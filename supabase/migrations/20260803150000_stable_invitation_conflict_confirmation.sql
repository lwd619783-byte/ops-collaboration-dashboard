-- Task 1.4 round 5 final audit: make auth_user_conflict a truly stable
-- conflict and strictly bind confirmation to the persisted operation kind.
--
-- Problem 1: a failed/auth_user_conflict invitation with NO internal invitee
-- (cross-workspace reuse of an unconfirmed Auth user) was invisible to the
-- invitee-lineage check (which requires invitee_user_id IS NOT NULL). A fresh
-- idempotency key therefore re-entered the plain new-user path, re-created a
-- 'prepared' row, re-called Auth Admin, re-sent mail and failed again. The
-- same-key retry additionally returned a plain failed row, making the handler
-- tell the admin to re-send.
--
-- Fix: inside the workspace row lock, ANY failed/auth_user_conflict row for
-- this workspace+digest (with or without an invitee) is a PERMANENT conflict:
--   * same idempotency key -> raise workspace_invitation_auth_user_conflict
--     (never a plain failed row);
--   * fresh idempotency key -> raise the same fixed error BEFORE any new
--     prepared/reissue_prepared row is created (never re-call Auth Admin,
--     never send mail, never touch history).
-- Only recoverable failures (temporary_failure / auth_invite_failed) may be
-- re-issued with a fresh key.
--
-- Problem 2: confirm_workspace_auth_invitation_result accepted a NULL
-- operation kind (NULL not in (...) evaluates to NULL, not TRUE), and the
-- sent/failed idempotent branches returned without re-verifying the caller
-- parameters. A reissue sent branch never validated tenant/subject.
--
-- Fix: operation kind is bound to the persisted row structure:
--   * new_auth_user_invite       -> reissue_of_invitation_id IS NULL
--   * existing_invitee_reissue   -> reissue_of_invitation_id IS NOT NULL
--                                   AND invitee_user_id IS NOT NULL
-- NULL / blank / unknown kind -> workspace_invitation_confirm_invalid (22023).
-- sent and failed idempotent confirmations STILL validate kind, structure,
-- source invitation, provider tenant/subject, identity and membership.

-- ---------------------------------------------------------------------------
-- 1. prepare_workspace_invitation: stable auth_user_conflict.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_workspace_invitation(
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

    -- A stable auth_user_conflict failure is terminal for this digest. The
    -- same idempotency key must NOT return a plain failed row: the handler
    -- would interpret it as "re-send this request". Raise the fixed conflict
    -- instead so the Edge Function maps it to the generic 409. History is
    -- never modified.
    if v_existing.status = 'failed'
       and v_existing.failure_code = 'auth_user_conflict'
    then
      raise exception 'workspace_invitation_auth_user_conflict' using errcode = '55000';
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

  -- Stable conflict guard (applies BEFORE any new row is created): a
  -- failed/auth_user_conflict row for this workspace+digest is a PERMANENT
  -- conflict whether or not it carried an internal invitee. An invitee-less
  -- row (cross-workspace reuse of an unconfirmed Auth user) must not be
  -- bypassed by a fresh idempotency key; a reissue conflict is caught here
  -- too. Only controlled account binding or an operational procedure can lift
  -- this state (not implemented in this task). Recoverable failures
  -- (temporary_failure / auth_invite_failed) are NOT affected.
  if exists (
    select 1 from public.workspace_invitations as i
    where i.workspace_id = p_workspace_id
      and i.email_hash = p_email_hash
      and i.status = 'failed'
      and i.failure_code = 'auth_user_conflict'
  ) then
    raise exception 'workspace_invitation_auth_user_conflict' using errcode = '55000';
  end if;

  if found then
    -- Once an internal invitee exists, this digest must NEVER fall back to
    -- the invitee-less new-user path.

    -- A still-valid sent/reissue_prepared invitation blocks the digest.
    if v_lineage.status in ('sent', 'reissue_prepared')
       and v_lineage.expires_at > v_now
    then
      raise exception 'workspace_invitation_conflict' using errcode = '23505';
    end if;

    -- Recoverable lineage: an expired sent/reissue_prepared, a recoverable
    -- failed reissue (temporary_failure / auth_invite_failed / confirmation
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
        if v_existing.status = 'failed'
           and v_existing.failure_code = 'auth_user_conflict'
        then
          raise exception 'workspace_invitation_auth_user_conflict' using errcode = '55000';
        end if;
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
-- 2. confirm_workspace_auth_invitation_result: strict kind binding.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_workspace_auth_invitation_result(
  p_invitation_id uuid,
  p_operation_kind text,
  p_provider_tenant text,
  p_provider_subject text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invitation public.workspace_invitations%rowtype;
  v_source public.workspace_invitations%rowtype;
begin
  -- Explicit NULL check: "p_operation_kind not in (...)" evaluates to NULL
  -- (not TRUE) for a NULL input, so a bare NOT IN would silently let NULL
  -- fall through to the new-auth branch. NULL, blank and unknown kinds all
  -- map to the same static invalid error.
  if p_operation_kind is null
     or pg_catalog.btrim(p_operation_kind) = ''
     or p_operation_kind not in ('new_auth_user_invite', 'existing_invitee_reissue')
  then
    raise exception 'workspace_invitation_confirm_invalid' using errcode = '22023';
  end if;
  if p_provider_tenant is null
     or pg_catalog.btrim(p_provider_tenant) = ''
     or pg_catalog.char_length(p_provider_tenant) > 2048
     or p_provider_subject is null
     or pg_catalog.btrim(p_provider_subject) = ''
     or pg_catalog.char_length(p_provider_subject) > 128
  then
    raise exception 'workspace_invitation_confirm_invalid' using errcode = '22023';
  end if;

  select i.* into v_invitation
  from public.workspace_invitations as i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'workspace_invitation_not_found' using errcode = 'P0002';
  end if;

  -- -------------------------------------------------------------------------
  -- existing_invitee_reissue: the row MUST be a reissue carrying an invitee.
  -- -------------------------------------------------------------------------
  if p_operation_kind = 'existing_invitee_reissue' then
    if v_invitation.reissue_of_invitation_id is null
       or v_invitation.invitee_user_id is null
    then
      raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
    end if;

    if v_invitation.status = 'failed'
       and v_invitation.failure_code = 'auth_user_conflict'
    then
      -- Stable retry after a conflict compensation. The kind is already bound
      -- to the persisted structure above; the failed terminal state is
      -- returned idempotently.
      return 'failed';
    end if;

    if v_invitation.status not in ('reissue_prepared', 'sent') then
      raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
    end if;
    if v_invitation.expires_at <= pg_catalog.clock_timestamp() then
      raise exception 'workspace_invitation_expired' using errcode = '55000';
    end if;

    -- The source invitation must belong to the same workspace and digest; the
    -- source may be revoked (expired close) or failed (recoverable failure).
    select i.* into v_source
    from public.workspace_invitations as i
    where i.id = v_invitation.reissue_of_invitation_id
    for update;

    if not found
       or v_source.workspace_id is distinct from v_invitation.workspace_id
       or v_source.email_hash is distinct from v_invitation.email_hash
       or v_source.status not in ('revoked', 'failed')
    then
      raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
    end if;

    -- The Auth Admin returned user ID must exactly match the invitee's LIVE
    -- supabase_auth identity for the verified issuer. This also runs on the
    -- idempotent 'sent' re-confirmation path: a repeated call with a wrong
    -- tenant/subject must be refused, never silently re-acknowledged.
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

    if not exists (
      select 1 from public.workspace_members as m
      where m.workspace_id = v_invitation.workspace_id
        and m.user_id = v_invitation.invitee_user_id
        and m.status = 'invited'
    ) then
      raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
    end if;

    if v_invitation.status = 'reissue_prepared' then
      update public.workspace_invitations as i
      set
        status = 'sent',
        sent_at = pg_catalog.clock_timestamp()
      where i.id = v_invitation.id;
    end if;

    return 'sent';
  end if;

  -- -------------------------------------------------------------------------
  -- new_auth_user_invite: the row MUST NOT be a reissue.
  -- -------------------------------------------------------------------------
  if v_invitation.reissue_of_invitation_id is not null then
    raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
  end if;

  if v_invitation.status = 'failed'
     and v_invitation.failure_code = 'auth_user_conflict'
  then
    -- Stable retry after a conflict compensation (kind bound above: this is a
    -- new-auth row because reissue_of_invitation_id is null).
    return 'failed';
  end if;

  if v_invitation.status = 'sent' then
    -- The trigger moved the invitation to sent WITH an invitee: verify the
    -- full provisioning chain against the verified issuer and the Auth Admin
    -- returned user ID before declaring business success. The reissue_of
    -- null check above already bound the kind to the persisted structure.
    if v_invitation.invitee_user_id is null then
      raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
    end if;

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

    if not exists (
      select 1 from public.workspace_members as m
      join public.workspace_invitations as i on i.id = v_invitation.id
      where m.workspace_id = v_invitation.workspace_id
        and m.user_id = v_invitation.invitee_user_id
        and m.status = 'invited'
        and m.role = v_invitation.role
    ) then
      raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
    end if;

    -- Invitation must not be expired while being confirmed.
    if v_invitation.expires_at <= pg_catalog.clock_timestamp() then
      raise exception 'workspace_invitation_expired' using errcode = '55000';
    end if;

    -- Already sent: idempotent success.
    return 'sent';
  end if;

  if v_invitation.status = 'prepared'
     and v_invitation.invitee_user_id is null
  then
    -- Auth Admin succeeded but NO auth.users INSERT happened: Auth reused an
    -- existing unconfirmed user (e.g. first invited to another workspace).
    -- The AFTER INSERT trigger can never fire for this invitation. This is a
    -- SAFE REFUSAL, never a success and never a cross-workspace join:
    --   * no second app_user / identity / membership is created;
    --   * the invitation is compensated to failed/auth_user_conflict;
    --   * no open 'prepared' row remains.
    update public.workspace_invitations as i
    set
      status = 'failed',
      failed_at = pg_catalog.clock_timestamp(),
      failure_code = 'auth_user_conflict'
    where i.id = v_invitation.id;

    return 'failed';
  end if;

  -- Any other state/kind combination is a static failure: never claim success.
  raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
end;
$function$;

revoke all on function public.confirm_workspace_auth_invitation_result(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_workspace_auth_invitation_result(uuid, text, text, text)
  to service_role;
