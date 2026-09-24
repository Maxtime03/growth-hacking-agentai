-- Persistent enrichment jobs and individually controllable email sequences.
alter table public.enrichment_runs
  add column if not exists progress smallint not null default 0,
  add column if not exists attempts smallint not null default 0,
  add column if not exists idempotency_key text,
  add column if not exists locked_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists cancelled_at timestamptz;
alter table public.enrichment_runs drop constraint if exists enrichment_runs_status_check;
alter table public.enrichment_runs add constraint enrichment_runs_status_check check (status in ('queued','running','completed','partial','failed','cancelled'));
create unique index if not exists enrichment_runs_lead_active_idx on public.enrichment_runs(lead_id) where status in ('queued','running');
create unique index if not exists enrichment_runs_idempotency_idx on public.enrichment_runs(idempotency_key) where idempotency_key is not null;

alter table public.email_sequences
  add column if not exists paused_at timestamptz,
  add column if not exists stopped_at timestamptz,
  add column if not exists stop_reason text,
  add column if not exists version integer not null default 1;
alter table public.email_steps
  add column if not exists version integer not null default 1;
alter table public.outbound_messages
  add column if not exists stop_reason text,
  add column if not exists triggered_by_message_id text;
create index if not exists outbound_messages_due_idx on public.outbound_messages(workspace_id,status,scheduled_at) where status='queued';

grant select, insert, update on public.enrichment_runs, public.email_sequences, public.email_steps, public.outbound_messages to authenticated;
revoke all on public.enrichment_runs, public.email_sequences, public.email_steps, public.outbound_messages from anon;
