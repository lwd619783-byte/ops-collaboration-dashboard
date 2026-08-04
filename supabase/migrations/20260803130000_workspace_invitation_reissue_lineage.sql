-- Task 1.4 round 3 audit: preserve invitee lineage across reissue failures.
--
-- Round 2 could only reuse an EXPIRED sent / reissue_prepared invitation as
-- the source of a reissue. When a reissue then failed (Auth re-send failed or
-- finalize failed), the invitation entered 'failed' WITH an invitee_user_id
-- and the membership still 'invited'. The next preparation attempt for the
-- same digest found no expired sent/reissue_prepared row, fell back to the
-- plain new-user path (prepared with invitee NULL), and relied on the
-- auth.users AFTER INSERT trigger -- which never fires because Auth reuses the
-- existing user. The invitation would stay prepared forever.
--
-- This migration establishes an explicit invitee LINEAGE rule:
--   * Once an invitation for a digest carries an internal invitee, preparation
--     must NEVER go back to the invitee-less new-user path.
--   * Recoverable failures (temporary_failure, auth_invite_failed, or the
--     temporary_failure compensation after a failed finalize) allow a new
--     reissue with a fresh idempotency key.
--   * auth_user_conflict failures are a stable conflict: the Auth user exists
--     in an unsupported state (confirmed / foreign), so re-sending would not
--     help. They return a fixed safe conflict and never create a prepared row.
--   * The finalize RPC now verifies, inside one transaction, that the Auth
--     Admin returned user ID matches the invitee's supabase_auth identity
--     (provider tenant + subject) before marking the invitation sent.

-- ---------------------------------------------------------------------------
-- 1. Preparation with explicit invitee lineage.
-- ---------------------------------------------------------------------------

drop function public.prepare_workspace_invitation(
  uuid, text, text, text, public.workspace_role, uuid
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
  should_send boolean,
  operation_kind text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_actor_role public.workspace_role;
  v_existing public.workspace_invitations%rowtype;
  v_lineage public.workspace_invitations%rowtype;
  v_invitation_id uuid;
  v_hint text := pg_catalog.btrim(p_email_hint);
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_now timestamptz;
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

  -- Serialize invitation preparation per workspace. The workspace row lock is
  -- acquired BEFORE any time is read: every expiry decision below uses the
  -- single v_now captured after the lock, so a request that waited across an
  -- old invitation's expiry point closes that invitation and still grants the
  -- new invitation a full TTL.
  perform 1
  from public.workspaces as w
  where w.id = p_workspace_id
  for update;

  v_now := pg_catalog.clock_timestamp();

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
    -- invitation and never dispatch a second Auth Admin call. The operation
    -- kind is not meaningful when the caller must not send again, but it is
    -- still reported truthfully for the existing row.
    return query select
      v_existing.id,
      v_existing.status,
      false,
      case
        when v_existing.status = 'reissue_prepared'
          then 'existing_invitee_reissue'
        else 'new_auth_user_invite'
      end;
    return;
  end if;

  -- Invitee lineage: the NEWEST invitation for this digest that already
  -- carries an internal invitee and is NOT accepted. Accepted history is
  -- terminal and never used as a reissue source.
  select i.* into v_lineage
  from public.workspace_invitations as i
  where i.workspace_id = p_workspace_id
    and i.email_hash = p_email_hash
    and i.invitee_user_id is not null
    and i.status in ('sent', 'reissue_prepared', 'failed', 'revoked')
  order by i.created_at desc, i.id desc
  limit 1;

  if found then
    -- Once an internal invitee exists, this digest must NEVER fall back to
    -- the invitee-less new-user path.

    -- A stable auth_user_conflict failure cannot be recovered by re-sending:
    -- the Auth user exists in an unsupported state. Return a fixed safe
    -- conflict; do NOT create a prepared row and do NOT close history.
    if v_lineage.status = 'failed'
       and v_lineage.failure_code = 'auth_user_conflict'
    then
      raise exception 'workspace_invitation_auth_user_conflict' using errcode = '55000';
    end if;

    -- A still-valid sent/reissue_prepared invitation blocks the digest.
    if v_lineage.status in ('sent', 'reissue_prepared')
       and v_lineage.expires_at > v_now
    then
      raise exception 'workspace_invitation_conflict' using errcode = '23505';
    end if;

    -- Recoverable lineage: an expired sent/reissue_prepared, a recoverable
    -- failed reissue (temporary_failure / auth_invite_failed / finalize
    -- compensation), or a revoked history row. The invitee must still be a
    -- valid, active internal user with a LIVE supabase_auth identity, and the
    -- membership must still be awaiting activation.
    if not exists (
      select 1
      from public.app_users as u
      join public.user_identities as ui on ui.user_id = u.id
      where u.id = v_lineage.invitee_user_id
        and u.status = 'active'
        and ui.provider = 'supabase_auth'
        and ui.verified_at is not null
        and ui.revoked_at is null
    ) then
      update public.workspace_invitations as i
      set
        status = 'revoked',
        revoked_at = v_now
      where i.workspace_id = p_workspace_id
        and i.email_hash = p_email_hash
        and i.status in ('prepared', 'sent', 'reissue_prepared')
        and i.expires_at <= v_now;
      raise exception 'workspace_invitation_invitee_invalid' using errcode = '55000';
    end if;

    if not exists (
      select 1
      from public.workspace_members as m
      where m.workspace_id = p_workspace_id
        and m.user_id = v_lineage.invitee_user_id
        and m.status = 'invited'
    ) then
      update public.workspace_invitations as i
      set
        status = 'revoked',
        revoked_at = v_now
      where i.workspace_id = p_workspace_id
        and i.email_hash = p_email_hash
        and i.status in ('prepared', 'sent', 'reissue_prepared')
        and i.expires_at <= v_now;
      raise exception 'workspace_invitation_invitee_invalid' using errcode = '55000';
    end if;

    -- A reissue keeps the original target role: the membership row already
    -- carries it and changing roles mid-reissue would be ambiguous.
    if v_lineage.role is distinct from p_role then
      raise exception 'workspace_invitation_role_conflict' using errcode = '23505';
    end if;

    -- Close every expired open invitation for this digest (the candidate plus
    -- any other stale rows) and create the linked reissue invitation.
    update public.workspace_invitations as i
    set
      status = 'revoked',
      revoked_at = v_now
    where i.workspace_id = p_workspace_id
      and i.email_hash = p_email_hash
      and i.status in ('prepared', 'sent', 'reissue_prepared')
      and i.expires_at <= v_now;

    insert into public.workspace_invitations (
      workspace_id,
      email_hash,
      email_hint,
      display_name,
      role,
      status,
      invitee_user_id,
      invited_by,
      idempotency_key,
      expires_at,
      reissue_of_invitation_id
    ) values (
      p_workspace_id,
      p_email_hash,
      v_hint,
      v_display_name,
      p_role,
      'reissue_prepared',
      v_lineage.invitee_user_id,
      v_actor_id,
      p_idempotency_key,
      v_now + pg_catalog.make_interval(
        secs => public.workspace_invitation_ttl_seconds()
      ),
      v_lineage.id
    ) returning id into v_invitation_id;

    return query select
      v_invitation_id,
      'reissue_prepared'::public.workspace_invitation_status,
      true,
      'existing_invitee_reissue';
    return;
  end if;

  -- No invitee lineage: the plain new-user path. Close expired prepared rows
  -- (they have no invitee to reuse) and reject any still-valid open
  -- invitation for this digest.
  update public.workspace_invitations as i
  set
    status = 'revoked',
    revoked_at = v_now
  where i.workspace_id = p_workspace_id
    and i.email_hash = p_email_hash
    and i.status = 'prepared'
    and i.expires_at <= v_now;

  if exists (
    select 1 from public.workspace_invitations as i
    where i.workspace_id = p_workspace_id
      and i.email_hash = p_email_hash
      and i.status in ('prepared', 'sent', 'reissue_prepared')
  ) then
    raise exception 'workspace_invitation_conflict' using errcode = '23505';
  end if;

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

  return query select
    v_invitation_id,
    'prepared'::public.workspace_invitation_status,
    true,
    'new_auth_user_invite';
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
          false,
          case
            when v_existing.status = 'reissue_prepared'
              then 'existing_invitee_reissue'
            else 'new_auth_user_invite'
          end;
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
-- 2. Service-only reissue finalization WITH Auth identity verification.
--    The Edge Function passes the Auth Admin returned user ID
--    (p_provider_subject) and the verified issuer (p_provider_tenant). The
--    invitation is only marked sent when the invitee's supabase_auth identity
--    matches BOTH inside the same transaction. Static errors never leak the
--    expected/actual user ID, email or identity data.
-- ---------------------------------------------------------------------------

drop function public.finalize_workspace_invitation_reissue(uuid);

create function public.finalize_workspace_invitation_reissue(
  p_invitation_id uuid,
  p_provider_tenant text,
  p_provider_subject text
)
returns public.workspace_invitation_status
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invitation public.workspace_invitations%rowtype;
  v_replaced public.workspace_invitations%rowtype;
begin
  if p_provider_tenant is null
     or pg_catalog.btrim(p_provider_tenant) = ''
     or pg_catalog.char_length(p_provider_tenant) > 2048
     or p_provider_subject is null
     or pg_catalog.btrim(p_provider_subject) = ''
     or pg_catalog.char_length(p_provider_subject) > 128
  then
    raise exception 'workspace_invitation_finalize_invalid' using errcode = '22023';
  end if;

  select i.* into v_invitation
  from public.workspace_invitations as i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'workspace_invitation_not_found' using errcode = 'P0002';
  end if;

  if v_invitation.status = 'sent' then
    -- Stable retry of the same finalize request.
    return 'sent'::public.workspace_invitation_status;
  end if;

  if v_invitation.status <> 'reissue_prepared'
     or v_invitation.invitee_user_id is null
     or v_invitation.reissue_of_invitation_id is null
  then
    raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
  end if;
  if v_invitation.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'workspace_invitation_expired' using errcode = '55000';
  end if;

  -- The replaced/source invitation must belong to the same workspace and
  -- digest: reissue never resurrects or re-targets history. The source may be
  -- revoked (expired close) or failed (recoverable failure) -- both are valid
  -- lineage roots; accepted history is never a source.
  select i.* into v_replaced
  from public.workspace_invitations as i
  where i.id = v_invitation.reissue_of_invitation_id
  for update;

  if not found
     or v_replaced.workspace_id is distinct from v_invitation.workspace_id
     or v_replaced.email_hash is distinct from v_invitation.email_hash
     or v_replaced.status not in ('revoked', 'failed')
  then
    raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
  end if;

  -- The Auth Admin returned user ID (p_provider_subject) must exactly match
  -- the invitee's LIVE supabase_auth identity for the verified issuer. Any
  -- mismatch, revoked identity, missing user or unsupported account state is
  -- a static failure; the error text never includes the IDs.
  if not exists (
    select 1
    from public.user_identities as ui
    join public.app_users as u on u.id = ui.user_id
    where ui.user_id = v_invitation.invitee_user_id
      and ui.provider = 'supabase_auth'
      and ui.provider_tenant = pg_catalog.btrim(p_provider_tenant)
      and ui.provider_subject = pg_catalog.btrim(p_provider_subject)
      and ui.verified_at is not null
      and ui.revoked_at is null
      and u.status = 'active'
  ) then
    raise exception 'workspace_invitation_identity_mismatch' using errcode = '55000';
  end if;

  -- The invitee relationship must still be intact: an invited membership is
  -- required (already covered by identity check for app_user active).
  if not exists (
    select 1 from public.workspace_members as m
    where m.workspace_id = v_invitation.workspace_id
      and m.user_id = v_invitation.invitee_user_id
      and m.status = 'invited'
  ) then
    raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
  end if;

  update public.workspace_invitations as i
  set
    status = 'sent',
    sent_at = pg_catalog.clock_timestamp()
  where i.id = v_invitation.id;

  return 'sent'::public.workspace_invitation_status;
end;
$function$;

revoke all on function public.finalize_workspace_invitation_reissue(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_workspace_invitation_reissue(uuid, text, text)
  to service_role;
