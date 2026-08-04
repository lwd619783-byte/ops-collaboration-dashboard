-- Task 1.4 round 4 final audit: unify Auth outcome confirmation.
--
-- Root cause: preparation only looked for invitee lineage inside the same
-- workspace + email_hash. When the same unconfirmed Auth user is FIRST
-- invited to workspace B after already being invited to workspace A, B has no
-- lineage, creates a plain 'prepared' row, Auth Admin reuses A's existing user
-- (no second auth.users INSERT), the AFTER INSERT trigger never fires, and the
-- Edge Function previously returned invitation_sent while B stayed prepared
-- forever. Auth Admin success != business invitation success.
--
-- This migration adds ONE service-only confirmation boundary that EVERY
-- Auth Admin success must pass through:
--
--   confirm_workspace_auth_invitation_result(
--     p_invitation_id     uuid,
--     p_operation_kind    text,   -- 'new_auth_user_invite' | 'existing_invitee_reissue'
--     p_provider_tenant   text,   -- verified issuer
--     p_provider_subject  text    -- Auth Admin returned user ID
--   )
--
--   * new_auth_user_invite: the AFTER INSERT trigger must have moved the
--     invitation to 'sent' WITH an invitee; the invitee's live supabase_auth
--     identity must match the verified tenant + Auth user ID, the membership
--     must exist as invited with a matching role. If the invitation is still
--     'prepared' without an invitee, Auth reused an existing unconfirmed user:
--     the invitation is safely compensated to failed/auth_user_conflict (never
--     a success, never a second identity, never cross-workspace membership).
--   * existing_invitee_reissue: the full reissue verification (reissue
--     prepared -> sent) is kept intact.
--
-- The old finalize_workspace_invitation_reissue() is removed: there is exactly
-- ONE identity verification implementation.

-- ---------------------------------------------------------------------------
-- 1. Unified confirmation RPC (replaces finalize_workspace_invitation_reissue).
-- ---------------------------------------------------------------------------

drop function public.finalize_workspace_invitation_reissue(uuid, text, text);

create function public.confirm_workspace_auth_invitation_result(
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
  if p_operation_kind not in ('new_auth_user_invite', 'existing_invitee_reissue') then
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
  -- existing_invitee_reissue: keep the full reissue verification.
  -- -------------------------------------------------------------------------
  if p_operation_kind = 'existing_invitee_reissue' then
    if v_invitation.status = 'sent' then
      -- Stable retry of an already confirmed reissue.
      return 'sent';
    end if;
    if v_invitation.status = 'failed'
       and v_invitation.failure_code = 'auth_user_conflict'
    then
      -- Stable retry after a conflict compensation.
      return 'failed';
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
    -- supabase_auth identity for the verified issuer.
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

    update public.workspace_invitations as i
    set
      status = 'sent',
      sent_at = pg_catalog.clock_timestamp()
    where i.id = v_invitation.id;

    return 'sent';
  end if;

  -- -------------------------------------------------------------------------
  -- new_auth_user_invite: the AFTER INSERT trigger must have completed.
  -- -------------------------------------------------------------------------
  if v_invitation.status = 'failed'
     and v_invitation.failure_code = 'auth_user_conflict'
  then
    -- Stable retry after a conflict compensation.
    return 'failed';
  end if;

  if v_invitation.status = 'sent' then
    -- The trigger moved the invitation to sent WITH an invitee: verify the
    -- full provisioning chain against the verified issuer and the Auth Admin
    -- returned user ID before declaring business success.
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
