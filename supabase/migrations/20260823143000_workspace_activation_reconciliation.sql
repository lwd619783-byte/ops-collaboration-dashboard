-- Recover a workspace membership only when an administrator explicitly acts
-- and the database can prove that authentication succeeded while the business
-- invitation lineage ended in a known recoverable delivery/identity failure.
--
-- This deliberately reuses the existing status-management RPC instead of
-- adding an automatic self-activation path. Normal pending invitations remain
-- subject to accept_workspace_invitation(). Invitation history is never edited.

create or replace function public.set_workspace_member_status(
  p_workspace_id uuid,
  p_user_id uuid,
  p_status public.workspace_member_status
)
returns table(
  user_id uuid,
  role public.workspace_role,
  status public.workspace_member_status,
  disabled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_actor_role public.workspace_role;
  v_target public.workspace_members%rowtype;
  v_latest_invitation public.workspace_invitations%rowtype;
  v_has_verified_identity boolean := false;
  v_has_sent_lineage boolean := false;
begin
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'workspace_member_status_conflict' using errcode = '55000';
  end if;

  select m.role into v_actor_role
  from public.workspace_members as m
  where m.workspace_id = p_workspace_id
    and m.user_id = v_actor_id
    and m.status = 'active';

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'workspace_permission_denied' using errcode = '42501';
  end if;

  select m.* into v_target
  from public.workspace_members as m
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  for update;

  if not found then
    raise exception 'workspace_member_not_found' using errcode = 'P0002';
  end if;
  if v_target.role = 'owner' then
    raise exception 'workspace_owner_immutable' using errcode = '42501';
  end if;
  if v_actor_role = 'admin'
     and v_target.role not in ('member', 'external_collaborator')
  then
    raise exception 'workspace_permission_denied' using errcode = '42501';
  end if;

  if v_target.status = 'invited' then
    -- An invited member may only move to active through this recovery branch;
    -- suspension and every other transition remain invalid.
    if p_status <> 'active' then
      raise exception 'workspace_member_status_conflict' using errcode = '55000';
    end if;

    select i.* into v_latest_invitation
    from public.workspace_invitations as i
    where i.workspace_id = p_workspace_id
      and i.invitee_user_id = p_user_id
    order by i.created_at desc, i.id desc
    limit 1;

    select exists (
      select 1
      from public.app_users as au
      join public.user_identities as ui on ui.user_id = au.id
      where au.id = p_user_id
        and au.status = 'active'
        and ui.provider = 'supabase_auth'
        and ui.verified_at is not null
        and ui.revoked_at is null
    ) into v_has_verified_identity;

    if v_latest_invitation.id is not null then
      with recursive lineage as (
        select
          i.id,
          i.reissue_of_invitation_id,
          i.sent_at
        from public.workspace_invitations as i
        where i.id = v_latest_invitation.id

        union all

        select
          parent.id,
          parent.reissue_of_invitation_id,
          parent.sent_at
        from public.workspace_invitations as parent
        join lineage as child
          on parent.id = child.reissue_of_invitation_id
        where parent.workspace_id = p_workspace_id
          and parent.invitee_user_id = p_user_id
      )
      select exists (
        select 1 from lineage where sent_at is not null
      ) into v_has_sent_lineage;
    end if;

    if not v_has_verified_identity
       or v_latest_invitation.id is null
       or v_latest_invitation.status <> 'failed'
       or v_latest_invitation.failure_code not in (
         'auth_user_conflict',
         'auth_invite_failed',
         'temporary_failure'
       )
       or not v_has_sent_lineage
    then
      raise exception 'workspace_activation_recovery_unavailable'
        using errcode = '55000';
    end if;

    update public.workspace_members as m
    set
      status = 'active',
      joined_at = coalesce(m.joined_at, pg_catalog.clock_timestamp()),
      disabled_at = null
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id;

    return query
    select m.user_id, m.role, m.status, m.disabled_at
    from public.workspace_members as m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
    return;
  end if;

  if v_target.status is distinct from p_status then
    update public.workspace_members as m
    set
      status = p_status,
      disabled_at = case
        when p_status = 'suspended' then pg_catalog.clock_timestamp()
        else null
      end
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
  end if;

  return query
  select m.user_id, m.role, m.status, m.disabled_at
  from public.workspace_members as m
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
end;
$function$;

revoke all on function public.set_workspace_member_status(
  uuid,
  uuid,
  public.workspace_member_status
) from public, anon;
grant execute on function public.set_workspace_member_status(
  uuid,
  uuid,
  public.workspace_member_status
) to authenticated;
