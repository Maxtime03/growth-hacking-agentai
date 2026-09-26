-- Durable dispatcher: values are stored in Supabase Vault out-of-band.
create or replace function public.process_enrichment_queue_cron()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, vault, net
as $$
declare
  worker_url text;
  auth_token text;
  request_id bigint;
begin
  select decrypted_secret into worker_url
  from vault.decrypted_secrets
  where name = 'ENRICHMENT_WORKER_URL'
  limit 1;
  select decrypted_secret into auth_token
  from vault.decrypted_secrets
  where name = 'ENRICHMENT_WORKER_AUTH'
  limit 1;
  if worker_url is null or auth_token is null then
    raise exception 'enrichment worker Vault configuration missing';
  end if;
  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object('content-type','application/json','apikey',auth_token,'authorization','Bearer ' || auth_token),
    body := jsonb_build_object('source','pg_cron'),
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.process_enrichment_queue_cron() from public, anon, authenticated;
grant execute on function public.process_enrichment_queue_cron() to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname = 'process-enrichment-queue';

select cron.schedule(
  'process-enrichment-queue',
  '* * * * *',
  $$select public.process_enrichment_queue_cron();$$
)
where not exists (select 1 from cron.job where jobname = 'process-enrichment-queue');
