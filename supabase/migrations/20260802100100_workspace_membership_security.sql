-- Task 1.4 - workspace RLS, controlled RPCs and invitation provisioning.

-- ---------------------------------------------------------------------------
-- Internal authorization helpers. Every helper resolves the actor through the
-- existing current_app_user_id() boundary and never accepts an actor id.
-- ---------------------------------------------------------------------------

create function public.is_active_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.workspace_members as m
    where m.workspace_id = p_workspace_id
      and m.user_id = public.current_app_user_id()
      and m.status = 'active'
  );
$function$;

create function public.workspace_role_for_current_user(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $function$
  select m.role
  from public.workspace_members as m
  where m.workspace_id = p_workspace_id
    and m.user_id = public.current_app_user_id()
    and m.status = 'active';
$function$;

create function public.can_manage_workspace_members(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    public.workspace_role_for_current_user(p_workspace_id) in ('owner', 'admin'),
    false
  );
$function$;

revoke all on function public.is_active_workspace_member(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.workspace_role_for_current_user(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_manage_workspace_members(uuid)
  from public, anon, authenticated, service_role;

-- The workspaces SELECT policy calls this helper as authenticated. The other
-- helpers remain internal to SECURITY DEFINER RPCs.
grant execute on function public.is_active_workspace_member(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS and table grants: default deny, then open only workspace SELECT. Member
-- directory and invitation data are returned exclusively by whitelist RPCs.
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;

create policy workspaces_select_active_members on public.workspaces
  for select to authenticated
  using (public.is_active_workspace_member(id));

revoke all on public.workspaces
  from public, anon, authenticated, service_role;
revoke all on public.workspace_members
  from public, anon, authenticated, service_role;
revoke all on public.workspace_invitations
  from public, anon, authenticated, service_role;

grant select on public.workspaces to authenticated;

-- ---------------------------------------------------------------------------
-- Controlled default workspace bootstrap. The idempotency key represents one
-- logical bootstrap request: matching retries return the existing workspace;
-- conflicting retries fail with a static error.
-- ---------------------------------------------------------------------------

create function public.bootstrap_default_workspace(
  p_owner_id uuid,
  p_name text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.workspaces%rowtype;
  v_workspace_id uuid;
  v_name text := pg_catalog.btrim(p_name);
begin
  if p_owner_id is null or p_idempotency_key is null then
    raise exception 'workspace_bootstrap_invalid' using errcode = '22023';
  end if;
  if v_name = '' or pg_catalog.char_length(v_name) > 120 then
    raise exception 'workspace_bootstrap_invalid' using errcode = '22023';
  end if;

  select w.* into v_existing
  from public.workspaces as w
  where w.bootstrap_key = p_idempotency_key;

  if found then
    if v_existing.owner_id = p_owner_id and v_existing.name = v_name then
      return v_existing.id;
    end if;
    raise exception 'workspace_bootstrap_conflict' using errcode = '23505';
  end if;

  if not exists (
    select 1 from public.app_users as u
    where u.id = p_owner_id and u.status = 'active'
  ) then
    raise exception 'workspace_bootstrap_owner_invalid' using errcode = '22023';
  end if;

  insert into public.workspaces (
    name,
    owner_id,
    created_by,
    bootstrap_key
  ) values (
    v_name,
    p_owner_id,
    p_owner_id,
    p_idempotency_key
  ) returning id into v_workspace_id;

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    invited_by,
    joined_at
  ) values (
    v_workspace_id,
    p_owner_id,
    'owner',
    'active',
    p_owner_id,
    pg_catalog.clock_timestamp()
  );

  return v_workspace_id;
exception
  when unique_violation then
    select w.* into v_existing
    from public.workspaces as w
    where w.bootstrap_key = p_idempotency_key;
    if found and v_existing.owner_id = p_owner_id and v_existing.name = v_name then
      return v_existing.id;
    end if;
    raise exception 'workspace_bootstrap_conflict' using errcode = '23505';
end;
$function$;

revoke all on function public.bootstrap_default_workspace(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_default_workspace(uuid, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Read RPCs. Their return shapes are deliberate safe projections.
-- ---------------------------------------------------------------------------

create function public.list_my_workspaces()
returns table (
  workspace_id uuid,
  workspace_name text,
  role public.workspace_role,
  status public.workspace_member_status,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select w.id, w.name, m.role, m.status, m.joined_at
  from public.workspace_members as m
  join public.workspaces as w on w.id = m.workspace_id
  where m.user_id = public.current_app_user_id()
    and m.status = 'active'
  order by w.created_at, w.id;
$function$;

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
    p.display_name,
    p.avatar_url,
    p.organization_name,
    p.title,
    m.role,
    m.status,
    m.joined_at,
    m.disabled_at
  from public.workspace_members as m
  join public.profiles as p on p.user_id = m.user_id
  where m.workspace_id = p_workspace_id
    and (v_actor_role in ('owner', 'admin') or m.status = 'active')
  order by
    case m.role
      when 'owner' then 1
      when 'admin' then 2
      when 'member' then 3
      else 4
    end,
    p.display_name,
    m.user_id;
end;
$function$;

create function public.list_my_pending_workspace_invitations()
returns table (
  invitation_id uuid,
  workspace_id uuid,
  workspace_name text,
  role public.workspace_role,
  status public.workspace_invitation_status,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select i.id, i.workspace_id, w.name, i.role, i.status, i.expires_at
  from public.workspace_invitations as i
  join public.workspaces as w on w.id = i.workspace_id
  where i.invitee_user_id = public.current_app_user_id()
    and i.status = 'sent'
    and i.expires_at > pg_catalog.clock_timestamp()
  order by i.created_at, i.id;
$function$;

revoke all on function public.list_my_workspaces()
  from public, anon, authenticated, service_role;
revoke all on function public.list_workspace_members(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_pending_workspace_invitations()
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_workspaces() to authenticated;
grant execute on function public.list_workspace_members(uuid) to authenticated;
grant execute on function public.list_my_pending_workspace_invitations() to authenticated;

-- ---------------------------------------------------------------------------
-- Member role and status management. Authorization is always derived from the
-- current verified caller and evaluated again inside the database.
-- ---------------------------------------------------------------------------

create function public.set_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns table (
  user_id uuid,
  role public.workspace_role,
  status public.workspace_member_status
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_actor_role public.workspace_role;
  v_target public.workspace_members%rowtype;
begin
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
  if v_target.role = 'owner' or p_role = 'owner' then
    raise exception 'workspace_owner_immutable' using errcode = '42501';
  end if;
  if v_target.status = 'invited' then
    raise exception 'workspace_member_status_conflict' using errcode = '55000';
  end if;
  if v_actor_role = 'admin'
     and (
       v_target.role not in ('member', 'external_collaborator')
       or p_role not in ('member', 'external_collaborator')
     )
  then
    raise exception 'workspace_permission_denied' using errcode = '42501';
  end if;

  if v_target.role is distinct from p_role then
    update public.workspace_members as m
    set role = p_role
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
  end if;

  return query
  select m.user_id, m.role, m.status
  from public.workspace_members as m
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
end;
$function$;

create function public.set_workspace_member_status(
  p_workspace_id uuid,
  p_user_id uuid,
  p_status public.workspace_member_status
)
returns table (
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
  if v_target.status = 'invited' then
    raise exception 'workspace_member_status_conflict' using errcode = '55000';
  end if;
  if v_actor_role = 'admin'
     and v_target.role not in ('member', 'external_collaborator')
  then
    raise exception 'workspace_permission_denied' using errcode = '42501';
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

revoke all on function public.set_workspace_member_role(uuid, uuid, public.workspace_role)
  from public, anon, authenticated, service_role;
revoke all on function public.set_workspace_member_status(uuid, uuid, public.workspace_member_status)
  from public, anon, authenticated, service_role;
grant execute on function public.set_workspace_member_role(uuid, uuid, public.workspace_role)
  to authenticated;
grant execute on function public.set_workspace_member_status(uuid, uuid, public.workspace_member_status)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Invitation preparation and failure compensation. The Edge Function sends
-- only a digest/hint to preparation; plaintext email remains in memory only.
-- ---------------------------------------------------------------------------

create function public.prepare_workspace_invitation(
  p_workspace_id uuid,
  p_email_hash text,
  p_email_hint text,
  p_display_name text,
  p_role public.workspace_role,
  p_idempotency_key uuid,
  p_expires_at timestamptz
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
     or p_expires_at <= pg_catalog.clock_timestamp()
     or p_expires_at > pg_catalog.clock_timestamp() + interval '14 days'
     or p_role is null or p_role = 'owner'
  then
    raise exception 'workspace_invitation_invalid' using errcode = '22023';
  end if;
  if v_actor_role = 'admin' and p_role not in ('member', 'external_collaborator') then
    raise exception 'workspace_permission_denied' using errcode = '42501';
  end if;

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
    p_expires_at
  ) returning id into v_invitation_id;

  return query select v_invitation_id, 'prepared'::public.workspace_invitation_status, true;
exception
  when unique_violation then
    raise exception 'workspace_invitation_conflict' using errcode = '23505';
end;
$function$;

create function public.mark_workspace_invitation_failed(
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
  if v_status = 'prepared' then
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

revoke all on function public.prepare_workspace_invitation(
  uuid, text, text, text, public.workspace_role, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_workspace_invitation(
  uuid, text, text, text, public.workspace_role, uuid, timestamptz
) to authenticated;

revoke all on function public.mark_workspace_invitation_failed(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_workspace_invitation_failed(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Auth invite provisioning. Only namespaced invitation metadata triggers the
-- path. Business values come from the locked invitation row, never metadata.
-- ---------------------------------------------------------------------------

create function public.provision_workspace_invited_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invitation_id uuid;
  v_invitation public.workspace_invitations%rowtype;
  v_provider_tenant text;
  v_email_hash text;
  v_app_user_id uuid := pg_catalog.gen_random_uuid();
begin
  if coalesce(new.raw_user_meta_data ->> 'ops_workspace_invitation_id', '') = '' then
    return new;
  end if;

  begin
    v_invitation_id := (new.raw_user_meta_data ->> 'ops_workspace_invitation_id')::uuid;
  exception
    when others then
      raise exception 'workspace_invitation_provisioning_invalid' using errcode = '22023';
  end;

  v_provider_tenant := pg_catalog.btrim(
    coalesce(new.raw_user_meta_data ->> 'ops_provider_tenant', '')
  );
  if v_provider_tenant = '' or pg_catalog.char_length(v_provider_tenant) > 2048 then
    raise exception 'workspace_invitation_provisioning_invalid' using errcode = '22023';
  end if;

  select i.* into v_invitation
  from public.workspace_invitations as i
  where i.id = v_invitation_id
  for update;

  if not found
     or v_invitation.status <> 'prepared'
     or v_invitation.expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception 'workspace_invitation_provisioning_invalid' using errcode = '55000';
  end if;
  if new.email is null then
    raise exception 'workspace_invitation_provisioning_invalid' using errcode = '22023';
  end if;

  v_email_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.lower(pg_catalog.btrim(new.email)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_email_hash <> v_invitation.email_hash then
    raise exception 'workspace_invitation_provisioning_invalid' using errcode = '22023';
  end if;

  insert into public.app_users (id, status)
  values (v_app_user_id, 'active');

  insert into public.profiles (user_id, display_name)
  values (v_app_user_id, v_invitation.display_name);

  insert into public.user_identities (
    user_id,
    provider,
    provider_tenant,
    provider_subject,
    verified_at
  ) values (
    v_app_user_id,
    'supabase_auth',
    v_provider_tenant,
    new.id::text,
    pg_catalog.clock_timestamp()
  );

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    invited_by
  ) values (
    v_invitation.workspace_id,
    v_app_user_id,
    v_invitation.role,
    'invited',
    v_invitation.invited_by
  );

  update public.workspace_invitations as i
  set
    status = 'sent',
    invitee_user_id = v_app_user_id,
    sent_at = pg_catalog.clock_timestamp()
  where i.id = v_invitation_id;

  return new;
exception
  when unique_violation then
    raise exception 'workspace_invitation_provisioning_conflict' using errcode = '23505';
end;
$function$;

create trigger provision_workspace_invited_auth_user
  after insert on auth.users
  for each row execute function public.provision_workspace_invited_auth_user();

revoke all on function public.provision_workspace_invited_auth_user()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Invitation acceptance. Repeating an already successful acceptance returns
-- the same stable relationship instead of mutating state again.
-- ---------------------------------------------------------------------------

create function public.accept_workspace_invitation(p_invitation_id uuid)
returns table (
  invitation_id uuid,
  workspace_id uuid,
  membership_status public.workspace_member_status,
  already_accepted boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_invitation public.workspace_invitations%rowtype;
  v_membership public.workspace_members%rowtype;
begin
  if v_actor_id is null then
    raise exception 'workspace_invitation_not_owned' using errcode = '42501';
  end if;

  select i.* into v_invitation
  from public.workspace_invitations as i
  where i.id = p_invitation_id
  for update;

  if not found or v_invitation.invitee_user_id is distinct from v_actor_id then
    raise exception 'workspace_invitation_not_owned' using errcode = '42501';
  end if;

  select m.* into v_membership
  from public.workspace_members as m
  where m.workspace_id = v_invitation.workspace_id
    and m.user_id = v_actor_id
  for update;

  if not found then
    raise exception 'workspace_invitation_unavailable' using errcode = '55000';
  end if;

  if v_invitation.status = 'accepted' and v_membership.status = 'active' then
    return query select
      v_invitation.id,
      v_invitation.workspace_id,
      v_membership.status,
      true;
    return;
  end if;
  if v_invitation.status <> 'sent' or v_membership.status <> 'invited' then
    raise exception 'workspace_invitation_unavailable' using errcode = '55000';
  end if;
  if v_invitation.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'workspace_invitation_expired' using errcode = '55000';
  end if;

  update public.workspace_members as m
  set status = 'active', joined_at = pg_catalog.clock_timestamp()
  where m.workspace_id = v_invitation.workspace_id and m.user_id = v_actor_id;

  update public.workspace_invitations as i
  set status = 'accepted', accepted_at = pg_catalog.clock_timestamp()
  where i.id = v_invitation.id;

  return query select
    v_invitation.id,
    v_invitation.workspace_id,
    'active'::public.workspace_member_status,
    false;
end;
$function$;

revoke all on function public.accept_workspace_invitation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_workspace_invitation(uuid)
  to authenticated;
