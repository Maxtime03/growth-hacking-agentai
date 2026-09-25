create table if not exists public.enrichment_queue (
  id uuid primary key default gen_random_uuid(),
  enrichment_run_id uuid not null references public.enrichment_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(enrichment_run_id)
);
create index if not exists enrichment_queue_due_idx on public.enrichment_queue(status, available_at);
alter table public.enrichment_queue enable row level security;
drop policy if exists enrichment_queue_workspace_access on public.enrichment_queue;
create policy enrichment_queue_workspace_access on public.enrichment_queue for all using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = enrichment_queue.workspace_id and wm.user_id = auth.uid())
) with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = enrichment_queue.workspace_id and wm.user_id = auth.uid())
);
revoke all on public.enrichment_queue from anon;
grant select, insert, update on public.enrichment_queue to authenticated;
