-- Task 1.4 round 2 audit: completed reissue for existing invitees.
--
-- Part 2 of 2: the reissue data model (link column, state CHECK, immutable
-- transitions, open-invitation index), the operation_kind preparation RPC,
-- the service-only finalize RPC, failure compensation for reissue_prepared
-- and the pending-invitation flag in the member directory. The
-- 'reissue_prepared' status value itself is added and committed by the
-- sibling 20260803120000 migration.
--
alter table public.workspace_invitations
  add column reissue_of_invitation_id uuid
    references public.workspace_invitations (id) on delete restrict;

comment on column public.workspace_invitations.reissue_of_invitation_id is
  'For a reissue invitation, the revoked invitation it replaces. Never modified.';

-- ---------------------------------------------------------------------------
-- 2. State/timestamps CHECK gains the reissue_prepared branch. The prepared
--    branch stays strictly invitee-less; reissue_prepared requires both the
--    invitee and the replaced invitation.
-- ---------------------------------------------------------------------------

alter table public.workspace_invitations
  drop constraint workspace_invitations_state_timestamps;

alter table public.workspace_invitations
  add constraint workspace_invitations_state_timestamps check (
    (
      status = 'prepared'
      and invitee_user_id is null
      and reissue_of_invitation_id is null
      and sent_at is null
      and accepted_at is null
      and failed_at is null
      and revoked_at is null
      and failure_code is null
    )
    or (
      status = 'reissue_prepared'
      and invitee_user_id is not null
      and reissue_of_invitation_id is not null
      and sent_at is null
      and accepted_at is null
      and failed_at is null
      and revoked_at is null
      and failure_code is null
    )
    or (
      status = 'sent'
      and invitee_user_id is not null
      and sent_at is not null
      and accepted_at is null
      and failed_at is null
      and revoked_at is null
      and failure_code is null
    )
    or (
      status = 'accepted'
      and invitee_user_id is not null
      and sent_at is not null
      and accepted_at is not null
      and failed_at is null
      and revoked_at is null
      and failure_code is null
    )
    or (
      status = 'failed'
      and accepted_at is null
      and failed_at is not null
      and revoked_at is null
      and failure_code is not null
    )
    or (
      status = 'revoked'
      and accepted_at is null
      and failed_at is null
      and revoked_at is not null
      and failure_code is null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Immutability trigger: the link column is immutable and the transition
--    matrix accepts reissue_prepared alongside prepared.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_invitations_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'workspace_invitation_delete_not_supported' using errcode = '27000';
  end if;

  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.email_hash is distinct from old.email_hash
     or new.email_hint is distinct from old.email_hint
     or new.display_name is distinct from old.display_name
     or new.role is distinct from old.role
     or new.invited_by is distinct from old.invited_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.expires_at is distinct from old.expires_at
     or new.reissue_of_invitation_id is distinct from old.reissue_of_invitation_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'workspace_invitation_identity_immutable' using errcode = '27000';
  end if;

  if old.invitee_user_id is not null
     and new.invitee_user_id is distinct from old.invitee_user_id
  then
    raise exception 'workspace_invitation_invitee_immutable' using errcode = '27000';
  end if;

  if new.status is distinct from old.status
     and not (
       (old.status = 'prepared' and new.status in ('sent', 'failed', 'revoked'))
       or (old.status = 'reissue_prepared' and new.status in ('sent', 'failed', 'revoked'))
       or (old.status = 'sent' and new.status in ('accepted', 'failed', 'revoked'))
     )
  then
    raise exception 'workspace_invitation_invalid_transition' using errcode = '27000';
  end if;

  if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
    raise exception 'workspace_invitation_sent_at_immutable' using errcode = '27000';
  end if;
  if old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at then
    raise exception 'workspace_invitation_accepted_at_immutable' using errcode = '27000';
  end if;
  if old.failed_at is not null and new.failed_at is distinct from old.failed_at then
    raise exception 'workspace_invitation_failed_at_immutable' using errcode = '27000';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'workspace_invitation_revoked_at_immutable' using errcode = '27000';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. One-open-invitation unique index covers reissue_prepared.
-- ---------------------------------------------------------------------------

drop index public.workspace_invitations_one_open_email_idx;

create unique index workspace_invitations_one_open_email_idx
  on public.workspace_invitations (workspace_id, email_hash)
  where status in ('prepared', 'sent', 'reissue_prepared');

-- ---------------------------------------------------------------------------
-- 5. Preparation: post-lock time point, operation kind and the reissue branch.
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
  v_expired_invitee public.workspace_invitations%rowtype;
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

  -- Reissue candidate: the newest EXPIRED invitation that already carries an
  -- invitee (a sent invitation whose Auth user exists, or a previous reissue
  -- that never reached sent). Only such rows can be re-sent to the SAME Auth
  -- user without a second auth.users INSERT.
  select i.* into v_expired_invitee
  from public.workspace_invitations as i
  where i.workspace_id = p_workspace_id
    and i.email_hash = p_email_hash
    and i.status in ('sent', 'reissue_prepared')
    and i.invitee_user_id is not null
    and i.expires_at <= v_now
  order by i.created_at desc, i.id desc
  limit 1;

  if found then
    -- The invitee must still be a valid, active internal user with a live
    -- identity, and the membership must still be awaiting activation. A
    -- suspended/merged user, a revoked identity, or an accepted membership
    -- must never enter the reissue path.
    if not exists (
      select 1
      from public.app_users as u
      join public.user_identities as ui on ui.user_id = u.id
      where u.id = v_expired_invitee.invitee_user_id
        and u.status = 'active'
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
        and m.user_id = v_expired_invitee.invitee_user_id
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
    if v_expired_invitee.role is distinct from p_role then
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
      v_expired_invitee.invitee_user_id,
      v_actor_id,
      p_idempotency_key,
      v_now + pg_catalog.make_interval(
        secs => public.workspace_invitation_ttl_seconds()
      ),
      v_expired_invitee.id
    ) returning id into v_invitation_id;

    return query select
      v_invitation_id,
      'reissue_prepared'::public.workspace_invitation_status,
      true,
      'existing_invitee_reissue';
    return;
  end if;

  -- Plain new-user flow: close expired prepared rows (they have no invitee to
  -- reuse) and reject any still-valid open invitation for this digest.
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
-- 6. Service-only reissue finalization. Moves a reissue_prepared invitation to
--    sent AFTER the Edge Function confirmed that Auth accepted the re-send.
--    Idempotent: a second call for an already-sent invitation returns sent.
-- ---------------------------------------------------------------------------

create function public.finalize_workspace_invitation_reissue(
  p_invitation_id uuid
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

  -- The replaced invitation must still be revoked and must belong to the same
  -- workspace and digest: reissue never resurrects or re-targets history.
  select i.* into v_replaced
  from public.workspace_invitations as i
  where i.id = v_invitation.reissue_of_invitation_id
  for update;

  if not found
     or v_replaced.status <> 'revoked'
     or v_replaced.workspace_id is distinct from v_invitation.workspace_id
     or v_replaced.email_hash is distinct from v_invitation.email_hash
  then
    raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
  end if;

  -- The invitee relationship must still be intact: an invited membership, an
  -- active internal user and a live identity are all required.
  if not exists (
    select 1 from public.workspace_members as m
    where m.workspace_id = v_invitation.workspace_id
      and m.user_id = v_invitation.invitee_user_id
      and m.status = 'invited'
  ) then
    raise exception 'workspace_invitation_state_conflict' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.app_users as u
    join public.user_identities as ui on ui.user_id = u.id
    where u.id = v_invitation.invitee_user_id
      and u.status = 'active'
      and ui.verified_at is not null
      and ui.revoked_at is null
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

revoke all on function public.finalize_workspace_invitation_reissue(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_workspace_invitation_reissue(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Failure compensation accepts reissue_prepared invitations.
-- ---------------------------------------------------------------------------

create or replace function public.mark_workspace_invitation_failed(
  p_invitation_id uuid,
  p_failure_code text
)
returns public.workspace_invitation_status
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status public.workspace_invitation_status;
begin
  if p_failure_code not in (
    'auth_invite_failed',
    'auth_user_conflict',
    'temporary_failure'
  ) then
    raise exception 'workspace_invitation_failure_invalid' using errcode = '22023';
  end if;

  select i.status into v_status
  from public.workspace_invitations as i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'workspace_invitation_not_found' using errcode = 'P0002';
  end if;
  if v_status in ('prepared', 'reissue_prepared') then
    update public.workspace_invitations as i
    set
      status = 'failed',
      failed_at = pg_catalog.clock_timestamp(),
      failure_code = p_failure_code
    where i.id = p_invitation_id;
    return 'failed'::public.workspace_invitation_status;
  end if;

  return v_status;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Member directory reports whether an invited membership still has a valid
--    pending invitation, so admins can distinguish "awaiting activation" from
--    "invitation expired, needs a re-invite". Only sent invitations count as
--    pending; a reissue_prepared row is transient and has not been mailed.
-- ---------------------------------------------------------------------------

drop function public.list_workspace_members(uuid);

create function public.list_workspace_members(p_workspace_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  organization_name text,
  title text,
  role public.workspace_role,
  status public.workspace_member_status,
  joined_at timestamptz,
  disabled_at timestamptz,
  pending_invitation boolean
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
    m.disabled_at,
    exists (
      select 1
      from public.workspace_invitations as i
      where i.workspace_id = m.workspace_id
        and i.invitee_user_id = m.user_id
        and i.status = 'sent'
        and i.expires_at > now()
    ) as pending_invitation
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

revoke all on function public.list_workspace_members(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_workspace_members(uuid)
  to authenticated;
