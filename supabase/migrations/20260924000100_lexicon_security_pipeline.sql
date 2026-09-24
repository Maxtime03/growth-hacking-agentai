-- Lexicon access, workspace scoring, provider/enrichment traceability.
-- Idempotent: this migration only adds nullable columns/tables and moves the
-- explicitly identified manual Lexicon leads by UUID.

alter table public.workspace_members
  add column if not exists permissions jsonb not null default '{}'::jsonb;

alter table public.leads
  add column if not exists pipeline_stage text not null default 'new',
  add column if not exists temperature text not null default 'non_contacte',
  add column if not exists fit_score smallint not null default 0,
  add column if not exists priority_score smallint not null default 0,
  add column if not exists data_confidence smallint not null default 0,
  add column if not exists score_model_version text not null default 'v1',
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb;

alter table public.leads
  drop constraint if exists leads_pipeline_stage_check;
alter table public.leads
  add constraint leads_pipeline_stage_check check (pipeline_stage in ('new','to_qualify','contacted','replied','meeting','negotiation','won','lost','blocked'));
alter table public.leads
  drop constraint if exists leads_temperature_check;
alter table public.leads
  add constraint leads_temperature_check check (temperature in ('non_contacte','froid','tiede','chaud'));
alter table public.leads
  drop constraint if exists leads_fit_score_check;
alter table public.leads
  add constraint leads_fit_score_check check (fit_score between 0 and 100);
alter table public.leads
  drop constraint if exists leads_priority_score_check;
alter table public.leads
  add constraint leads_priority_score_check check (priority_score between 0 and 100);
alter table public.leads
  drop constraint if exists leads_data_confidence_check;
alter table public.leads
  add constraint leads_data_confidence_check check (data_confidence between 0 and 100);

create table if not exists public.enrichment_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  provider text not null,
  source_url text,
  status text not null default 'collected' check (status in ('collected','failed','blocked')),
  collected_at timestamptz not null default now(),
  confidence text check (confidence in ('verified','probable','to_verify')),
  fields jsonb not null default '{}'::jsonb,
  raw_snapshot jsonb not null default '{}'::jsonb
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  enrichment_source_id uuid references public.enrichment_sources(id) on delete set null,
  category text not null,
  fact text not null,
  source_url text,
  source_title text,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  confidence text not null default 'to_verify' check (confidence in ('verified','probable','to_verify'))
);

create table if not exists public.provider_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  provider text not null,
  actor_handle text,
  provider_run_id text,
  dataset_id text,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled','timing_out','timed_out','aborting','aborted')),
  sanitized_input jsonb not null default '{}'::jsonb,
  error_excerpt text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_run_id)
);

create index if not exists leads_workspace_pipeline_idx on public.leads(workspace_id,pipeline_stage,temperature,priority_score desc);
create index if not exists enrichment_sources_workspace_lead_idx on public.enrichment_sources(workspace_id,lead_id,collected_at desc);
create index if not exists evidence_workspace_lead_idx on public.evidence(workspace_id,lead_id,collected_at desc);
create index if not exists provider_runs_workspace_status_idx on public.provider_runs(workspace_id,status,created_at desc);

alter table public.enrichment_sources enable row level security;
alter table public.evidence enable row level security;
alter table public.provider_runs enable row level security;

drop policy if exists enrichment_sources_member_all on public.enrichment_sources;
create policy enrichment_sources_member_all on public.enrichment_sources for all to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id=enrichment_sources.workspace_id and m.user_id=(select auth.uid())))
  with check (exists (select 1 from public.workspace_members m where m.workspace_id=enrichment_sources.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists evidence_member_all on public.evidence;
create policy evidence_member_all on public.evidence for all to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id=evidence.workspace_id and m.user_id=(select auth.uid())))
  with check (exists (select 1 from public.workspace_members m where m.workspace_id=evidence.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists provider_runs_member_all on public.provider_runs;
create policy provider_runs_member_all on public.provider_runs for all to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id=provider_runs.workspace_id and m.user_id=(select auth.uid())))
  with check (exists (select 1 from public.workspace_members m where m.workspace_id=provider_runs.workspace_id and m.user_id=(select auth.uid())));

grant select, insert, update, delete on public.enrichment_sources, public.evidence, public.provider_runs to authenticated;
revoke all on public.enrichment_sources, public.evidence, public.provider_runs from anon;

-- Explicitly identified manual Lexicon leads. Relations remain intact because
-- only the tenant FK is changed; lead/contact/deal/activity IDs are preserved.
with moved(id) as (values
 ('eeb900a4-2bae-40a2-af6a-196a1077c295'::uuid),
 ('50293543-262d-4db9-8ea5-25388a798581'::uuid),
 ('1a94b1d6-1418-40e5-ae6c-ee4cf4a4af74'::uuid),
 ('44144745-d01f-4f5d-9aac-760de9c02019'::uuid),
 ('32b0e8b4-c45e-45d0-934a-d48e1ee7b4f3'::uuid),
 ('38e39744-5dc4-4a26-a597-2fef772fe42b'::uuid),
 ('06d8ad4e-2ca6-4afe-b36f-a8ac0dc002d4'::uuid),
 ('becd0019-f762-43ed-b188-d8a7f16fee6d'::uuid),
 ('e25707d8-79b3-4149-aa06-7258d722c0b5'::uuid),
 ('41c090fd-22c3-4bb0-a292-eeb053bea488'::uuid))
update public.leads l set workspace_id=(select id from public.workspaces where slug='lexicon'), updated_at=now()
where l.id in (select id from moved) and l.workspace_id=(select id from public.workspaces where slug='net-ai');

update public.contacts c set workspace_id=(select l.workspace_id from public.leads l where l.id=c.lead_id)
where c.lead_id in ('eeb900a4-2bae-40a2-af6a-196a1077c295','50293543-262d-4db9-8ea5-25388a798581','1a94b1d6-1418-40e5-ae6c-ee4cf4a4af74','44144745-d01f-4f5d-9aac-760de9c02019','32b0e8b4-c45e-45d0-934a-d48e1ee7b4f3','38e39744-5dc4-4a26-a597-2fef772fe42b','06d8ad4e-2ca6-4afe-b36f-a8ac0dc002d4','becd0019-f762-43ed-b188-d8a7f16fee6d','e25707d8-79b3-4149-aa06-7258d722c0b5','41c090fd-22c3-4bb0-a292-eeb053bea488');

grant select on public.workspaces to authenticated;
