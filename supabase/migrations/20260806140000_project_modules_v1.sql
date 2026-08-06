-- Task 2.3 - ordered project modules V1.
--
-- Module reads are project-member scoped. Every browser write goes through a
-- SECURITY DEFINER RPC that locks the project first, locks and re-validates the
-- current actor through the Task 2.2 participant helper, and then applies one
-- complete transaction. Browser roles never receive direct table write access.

-- Remember whether the idempotent create request selected the preset. This is
-- intentionally not part of the browser project projection; it exists so an
-- idempotency-key retry with a different preset choice is rejected instead of
-- returning a project whose initialization differs from the submitted payload.
alter table public.projects
  add column module_preset_initialized boolean not null default false;

comment on column public.projects.module_preset_initialized is
  'Immutable create-time idempotency input. True only when the operations module preset was atomically initialized.';

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
     or new.module_preset_initialized is distinct from old.module_preset_initialized
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

alter function public.projects_guard() owner to postgres;

-- One normalization rule is shared by constraints, uniqueness and RPCs.
-- It trims the ends and collapses every run of whitespace to one ordinary
-- space. Case-insensitive uniqueness is applied separately by the active-name
-- index so users cannot create visually duplicate names through case changes.
create function public.normalize_project_module_name(p_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when p_name is null then null
    else pg_catalog.regexp_replace(
      pg_catalog.btrim(p_name),
      '[[:space:]]+',
      ' ',
      'g'
    )
  end;
$function$;

alter function public.normalize_project_module_name(text) owner to postgres;
revoke all on function public.normalize_project_module_name(text)
  from public, anon, authenticated, service_role;

create table public.project_modules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  name text not null,
  sort_position integer not null,
  created_by uuid not null references public.app_users (id) on delete restrict,
  updated_by uuid not null references public.app_users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.app_users (id) on delete restrict,
  constraint project_modules_name_normalized_nonblank check (
    name = public.normalize_project_module_name(name) and name <> ''
  ),
  constraint project_modules_name_length check (pg_catalog.char_length(name) <= 120),
  constraint project_modules_sort_position_nonnegative check (sort_position >= 0),
  constraint project_modules_delete_consistency check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null)
  )
);

create unique index project_modules_active_position_idx
  on public.project_modules (project_id, sort_position)
  where deleted_at is null;

create unique index project_modules_active_name_idx
  on public.project_modules (
    project_id,
    pg_catalog.lower(public.normalize_project_module_name(name))
  )
  where deleted_at is null;

create index project_modules_project_history_idx
  on public.project_modules (project_id, deleted_at, sort_position, id);

comment on table public.project_modules is
  'Flat, ordered project work modules. Deletion is a controlled soft delete; active rows are uniquely named and continuously ordered by RPCs.';
comment on column public.project_modules.sort_position is
  'Zero-based active display position. Module RPCs normalize each active project sequence to 0..n-1.';
comment on column public.project_modules.deleted_at is
  'Controlled V1 soft-delete timestamp. Deleted modules are immutable and excluded from project reads and sorting.';

create trigger project_modules_set_updated_at
  before update on public.project_modules
  for each row execute function public.set_updated_at();

create function public.project_modules_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'project_module_delete_not_supported' using errcode = '27000';
  end if;

  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'project_module_identity_immutable' using errcode = '27000';
  end if;

  if old.deleted_at is not null then
    raise exception 'project_module_deleted' using errcode = '55000';
  end if;

  if new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by
  then
    if old.deleted_at is not null
       or new.deleted_at is null
       or new.deleted_by is null
    then
      raise exception 'project_module_delete_controlled' using errcode = '27000';
    end if;
  end if;

  return new;
end;
$function$;

alter function public.project_modules_guard() owner to postgres;
revoke all on function public.project_modules_guard()
  from public, anon, authenticated, service_role;

create trigger project_modules_guard
  before update or delete on public.project_modules
  for each row execute function public.project_modules_guard();

-- The only executable source of preset names and order. Frontend code sends a
-- boolean choice and never maintains a second copy of these names.
create function public.operations_project_module_presets()
returns table (module_name text, sort_position integer)
language sql
immutable
security invoker
set search_path = ''
as $function$
  values
    ('准备与计划'::text, 0),
    ('实施与变更'::text, 1),
    ('验证与观察'::text, 2),
    ('收尾与复盘'::text, 3);
$function$;

alter function public.operations_project_module_presets() owner to postgres;
revoke all on function public.operations_project_module_presets()
  from public, anon, authenticated, service_role;

-- Internal projection. Deleted rows and deletion metadata never cross the
-- browser boundary. The module id is a stable tie-breaker even though active
-- positions are unique and normalized.
create function public.project_module_snapshot(p_project_id uuid)
returns table (
  module_id uuid,
  project_id uuid,
  name text,
  sort_position integer,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    m.id,
    m.project_id,
    m.name,
    m.sort_position,
    m.created_by,
    m.updated_by,
    m.created_at,
    m.updated_at
  from public.project_modules as m
  where m.project_id = p_project_id
    and m.deleted_at is null
  order by m.sort_position, m.id;
$function$;

alter function public.project_module_snapshot(uuid) owner to postgres;
revoke all on function public.project_module_snapshot(uuid)
  from public, anon, authenticated, service_role;

-- Shared module-write lock boundary. All module mutations take locks in the
-- following order and keep them until the caller transaction ends:
--   1. projects row;
--   2. actor app_users row (ordered by the Task 2.2 helper);
--   3. actor workspace_members row;
--   4. project_modules rows ordered by id where needed.
-- Permission and archive state are re-evaluated only after these locks exist.
create function public.lock_project_for_module_write(p_project_id uuid)
returns public.projects
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

  if not found then
    raise exception 'project_module_not_found_or_forbidden' using errcode = '42501';
  end if;

  perform public.lock_membership_participants(
    p_project_id,
    array[]::uuid[]
  );

  if not public.can_read_project(p_project_id) then
    raise exception 'project_module_not_found_or_forbidden' using errcode = '42501';
  end if;
  if not public.can_manage_project_members(p_project_id) then
    raise exception 'project_module_permission_denied' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'project_archived' using errcode = '55000';
  end if;

  return v_project;
end;
$function$;

alter function public.lock_project_for_module_write(uuid) owner to postgres;
revoke all on function public.lock_project_for_module_write(uuid)
  from public, anon, authenticated, service_role;

alter table public.project_modules enable row level security;

create policy project_modules_select_active_members on public.project_modules
  for select to authenticated
  using (
    deleted_at is null
    and public.can_read_project(project_id)
  );

revoke all on public.project_modules
  from public, anon, authenticated, service_role;
grant select (
  id, project_id, name, sort_position, created_by, updated_by,
  created_at, updated_at
) on public.project_modules to authenticated;

create function public.list_project_modules(p_project_id uuid)
returns table (
  module_id uuid,
  project_id uuid,
  name text,
  sort_position integer,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_project_id is null or not public.can_read_project(p_project_id) then
    raise exception 'project_module_not_found_or_forbidden' using errcode = '42501';
  end if;

  return query
  select s.* from public.project_module_snapshot(p_project_id) as s;
end;
$function$;

alter function public.list_project_modules(uuid) owner to postgres;
revoke all on function public.list_project_modules(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_modules(uuid) to authenticated;

create function public.add_project_module(
  p_project_id uuid,
  p_name text
)
returns table (
  module_id uuid,
  project_id uuid,
  name text,
  sort_position integer,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_name text := public.normalize_project_module_name(p_name);
  v_next_position integer;
begin
  perform public.lock_project_for_module_write(p_project_id);

  if v_actor_id is null
     or v_name is null
     or v_name = ''
     or pg_catalog.char_length(v_name) > 120
  then
    raise exception 'project_module_validation_failed' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.max(m.sort_position), -1) + 1
    into v_next_position
  from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null;

  begin
    insert into public.project_modules (
      project_id, name, sort_position, created_by, updated_by
    ) values (
      p_project_id, v_name, v_next_position, v_actor_id, v_actor_id
    );
  exception
    when unique_violation then
      raise exception 'project_module_name_conflict' using errcode = '23505';
  end;

  update public.projects as p set updated_at = p.updated_at
  where p.id = p_project_id;

  return query
  select s.* from public.project_module_snapshot(p_project_id) as s;
end;
$function$;

alter function public.add_project_module(uuid, text) owner to postgres;
revoke all on function public.add_project_module(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.add_project_module(uuid, text) to authenticated;

create function public.rename_project_module(
  p_project_id uuid,
  p_module_id uuid,
  p_name text
)
returns table (
  module_id uuid,
  project_id uuid,
  name text,
  sort_position integer,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_name text := public.normalize_project_module_name(p_name);
begin
  perform public.lock_project_for_module_write(p_project_id);

  if v_actor_id is null
     or p_module_id is null
     or v_name is null
     or v_name = ''
     or pg_catalog.char_length(v_name) > 120
  then
    raise exception 'project_module_validation_failed' using errcode = '22023';
  end if;

  perform 1
  from public.project_modules as m
  where m.project_id = p_project_id
    and m.id = p_module_id
    and m.deleted_at is null
  for update;

  if not found then
    raise exception 'project_module_not_found_or_forbidden' using errcode = '42501';
  end if;

  begin
    update public.project_modules as m
    set name = v_name, updated_by = v_actor_id
    where m.project_id = p_project_id
      and m.id = p_module_id
      and m.deleted_at is null;
  exception
    when unique_violation then
      raise exception 'project_module_name_conflict' using errcode = '23505';
  end;

  update public.projects as p set updated_at = p.updated_at
  where p.id = p_project_id;

  return query
  select s.* from public.project_module_snapshot(p_project_id) as s;
end;
$function$;

alter function public.rename_project_module(uuid, uuid, text) owner to postgres;
revoke all on function public.rename_project_module(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rename_project_module(uuid, uuid, text)
  to authenticated;

create function public.reorder_project_modules(
  p_project_id uuid,
  p_module_ids uuid[]
)
returns table (
  module_id uuid,
  project_id uuid,
  name text,
  sort_position integer,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_active_count integer;
  v_distinct_count integer;
  v_offset integer;
begin
  perform public.lock_project_for_module_write(p_project_id);

  if v_actor_id is null or p_module_ids is null then
    raise exception 'project_module_order_invalid' using errcode = '22023';
  end if;

  select count(*)::integer
    into v_active_count
  from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null;

  select count(distinct submitted.module_id)::integer
    into v_distinct_count
  from unnest(p_module_ids) as submitted(module_id);

  if pg_catalog.cardinality(p_module_ids) <> v_active_count
     or v_distinct_count <> pg_catalog.cardinality(p_module_ids)
     or exists (
       select 1
       from unnest(p_module_ids) as submitted(module_id)
       left join public.project_modules as m
         on m.id = submitted.module_id
        and m.project_id = p_project_id
        and m.deleted_at is null
       where submitted.module_id is null or m.id is null
     )
  then
    raise exception 'project_module_order_invalid' using errcode = '22023';
  end if;

  -- Stable module-row lock order avoids a future deadlock if the project-level
  -- serialization boundary is ever shared with additional module consumers.
  perform 1
  from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null
  order by m.id
  for update;

  select coalesce(pg_catalog.max(m.sort_position), -1)
         + v_active_count + 1
    into v_offset
  from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null;

  -- Two phases keep the immediate active-position unique index valid while
  -- arbitrary swaps are normalized to the complete submitted sequence.
  update public.project_modules as m
  set sort_position = m.sort_position + v_offset,
      updated_by = v_actor_id
  where m.project_id = p_project_id and m.deleted_at is null;

  with desired as (
    select submitted.module_id, submitted.ordinality::integer - 1 as position
    from unnest(p_module_ids) with ordinality as submitted(module_id, ordinality)
  )
  update public.project_modules as m
  set sort_position = desired.position,
      updated_by = v_actor_id
  from desired
  where m.id = desired.module_id and m.project_id = p_project_id;

  update public.projects as p set updated_at = p.updated_at
  where p.id = p_project_id;

  return query
  select s.* from public.project_module_snapshot(p_project_id) as s;
end;
$function$;

alter function public.reorder_project_modules(uuid, uuid[]) owner to postgres;
revoke all on function public.reorder_project_modules(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.reorder_project_modules(uuid, uuid[])
  to authenticated;

create function public.delete_project_module(
  p_project_id uuid,
  p_module_id uuid
)
returns table (
  module_id uuid,
  project_id uuid,
  name text,
  sort_position integer,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_offset integer;
begin
  perform public.lock_project_for_module_write(p_project_id);

  if v_actor_id is null or p_module_id is null then
    raise exception 'project_module_validation_failed' using errcode = '22023';
  end if;

  perform 1
  from public.project_modules as m
  where m.project_id = p_project_id
    and m.id = p_module_id
    and m.deleted_at is null
  for update;

  if not found then
    raise exception 'project_module_not_found_or_forbidden' using errcode = '42501';
  end if;

  update public.project_modules as m
  set
    deleted_at = pg_catalog.clock_timestamp(),
    deleted_by = v_actor_id,
    updated_by = v_actor_id
  where m.project_id = p_project_id
    and m.id = p_module_id
    and m.deleted_at is null;

  select coalesce(pg_catalog.max(m.sort_position), -1)
           + count(*)::integer + 1
    into v_offset
  from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null;

  perform 1
  from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null
  order by m.id
  for update;

  update public.project_modules as m
  set sort_position = m.sort_position + v_offset,
      updated_by = v_actor_id
  where m.project_id = p_project_id and m.deleted_at is null;

  with compacted as (
    select
      m.id,
      row_number() over (order by m.sort_position, m.id)::integer - 1 as position
    from public.project_modules as m
    where m.project_id = p_project_id and m.deleted_at is null
  )
  update public.project_modules as m
  set sort_position = compacted.position,
      updated_by = v_actor_id
  from compacted
  where m.id = compacted.id;

  update public.projects as p set updated_at = p.updated_at
  where p.id = p_project_id;

  return query
  select s.* from public.project_module_snapshot(p_project_id) as s;
end;
$function$;

alter function public.delete_project_module(uuid, uuid) owner to postgres;
revoke all on function public.delete_project_module(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_project_module(uuid, uuid)
  to authenticated;

-- Internal project-creation authorization boundary. The browser never calls
-- this helper directly. It resolves the actor from the verified identity,
-- takes locks in a single documented order, and only then re-evaluates the
-- existing workspace-project authority rule:
--   1. target workspaces row;
--   2. current actor app_users row;
--   3. current actor workspace_members row in the target workspace.
--
-- Workspace role/status mutations lock the target workspace_members row and
-- do not subsequently request the workspace or app-user rows. App-user status
-- writes lock the app_users row and do not request the workspace row. This
-- helper can therefore wait behind either revocation path without introducing
-- a reverse lock order. Once acquired, its locks remain held through the
-- create transaction, so a later revocation waits rather than racing the
-- project, owner relation, or preset inserts.
create function public.lock_workspace_project_creator(p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
begin
  if p_workspace_id is null or v_actor_id is null then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;

  -- Missing and unauthorized workspaces deliberately share the same browser
  -- error. No idempotency lookup or business write happens before this lock.
  perform 1
  from public.workspaces as w
  where w.id = p_workspace_id
  for update;

  if not found then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;

  perform 1
  from public.app_users as u
  where u.id = v_actor_id
  for update;

  if not found then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;

  perform 1
  from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = v_actor_id
  for update;

  if not found
     or public.current_app_user_id() is distinct from v_actor_id
     or not public.can_manage_workspace_projects(p_workspace_id)
  then
    raise exception 'project_permission_denied' using errcode = '42501';
  end if;

  return v_actor_id;
end;
$function$;

alter function public.lock_workspace_project_creator(uuid) owner to postgres;
revoke all on function public.lock_workspace_project_creator(uuid)
  from public, anon, authenticated, service_role;

-- Add the preset-aware overload without defaults. The original eight-argument
-- signature remains as a wrapper, so existing named or positional calls stay
-- unambiguous and preserve the old no-preset behavior.
create function public.create_project(
  p_workspace_id uuid,
  p_name text,
  p_description text,
  p_project_type public.project_type,
  p_initial_status public.project_status,
  p_start_date date,
  p_due_date date,
  p_idempotency_key uuid,
  p_initialize_modules boolean
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
  v_actor_id uuid;
  v_existing public.projects%rowtype;
  v_project_id uuid;
  v_name text := pg_catalog.btrim(p_name);
  v_description text := nullif(pg_catalog.btrim(p_description), '');
  v_was_existing boolean := false;
begin
  v_actor_id := public.lock_workspace_project_creator(p_workspace_id);

  if p_workspace_id is null
     or p_idempotency_key is null
     or p_initialize_modules is null
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
       or v_existing.module_preset_initialized is distinct from p_initialize_modules
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
      idempotency_key,
      module_preset_initialized
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
      p_idempotency_key,
      p_initialize_modules
    ) returning id into v_project_id;

    insert into public.project_members (project_id, user_id, role)
    values (v_project_id, v_actor_id, 'owner');

    if p_initialize_modules then
      insert into public.project_modules (
        project_id, name, sort_position, created_by, updated_by
      )
      select
        v_project_id,
        preset.module_name,
        preset.sort_position,
        v_actor_id,
        v_actor_id
      from public.operations_project_module_presets() as preset
      order by preset.sort_position;
    end if;
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
       and v_existing.module_preset_initialized is not distinct from p_initialize_modules
    then
      return query
      select s.*, true
      from public.project_snapshot(v_existing.id) as s;
      return;
    end if;
    raise exception 'project_idempotency_conflict' using errcode = '23505';
end;
$function$;

alter function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid, boolean
) owner to postgres;
revoke all on function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid, boolean
) to authenticated;

create or replace function public.create_project(
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
language sql
security definer
set search_path = ''
as $function$
  select created.*
  from public.create_project(
    p_workspace_id,
    p_name,
    p_description,
    p_project_type,
    p_initial_status,
    p_start_date,
    p_due_date,
    p_idempotency_key,
    false
  ) as created;
$function$;

alter function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid
) owner to postgres;
revoke all on function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_project(
  uuid, text, text, public.project_type, public.project_status, date, date, uuid
) to authenticated;

-- Final defense-in-depth assertion of the table boundary after every object is
-- created. Task 3.1 must add tasks.module_id ON DELETE RESTRICT and extend the
-- delete RPC with a stable project_module_not_empty rejection before marking a
-- module deleted; this migration intentionally does not create a tasks table.
revoke insert, update, delete on public.project_modules
  from public, anon, authenticated, service_role;
