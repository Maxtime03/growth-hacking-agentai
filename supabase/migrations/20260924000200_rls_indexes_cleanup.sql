-- Remove duplicate permissive policies introduced by the first operational pass.
drop policy if exists leads_workspace_member_select on public.leads;
drop policy if exists leads_workspace_member_write on public.leads;
drop policy if exists search_runs_workspace_member_all on public.search_runs;
drop policy if exists workspace_members_self on public.workspace_members;

create index if not exists apify_runs_search_run_id_idx on public.apify_runs(search_run_id);
create index if not exists email_messages_lead_id_idx on public.email_messages(lead_id);
create index if not exists enrichment_sources_lead_id_idx on public.enrichment_sources(lead_id);
create index if not exists evidence_enrichment_source_id_idx on public.evidence(enrichment_source_id);
create index if not exists evidence_lead_id_idx on public.evidence(lead_id);
create index if not exists lead_activities_created_by_idx on public.lead_activities(created_by);
create index if not exists lead_activities_workspace_id_idx on public.lead_activities(workspace_id);
create index if not exists provider_runs_lead_id_idx on public.provider_runs(lead_id);
create index if not exists suppression_list_workspace_id_idx on public.suppression_list(workspace_id);
