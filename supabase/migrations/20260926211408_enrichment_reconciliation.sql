-- Durable, idempotent enrichment completion and autonomous reconciliation.
-- The RPCs are SECURITY INVOKER and executable only by service_role: the Edge
-- runtime keeps its normal database privileges while the whole finalization is
-- committed as a single PostgreSQL transaction.

alter table public.enrichment_runs
  add column if not exists heartbeat_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists finished_at timestamptz;

alter table public.enrichment_sources
  add column if not exists enrichment_run_id uuid references public.enrichment_runs(id) on delete set null,
  add column if not exists dedupe_key text;

alter table public.evidence
  add column if not exists enrichment_run_id uuid references public.enrichment_runs(id) on delete set null,
  add column if not exists dedupe_key text;

alter table public.provider_webhook_events
  add column if not exists enrichment_run_id uuid references public.enrichment_runs(id) on delete set null,
  add column if not exists dataset_id text,
  add column if not exists attempts integer not null default 0,
  add column if not exists error_message text;

create index if not exists enrichment_runs_reconcile_idx
  on public.enrichment_runs(status, lease_expires_at, created_at)
  where status = 'running';
create index if not exists enrichment_sources_run_idx
  on public.enrichment_sources(enrichment_run_id)
  where enrichment_run_id is not null;
create index if not exists evidence_run_idx
  on public.evidence(enrichment_run_id)
  where enrichment_run_id is not null;
create unique index if not exists enrichment_sources_dedupe_idx
  on public.enrichment_sources(lead_id, provider, dedupe_key)
  where dedupe_key is not null;
create unique index if not exists evidence_dedupe_idx
  on public.evidence(lead_id, dedupe_key)
  where dedupe_key is not null;
create index if not exists provider_webhook_events_run_idx
  on public.provider_webhook_events(enrichment_run_id, created_at desc)
  where enrichment_run_id is not null;

create or replace function public.claim_enrichment_reconciliation(
  p_lease_seconds integer default 120,
  p_limit integer default 5
)
returns table (
  id uuid,
  workspace_id uuid,
  lead_id uuid,
  actor_run_id text,
  default_dataset_id text,
  provider_status text,
  attempts smallint,
  max_attempts smallint,
  message_id bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'lease seconds must be between 30 and 900';
  end if;
  if p_limit < 1 or p_limit > 25 then
    raise exception 'limit must be between 1 and 25';
  end if;

  return query
  with candidates as (
    select run.id
    from public.enrichment_runs run
    where run.status = 'running'
      and run.actor_run_id is not null
      and coalesce(run.lease_expires_at, run.heartbeat_at, run.locked_at, run.created_at) <= now()
      and run.attempts < run.max_attempts
    order by coalesce(run.lease_expires_at, run.heartbeat_at, run.locked_at, run.created_at)
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.enrichment_runs run
    set locked_at = now(),
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where run.id = candidates.id
    returning run.*
  )
  select claimed.id,
         claimed.workspace_id,
         claimed.lead_id,
         claimed.actor_run_id,
         claimed.default_dataset_id,
         claimed.provider_status,
         claimed.attempts,
         claimed.max_attempts,
         case
           when claimed.result ? 'messageId'
             and (claimed.result->>'messageId') ~ '^[0-9]+$'
           then (claimed.result->>'messageId')::bigint
           else null
         end
  from claimed;
end;
$$;

create or replace function public.renew_enrichment_lease(
  p_run_id uuid,
  p_provider_status text,
  p_lease_seconds integer default 120
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public
as $$
  update public.enrichment_runs
  set provider_status = left(coalesce(p_provider_status, provider_status), 80),
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
      locked_at = null
  where id = p_run_id and status = 'running'
  returning true
$$;

create or replace function public.finalize_enrichment_run(
  p_run_id uuid,
  p_actor_run_id text,
  p_dataset_id text,
  p_item jsonb,
  p_event_id text default null,
  p_usage_total_usd numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  run public.enrichment_runs%rowtype;
  source_id uuid;
  evidence_id uuid;
  source_url text;
  source_key text;
  evidence_key text;
  item jsonb := coalesce(p_item, '{}'::jsonb);
begin
  select * into run
  from public.enrichment_runs
  where id = p_run_id
  for update;

  if not found then raise exception 'enrichment run % not found', p_run_id; end if;
  if run.actor_run_id is distinct from p_actor_run_id then
    raise exception 'actor run mismatch for %: expected %, received %', p_run_id, run.actor_run_id, p_actor_run_id;
  end if;
  if run.status = 'completed' then
    if p_event_id is not null then
      update public.provider_webhook_events
      set enrichment_run_id = run.id,
          dataset_id = coalesce(nullif(p_dataset_id, ''), run.default_dataset_id),
          processed_at = now(),
          error_message = null
      where provider = 'apify' and event_id = p_event_id;
    end if;
    return jsonb_build_object('status','duplicate','jobId',run.id,'datasetId',run.default_dataset_id);
  end if;
  if run.status not in ('running','queued') then
    raise exception 'enrichment run % is terminal with status %', p_run_id, run.status;
  end if;
  if nullif(p_dataset_id, '') is null then raise exception 'dataset id is required'; end if;

  source_url := coalesce(
    nullif(item->>'website',''), nullif(item->>'url',''),
    nullif(item->>'googleMapsUrl',''), 'https://api.apify.com/v2/datasets/' || p_dataset_id
  );
  source_key := 'apify:' || p_actor_run_id || ':' || p_dataset_id;
  evidence_key := source_key || ':business-identity';

  update public.leads
  set company_name = coalesce(nullif(item->>'title',''), nullif(item->>'name',''), company_name),
      legal_name = coalesce(nullif(item->>'title',''), nullif(item->>'name',''), legal_name),
      website = coalesce(nullif(item->>'website',''), website),
      domain = coalesce(nullif(regexp_replace(item->>'website', '^https?://(www\.)?', '', 'i'), ''), domain),
      phone = coalesce(nullif(item->>'phone',''), phone),
      address = coalesce(nullif(item->>'address',''), address),
      city = coalesce(nullif(item->>'city',''), city),
      category = coalesce(nullif(item->>'categoryName',''), nullif(item->>'category',''), category),
      google_place_id = coalesce(nullif(item->>'placeId',''), google_place_id),
      google_maps_url = coalesce(nullif(item->>'url',''), nullif(item->>'googleMapsUrl',''), google_maps_url),
      rating = coalesce(case when (item->>'totalScore') ~ '^[0-9]+(\.[0-9]+)?$' then (item->>'totalScore')::numeric else null end, rating),
      review_count = coalesce(case when (item->>'reviewsCount') ~ '^[0-9]+$' then (item->>'reviewsCount')::integer else null end, review_count),
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('apify_enrichment', item),
      status = 'enriched',
      last_enriched_at = now(),
      updated_at = now()
  where id = run.lead_id;

  insert into public.enrichment_sources (
    workspace_id, lead_id, enrichment_run_id, provider, source_url,
    status, confidence, fields, raw_snapshot, dedupe_key
  ) values (
    run.workspace_id, run.lead_id, run.id, 'apify_google_maps', source_url,
    'collected', 'verified', jsonb_build_object('datasetId',p_dataset_id,'actorRunId',p_actor_run_id), item, source_key
  )
  on conflict (lead_id, provider, dedupe_key) where dedupe_key is not null
  do update set collected_at = now(), status = 'collected', raw_snapshot = excluded.raw_snapshot
  returning id into source_id;

  insert into public.evidence (
    workspace_id, lead_id, enrichment_run_id, enrichment_source_id,
    category, fact, source_url, source_title, confidence, dedupe_key
  ) values (
    run.workspace_id, run.lead_id, run.id, source_id,
    'business_identity',
    coalesce(nullif(item->>'title',''), nullif(item->>'name',''), 'Résultat Google Maps vérifié'),
    source_url, 'Google Maps via Apify', 'verified', evidence_key
  )
  on conflict (lead_id, dedupe_key) where dedupe_key is not null
  do update set enrichment_source_id = excluded.enrichment_source_id, collected_at = now(), fact = excluded.fact
  returning id into evidence_id;

  insert into public.provider_runs (
    workspace_id, lead_id, provider, actor_handle, provider_run_id, dataset_id,
    status, sanitized_input, started_at, completed_at
  ) values (
    run.workspace_id, run.lead_id, 'apify', 'lukaskrivka/google-maps-with-contact-details',
    p_actor_run_id, p_dataset_id, 'succeeded',
    jsonb_build_object('maxItems',1,'reconciled',true), run.created_at, now()
  )
  on conflict (provider, provider_run_id)
  do update set dataset_id = excluded.dataset_id, status = 'succeeded', completed_at = now();

  update public.enrichment_queue
  set status = 'completed', locked_at = null, last_error = null, completed_at = now()
  where enrichment_run_id = run.id;

  update public.enrichment_runs
  set status = 'completed', progress = 100, provider_status = 'SUCCEEDED',
      default_dataset_id = p_dataset_id, provider_payload = item,
      fields_found = array['company','sources'],
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'provider','apify','actorRunId',p_actor_run_id,'datasetId',p_dataset_id,
        'item',item,'sourceId',source_id,'evidenceId',evidence_id
      ),
      cost_amount = coalesce(p_usage_total_usd, cost_amount),
      error_message = null, completed_at = now(), finished_at = now(),
      heartbeat_at = now(), lease_expires_at = null, locked_at = null,
      ai_status = coalesce(ai_status, 'waiting')
  where id = run.id;

  if p_event_id is not null then
    update public.provider_webhook_events
    set enrichment_run_id = run.id, dataset_id = p_dataset_id,
        processed_at = now(), error_message = null
    where provider = 'apify' and event_id = p_event_id;
  end if;

  return jsonb_build_object(
    'status','completed','jobId',run.id,'datasetId',p_dataset_id,
    'sourceId',source_id,'evidenceId',evidence_id
  );
exception when others then
  raise;
end;
$$;

create or replace function public.fail_enrichment_attempt(
  p_run_id uuid,
  p_provider_status text,
  p_error_message text,
  p_event_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  run public.enrichment_runs%rowtype;
  next_attempt integer;
  terminal boolean;
begin
  select * into run from public.enrichment_runs where id = p_run_id for update;
  if not found then raise exception 'enrichment run % not found', p_run_id; end if;
  if run.status = 'completed' then return jsonb_build_object('status','duplicate','jobId',run.id); end if;

  next_attempt := run.attempts + 1;
  terminal := next_attempt >= run.max_attempts;
  update public.enrichment_runs
  set status = case when terminal then 'failed' else 'running' end,
      attempts = next_attempt,
      provider_status = left(coalesce(p_provider_status,'UNKNOWN'),80),
      error_message = left(coalesce(p_error_message,'Erreur fournisseur sans détail'),2000),
      next_retry_at = case when terminal then null else now() + make_interval(secs => least(900, 30 * (2 ^ next_attempt)::integer)) end,
      completed_at = case when terminal then now() else null end,
      finished_at = case when terminal then now() else null end,
      heartbeat_at = now(), lease_expires_at = null, locked_at = null
  where id = run.id;

  update public.enrichment_queue
  set status = case when terminal then 'failed' else 'running' end,
      attempts = next_attempt, last_error = left(coalesce(p_error_message,'Erreur fournisseur sans détail'),2000),
      locked_at = null, completed_at = case when terminal then now() else null end
  where enrichment_run_id = run.id;

  if p_event_id is not null then
    update public.provider_webhook_events
    set enrichment_run_id = run.id, attempts = next_attempt,
        processed_at = now(), error_message = left(coalesce(p_error_message,'Erreur fournisseur sans détail'),2000)
    where provider = 'apify' and event_id = p_event_id;
  end if;
  return jsonb_build_object('status',case when terminal then 'failed' else 'retry' end,'jobId',run.id,'attempts',next_attempt,'terminal',terminal);
end;
$$;

revoke all on function public.claim_enrichment_reconciliation(integer, integer) from public, anon, authenticated;
revoke all on function public.renew_enrichment_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finalize_enrichment_run(uuid, text, text, jsonb, text, numeric) from public, anon, authenticated;
revoke all on function public.fail_enrichment_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_enrichment_reconciliation(integer, integer) to service_role;
grant execute on function public.renew_enrichment_lease(uuid, text, integer) to service_role;
grant execute on function public.finalize_enrichment_run(uuid, text, text, jsonb, text, numeric) to service_role;
grant execute on function public.fail_enrichment_attempt(uuid, text, text, text) to service_role;

-- Existing running rows predate leases. Make them immediately eligible for the
-- first autonomous reconciliation tick without changing their business state.
update public.enrichment_runs
set heartbeat_at = coalesce(heartbeat_at, locked_at, created_at),
    lease_expires_at = coalesce(lease_expires_at, locked_at, created_at)
where status = 'running' and actor_run_id is not null;
