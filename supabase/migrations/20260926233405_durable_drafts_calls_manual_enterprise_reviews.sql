-- Durable drafts, CRM calls, manual lead fields and evidence-first offer configuration.
alter table public.email_drafts
  alter column account_id drop not null,
  add column if not exists contact_id uuid references public.lead_contacts(id) on delete set null,
  add column if not exists created_by_email text,
  add column if not exists is_current boolean not null default true,
  add column if not exists last_saved_at timestamptz not null default now();

create unique index if not exists email_drafts_current_lead_idx
  on public.email_drafts(workspace_id, lead_id)
  where is_current and status in ('local','approved') and gmail_draft_id is null;
create index if not exists email_drafts_lead_updated_idx on public.email_drafts(lead_id, updated_at desc);

create table if not exists public.email_draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  subject text not null default '',
  icebreaker text not null default '',
  body text not null default '',
  signature text not null default '',
  source_evidence jsonb not null default '[]'::jsonb,
  change_reason text not null default 'manual',
  created_by_email text,
  created_at timestamptz not null default now(),
  unique(draft_id, version)
);
create index if not exists email_draft_versions_draft_idx on public.email_draft_versions(draft_id, version desc);

create table if not exists public.offer_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  offer_slug text not null check (offer_slug in ('lexicon','pluq','profitflow')),
  claim_key text not null,
  enabled boolean not null default false,
  exact_text text not null,
  evidence_or_condition text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, offer_slug, claim_key)
);

insert into public.offer_claims(workspace_id,offer_slug,claim_key,enabled,exact_text,evidence_or_condition)
select w.id,'lexicon',v.claim_key,v.enabled,v.exact_text,v.condition
from public.workspaces w cross join (values
  ('authority_web',true,'Renforcer l’autorité et la présence de la marque sur le Web.','Argument qualitatif Lexicon.'),
  ('search_ai_geo',true,'Développer la visibilité dans les moteurs de recherche et les moteurs IA/GEO.','Argument qualitatif Lexicon.'),
  ('durable_value',true,'Construire une valeur de notoriété durable, au-delà d’une campagne qui s’arrête avec son budget.','Ne contient aucune comparaison de prix.'),
  ('cheaper_than_ads',false,'Moins cher que Google Ads.','Activation interdite sans comparaison chiffrée et sourcée.'),
  ('refund_guarantee',false,'Satisfait ou remboursé.','Activation interdite sans garantie commerciale contractuelle enregistrée.')
) as v(claim_key,enabled,exact_text,condition)
where w.slug='lexicon'
on conflict(workspace_id,offer_slug,claim_key) do nothing;

create table if not exists public.call_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  contact_id uuid references public.lead_contacts(id) on delete set null,
  outcome text not null check(outcome in ('no_answer','callback','interested','meeting','refused','wrong_number')),
  notes text,
  called_at timestamptz not null default now(),
  callback_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists call_activities_lead_idx on public.call_activities(lead_id, called_at desc);
create index if not exists call_activities_callback_idx on public.call_activities(workspace_id, callback_at) where callback_at is not null;

alter table public.leads
  add column if not exists opportunity_value_min numeric(14,2),
  add column if not exists opportunity_value_max numeric(14,2),
  add column if not exists currency char(3) not null default 'EUR',
  add column if not exists tax_included boolean,
  add column if not exists notes text,
  add column if not exists consent_status text,
  add column if not exists source_detail text,
  add column if not exists legal_entity text,
  add column if not exists office_scope text,
  add column if not exists budget_probability text,
  add column if not exists budget_confidence numeric(5,2),
  add column if not exists grand_account_score jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='leads_opportunity_range_check' and conrelid='public.leads'::regclass) then
    alter table public.leads add constraint leads_opportunity_range_check check(opportunity_value_min is null or opportunity_value_max is null or opportunity_value_min <= opportunity_value_max);
  end if;
  if not exists(select 1 from pg_constraint where conname='leads_consent_status_check' and conrelid='public.leads'::regclass) then
    alter table public.leads add constraint leads_consent_status_check check(consent_status is null or consent_status in ('unknown','legitimate_interest','consented','opposed','suppressed'));
  end if;
  if not exists(select 1 from pg_constraint where conname='leads_budget_confidence_check' and conrelid='public.leads'::regclass) then
    alter table public.leads add constraint leads_budget_confidence_check check(budget_confidence is null or budget_confidence between 0 and 100);
  end if;
end $$;

create table if not exists public.lead_review_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  google_place_id text not null,
  rating numeric(3,2),
  review_count integer,
  positive_themes text[] not null default '{}',
  negative_themes text[] not null default '{}',
  communication_opportunities text[] not null default '{}',
  source_url text not null,
  attribution text not null default 'Google',
  provider_review_count smallint not null default 0 check(provider_review_count between 0 and 5),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  unique(lead_id, google_place_id)
);
create index if not exists lead_review_insights_lead_idx on public.lead_review_insights(lead_id, fetched_at desc);

alter table public.email_draft_versions enable row level security;
alter table public.offer_claims enable row level security;
alter table public.call_activities enable row level security;
alter table public.lead_review_insights enable row level security;

drop policy if exists email_draft_versions_member_all on public.email_draft_versions;
create policy email_draft_versions_member_all on public.email_draft_versions for all to authenticated using ((select private.email_workspace_allowed(workspace_id))) with check ((select private.email_workspace_allowed(workspace_id)));
drop policy if exists offer_claims_member_select on public.offer_claims;
create policy offer_claims_member_select on public.offer_claims for select to authenticated using ((select private.email_workspace_allowed(workspace_id)));
drop policy if exists call_activities_member_all on public.call_activities;
create policy call_activities_member_all on public.call_activities for all to authenticated using ((select private.email_workspace_allowed(workspace_id))) with check ((select private.email_workspace_allowed(workspace_id)));
drop policy if exists lead_review_insights_member_all on public.lead_review_insights;
create policy lead_review_insights_member_all on public.lead_review_insights for all to authenticated using ((select private.email_workspace_allowed(workspace_id))) with check ((select private.email_workspace_allowed(workspace_id)));

revoke all on public.email_draft_versions,public.offer_claims,public.call_activities,public.lead_review_insights from anon;
grant select,insert,update,delete on public.email_draft_versions,public.call_activities,public.lead_review_insights to authenticated;
grant select on public.offer_claims to authenticated;
