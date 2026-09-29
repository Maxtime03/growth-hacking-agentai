-- Additive lead intelligence schema: normalized company/location fields and
-- people stored separately from companies. All public tables are protected by
-- workspace-scoped RLS and explicitly hidden from anon.

alter table public.leads
  add column if not exists search_run_id uuid references public.search_runs(id) on delete set null,
  add column if not exists legal_name text,
  add column if not exists description text,
  add column if not exists sector text,
  add column if not exists category text,
  add column if not exists domain text,
  add column if not exists city text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists google_place_id text,
  add column if not exists google_maps_url text,
  add column if not exists google_business_url text,
  add column if not exists rating numeric(3,2),
  add column if not exists review_count integer,
  add column if not exists opening_hours jsonb not null default '{}'::jsonb,
  add column if not exists photo_url text,
  add column if not exists logo_url text,
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists company_size text,
  add column if not exists employee_count integer,
  add column if not exists founded_year integer,
  add column if not exists last_interaction_at timestamptz;

alter table public.leads drop constraint if exists leads_latitude_check;
alter table public.leads add constraint leads_latitude_check check (latitude is null or latitude between -90 and 90);
alter table public.leads drop constraint if exists leads_longitude_check;
alter table public.leads add constraint leads_longitude_check check (longitude is null or longitude between -180 and 180);
alter table public.leads drop constraint if exists leads_rating_check;
alter table public.leads add constraint leads_rating_check check (rating is null or rating between 0 and 5);
alter table public.leads drop constraint if exists leads_review_count_check;
alter table public.leads add constraint leads_review_count_check check (review_count is null or review_count >= 0);
alter table public.leads drop constraint if exists leads_employee_count_check;
alter table public.leads add constraint leads_employee_count_check check (employee_count is null or employee_count >= 0);
alter table public.leads drop constraint if exists leads_founded_year_check;
alter table public.leads add constraint leads_founded_year_check check (founded_year is null or founded_year between 1500 and 2200);

create table if not exists public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  first_name text,
  last_name text,
  full_name text not null,
  title text,
  department text,
  seniority text,
  email text,
  phone text,
  linkedin_url text,
  profile_photo_url text,
  headline text,
  about text,
  location text,
  experience jsonb not null default '[]'::jsonb,
  education jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  source text not null,
  confidence_score smallint not null default 0 check (confidence_score between 0 and 100),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, linkedin_url)
);

create index if not exists leads_workspace_filters_idx
  on public.leads(workspace_id, pipeline_stage, temperature, fit_score desc, created_at desc);
create index if not exists leads_workspace_location_idx
  on public.leads(workspace_id, country_code, region, city);
create index if not exists leads_workspace_next_action_idx
  on public.leads(workspace_id, next_action_at) where next_action_at is not null;
create index if not exists leads_search_run_idx
  on public.leads(search_run_id) where search_run_id is not null;
create index if not exists lead_contacts_workspace_lead_idx
  on public.lead_contacts(workspace_id, lead_id, is_primary desc, confidence_score desc);
create index if not exists lead_contacts_linkedin_idx
  on public.lead_contacts(linkedin_url) where linkedin_url is not null;

update public.leads lead
set search_run_id = latest.search_run_id
from (
  select distinct on (link.lead_id) link.lead_id, link.search_run_id
  from public.search_run_leads link
  join public.search_runs run on run.id = link.search_run_id
  order by link.lead_id, run.created_at desc
) latest
where lead.id = latest.lead_id
  and lead.search_run_id is null;

alter table public.lead_contacts enable row level security;

drop policy if exists lead_contacts_member_select on public.lead_contacts;
create policy lead_contacts_member_select on public.lead_contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = lead_contacts.workspace_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists lead_contacts_member_insert on public.lead_contacts;
create policy lead_contacts_member_insert on public.lead_contacts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = lead_contacts.workspace_id
        and member.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.leads lead
      where lead.id = lead_contacts.lead_id
        and lead.workspace_id = lead_contacts.workspace_id
    )
  );

drop policy if exists lead_contacts_member_update on public.lead_contacts;
create policy lead_contacts_member_update on public.lead_contacts
  for update to authenticated
  using (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = lead_contacts.workspace_id
        and member.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = lead_contacts.workspace_id
        and member.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.leads lead
      where lead.id = lead_contacts.lead_id
        and lead.workspace_id = lead_contacts.workspace_id
    )
  );

drop policy if exists lead_contacts_member_delete on public.lead_contacts;
create policy lead_contacts_member_delete on public.lead_contacts
  for delete to authenticated
  using (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = lead_contacts.workspace_id
        and member.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.lead_contacts to authenticated;
revoke all on public.lead_contacts from anon;
