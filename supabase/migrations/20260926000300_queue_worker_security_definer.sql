alter function public.claim_enrichment_job(integer) security definer;
alter function public.ack_enrichment_job(bigint) security definer;
alter function public.archive_enrichment_job(bigint) security definer;
alter function public.requeue_enrichment_job(uuid, uuid, jsonb) security definer;
alter function public.enqueue_enrichment_job(uuid, uuid, jsonb) security definer;

alter function public.claim_enrichment_job(integer) set search_path = pg_catalog, public, pgmq;
alter function public.ack_enrichment_job(bigint) set search_path = pg_catalog, public, pgmq;
alter function public.archive_enrichment_job(bigint) set search_path = pg_catalog, public, pgmq;
alter function public.requeue_enrichment_job(uuid, uuid, jsonb) set search_path = pg_catalog, public, pgmq;
alter function public.enqueue_enrichment_job(uuid, uuid, jsonb) set search_path = pg_catalog, public, pgmq;

revoke execute on function public.enqueue_enrichment_job(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_enrichment_job(integer) from public, anon, authenticated;
revoke execute on function public.ack_enrichment_job(bigint) from public, anon, authenticated;
revoke execute on function public.archive_enrichment_job(bigint) from public, anon, authenticated;
revoke execute on function public.requeue_enrichment_job(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_enrichment_job(uuid, uuid, jsonb) to service_role;
grant execute on function public.claim_enrichment_job(integer) to service_role;
grant execute on function public.ack_enrichment_job(bigint) to service_role;
grant execute on function public.archive_enrichment_job(bigint) to service_role;
grant execute on function public.requeue_enrichment_job(uuid, uuid, jsonb) to service_role;
