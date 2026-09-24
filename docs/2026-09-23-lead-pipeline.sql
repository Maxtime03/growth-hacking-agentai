-- Déjà appliqué au projet Supabase Net.AI OS.
-- Conserver ce fichier pour reproduire le schéma sur un autre projet.
alter table public.leads
  add column if not exists deal_status text not null default 'new'
    check (deal_status in ('new','qualified','contacted','negotiation','won','lost')),
  add column if not exists opportunity_value numeric(12,2),
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists lost_reason text;

create index if not exists leads_workspace_deal_status_idx
  on public.leads (workspace_id, deal_status);

create index if not exists leads_next_action_at_idx
  on public.leads (next_action_at)
  where next_action_at is not null;
