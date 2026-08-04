-- Task 2.1 - project CRUD, visibility and the minimal project membership base.
--
-- Browser clients may read projects only through RLS and the safe projection
-- RPCs below. Creation, editing and archival are transaction-bound RPCs. The
-- minimal project_members table is deliberately not writable from browsers;
-- Task 2.2 will replace that boundary with its reviewed member workflow.

create type public.project_type as enum ('operations');

create type public.project_status as enum (
  'planning',
  'active',
  'paused',
  'completed',
  'archived'
);

create type public.project_role as enum (
  'owner',
  'lead',
  'member',
  'viewer'
);

comment on type public.project_type is
  'Stable cross-client project type. Task 2.1 exposes operations only.';
comment on type public.project_status is
  'Project lifecycle: planning -> active <-> paused, active -> completed -> archived.';
comment on type public.project_role is
  'Project-local role vocabulary reserved for Task 2.2. Task 2.1 initializes owner only.';

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  name text not null,
  description text,
  project_type public.project_type not null default 'operations',
  status public.project_status not null default 'planning',
  owner_id uuid not null references public.app_users (id) on delete restrict,
  lead_id uuid references public.app_users (id) on delete restrict,
  start_date date,
  due_date date,
  created_by uuid not null references public.app_users (id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint projects_name_trimmed_nonblank
    check (name = btrim(name) and name <> ''),
  constraint projects_name_length check (char_length(name) <= 120),
  constraint projects_description_length
    check (description is null or char_length(description) <= 2000),
  constraint projects_date_order
    check (start_date is null or due_date is null or due_date >= start_date),
  constraint projects_archive_consistency check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  ),
  constraint projects_actor_idempotency
    unique (workspace_id, created_by, idempotency_key)
);

create index projects_workspace_archive_updated_idx
  on public.projects (workspace_id, archived_at, updated_at desc, id);
create index projects_workspace_status_updated_idx
  on public.projects (workspace_id, status, updated_at desc, id);

comment on table public.projects is
  'Workspace-scoped projects. Physical deletion and unarchiving are not supported.';
comment on column public.projects.idempotency_key is
  'Creation retry key scoped by workspace_id and the database-derived created_by user.';
comment on column public.projects.archived_at is
  'Database-controlled archival timestamp; non-null exactly when status is archived.';

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete restrict,
  user_id uuid not null references public.app_users (id) on delete restrict,
  role public.project_role not null,
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_project_idx
  on public.project_members (user_id, project_id);

comment on table public.project_members is
  'Minimal Task 2.1 visibility relationship. Only create_project initializes the creator owner.';

-- ---------------------------------------------------------------------------
-- Structural guards and cross-table invariants.
-- ---------------------------------------------------------------------------

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create function public.projects_guard()
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
     or new.owner_id is distinct from old.owner_id
     or new.lead_id is distinct from old.lead_id
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

create function public.project_members_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'project_member_delete_not_supported' using errcode = '27000';
  end if;

  if new.project_id is distinct from old.project_id
     or new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.joined_at is distinct from old.joined_at
  then
    raise exception 'project_member_update_not_supported' using errcode = '27000';
  end if;

  return new;
end;
$function$;

create trigger project_members_guard
  before update or delete on public.project_members
  for each row execute function public.project_members_guard();

-- Project actors must remain valid app users with active workspace membership.
-- The owner/creator rule is enforced even for privileged direct SQL, not only
-- by the public RPC.
create function public.assert_project_workspace_users_valid()
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
  ) or not exists (
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

create constraint trigger projects_workspace_users_valid
  after insert or update on public.projects
  for each row execute function public.assert_project_workspace_users_valid();

create function public.assert_project_member_workspace_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.projects as p
    join public.workspace_members as m
      on m.workspace_id = p.workspace_id and m.user_id = new.user_id
    join public.app_users as u on u.id = new.user_id
    where p.id = new.project_id
      and m.status = 'active'
      and u.status = 'active'
  ) then
    raise exception 'project_member_workspace_invalid' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create constraint trigger project_members_workspace_valid
  after insert on public.project_members
  for each row execute function public.assert_project_member_workspace_valid();

-- Deferral permits create_project() to insert the project and its owner
-- relationship in one transaction while still enforcing the invariant at
-- commit for privileged SQL paths.
create function public.assert_project_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
begin
  if tg_table_name = 'projects' then
    v_project_id := coalesce(new.id, old.id);
  else
    v_project_id := coalesce(new.project_id, old.project_id);
  end if;

  if exists (
    select 1
    from public.projects as p
    where p.id = v_project_id
      and not exists (
        select 1
        from public.project_members as pm
        where pm.project_id = p.id
          and pm.user_id = p.owner_id
          and pm.role = 'owner'
      )
  ) then
    raise exception 'project_owner_membership_required' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
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

revoke all on function public.projects_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.project_members_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.assert_project_workspace_users_valid()
  from public, anon, authenticated, service_role;
revoke all on function public.assert_project_member_workspace_valid()
  from public, anon, authenticated, service_role;
revoke all on function public.assert_project_owner_membership()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authorization helpers and RLS.
-- ---------------------------------------------------------------------------

create function public.can_manage_workspace_projects(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select m.role in ('owner', 'admin')
      from public.workspace_members as m
      join public.app_users as u on u.id = m.user_id
      where m.workspace_id = p_workspace_id
        and m.user_id = public.current_app_user_id()
        and m.status = 'active'
        and u.status = 'active'
    ),
    false
  );
$function$;

create function public.can_read_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.projects as p
    join public.workspace_members as wm
      on wm.workspace_id = p.workspace_id
    join public.app_users as u on u.id = wm.user_id
    where p.id = p_project_id
      and wm.user_id = public.current_app_user_id()
      and wm.status = 'active'
      and u.status = 'active'
      and (
        wm.role in ('owner', 'admin')
        or exists (
          select 1
          from public.project_members as pm
          where pm.project_id = p.id
            and pm.user_id = wm.user_id
        )
      )
  );
$function$;

revoke all on function public.can_manage_workspace_projects(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_read_project(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_read_project(uuid) to authenticated;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy projects_select_authorized on public.projects
  for select to authenticated
  using (public.can_read_project(id));

revoke all on public.projects
  from public, anon, authenticated, service_role;
revoke all on public.project_members
  from public, anon, authenticated, service_role;
grant select on public.projects to authenticated;

-- ---------------------------------------------------------------------------
-- Internal safe projection. It is intentionally not executable by API roles.
-- ---------------------------------------------------------------------------

create function public.project_snapshot(p_project_id uuid)
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
  archived_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.id,
    p.workspace_id,
    p.name,
    p.description,
    p.project_type,
    p.status,
    p.owner_id,
    coalesce(op.display_name, '未设置显示名称'),
    p.lead_id,
    case
      when p.lead_id is null then null
      else coalesce(lp.display_name, '未设置显示名称')
    end,
    p.start_date,
    p.due_date,
    p.created_by,
    p.created_at,
    p.updated_at,
    p.archived_at
  from public.projects as p
  left join public.profiles as op on op.user_id = p.owner_id
  left join public.profiles as lp on lp.user_id = p.lead_id
  where p.id = p_project_id;
$function$;

revoke all on function public.project_snapshot(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Safe reads. get_project deliberately returns zero rows for both a missing
-- UUID and a UUID the caller cannot access, preventing existence disclosure.
-- ---------------------------------------------------------------------------

create function public.list_projects(
  p_workspace_id uuid,
  p_archived_only boolean default false,
  p_status public.project_status default null,
  p_search text default null
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
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := nullif(pg_catalog.btrim(p_search), '');
begin
  if p_workspace_id is null or not public.is_active_workspace_member(p_workspace_id) then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;
  if p_archived_only is null
     or (v_search is not null and pg_catalog.char_length(v_search) > 120)
  then
    raise exception 'project_validation_failed' using errcode = '22023';
  end if;

  return query
  select
    p.id,
    p.workspace_id,
    p.name,
    p.description,
    p.project_type,
    p.status,
    p.owner_id,
    coalesce(op.display_name, '未设置显示名称'),
    p.lead_id,
    case
      when p.lead_id is null then null
      else coalesce(lp.display_name, '未设置显示名称')
    end,
    p.start_date,
    p.due_date,
    p.created_by,
    p.created_at,
    p.updated_at,
    p.archived_at
  from public.projects as p
  left join public.profiles as op on op.user_id = p.owner_id
  left join public.profiles as lp on lp.user_id = p.lead_id
  where p.workspace_id = p_workspace_id
    and public.can_read_project(p.id)
    and (
      (p_archived_only and p.status = 'archived')
      or (not p_archived_only and p.status <> 'archived')
    )
    and (p_status is null or p.status = p_status)
    and (
      v_search is null
      or pg_catalog.strpos(
        pg_catalog.lower(p.name || ' ' || coalesce(p.description, '')),
        pg_catalog.lower(v_search)
      ) > 0
    )
  order by p.updated_at desc, p.id;
end;
$function$;

create function public.get_project(p_project_id uuid)
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
  archived_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.*
  from public.project_snapshot(p_project_id) as s
  where public.can_read_project(p_project_id);
$function$;

revoke all on function public.list_projects(uuid, boolean, public.project_status, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_project(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_projects(uuid, boolean, public.project_status, text)
  to authenticated;
grant execute on function public.get_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic project creation. Browser input cannot select any actor, owner,
-- member, workspace relationship timestamp or archival timestamp.
-- ---------------------------------------------------------------------------

create function public.create_project(
  p_workspace_id uuid,
  p_name text,
  p_description text,
  p_project_type public.project_type,
  p_initial_status public.project_status,
  p_start_date date,
  p_due_date date,
  p_idempotency_key uuid
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
  was_existing boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_existing public.projects%rowtype;
  v_project_id uuid;
  v_name text := pg_catalog.btrim(p_name);
  v_description text := nullif(pg_catalog.btrim(p_description), '');
  v_was_existing boolean := false;
begin
  if v_actor_id is null
     or not public.can_manage_workspace_projects(p_workspace_id)
  then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_idempotency_key is null
     or v_name is null
     or v_name = ''
     or pg_catalog.char_length(v_name) > 120
     or (v_description is not null and pg_catalog.char_length(v_description) > 2000)
     or p_project_type is null
     or p_project_type <> 'operations'
     or p_initial_status is null
     or p_initial_status not in ('planning', 'active')
     or (p_start_date is not null and p_due_date is not null and p_due_date < p_start_date)
  then
    raise exception 'project_validation_failed' using errcode = '22023';
  end if;

  perform 1
  from public.workspaces as w
  where w.id = p_workspace_id
  for update;

  select p.* into v_existing
  from public.projects as p
  where p.workspace_id = p_workspace_id
    and p.created_by = v_actor_id
    and p.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.name is distinct from v_name
       or v_existing.description is distinct from v_description
       or v_existing.project_type is distinct from p_project_type
       or v_existing.status is distinct from p_initial_status
       or v_existing.start_date is distinct from p_start_date
       or v_existing.due_date is distinct from p_due_date
    then
      raise exception 'project_idempotency_conflict' using errcode = '23505';
    end if;
    v_project_id := v_existing.id;
    v_was_existing := true;
  else
    insert into public.projects (
      workspace_id,
      name,
      description,
      project_type,
      status,
      owner_id,
      lead_id,
      start_date,
      due_date,
      created_by,
      idempotency_key
    ) values (
      p_workspace_id,
      v_name,
      v_description,
      p_project_type,
      p_initial_status,
      v_actor_id,
      null,
      p_start_date,
      p_due_date,
      v_actor_id,
      p_idempotency_key
    ) returning id into v_project_id;

    insert into public.project_members (project_id, user_id, role)
    values (v_project_id, v_actor_id, 'owner');
  end if;

  return query
  select s.*, v_was_existing
  from public.project_snapshot(v_project_id) as s;
exception
  when unique_violation then
    select p.* into v_existing
    from public.projects as p
    where p.workspace_id = p_workspace_id
      and p.created_by = v_actor_id
      and p.idempotency_key = p_idempotency_key;
    if found
       and v_existing.name is not distinct from v_name
       and v_existing.description is not distinct from v_description
       and v_existing.project_type is not distinct from p_project_type
       and v_existing.status is not distinct from p_initial_status
       and v_existing.start_date is not distinct from p_start_date
       and v_existing.due_date is not distinct from p_due_date
    then
      return query
      select s.*, true
      from public.project_snapshot(v_existing.id) as s;
      return;
    end if;
    raise exception 'project_idempotency_conflict' using errcode = '23505';
end;
$function$;

revoke all on function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Optimistic project edit. Immutable business fields are absent from the
-- signature. Ordinary editing can never archive or restore a project.
-- ---------------------------------------------------------------------------

create function public.update_project(
  p_project_id uuid,
  p_name text,
  p_description text,
  p_status public.project_status,
  p_start_date date,
  p_due_date date,
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
  archived_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_name text := pg_catalog.btrim(p_name);
  v_description text := nullif(pg_catalog.btrim(p_description), '');
begin
  select p.* into v_project
  from public.projects as p
  where p.id = p_project_id
  for update;

  if not found
     or not public.can_manage_workspace_projects(v_project.workspace_id)
  then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;
  if p_expected_updated_at is null
     or v_project.updated_at is distinct from p_expected_updated_at
  then
    raise exception 'project_concurrent_update' using errcode = '40001';
  end if;
  if v_name is null
     or v_name = ''
     or pg_catalog.char_length(v_name) > 120
     or (v_description is not null and pg_catalog.char_length(v_description) > 2000)
     or p_status is null
     or p_status = 'archived'
     or (p_start_date is not null and p_due_date is not null and p_due_date < p_start_date)
  then
    raise exception 'project_validation_failed' using errcode = '22023';
  end if;

  update public.projects as p
  set
    name = v_name,
    description = v_description,
    status = p_status,
    start_date = p_start_date,
    due_date = p_due_date
  where p.id = p_project_id;

  return query
  select s.* from public.project_snapshot(p_project_id) as s;
end;
$function$;

revoke all on function public.update_project(
  uuid, text, text, public.project_status, date, date, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.update_project(
  uuid, text, text, public.project_status, date, date, timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- Explicit, idempotent archival. It is the only browser-accessible path from
-- completed to archived and atomically writes status plus archived_at.
-- ---------------------------------------------------------------------------

create function public.archive_project(
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
  archived_at timestamptz
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
  for update;

  if not found
     or not public.can_manage_workspace_projects(v_project.workspace_id)
  then
    raise exception 'project_not_found_or_forbidden' using errcode = '42501';
  end if;

  if v_project.status = 'archived' then
    return query
    select s.* from public.project_snapshot(p_project_id) as s;
    return;
  end if;
  if p_expected_updated_at is null
     or v_project.updated_at is distinct from p_expected_updated_at
  then
    raise exception 'project_concurrent_update' using errcode = '40001';
  end if;
  if v_project.status <> 'completed' then
    raise exception 'project_archive_requires_completed' using errcode = '55000';
  end if;

  update public.projects as p
  set
    status = 'archived',
    archived_at = pg_catalog.clock_timestamp()
  where p.id = p_project_id;

  return query
  select s.* from public.project_snapshot(p_project_id) as s;
end;
$function$;

revoke all on function public.archive_project(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.archive_project(uuid, timestamptz)
  to authenticated;
