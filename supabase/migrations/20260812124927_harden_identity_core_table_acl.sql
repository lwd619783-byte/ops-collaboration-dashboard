-- Task 3.9.2-R2-F1 — Identity core table ACL hardening.
--
-- Supabase initializes tables created by the postgres migration role in the
-- public schema with platform default ACL entries for browser roles. The
-- historical identity security migration revoked those inherited entries from
-- anon, but only added the intended grants for authenticated; GRANT is
-- additive, so authenticated retained TRUNCATE, REFERENCES, TRIGGER and
-- MAINTAIN on app_users and profiles. RLS does not apply to TRUNCATE.
--
-- Canonicalize both browser-facing identity tables from any old/default ACL
-- state, then restore only the reviewed application privileges. REVOKE ALL on
-- a table also removes column ACL entries for the named grantees, so the final
-- column whitelist below is deterministic on both fresh installs and upgrades.

revoke all privileges on table public.app_users
  from public, anon, authenticated;
revoke all privileges on table public.profiles
  from public, anon, authenticated;

grant select on table public.app_users to authenticated;

grant select on table public.profiles to authenticated;
grant update (
  display_name,
  avatar_url,
  organization_name,
  title,
  contact_info,
  updated_at
) on table public.profiles to authenticated;

-- service_role is intentionally untouched. Its reviewed identity-service ACL
-- remains exactly as established by the historical identity security migration.
