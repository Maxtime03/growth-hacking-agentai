drop policy if exists provider_webhook_events_deny_clients on public.provider_webhook_events;
create policy provider_webhook_events_deny_clients
  on public.provider_webhook_events
  for all to anon, authenticated
  using (false)
  with check (false);

drop policy if exists enrichment_queue_workspace_access on public.enrichment_queue;
create policy enrichment_queue_workspace_access
  on public.enrichment_queue
  for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = enrichment_queue.workspace_id
        and wm.user_id = (select auth.uid())
    )
  );
