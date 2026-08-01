-- Task 1.2 — Unified system user and multi-identity data model (security).
--
-- Order matters: functions are created BEFORE the RLS policies that reference
-- them, and grants come last. Functions are SECURITY DEFINER owned by the
-- migration role (postgres), so they bypass RLS on app_users/user_identities
-- and avoid infinite RLS recursion (the policies themselves call
-- current_app_user_id()).

-- ---------------------------------------------------------------------------
-- resolve_app_user_id: internal, restricted resolver.
-- Maps (provider, tenant, subject) to the active internal user id, or null.
-- Granted ONLY to service_role — never to anon/authenticated/public. This is
-- the single place that translates an external subject into a business key.
-- ---------------------------------------------------------------------------

create function public.resolve_app_user_id(
  provider public.identity_provider,
  tenant text,
  subject text
)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select u.id
  from public.user_identities as i
  join public.app_users as u on u.id = i.user_id
  where i.provider = provider
    and i.provider_tenant = tenant
    and i.provider_subject = subject
    and i.revoked_at is null
    and u.status = 'active'
  limit 1;
$function$;

comment on function public.resolve_app_user_id(public.identity_provider, text, text) is
  'Internal resolver: (provider, tenant, subject) -> active app_users.id or null. '
  'SECURITY DEFINER; execute granted to service_role only.';

revoke execute on function public.resolve_app_user_id(public.identity_provider, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_app_user_id(public.identity_provider, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- current_app_user_id: the single unified identity boundary for callers.
-- Reads the verified Supabase JWT from the request.jwt.claims GUC (set by
-- PostgREST on every authenticated request): "sub" is the subject, "iss" is
-- the tenant/issuer. It resolves to the internal app_users.id via
-- resolve_app_user_id. Returns null unless the bound identity exists, is not
-- revoked, and the user is active. It NEVER accepts a client-supplied user id
-- or subject. We read the claims GUC directly (equivalent to auth.uid() /
-- auth.jwt()) so the boundary does not depend on the auth schema helpers.
-- ---------------------------------------------------------------------------

create function public.current_app_user_id()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_claims json := null;
  v_subject text := '';
  v_issuer text := '';
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::json;
  exception
    when others then
      v_claims := null;
  end;

  if v_claims is null then
    return null;
  end if;

  v_subject := coalesce(v_claims ->> 'sub', '');
  v_issuer := coalesce(v_claims ->> 'iss', '');

  if v_subject = '' or v_issuer = '' then
    return null;
  end if;

  return public.resolve_app_user_id('supabase_auth', v_issuer, v_subject);
end;
$function$;

comment on function public.current_app_user_id() is
  'Resolves the JWT-authenticated caller to the internal app_users.id. '
  'Returns null for unauthenticated, unbound, revoked, invited, suspended or merged users. '
  'SECURITY DEFINER; granted to authenticated and service_role only.';

revoke execute on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-level security: default deny, opt-in per role. All four tables enable
-- RLS; policies use the trusted current_app_user_id() boundary only.
-- ---------------------------------------------------------------------------

alter table public.app_users enable row level security;
alter table public.profiles enable row level security;
alter table public.user_identities enable row level security;
alter table public.identity_binding_challenges enable row level security;

-- app_users: an authenticated caller may read only their own resolved record.
create policy app_users_select_own on public.app_users
  for select to authenticated
  using (id = public.current_app_user_id());

-- profiles: read and update only the caller's own profile. user_id is excluded
-- from the UPDATE grant and re-checked by WITH CHECK, so it cannot be changed.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = public.current_app_user_id());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = public.current_app_user_id())
  with check (user_id = public.current_app_user_id());

-- user_identities and identity_binding_challenges: NO policies for
-- anon/authenticated. They stay server-side only; direct client access is
-- denied by both RLS (no policy) and explicit privilege revocation below.

-- ---------------------------------------------------------------------------
-- Table privileges: explicit, default-deny. service_role keeps full control
-- for admin/test paths; anon/authenticated get only what they need.
-- ---------------------------------------------------------------------------

-- app_users
revoke all on public.app_users from anon;
grant select on public.app_users to authenticated;
grant all on public.app_users to service_role;

-- profiles
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;
grant update (
  display_name,
  avatar_url,
  organization_name,
  title,
  contact_info,
  updated_at
) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- user_identities: never directly accessible to anon/authenticated.
revoke all on public.user_identities from anon, authenticated;
grant all on public.user_identities to service_role;

-- identity_binding_challenges: never directly accessible to anon/authenticated.
revoke all on public.identity_binding_challenges from anon, authenticated;
grant all on public.identity_binding_challenges to service_role;
