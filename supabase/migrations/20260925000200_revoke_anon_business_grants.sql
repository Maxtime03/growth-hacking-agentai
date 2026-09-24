-- Anonymous clients must not have Data API privileges on CRM/business tables.
-- RLS remains enabled; this explicit revoke also prevents HTTP 200 empty reads
-- from being mistaken for an authorized business-data access.
revoke all on table
  public.workspaces,
  public.workspace_members,
  public.leads,
  public.contacts,
  public.search_runs,
  public.search_run_leads,
  public.enrichment_runs,
  public.enrichment_sources,
  public.evidence,
  public.provider_runs,
  public.activities,
  public.tasks,
  public.email_sequences,
  public.email_steps,
  public.outbound_messages,
  public.email_messages,
  public.campaigns,
  public.campaign_leads,
  public.apify_runs,
  public.email_connections,
  public.integrations,
  public.lead_activities,
  public.lead_enrichments,
  public.lead_sources,
  public.profiles,
  public.suppression_list
from anon;

grant select, insert, update, delete on table
  public.enrichment_runs,
  public.enrichment_sources,
  public.evidence,
  public.provider_runs,
  public.email_sequences,
  public.email_steps,
  public.outbound_messages
to authenticated;
