-- Durable, workspace-scoped Gmail CRM. Additive only.
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  provider text not null default 'google' check (provider = 'google'),
  email_address text not null,
  display_name text,
  scopes text[] not null default '{}',
  encrypted_refresh_token text not null,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected','expired','error','revoked')),
  status_detail text,
  gmail_history_id text,
  watch_expiration timestamptz,
  last_sync_at timestamptz,
  last_verified_at timestamptz,
  synced_message_count bigint not null default 0,
  initial_sync_days smallint not null default 30 check (initial_sync_days between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_email, provider, email_address)
);

create table if not exists public.email_account_workspaces (
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, workspace_id)
);

create table if not exists public.email_sync_state (
  account_id uuid primary key references public.email_accounts(id) on delete cascade,
  history_id text,
  page_token text,
  initial_sync_completed_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_full_sync_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  last_error_detail text,
  notification_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gmail_thread_id text not null,
  lead_id uuid references public.leads(id) on delete set null,
  subject text,
  snippet text,
  classification text not null default 'unclassified' check (classification in ('positive','meeting','question','negative','not_now','vacation','unsubscribe','bounce','automatic','uncertain','unclassified')),
  confidence numeric(4,3) check (confidence between 0 and 1),
  unread boolean not null default false,
  needs_association boolean not null default false,
  candidate_lead_ids uuid[] not null default '{}',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_thread_id)
);

alter table public.email_messages
  add column if not exists account_id uuid references public.email_accounts(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists email_thread_id uuid references public.email_threads(id) on delete cascade,
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id text,
  add column if not exists history_id text,
  add column if not exists message_id_header text,
  add column if not exists in_reply_to text,
  add column if not exists references_header text,
  add column if not exists labels text[] not null default '{}',
  add column if not exists from_address text,
  add column if not exists to_addresses text[] not null default '{}',
  add column if not exists cc_addresses text[] not null default '{}',
  add column if not exists sent_at timestamptz,
  add column if not exists text_body text,
  add column if not exists html_body text,
  add column if not exists raw_headers jsonb not null default '{}'::jsonb,
  add column if not exists association_reason text,
  add column if not exists created_at timestamptz not null default now();
alter table public.email_messages drop constraint if exists email_messages_classification_check;
alter table public.email_messages add constraint email_messages_classification_check check (classification is null or classification in ('positive','meeting','question','negative','not_now','vacation','unsubscribe','bounce','automatic','uncertain','unclassified','neutral','no_reply','sent'));
update public.email_messages set gmail_message_id=provider_message_id where gmail_message_id is null;
update public.email_messages set gmail_thread_id=thread_id where gmail_thread_id is null;

create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.email_messages(id) on delete cascade,
  gmail_attachment_id text,
  filename text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now(),
  unique (message_id, gmail_attachment_id)
);

create table if not exists public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  thread_id uuid references public.email_threads(id) on delete set null,
  gmail_draft_id text,
  gmail_message_id text,
  recipient text not null,
  subject text not null default '',
  icebreaker text not null default '',
  body text not null default '',
  signature text not null default '',
  source_evidence jsonb not null default '[]'::jsonb,
  status text not null default 'local' check (status in ('local','gmail','approved','cancelled')),
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_draft_id)
);

alter table public.email_sequences
  add column if not exists lead_id uuid references public.leads(id) on delete cascade,
  add column if not exists account_id uuid references public.email_accounts(id) on delete set null,
  add column if not exists safe_draft_only boolean not null default true,
  add column if not exists resumed_at timestamptz;
alter table public.email_sequences drop constraint if exists email_sequences_status_check;
alter table public.email_sequences add constraint email_sequences_status_check check (status in ('draft','active','scheduled','paused','stopped','cancelled','completed'));

create table if not exists public.email_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  account_id uuid references public.email_accounts(id) on delete set null,
  step_order smallint not null check (step_order between 1 and 3),
  delay_days smallint not null default 0 check (delay_days between 0 and 365),
  scheduled_at timestamptz,
  subject text not null default '',
  body text not null default '',
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft','scheduled','sent','skipped','cancelled')),
  gmail_draft_id text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, step_order)
);

create table if not exists public.email_sequence_step_versions (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.email_sequence_steps(id) on delete cascade,
  version integer not null,
  subject text not null,
  body text not null,
  changed_at timestamptz not null default now(),
  unique (step_id, version)
);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid references public.email_accounts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  message_id uuid references public.email_messages(id) on delete set null,
  sequence_id uuid references public.email_sequences(id) on delete set null,
  event_type text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.email_classifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id uuid not null references public.email_messages(id) on delete cascade,
  classification text not null check (classification in ('positive','meeting','question','negative','not_now','vacation','unsubscribe','bounce','automatic','uncertain')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  human_validated boolean not null default false,
  return_at timestamptz,
  rationale text,
  created_at timestamptz not null default now()
);

alter table public.suppression_list
  add column if not exists kind text not null default 'unsubscribe' check (kind in ('unsubscribe','bounce','manual')),
  add column if not exists source_message_id uuid references public.email_messages(id) on delete set null;

create unique index if not exists suppression_workspace_email_unique on public.suppression_list(workspace_id, lower(email)) where email is not null;

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  email_thread_id uuid references public.email_threads(id) on delete cascade,
  task_type text not null check (task_type in ('reply','call','meeting','reminder','associate','review')),
  title text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_accounts_owner_idx on public.email_accounts(lower(owner_email), status);
create index if not exists email_account_workspaces_workspace_idx on public.email_account_workspaces(workspace_id, account_id);
create index if not exists email_threads_workspace_last_idx on public.email_threads(workspace_id, last_message_at desc);
create index if not exists email_threads_lead_idx on public.email_threads(lead_id, last_message_at desc) where lead_id is not null;
create unique index if not exists email_messages_account_gmail_unique on public.email_messages(account_id, gmail_message_id) where account_id is not null and gmail_message_id is not null;
create index if not exists email_messages_thread_sent_idx on public.email_messages(email_thread_id, sent_at asc);
create index if not exists email_messages_lead_sent_idx on public.email_messages(lead_id, sent_at desc) where lead_id is not null;
create index if not exists email_messages_reply_headers_idx on public.email_messages(message_id_header) where message_id_header is not null;
create index if not exists email_sequence_steps_due_idx on public.email_sequence_steps(status, scheduled_at) where status = 'scheduled';
create index if not exists email_events_lead_idx on public.email_events(lead_id, created_at desc);
create index if not exists crm_tasks_due_idx on public.crm_tasks(workspace_id, status, due_at) where status = 'open';

create schema if not exists private;
create or replace function private.email_workspace_allowed(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()));
$$;
revoke all on function private.email_workspace_allowed(uuid) from public, anon, authenticated;

do $$ declare table_name text; begin
  foreach table_name in array array['email_accounts','email_account_workspaces','email_sync_state','email_threads','email_attachments','email_drafts','email_sequence_steps','email_sequence_step_versions','email_events','email_classifications','crm_tasks'] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

drop policy if exists email_accounts_member_select on public.email_accounts;
create policy email_accounts_member_select on public.email_accounts for select to authenticated using (
  lower(owner_email)=lower((select auth.email())) and exists(select 1 from public.email_account_workspaces aw where aw.account_id=id and (select private.email_workspace_allowed(aw.workspace_id)))
);
drop policy if exists email_account_workspaces_member_select on public.email_account_workspaces;
create policy email_account_workspaces_member_select on public.email_account_workspaces for select to authenticated using ((select private.email_workspace_allowed(workspace_id)));

do $$ declare t text; begin
  foreach t in array array['email_threads','email_drafts','email_sequence_steps','email_events','email_classifications','crm_tasks'] loop
    execute format('drop policy if exists %I on public.%I', t||'_member_all', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select private.email_workspace_allowed(workspace_id))) with check ((select private.email_workspace_allowed(workspace_id)))', t||'_member_all', t);
  end loop;
end $$;

drop policy if exists email_sync_state_member_select on public.email_sync_state;
create policy email_sync_state_member_select on public.email_sync_state for select to authenticated using (exists(select 1 from public.email_accounts a where a.id=account_id and lower(a.owner_email)=lower((select auth.email()))));
drop policy if exists email_attachments_member_select on public.email_attachments;
create policy email_attachments_member_select on public.email_attachments for select to authenticated using (exists(select 1 from public.email_messages m where m.id=message_id and (select private.email_workspace_allowed(m.workspace_id))));
drop policy if exists email_sequence_step_versions_member_select on public.email_sequence_step_versions;
create policy email_sequence_step_versions_member_select on public.email_sequence_step_versions for select to authenticated using (exists(select 1 from public.email_sequence_steps s where s.id=step_id and (select private.email_workspace_allowed(s.workspace_id))));
drop policy if exists email_messages_workspace_member_select on public.email_messages;
create policy email_messages_workspace_member_select on public.email_messages for select to authenticated using ((select private.email_workspace_allowed(workspace_id)));

revoke all on public.email_accounts, public.email_account_workspaces, public.email_sync_state, public.email_threads, public.email_attachments, public.email_drafts, public.email_sequence_steps, public.email_sequence_step_versions, public.email_events, public.email_classifications, public.crm_tasks from anon;
grant select,insert,update,delete on public.email_accounts, public.email_account_workspaces, public.email_sync_state, public.email_threads, public.email_attachments, public.email_drafts, public.email_sequence_steps, public.email_sequence_step_versions, public.email_events, public.email_classifications, public.crm_tasks to authenticated;

create or replace function public.stop_email_sequence_on_inbound()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_sequence_id uuid; v_class text; v_conf numeric; v_email text; v_task text; begin
  if new.direction <> 'inbound' or new.lead_id is null or new.workspace_id is null then return new; end if;
  select classification,confidence into v_class,v_conf from public.email_classifications where message_id=new.id order by created_at desc limit 1;
  v_class:=coalesce(v_class,new.classification,'uncertain'); v_conf:=coalesce(v_conf,0.5);
  select id into v_sequence_id from public.email_sequences where lead_id=new.lead_id and workspace_id=new.workspace_id and status in ('draft','active','paused','scheduled') order by created_at desc limit 1;
  update public.email_sequence_steps set status='cancelled',updated_at=now() where sequence_id in (select id from public.email_sequences where lead_id=new.lead_id and workspace_id=new.workspace_id and status in ('draft','active','paused','scheduled')) and status in ('draft','scheduled');
  update public.email_sequences set status='stopped',stopped_at=now(),stop_reason='inbound_reply:'||v_class,updated_at=now() where lead_id=new.lead_id and workspace_id=new.workspace_id and status in ('draft','active','paused','scheduled');
  update public.leads set last_interaction_at=coalesce(new.sent_at,now()),pipeline_stage=case when v_class in ('positive','meeting') then 'replied' else pipeline_stage end,temperature=case when v_class in ('positive','meeting') then 'chaud' else temperature end,next_action=case when v_class='meeting' then 'Proposer deux créneaux' when v_class='positive' then 'Répondre aujourd''hui' when v_class='vacation' then 'Reprendre après le retour' else 'Qualifier et répondre' end,updated_at=now() where id=new.lead_id;
  insert into public.email_events(workspace_id,account_id,lead_id,message_id,sequence_id,event_type,reason,metadata) values(new.workspace_id,new.account_id,new.lead_id,new.id,v_sequence_id,'sequence_stopped','Toute réponse humaine arrête les étapes futures',jsonb_build_object('classification',v_class,'confidence',v_conf));
  v_task:=case when v_class='meeting' then 'meeting' when v_class='positive' then 'reply' when v_class='vacation' then 'reminder' else 'review' end;
  insert into public.crm_tasks(workspace_id,lead_id,email_thread_id,task_type,title,due_at) values(new.workspace_id,new.lead_id,new.email_thread_id,v_task,case when v_class='meeting' then 'Proposer deux créneaux' when v_class='positive' then 'Répondre au prospect' when v_class='vacation' then 'Programmer la reprise' else 'Valider la réponse' end,case when v_class='vacation' then now()+interval '7 days' else now()+interval '1 day' end);
  if v_class in ('unsubscribe','bounce') then
    v_email:=lower(split_part(new.from_address,'<',1));
    insert into public.suppression_list(workspace_id,email,reason,kind,source_message_id) values(new.workspace_id,v_email,'Réponse Gmail classée '||v_class,case when v_class='bounce' then 'bounce' else 'unsubscribe' end,new.id) on conflict (workspace_id,lower(email)) where email is not null do update set reason=excluded.reason,kind=excluded.kind,source_message_id=excluded.source_message_id;
  end if;
  return new;
end $$;
drop trigger if exists email_stop_sequence_after_inbound on public.email_messages;
create trigger email_stop_sequence_after_inbound after insert on public.email_messages for each row execute function public.stop_email_sequence_on_inbound();

-- Cron dispatch uses Vault values configured out-of-band; no secret is stored in Git.
create or replace function public.sync_gmail_accounts_cron()
returns bigint language plpgsql security definer set search_path=pg_catalog,public,vault,net as $$
declare worker_url text; auth_token text; request_id bigint; begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='GMAIL_SYNC_WORKER_URL' limit 1;
  select decrypted_secret into auth_token from vault.decrypted_secrets where name='GMAIL_SYNC_WORKER_AUTH' limit 1;
  if worker_url is null or auth_token is null then raise exception 'gmail sync worker Vault configuration missing'; end if;
  select net.http_post(url:=worker_url,headers:=jsonb_build_object('content-type','application/json','apikey',auth_token,'authorization','Bearer '||auth_token),body:='{"source":"pg_cron"}'::jsonb,timeout_milliseconds:=15000) into request_id;
  return request_id;
end $$;
revoke all on function public.sync_gmail_accounts_cron() from public,anon,authenticated;
grant execute on function public.sync_gmail_accounts_cron() to postgres;
select cron.unschedule(jobid) from cron.job where jobname='sync-gmail-accounts';
select cron.schedule('sync-gmail-accounts','*/3 * * * *',$$select public.sync_gmail_accounts_cron();$$) where not exists(select 1 from cron.job where jobname='sync-gmail-accounts');
