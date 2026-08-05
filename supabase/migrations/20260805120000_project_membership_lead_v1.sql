-- Task 2.2 - project membership and lead management V1.
--
-- Project membership remains an internal app_users relationship. Browser
-- clients receive only safe projections and execute reviewed RPCs; they never
-- receive direct project_members write privileges or an actor-id parameter.

-- ---------------------------------------------------------------------------
-- Evolve the Task 2.1 guards. Project identity fields remain immutable while
-- owner_id / lead_id and member roles may change inside atomic transactions.
-- Archived projects remain fully immutable, including membership leadership.
-- ---------------------------------------------------------------------------

drop trigger projects_guard on public.projects;

create or replace function public.projects_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'project_delete_not_supported' using errcode = '27000';
  end if;

  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.created_by is distinct from old.created_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at
  then
    raise exception 'project_identity_immutable' using errcode = '27000';
  end if;

  if old.status = 'archived'
     and (
       new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.project_type is distinct from old.project_type
       or new.status is distinct from old.status
       or new.owner_id is distinct from old.owner_id
       or new.lead_id is distinct from old.lead_id
       or new.start_date is distinct from old.start_date
       or new.due_date is distinct from old.due_date
       or new.archived_at is distinct from old.archived_at
     )
  then
    raise exception 'project_archived' using errcode = '55000';
  end if;

  if new.status is distinct from old.status
     and not (
       (old.status = 'planning' and new.status = 'active')
       or (old.status = 'active' and new.status in ('paused', 'completed'))
       or (old.status = 'paused' and new.status = 'active')
       or (old.status = 'completed' and new.status = 'archived')
     )
  then
    raise exception 'project_invalid_transition' using errcode = '55000';
  end if;

  if new.status = 'archived' and new.status is distinct from old.status then
    if new.archived_at is null then
      raise exception 'project_archive_timestamp_required' using errcode = '23514';
    end if;
  elsif new.archived_at is distinct from old.archived_at then
    raise exception 'project_archive_controlled' using errcode = '27000';
  end if;

  return new;
end;
$function$;

create trigger projects_guard
  before update or delete on public.projects
  for each row execute function public.projects_guard();

drop trigger project_members_guard on public.project_members;

create or replace function public.project_members_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and (
       new.project_id is distinct from old.project_id
       or new.user_id is distinct from old.user_id
       or new.joined_at is distinct from old.joined_at
     )
  then
    raise exception 'project_member_identity_immutable' using errcode = '27000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create trigger project_members_guard
  before update or delete on public.project_members
  for each row execute function public.project_members_guard();

-- The creator is historical after insert. Owner and lead, however, must stay
-- active workspace users on every project change.
create or replace function public.assert_project_workspace_users_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.app_users as u
    join public.workspace_members as m on m.user_id = u.id
    where u.id = new.owner_id
      and u.status = 'active'
      and m.workspace_id = new.workspace_id
      and m.status = 'active'
  ) then
    raise exception 'project_workspace_owner_invalid' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1
    from public.app_users as u
    join public.workspace_members as m on m.user_id = u.id
    where u.id = new.created_by
      and u.status = 'active'
      and m.workspace_id = new.workspace_id
      and m.status = 'active'
  ) then
    raise exception 'project_workspace_actor_invalid' using errcode = '23514';
  end if;

  if new.lead_id is not null and not exists (
    select 1
    from public.app_users as u
    join public.workspace_members as m on m.user_id = u.id
    where u.id = new.lead_id
      and u.status = 'active'
      and m.workspace_id = new.workspace_id
      and m.status = 'active'
  ) then
    raise exception 'project_workspace_lead_invalid' using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger project_members_workspace_valid on public.project_members;

create constraint trigger project_members_workspace_valid
  after insert or update on public.project_members
  for each row execute function public.assert_project_member_workspace_valid();

-- Task 2.1 had no browser path that could set a lead or mutate member roles.
-- Normalize any privileged pre-Task-2.2 rows before installing the stronger
-- uniqueness and consistency constraints.
update public.projects
set lead_id = null
where lead_id = owner_id;

update public.project_members as pm
set role = 'member'
from public.projects as p
where p.id = pm.project_id
  and (
    (pm.role = 'owner' and pm.user_id <> p.owner_id)
    or (pm.role = 'lead' and pm.user_id is distinct from p.lead_id)
  );

insert into public.project_members (project_id, user_id, role)
select p.id, p.owner_id, 'owner'::public.project_role
from public.projects as p
on conflict (project_id, user_id) do update set role = excluded.role;

insert into public.project_members (project_id, user_id, role)
select p.id, p.lead_id, 'lead'::public.project_role
from public.projects as p
where p.lead_id is not null
on conflict (project_id, user_id) do update set role = excluded.role;

create unique index project_members_one_owner_idx
  on public.project_members (project_id)
  where role = 'owner';

create unique index project_members_one_lead_idx
  on public.project_members (project_id)
  where role = 'lead';

drop trigger projects_owner_membership_required on public.projects;
drop trigger project_members_owner_membership_required on public.project_members;

create or replace function public.assert_project_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_project public.projects%rowtype;
begin
  if tg_table_name = 'projects' then
    v_project_id := coalesce(new.id, old.id);
  else
    v_project_id := coalesce(new.project_id, old.project_id);
  end if;

  select p.* into v_project
  from public.projects as p
  where p.id = v_project_id;

  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_project.owner_id is null
     or not exists (
       select 1
       from public.project_members as pm
       where pm.project_id = v_project.id
         and pm.user_id = v_project.owner_id
         and pm.role = 'owner'
     )
     or (select count(*) from public.project_members as pm
         where pm.project_id = v_project.id and pm.role = 'owner') <> 1
  then
    raise exception 'project_owner_membership_required' using errcode = '23514';
  end if;

  if v_project.lead_id is not null
     and v_project.lead_id = v_project.owner_id
  then
    raise exception 'project_owner_lead_conflict' using errcode = '23514';
  end if;

  if v_project.lead_id is null then
    if exists (
      select 1 from public.project_members as pm
      where pm.project_id = v_project.id and pm.role = 'lead'
    ) then
      raise exception 'project_lead_membership_mismatch' using errcode = '23514';
    end if;
  elsif not exists (
    select 1
    from public.project_members as pm
    where pm.project_id = v_project.id
      and pm.user_id = v_project.lead_id
      and pm.role = 'lead'
  ) or (select count(*) from public.project_members as pm
        where pm.project_id = v_project.id and pm.role = 'lead') <> 1
  then
    raise exception 'project_lead_membership_mismatch' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

create constraint trigger projects_owner_membership_required
  after insert or update on public.projects
  deferrable initially deferred
  for each row execute function public.assert_project_owner_membership();

create constraint trigger project_members_owner_membership_required
  after insert or update or delete on public.project_members
  deferrable initially deferred
  for each row execute function public.assert_project_owner_membership();

comment on index public.project_members_one_owner_idx is
  'Every project has at most one owner membership; the deferred invariant requires exactly one.';
comment on index public.project_members_one_lead_idx is
  'Every project has at most one optional lead membership.';

-- Project owner / lead responsibility must be reassigned before either the
-- workspace membership or the global app user can be deactivated. Ordinary
-- member/viewer relationships are retained as inert history: RLS immediately
-- denies access while either status is inactive, and deliberate reactivation
-- restores the existing relationship.
create function public.guard_project_responsibility_on_workspace_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'active' and new.status <> 'active'
     and exists (
       select 1
       from public.projects as p
       where p.workspace_id = old.workspace_id
         and (p.owner_id = old.user_id or p.lead_id = old.user_id)
     )
  then
    raise exception 'workspace_member_project_responsibility_conflict' using errcode = '55000';
  end if;
  return new;
end;
$function$;

create trigger guard_project_responsibility_on_workspace_status
  before update of status on public.workspace_members
  for each row execute function public.guard_project_responsibility_on_workspace_status();

create function public.guard_project_responsibility_on_app_user_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'active' and new.status <> 'active'
     and exists (
       select 1
       from public.projects as p
       where p.owner_id = old.id or p.lead_id = old.id
     )
  then
    raise exception 'app_user_project_responsibility_conflict' using errcode = '55000';
  end if;
  return new;
end;
$function$;

create trigger guard_project_responsibility_on_app_user_status
  before update of status on public.app_users
  for each row execute function public.guard_project_responsibility_on_app_user_status();

revoke all on function public.guard_project_responsibility_on_workspace_status()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_project_responsibility_on_app_user_status()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal authorization and validation helpers.
-- ---------------------------------------------------------------------------

create function public.project_role_for_current_user(p_project_id uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $function$
  select pm.role
  from public.project_members as pm
  join public.projects as p on p.id = pm.project_id
  join public.workspace_members as wm
    on wm.workspace_id = p.workspace_id and wm.user_id = pm.user_id
  join public.app_users as u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and pm.user_id = public.current_app_user_id()
    and wm.status = 'active'
    and u.status = 'active';
$function$;

create function public.can_manage_project_members(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select public.can_manage_workspace_projects(p.workspace_id)
        or coalesce(public.project_role_for_current_user(p.id) in ('owner', 'lead'), false)
      from public.projects as p
      where p.id = p_project_id
    ),
    false
  );
$function$;

create function public.can_manage_project_leadership(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select public.can_manage_workspace_projects(p.workspace_id)
        or public.project_role_for_current_user(p.id) = 'owner'
      from public.projects as p
      where p.id = p_project_id
    ),
    false
  );
$function$;

create function public.assert_active_project_candidate(
  p_project_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  select p.workspace_id into v_workspace_id
  from public.projects as p
  where p.id = p_project_id;

  if p_user_id is null or not exists (
    select 1
    from public.workspace_members as wm
    join public.app_users as u on u.id = wm.user_id
    where wm.workspace_id = v_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'
      and u.status = 'active'
  ) then
    raise exception 'project_member_candidate_invalid' using errcode = '22023';
  end if;
end;
$function$;

revoke all on function public.project_role_for_current_user(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_manage_project_members(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_manage_project_leadership(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_active_project_candidate(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Safe project member and candidate projections.
-- ---------------------------------------------------------------------------

create function public.list_project_members(p_project_id uuid)
returns table (
  project_id uuid,
  workspace_id uuid,
  app_user_id uuid,
  display_name text,
  workspace_role public.workspace_role,
  project_role public.project_role,
  joined_at timestamptz,
  is_current_user boolean,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    pm.project_id,
    p.workspace_id,
    pm.user_id,
    coalesce(pr.display_name, '未设置显示名称'),
    wm.role,
    pm.role,
    pm.joined_at,
    pm.user_id = public.current_app_user_id(),
    wm.status = 'active' and u.status = 'active'
  from public.project_members as pm
  join public.projects as p on p.id = pm.project_id
  join public.workspace_members as wm
    on wm.workspace_id = p.workspace_id and wm.user_id = pm.user_id
  join public.app_users as u on u.id = pm.user_id
  left join public.profiles as pr on pr.user_id = pm.user_id
  where pm.project_id = p_project_id
    and public.can_read_project(p_project_id)
  order by
    case pm.role
      when 'owner' then 1
      when 'lead' then 2
      when 'member' then 3
      else 4
    end,
    coalesce(pr.display_name, '未设置显示名称'),
    pm.user_id;
$function$;

create function public.list_project_member_candidates(p_project_id uuid)
returns table (
  project_id uuid,
  workspace_id uuid,
  app_user_id uuid,
  display_name text,
  workspace_role public.workspace_role,
  existing_project_role public.project_role
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
    and public.can_read_project(p.id);

  if not found then
    return;
  end if;
  if not public.can_manage_project_members(p_project_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;

  return query
  select
    v_project.id,
    v_project.workspace_id,
    wm.user_id,
    coalesce(pr.display_name, '未设置显示名称'),
    wm.role,
    pm.role
  from public.workspace_members as wm
  join public.app_users as u on u.id = wm.user_id
  left join public.profiles as pr on pr.user_id = wm.user_id
  left join public.project_members as pm
    on pm.project_id = v_project.id and pm.user_id = wm.user_id
  where wm.workspace_id = v_project.workspace_id
    and wm.status = 'active'
    and u.status = 'active'
  order by coalesce(pr.display_name, '未设置显示名称'), wm.user_id;
end;
$function$;

revoke all on function public.list_project_members(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_project_member_candidates(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_members(uuid) to authenticated;
grant execute on function public.list_project_member_candidates(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ordinary member writes. Every function locks the project first, derives the
-- actor from current_app_user_id(), rejects archived projects and returns a
-- project snapshot with both entity scope ids for frontend validation.
-- ---------------------------------------------------------------------------

create function public.add_project_member(
  p_project_id uuid,
  p_user_id uuid,
  p_role public.project_role
)
returns table (
  project_id uuid,
  workspace_id uuid,
  name text,
  description text,
  project_type public.project_type,
  status public.project_status,
  owner_id uuid,
  owner_display_name text,
  lead_id uuid,
  lead_display_name text,
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_existing public.project_members%rowtype;
  v_changed boolean := false;
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
    and public.can_read_project(p.id)
  for update;

  if not found then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;
  if not public.can_manage_project_members(p_project_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;
  if p_role is null or p_role not in ('member', 'viewer') then
    raise exception 'project_member_role_invalid' using errcode = '22023';
  end if;

  perform public.assert_active_project_candidate(p_project_id, p_user_id);

  select pm.* into v_existing
  from public.project_members as pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id
  for update;

  if found then
    if v_existing.role is distinct from p_role then
      raise exception 'project_member_role_conflict' using errcode = '23505';
    end if;
  else
    insert into public.project_members (project_id, user_id, role)
    values (p_project_id, p_user_id, p_role);
    update public.projects as p set updated_at = p.updated_at where p.id = p_project_id;
    v_changed := true;
  end if;

  return query select s.*, v_changed from public.project_snapshot(p_project_id) as s;
end;
$function$;

create function public.set_project_member_role(
  p_project_id uuid,
  p_user_id uuid,
  p_role public.project_role
)
returns table (
  project_id uuid,
  workspace_id uuid,
  name text,
  description text,
  project_type public.project_type,
  status public.project_status,
  owner_id uuid,
  owner_display_name text,
  lead_id uuid,
  lead_display_name text,
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_target public.project_members%rowtype;
  v_changed boolean := false;
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
    and public.can_read_project(p.id)
  for update;

  if not found then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;
  if not public.can_manage_project_members(p_project_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;
  if p_role is null or p_role not in ('member', 'viewer') then
    raise exception 'project_member_role_invalid' using errcode = '22023';
  end if;

  select pm.* into v_target
  from public.project_members as pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'project_member_not_found' using errcode = 'P0002';
  end if;
  if v_target.role not in ('member', 'viewer') then
    raise exception 'project_member_role_protected' using errcode = '42501';
  end if;

  perform public.assert_active_project_candidate(p_project_id, p_user_id);

  if v_target.role is distinct from p_role then
    update public.project_members as pm
    set role = p_role
    where pm.project_id = p_project_id and pm.user_id = p_user_id;
    update public.projects as p set updated_at = p.updated_at where p.id = p_project_id;
    v_changed := true;
  end if;

  return query select s.*, v_changed from public.project_snapshot(p_project_id) as s;
end;
$function$;

create function public.remove_project_member(
  p_project_id uuid,
  p_user_id uuid
)
returns table (
  project_id uuid,
  workspace_id uuid,
  name text,
  description text,
  project_type public.project_type,
  status public.project_status,
  owner_id uuid,
  owner_display_name text,
  lead_id uuid,
  lead_display_name text,
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_target public.project_members%rowtype;
  v_changed boolean := false;
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
    and public.can_read_project(p.id)
  for update;

  if not found then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;
  if not public.can_manage_project_members(p_project_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;

  select pm.* into v_target
  from public.project_members as pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id
  for update;

  if found then
    if v_target.role not in ('member', 'viewer') then
      raise exception 'project_member_role_protected' using errcode = '42501';
    end if;
    delete from public.project_members as pm
    where pm.project_id = p_project_id and pm.user_id = p_user_id;
    update public.projects as p set updated_at = p.updated_at where p.id = p_project_id;
    v_changed := true;
  end if;

  return query select s.*, v_changed from public.project_snapshot(p_project_id) as s;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Dedicated leadership writes with optimistic concurrency plus row locks.
-- ---------------------------------------------------------------------------

create function public.set_project_lead(
  p_project_id uuid,
  p_user_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  project_id uuid,
  workspace_id uuid,
  name text,
  description text,
  project_type public.project_type,
  status public.project_status,
  owner_id uuid,
  owner_display_name text,
  lead_id uuid,
  lead_display_name text,
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_target public.project_members%rowtype;
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
    and public.can_read_project(p.id)
  for update;

  if not found then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;
  if not public.can_manage_project_leadership(p_project_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;
  if p_user_id = v_project.owner_id then
    raise exception 'project_owner_lead_conflict' using errcode = '22023';
  end if;

  perform public.assert_active_project_candidate(p_project_id, p_user_id);

  if v_project.lead_id = p_user_id then
    return query select s.*, false from public.project_snapshot(p_project_id) as s;
    return;
  end if;
  if p_expected_updated_at is null
     or v_project.updated_at is distinct from p_expected_updated_at
  then
    raise exception 'project_concurrent_update' using errcode = '40001';
  end if;

  if v_project.lead_id is not null then
    update public.project_members as pm
    set role = 'member'
    where pm.project_id = p_project_id and pm.user_id = v_project.lead_id;
  end if;

  select pm.* into v_target
  from public.project_members as pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id
  for update;

  if found then
    if v_target.role = 'owner' then
      raise exception 'project_owner_lead_conflict' using errcode = '22023';
    end if;
    update public.project_members as pm
    set role = 'lead'
    where pm.project_id = p_project_id and pm.user_id = p_user_id;
  else
    insert into public.project_members (project_id, user_id, role)
    values (p_project_id, p_user_id, 'lead');
  end if;

  update public.projects as p set lead_id = p_user_id where p.id = p_project_id;

  return query select s.*, true from public.project_snapshot(p_project_id) as s;
end;
$function$;

create function public.clear_project_lead(
  p_project_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  project_id uuid,
  workspace_id uuid,
  name text,
  description text,
  project_type public.project_type,
  status public.project_status,
  owner_id uuid,
  owner_display_name text,
  lead_id uuid,
  lead_display_name text,
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
    and public.can_read_project(p.id)
  for update;

  if not found then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;
  if not public.can_manage_project_leadership(p_project_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;
  if v_project.lead_id is null then
    return query select s.*, false from public.project_snapshot(p_project_id) as s;
    return;
  end if;
  if p_expected_updated_at is null
     or v_project.updated_at is distinct from p_expected_updated_at
  then
    raise exception 'project_concurrent_update' using errcode = '40001';
  end if;

  update public.project_members as pm
  set role = 'member'
  where pm.project_id = p_project_id and pm.user_id = v_project.lead_id;

  update public.projects as p set lead_id = null where p.id = p_project_id;

  return query select s.*, true from public.project_snapshot(p_project_id) as s;
end;
$function$;

create function public.transfer_project_owner(
  p_project_id uuid,
  p_user_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  project_id uuid,
  workspace_id uuid,
  name text,
  description text,
  project_type public.project_type,
  status public.project_status,
  owner_id uuid,
  owner_display_name text,
  lead_id uuid,
  lead_display_name text,
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_new_was_lead boolean;
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
    and public.can_read_project(p.id)
  for update;

  if not found then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;
  if not public.can_manage_project_leadership(p_project_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;

  perform public.assert_active_project_candidate(p_project_id, p_user_id);

  if v_project.owner_id = p_user_id then
    return query select s.*, false from public.project_snapshot(p_project_id) as s;
    return;
  end if;
  if p_expected_updated_at is null
     or v_project.updated_at is distinct from p_expected_updated_at
  then
    raise exception 'project_concurrent_update' using errcode = '40001';
  end if;

  v_new_was_lead := v_project.lead_id = p_user_id;

  update public.project_members as pm
  set role = 'member'
  where pm.project_id = p_project_id and pm.user_id = v_project.owner_id;

  perform 1
  from public.project_members as pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id
  for update;

  if found then
    update public.project_members as pm
    set role = 'owner'
    where pm.project_id = p_project_id and pm.user_id = p_user_id;
  else
    insert into public.project_members (project_id, user_id, role)
    values (p_project_id, p_user_id, 'owner');
  end if;

  update public.projects as p
  set
    owner_id = p_user_id,
    lead_id = case when v_new_was_lead then null else p.lead_id end
  where p.id = p_project_id;

  return query select s.*, true from public.project_snapshot(p_project_id) as s;
end;
$function$;

revoke all on function public.add_project_member(uuid, uuid, public.project_role)
  from public, anon, authenticated, service_role;
revoke all on function public.set_project_member_role(uuid, uuid, public.project_role)
  from public, anon, authenticated, service_role;
revoke all on function public.remove_project_member(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_project_lead(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.clear_project_lead(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.transfer_project_owner(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.add_project_member(uuid, uuid, public.project_role)
  to authenticated;
grant execute on function public.set_project_member_role(uuid, uuid, public.project_role)
  to authenticated;
grant execute on function public.remove_project_member(uuid, uuid)
  to authenticated;
grant execute on function public.set_project_lead(uuid, uuid, timestamptz)
  to authenticated;
grant execute on function public.clear_project_lead(uuid, timestamptz)
  to authenticated;
grant execute on function public.transfer_project_owner(uuid, uuid, timestamptz)
  to authenticated;

-- Reassert the browser table boundary after all object changes. Browser RPCs
-- execute as postgres and the tables remain unavailable for direct mutation.
revoke all on public.project_members
  from public, anon, authenticated, service_role;
revoke insert, update, delete on public.projects
  from public, anon, authenticated, service_role;
