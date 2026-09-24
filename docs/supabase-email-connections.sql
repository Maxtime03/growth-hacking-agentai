create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  provider text not null check (provider in ('google', 'microsoft')),
  email_address text not null,
  display_name text,
  scopes text[] not null default '{}',
  encrypted_refresh_token text not null,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_email, provider, email_address)
);

alter table public.email_connections enable row level security;
revoke all on table public.email_connections from anon, authenticated;

create policy "No client access" on public.email_connections
as restrictive for all to anon, authenticated
using (false) with check (false);

create index if not exists email_connections_owner_idx
on public.email_connections (owner_email, status);
