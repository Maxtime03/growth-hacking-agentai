-- Net.AI OS operational tables and workspace-scoped RLS.
-- Apply after the existing base tables (workspaces, leads, search_runs,
-- email_connections) have been created.

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.apify_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  search_run_id uuid references public.search_runs(id) on delete set null, provider text not null default 'apify',
  actor_id text not null, provider_run_id text not null, dataset_id text, idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  input jsonb not null default '{}'::jsonb, error_message text, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), unique(workspace_id,idempotency_key), unique(provider_run_id)
);

create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  source_type text not null, source_url text, collected_at timestamptz not null default now(), confidence numeric(5,2), raw_data jsonb not null default '{}'::jsonb
);
create table if not exists public.lead_enrichments (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  provider text not null, status text not null default 'completed' check(status in ('queued','running','completed','failed')),
  facts jsonb not null default '[]'::jsonb, collected_at timestamptz not null default now(), error_message text
);
create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade, activity_type text not null,
  body text, metadata jsonb not null default '{}'::jsonb, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(), connection_id uuid references public.email_connections(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null, provider_message_id text not null, thread_id text,
  direction text not null check(direction in ('inbound','outbound')), classification text check(classification in ('positive','negative','neutral','question','no_reply','sent')),
  subject text, snippet text, has_attachments boolean not null default false, collected_at timestamptz not null default now(), unique(connection_id,provider_message_id)
);
create table if not exists public.suppression_list (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id) on delete cascade,
  email text, phone text, reason text, created_at timestamptz not null default now(), check(email is not null or phone is not null)
);

create index if not exists apify_runs_workspace_status_idx on public.apify_runs(workspace_id,status,created_at desc);
create index if not exists lead_sources_lead_idx on public.lead_sources(lead_id,collected_at desc);
create index if not exists lead_enrichments_lead_idx on public.lead_enrichments(lead_id,collected_at desc);
create index if not exists lead_activities_lead_idx on public.lead_activities(lead_id,created_at desc);
create index if not exists email_messages_thread_idx on public.email_messages(thread_id,collected_at desc);
create index if not exists suppression_email_idx on public.suppression_list(lower(email)) where email is not null;

alter table public.workspace_members enable row level security;
alter table public.apify_runs enable row level security;
alter table public.lead_sources enable row level security;
alter table public.lead_enrichments enable row level security;
alter table public.lead_activities enable row level security;
alter table public.email_messages enable row level security;
alter table public.suppression_list enable row level security;
alter table public.leads enable row level security;
alter table public.search_runs enable row level security;

drop policy if exists workspace_members_self on public.workspace_members;
create policy workspace_members_self on public.workspace_members for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists apify_runs_member_select on public.apify_runs;
create policy apify_runs_member_select on public.apify_runs for select to authenticated using (exists(select 1 from public.workspace_members m where m.workspace_id=apify_runs.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists lead_activities_member_all on public.lead_activities;
create policy lead_activities_member_all on public.lead_activities for all to authenticated using (exists(select 1 from public.workspace_members m where m.workspace_id=lead_activities.workspace_id and m.user_id=(select auth.uid()))) with check (exists(select 1 from public.workspace_members m where m.workspace_id=lead_activities.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists suppression_member_all on public.suppression_list;
create policy suppression_member_all on public.suppression_list for all to authenticated using (workspace_id is null or exists(select 1 from public.workspace_members m where m.workspace_id=suppression_list.workspace_id and m.user_id=(select auth.uid()))) with check (workspace_id is null or exists(select 1 from public.workspace_members m where m.workspace_id=suppression_list.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists lead_sources_member_select on public.lead_sources;
create policy lead_sources_member_select on public.lead_sources for select to authenticated using (exists(select 1 from public.leads l join public.workspace_members m on m.workspace_id=l.workspace_id where l.id=lead_sources.lead_id and m.user_id=(select auth.uid())));
drop policy if exists lead_enrichments_member_select on public.lead_enrichments;
create policy lead_enrichments_member_select on public.lead_enrichments for select to authenticated using (exists(select 1 from public.leads l join public.workspace_members m on m.workspace_id=l.workspace_id where l.id=lead_enrichments.lead_id and m.user_id=(select auth.uid())));
drop policy if exists email_messages_member_select on public.email_messages;
create policy email_messages_member_select on public.email_messages for select to authenticated using (exists(select 1 from public.email_connections c where c.id=email_messages.connection_id and c.owner_email=(select auth.email())));
drop policy if exists leads_workspace_member_select on public.leads;
create policy leads_workspace_member_select on public.leads for select to authenticated using (exists(select 1 from public.workspace_members m where m.workspace_id=leads.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists leads_workspace_member_write on public.leads;
create policy leads_workspace_member_write on public.leads for update to authenticated using (exists(select 1 from public.workspace_members m where m.workspace_id=leads.workspace_id and m.user_id=(select auth.uid()))) with check (exists(select 1 from public.workspace_members m where m.workspace_id=leads.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists search_runs_workspace_member_all on public.search_runs;
create policy search_runs_workspace_member_all on public.search_runs for all to authenticated using (exists(select 1 from public.workspace_members m where m.workspace_id=search_runs.workspace_id and m.user_id=(select auth.uid()))) with check (exists(select 1 from public.workspace_members m where m.workspace_id=search_runs.workspace_id and m.user_id=(select auth.uid())));

revoke all on table public.workspace_members,public.apify_runs,public.lead_sources,public.lead_enrichments,public.lead_activities,public.email_messages,public.suppression_list from anon;
