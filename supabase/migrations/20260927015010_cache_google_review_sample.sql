-- Provider-bounded cache: at most five public review samples, expired by the
-- existing expires_at column and always displayed with Google attribution.
alter table public.lead_review_insights
  add column if not exists review_sample jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='lead_review_insights_sample_limit' and conrelid='public.lead_review_insights'::regclass) then
    alter table public.lead_review_insights add constraint lead_review_insights_sample_limit
      check(jsonb_typeof(review_sample)='array' and jsonb_array_length(review_sample)<=5);
  end if;
end $$;
