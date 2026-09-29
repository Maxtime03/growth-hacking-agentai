-- RLS policies call this security-definer membership predicate as authenticated users.
revoke all on function private.email_workspace_allowed(uuid) from public, anon;
grant execute on function private.email_workspace_allowed(uuid) to authenticated, service_role;
