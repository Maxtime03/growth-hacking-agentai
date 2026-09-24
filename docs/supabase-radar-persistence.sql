-- Déjà appliqué au projet Supabase Net.AI LeadOS le 22 septembre 2026.
-- Conserver ce fichier dans le dépôt pour documenter la structure de production.

create table if not exists public.search_run_leads (
  search_run_id uuid not null references public.search_runs(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  rank integer not null default 0 check (rank >= 0),
  created_at timestamptz not null default now(),
  primary key (search_run_id, lead_id)
);

alter table public.search_run_leads enable row level security;
revoke all on table public.search_run_leads from anon, authenticated;
grant select, insert, update, delete on table public.search_run_leads to service_role;

create policy "deny client access"
  on public.search_run_leads
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.leads
  add constraint leads_workspace_external_id_key unique (workspace_id, external_id);

create index if not exists search_run_leads_run_rank_idx
  on public.search_run_leads(search_run_id, rank);
create index if not exists search_run_leads_lead_id_idx
  on public.search_run_leads(lead_id);
create index if not exists leads_workspace_score_idx
  on public.leads(workspace_id, score desc, updated_at desc);
