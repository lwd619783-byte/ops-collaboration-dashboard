-- Task 1.4 audit hardening: single-owner invariant, invitation TTL, expiry
-- recovery and idempotent concurrent preparation.
--
-- 1. A workspace can have AT MOST ONE role='owner' membership, that membership
--    must reference workspaces.owner_id, and it is always active (the existing
--    workspace_members_owner_active CHECK already covers the active part).
-- 2. Business invitation TTL becomes an explicit server-side configuration
--    (workspace_invitation_ttl_seconds) aligned with the Auth email OTP expiry
--    in supabase/config.toml ([auth] otp_expiry = 3600).
-- 3. prepare_workspace_invitation() computes p_expires_at itself (browsers can
--    no longer pass it), atomically closes expired open invitations inside the
--    same transaction and lock boundary, and re-reads the idempotency key after
--    any unique violation instead of failing blindly.

-- ---------------------------------------------------------------------------
-- 1. Single-owner invariants.
-- ---------------------------------------------------------------------------

-- At most one owner membership per workspace, enforced immediately by the
-- unique index regardless of the writing role (SQL, service_role, future RPC).
create unique index workspace_members_one_owner_idx
  on public.workspace_members (workspace_id)
  where role = 'owner';

-- Any owner membership must belong to the workspace's current owner. This is
-- an immediate AFTER constraint so a forged owner row (or an UPDATE promoting
-- a normal member to owner) is rejected at statement level. The deferred
-- assert_workspace_owner_membership() invariant (owner presence) is kept.
create function public.assert_workspace_owner_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.role = 'owner'
     and new.user_id is distinct from (
       select w.owner_id
       from public.workspaces as w
       where w.id = new.workspace_id
     )
  then
    raise exception 'workspace_owner_membership_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create constraint trigger workspace_members_owner_user_id_required
  after insert or update on public.workspace_members
  for each row execute function public.assert_workspace_owner_user_id();

comment on index public.workspace_members_one_owner_idx is
  'A workspace can have at most one owner membership; ownership transfer is not supported.';

revoke all on function public.assert_workspace_owner_user_id()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Explicit server-side invitation TTL.
-- ---------------------------------------------------------------------------

-- Business invitation lifetime in seconds. MUST stay aligned with the Auth
-- email OTP expiry (supabase/config.toml [auth] otp_expiry = 3600) and with
-- the Edge Function default APP_INVITE_TTL_SECONDS so an invite can never
-- outlive the link token that delivers it.
create function public.workspace_invitation_ttl_seconds()
returns integer
language sql
stable
security invoker
set search_path = ''
as $function$
  select 3600;
$function$;

comment on function public.workspace_invitation_ttl_seconds() is
  'Server-side business invitation TTL in seconds; must match the Auth email OTP expiry.';

revoke all on function public.workspace_invitation_ttl_seconds()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Invitation preparation: trusted expiry, expiry recovery, idempotency.
-- ---------------------------------------------------------------------------

drop function public.prepare_workspace_invitation(
  uuid, text, text, text, public.workspace_role, uuid, timestamptz
);

create function public.prepare_workspace_invitation(
  p_workspace_id uuid,
  p_email_hash text,
  p_email_hint text,
  p_display_name text,
  p_role public.workspace_role,
  p_idempotency_key uuid
)
returns table (
  invitation_id uuid,
  invitation_status public.workspace_invitation_status,
  should_send boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_actor_role public.workspace_role;
  v_existing public.workspace_invitations%rowtype;
  v_invitation_id uuid;
  v_hint text := pg_catalog.btrim(p_email_hint);
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select m.role into v_actor_role
  from public.workspace_members as m
  where m.workspace_id = p_workspace_id
    and m.user_id = v_actor_id
    and m.status = 'active';

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'workspace_permission_denied' using errcode = '42501';
  end if;
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$'
     or v_hint = '' or pg_catalog.char_length(v_hint) > 160
     or v_display_name = '' or pg_catalog.char_length(v_display_name) > 120
     or p_idempotency_key is null
     or p_role is null or p_role = 'owner'
  then
    raise exception 'workspace_invitation_invalid' using errcode = '22023';
  end if;
  if v_actor_role = 'admin' and p_role not in ('member', 'external_collaborator') then
    raise exception 'workspace_permission_denied' using errcode = '42501';
  end if;

  -- Serialize invitation preparation per workspace. Expiry recovery, the
  -- idempotency re-read and the insert below share one transaction and one
  -- lock boundary, so concurrent requests for the same workspace cannot race.
  perform 1
  from public.workspaces as w
  where w.id = p_workspace_id
  for update;

  -- Close expired open invitations for the same workspace and email digest
  -- BEFORE checking open conflicts, so a stale prepared/sent invitation that
  -- can no longer be used stops blocking a fresh one. Only expired
  -- prepared/sent rows are touched; accepted, failed, revoked and still-valid
  -- invitations are never modified here.
  update public.workspace_invitations as i
  set
    status = 'revoked',
    revoked_at = v_now
  where i.workspace_id = p_workspace_id
    and i.email_hash = p_email_hash
    and i.status in ('prepared', 'sent')
    and i.expires_at <= v_now;

  select i.* into v_existing
  from public.workspace_invitations as i
  where i.workspace_id = p_workspace_id
    and i.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.email_hash <> p_email_hash
       or v_existing.email_hint <> v_hint
       or v_existing.display_name <> v_display_name
       or v_existing.role <> p_role
    then
      raise exception 'workspace_invitation_idempotency_conflict' using errcode = '23505';
    end if;

    -- Stable retry of the same logical request: return the existing
    -- invitation and never dispatch a second Auth Admin call.
    return query select
      v_existing.id,
      v_existing.status,
      false;
    return;
  end if;

  if exists (
    select 1 from public.workspace_invitations as i
    where i.workspace_id = p_workspace_id
      and i.email_hash = p_email_hash
      and i.status in ('prepared', 'sent')
  ) then
    raise exception 'workspace_invitation_conflict' using errcode = '23505';
  end if;

  -- p_expires_at is computed by this trusted server-side function from the
  -- configured TTL; browsers never pass an expiry.
  insert into public.workspace_invitations (
    workspace_id,
    email_hash,
    email_hint,
    display_name,
    role,
    status,
    invited_by,
    idempotency_key,
    expires_at
  ) values (
    p_workspace_id,
    p_email_hash,
    v_hint,
    v_display_name,
    p_role,
    'prepared',
    v_actor_id,
    p_idempotency_key,
    v_now + pg_catalog.make_interval(
      secs => public.workspace_invitation_ttl_seconds()
    )
  ) returning id into v_invitation_id;

  return query select v_invitation_id, 'prepared'::public.workspace_invitation_status, true;
exception
  when unique_violation then
    -- Defensive re-read after a unique violation (the workspace lock normally
    -- prevents this): if the same idempotency key now exists with the same
    -- logical payload, treat the retry as a stable idempotent success.
    select i.* into v_existing
    from public.workspace_invitations as i
    where i.workspace_id = p_workspace_id
      and i.idempotency_key = p_idempotency_key;
    if found then
      if v_existing.email_hash = p_email_hash
         and v_existing.email_hint = v_hint
         and v_existing.display_name = v_display_name
         and v_existing.role = p_role
      then
        return query select
          v_existing.id,
          v_existing.status,
          false;
        return;
      end if;
      raise exception 'workspace_invitation_idempotency_conflict' using errcode = '23505';
    end if;
    raise exception 'workspace_invitation_conflict' using errcode = '23505';
end;
$function$;

revoke all on function public.prepare_workspace_invitation(
  uuid, text, text, text, public.workspace_role, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_workspace_invitation(
  uuid, text, text, text, public.workspace_role, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Member directory must not drop members whose profile row is missing.
--    A safe LEFT JOIN returns every membership the caller may see; missing
--    profiles fall back to a fixed, non-sensitive display name and keep the
--    optional profile columns null. contact_info / email / identity data are
--    still never returned. profiles RLS is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.list_workspace_members(p_workspace_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  organization_name text,
  title text,
  role public.workspace_role,
  status public.workspace_member_status,
  joined_at timestamptz,
  disabled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_role public.workspace_role;
begin
  v_actor_role := public.workspace_role_for_current_user(p_workspace_id);
  if v_actor_role is null then
    raise exception 'workspace_permission_denied' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    coalesce(p.display_name, '未设置显示名称'),
    p.avatar_url,
    p.organization_name,
    p.title,
    m.role,
    m.status,
    m.joined_at,
    m.disabled_at
  from public.workspace_members as m
  left join public.profiles as p on p.user_id = m.user_id
  where m.workspace_id = p_workspace_id
    and (v_actor_role in ('owner', 'admin') or m.status = 'active')
  order by
    case m.role
      when 'owner' then 1
      when 'admin' then 2
      when 'member' then 3
      else 4
    end,
    coalesce(p.display_name, '未设置显示名称'),
    m.user_id;
end;
$function$;
