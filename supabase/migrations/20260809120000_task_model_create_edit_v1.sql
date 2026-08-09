-- Task 3.1 - shared project task model and create/edit V1.
--
-- Tasks are always project-scoped. Browser writes are limited to the reviewed
-- SECURITY DEFINER RPCs below; actor, audit fields, initial status and progress
-- are derived or fixed by the database. Task 3.2-3.5 workflows are deliberately
-- not implemented by this migration.

create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.task_workload_level as enum ('xs', 's', 'm', 'l', 'xl');
create type public.task_visibility as enum ('project', 'restricted');
create type public.task_status as enum (
  'todo',
  'in_progress',
  'blocked',
  'pending_review',
  'completed',
  'cancelled'
);

comment on type public.task_status is
  'Shared task lifecycle vocabulary reserved for Task 3.3-3.5. Task 3.1 creates todo/0 tasks and exposes no status transition API.';

-- A composite candidate key lets the task foreign key prove that module_id and
-- project_id belong to the same project, not merely that each id exists.
create unique index project_modules_id_project_unique
  on public.project_modules (id, project_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  module_id uuid not null,
  title text not null,
  description text,
  acceptance_criteria text,
  assignee_id uuid not null references public.app_users (id) on delete restrict,
  reviewer_id uuid not null references public.app_users (id) on delete restrict,
  priority public.task_priority not null default 'medium',
  start_date date,
  due_date date,
  estimated_hours numeric(8, 2),
  workload_level public.task_workload_level not null default 'm',
  visibility public.task_visibility not null default 'project',
  status public.task_status not null default 'todo',
  progress smallint not null default 0,
  created_by uuid not null references public.app_users (id) on delete restrict,
  updated_by uuid not null references public.app_users (id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_module_project_fkey
    foreign key (module_id, project_id)
    references public.project_modules (id, project_id)
    on delete restrict,
  constraint tasks_title_trimmed_nonblank
    check (
      title = pg_catalog.regexp_replace(title, '^[[:space:]]+|[[:space:]]+$', '', 'g')
      and title <> ''
    ),
  constraint tasks_title_length check (pg_catalog.char_length(title) <= 200),
  constraint tasks_description_length
    check (description is null or pg_catalog.char_length(description) <= 10000),
  constraint tasks_acceptance_criteria_length
    check (acceptance_criteria is null or pg_catalog.char_length(acceptance_criteria) <= 10000),
  constraint tasks_date_order
    check (start_date is null or due_date is null or due_date >= start_date),
  constraint tasks_estimated_hours_range
    check (estimated_hours is null or (estimated_hours >= 0 and estimated_hours <= 10000)),
  constraint tasks_progress_range check (progress between 0 and 100),
  constraint tasks_actor_idempotency
    unique (project_id, created_by, idempotency_key)
);

create index tasks_project_updated_idx
  on public.tasks (project_id, updated_at desc, id);
create index tasks_module_idx on public.tasks (module_id, id);
create index tasks_assignee_idx on public.tasks (assignee_id, project_id, id);
create index tasks_reviewer_idx on public.tasks (reviewer_id, project_id, id);
create index tasks_project_visibility_idx
  on public.tasks (project_id, visibility, id);

comment on table public.tasks is
  'Project-only shared tasks. Private tasks and personal notes require a separate future model.';
comment on column public.tasks.idempotency_key is
  'Create retry key scoped by project and the database-derived actor; excluded from browser projections.';
comment on column public.tasks.status is
  'Task 3.1 always creates todo and cannot edit status; later migrations add reviewed transitions.';
comment on column public.tasks.progress is
  'Task 3.1 always creates 0 and cannot edit progress; Task 3.3/3.4 own progress changes.';

create table public.task_collaborators (
  task_id uuid not null references public.tasks (id) on delete restrict,
  user_id uuid not null references public.app_users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_collaborators_user_task_idx
  on public.task_collaborators (user_id, task_id);

create table public.task_visibility_users (
  task_id uuid not null references public.tasks (id) on delete restrict,
  user_id uuid not null references public.app_users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_visibility_users_user_task_idx
  on public.task_visibility_users (user_id, task_id);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Project owner/lead and workspace owner/admin share the existing reviewed
-- management semantics. The named helper is the single future task-management
-- policy seam and prevents role checks being copied across RPCs.
create function public.can_manage_project_tasks(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.can_manage_project_members(p_project_id);
$function$;

alter function public.can_manage_project_tasks(uuid) owner to postgres;
revoke all on function public.can_manage_project_tasks(uuid)
  from public, anon, authenticated, service_role;

-- Responsibility holders must be current active project members and may not
-- have the read-only viewer role. Explicit visibility users may be viewers but
-- must still be current active project members in the same project/workspace.
create function public.assert_task_candidate(
  p_project_id uuid,
  p_user_id uuid,
  p_responsibility boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_project_id is null or p_user_id is null or p_responsibility is null
     or not exists (
       select 1
       from public.project_members as pm
       join public.projects as p on p.id = pm.project_id
       join public.workspace_members as wm
         on wm.workspace_id = p.workspace_id and wm.user_id = pm.user_id
       join public.app_users as u on u.id = pm.user_id
       where pm.project_id = p_project_id
         and pm.user_id = p_user_id
         and wm.status = 'active'
         and u.status = 'active'
         and (not p_responsibility or pm.role <> 'viewer')
     )
  then
    raise exception 'task_member_invalid' using errcode = '22023';
  end if;
end;
$function$;

alter function public.assert_task_candidate(uuid, uuid, boolean) owner to postgres;
revoke all on function public.assert_task_candidate(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- Direct privileged SQL is still guarded by the same cross-table invariants.
-- Browser clients cannot reach the tables, but database constraints must remain
-- authoritative for future server-side callers too.
create function public.tasks_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'task_delete_not_supported' using errcode = '27000';
  end if;

  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.created_by is distinct from old.created_by
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'task_identity_immutable' using errcode = '27000';
  end if;

  if tg_op = 'UPDATE' and (
    new.status is distinct from old.status
    or new.progress is distinct from old.progress
  ) then
    raise exception 'task_execution_state_controlled' using errcode = '27000';
  end if;

  if new.status <> 'todo' or new.progress <> 0 then
    raise exception 'task_execution_state_controlled' using errcode = '27000';
  end if;

  if not exists (
    select 1
    from public.projects as p
    where p.id = new.project_id and p.status <> 'archived'
  ) then
    raise exception 'task_project_archived_or_invalid' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.project_modules as m
    where m.id = new.module_id
      and m.project_id = new.project_id
      and m.deleted_at is null
  ) then
    raise exception 'task_module_invalid' using errcode = '22023';
  end if;

  perform public.assert_task_candidate(new.project_id, new.assignee_id, true);
  perform public.assert_task_candidate(new.project_id, new.reviewer_id, true);

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.task_collaborators as tc
    where tc.task_id = new.id and tc.user_id = new.assignee_id
  ) then
    raise exception 'task_assignee_collaborator_conflict' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.visibility = 'project' and exists (
    select 1
    from public.task_visibility_users as tvu
    where tvu.task_id = new.id
  ) then
    raise exception 'task_visibility_users_not_allowed' using errcode = '23514';
  end if;

  return new;
end;
$function$;

alter function public.tasks_guard() owner to postgres;
revoke all on function public.tasks_guard()
  from public, anon, authenticated, service_role;

create trigger tasks_guard
  before insert or update or delete on public.tasks
  for each row execute function public.tasks_guard();

-- Extend the existing module guard so even privileged direct SQL cannot soft
-- delete a module referenced by a task. The public deletion RPC repeats this
-- check under the project lock to provide deterministic concurrency behavior.
create or replace function public.project_modules_guard()
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
    if exists (
      select 1 from public.tasks as t
      where t.project_id = old.project_id and t.module_id = old.id
    ) then
      raise exception 'project_module_not_empty' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$function$;

alter function public.project_modules_guard() owner to postgres;
revoke all on function public.project_modules_guard()
  from public, anon, authenticated, service_role;

create function public.task_collaborators_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_assignee_id uuid;
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (
    new.task_id is distinct from old.task_id
    or new.user_id is distinct from old.user_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'task_collaborator_identity_immutable' using errcode = '27000';
  end if;

  select t.project_id, t.assignee_id into v_project_id, v_assignee_id
  from public.tasks as t where t.id = new.task_id;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  if new.user_id = v_assignee_id then
    raise exception 'task_assignee_collaborator_conflict' using errcode = '23514';
  end if;
  perform public.assert_task_candidate(v_project_id, new.user_id, true);
  return new;
end;
$function$;

alter function public.task_collaborators_guard() owner to postgres;
revoke all on function public.task_collaborators_guard()
  from public, anon, authenticated, service_role;
create trigger task_collaborators_guard
  before insert or update or delete on public.task_collaborators
  for each row execute function public.task_collaborators_guard();

create function public.task_visibility_users_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_visibility public.task_visibility;
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (
    new.task_id is distinct from old.task_id
    or new.user_id is distinct from old.user_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'task_visibility_identity_immutable' using errcode = '27000';
  end if;

  select t.project_id, t.visibility into v_project_id, v_visibility
  from public.tasks as t where t.id = new.task_id;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  if v_visibility <> 'restricted' then
    raise exception 'task_visibility_users_not_allowed' using errcode = '23514';
  end if;
  perform public.assert_task_candidate(v_project_id, new.user_id, false);
  return new;
end;
$function$;

alter function public.task_visibility_users_guard() owner to postgres;
revoke all on function public.task_visibility_users_guard()
  from public, anon, authenticated, service_role;
create trigger task_visibility_users_guard
  before insert or update or delete on public.task_visibility_users
  for each row execute function public.task_visibility_users_guard();

-- A single trusted read boundary is shared by all three RLS policies and the
-- safe task projection. Project access is always required first, so explicit
-- visibility can never bridge projects or workspaces.
create function public.can_read_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tasks as t
    where t.id = p_task_id
      and public.can_read_project(t.project_id)
      and (
        t.visibility = 'project'
        or public.can_manage_project_tasks(t.project_id)
        or t.assignee_id = public.current_app_user_id()
        or t.reviewer_id = public.current_app_user_id()
        or t.created_by = public.current_app_user_id()
        or exists (
          select 1 from public.task_collaborators as tc
          where tc.task_id = t.id and tc.user_id = public.current_app_user_id()
        )
        or exists (
          select 1 from public.task_visibility_users as tvu
          where tvu.task_id = t.id and tvu.user_id = public.current_app_user_id()
        )
      )
  );
$function$;

alter function public.can_read_task(uuid) owner to postgres;
revoke all on function public.can_read_task(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_read_task(uuid) to authenticated;

alter table public.tasks enable row level security;
alter table public.task_collaborators enable row level security;
alter table public.task_visibility_users enable row level security;

create policy tasks_select_authorized on public.tasks
  for select to authenticated using (public.can_read_task(id));
create policy task_collaborators_select_authorized on public.task_collaborators
  for select to authenticated using (public.can_read_task(task_id));
create policy task_visibility_users_select_authorized on public.task_visibility_users
  for select to authenticated using (public.can_read_task(task_id));

revoke all on public.tasks from public, anon, authenticated, service_role;
revoke all on public.task_collaborators from public, anon, authenticated, service_role;
revoke all on public.task_visibility_users from public, anon, authenticated, service_role;

grant select (
  id, project_id, module_id, title, description, acceptance_criteria,
  assignee_id, reviewer_id, priority, start_date, due_date, estimated_hours,
  workload_level, visibility, status, progress, created_by, updated_by,
  created_at, updated_at
) on public.tasks to authenticated;
grant select (task_id, user_id, created_at)
  on public.task_collaborators to authenticated;
grant select (task_id, user_id, created_at)
  on public.task_visibility_users to authenticated;

-- Internal safe snapshot. Arrays are deterministic JSON objects so a client
-- receives one complete, scope-checked payload rather than composing bottom
-- tables and re-implementing visibility rules.
create function public.task_snapshot(p_task_id uuid)
returns table (
  task_id uuid,
  project_id uuid,
  workspace_id uuid,
  module_id uuid,
  module_name text,
  title text,
  description text,
  acceptance_criteria text,
  assignee_id uuid,
  assignee_display_name text,
  reviewer_id uuid,
  reviewer_display_name text,
  priority public.task_priority,
  start_date date,
  due_date date,
  estimated_hours numeric,
  workload_level public.task_workload_level,
  visibility public.task_visibility,
  status public.task_status,
  progress smallint,
  collaborators jsonb,
  visibility_users jsonb,
  created_by uuid,
  created_at timestamptz,
  updated_by uuid,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    t.id,
    t.project_id,
    p.workspace_id,
    t.module_id,
    m.name,
    t.title,
    t.description,
    t.acceptance_criteria,
    t.assignee_id,
    coalesce(ap.display_name, '未设置显示名称'),
    t.reviewer_id,
    coalesce(rp.display_name, '未设置显示名称'),
    t.priority,
    t.start_date,
    t.due_date,
    t.estimated_hours,
    t.workload_level,
    t.visibility,
    t.status,
    t.progress,
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'app_user_id', tc.user_id,
          'display_name', coalesce(cp.display_name, '未设置显示名称')
        ) order by coalesce(cp.display_name, '未设置显示名称'), tc.user_id
      )
      from public.task_collaborators as tc
      left join public.profiles as cp on cp.user_id = tc.user_id
      where tc.task_id = t.id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'app_user_id', tvu.user_id,
          'display_name', coalesce(vp.display_name, '未设置显示名称')
        ) order by coalesce(vp.display_name, '未设置显示名称'), tvu.user_id
      )
      from public.task_visibility_users as tvu
      left join public.profiles as vp on vp.user_id = tvu.user_id
      where tvu.task_id = t.id
    ), '[]'::jsonb),
    t.created_by,
    t.created_at,
    t.updated_by,
    t.updated_at
  from public.tasks as t
  join public.projects as p on p.id = t.project_id
  join public.project_modules as m on m.id = t.module_id and m.project_id = t.project_id
  left join public.profiles as ap on ap.user_id = t.assignee_id
  left join public.profiles as rp on rp.user_id = t.reviewer_id
  where t.id = p_task_id;
$function$;

alter function public.task_snapshot(uuid) owner to postgres;
revoke all on function public.task_snapshot(uuid)
  from public, anon, authenticated, service_role;

create function public.get_task(p_task_id uuid)
returns table (
  task_id uuid, project_id uuid, workspace_id uuid, module_id uuid,
  module_name text, title text, description text, acceptance_criteria text,
  assignee_id uuid, assignee_display_name text, reviewer_id uuid,
  reviewer_display_name text, priority public.task_priority, start_date date,
  due_date date, estimated_hours numeric,
  workload_level public.task_workload_level, visibility public.task_visibility,
  status public.task_status, progress smallint, collaborators jsonb,
  visibility_users jsonb, created_by uuid, created_at timestamptz,
  updated_by uuid, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.* from public.task_snapshot(p_task_id) as s
  where public.can_read_task(p_task_id);
$function$;

alter function public.get_task(uuid) owner to postgres;
revoke all on function public.get_task(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_task(uuid) to authenticated;

create function public.list_task_assignment_candidates(p_project_id uuid)
returns table (
  project_id uuid,
  workspace_id uuid,
  app_user_id uuid,
  display_name text,
  project_role public.project_role,
  can_hold_responsibility boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
begin
  select p.* into v_project from public.projects as p
  where p.id = p_project_id;
  if not found
     or not public.can_read_project(p_project_id)
     or not public.can_manage_project_tasks(p_project_id)
  then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  return query
  select
    pm.project_id,
    v_project.workspace_id,
    pm.user_id,
    coalesce(pr.display_name, '未设置显示名称'),
    pm.role,
    pm.role <> 'viewer'
  from public.project_members as pm
  join public.workspace_members as wm
    on wm.workspace_id = v_project.workspace_id and wm.user_id = pm.user_id
  join public.app_users as u on u.id = pm.user_id
  left join public.profiles as pr on pr.user_id = pm.user_id
  where pm.project_id = p_project_id
    and wm.status = 'active'
    and u.status = 'active'
  order by coalesce(pr.display_name, '未设置显示名称'), pm.user_id;
end;
$function$;

alter function public.list_task_assignment_candidates(uuid) owner to postgres;
revoke all on function public.list_task_assignment_candidates(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_task_assignment_candidates(uuid)
  to authenticated;

-- Lock and validate all people after the project row is held. project_members
-- rows are locked after app_users/workspace_members to match Task 2.2.
create function public.lock_task_write_participants(
  p_project_id uuid,
  p_participant_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ids uuid[];
begin
  perform public.lock_membership_participants(p_project_id, p_participant_ids);
  v_ids := array(
    select distinct participant_id
    from unnest(coalesce(p_participant_ids, array[]::uuid[])) as participant_id
    where participant_id is not null
    order by participant_id
  );
  perform 1
  from public.project_members as pm
  where pm.project_id = p_project_id and pm.user_id = any(v_ids)
  order by pm.user_id
  for update;
end;
$function$;

alter function public.lock_task_write_participants(uuid, uuid[]) owner to postgres;
revoke all on function public.lock_task_write_participants(uuid, uuid[])
  from public, anon, authenticated, service_role;

create function public.validate_task_write_input(
  p_project_id uuid,
  p_assignee_id uuid,
  p_collaborator_ids uuid[],
  p_reviewer_id uuid,
  p_visibility public.task_visibility,
  p_visibility_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  if p_collaborator_ids is null or p_visibility_user_ids is null
     or exists (select 1 from unnest(p_collaborator_ids) as id where id is null)
     or exists (select 1 from unnest(p_visibility_user_ids) as id where id is null)
     or pg_catalog.cardinality(p_collaborator_ids) <>
        (select count(distinct id) from unnest(p_collaborator_ids) as id)
     or pg_catalog.cardinality(p_visibility_user_ids) <>
        (select count(distinct id) from unnest(p_visibility_user_ids) as id)
  then
    raise exception 'task_relationship_duplicate' using errcode = '22023';
  end if;
  if p_assignee_id = any(p_collaborator_ids) then
    raise exception 'task_assignee_collaborator_conflict' using errcode = '22023';
  end if;
  if p_visibility = 'project' and pg_catalog.cardinality(p_visibility_user_ids) <> 0 then
    raise exception 'task_visibility_users_not_allowed' using errcode = '22023';
  end if;

  perform public.assert_task_candidate(p_project_id, p_assignee_id, true);
  perform public.assert_task_candidate(p_project_id, p_reviewer_id, true);
  foreach v_user_id in array p_collaborator_ids loop
    perform public.assert_task_candidate(p_project_id, v_user_id, true);
  end loop;
  foreach v_user_id in array p_visibility_user_ids loop
    perform public.assert_task_candidate(p_project_id, v_user_id, false);
  end loop;
end;
$function$;

alter function public.validate_task_write_input(uuid, uuid, uuid[], uuid, public.task_visibility, uuid[]) owner to postgres;
revoke all on function public.validate_task_write_input(uuid, uuid, uuid[], uuid, public.task_visibility, uuid[])
  from public, anon, authenticated, service_role;

create function public.create_task(
  p_project_id uuid,
  p_module_id uuid,
  p_title text,
  p_description text,
  p_acceptance_criteria text,
  p_assignee_id uuid,
  p_collaborator_ids uuid[],
  p_reviewer_id uuid,
  p_priority public.task_priority,
  p_start_date date,
  p_due_date date,
  p_estimated_hours numeric,
  p_workload_level public.task_workload_level,
  p_visibility public.task_visibility,
  p_visibility_user_ids uuid[],
  p_idempotency_key uuid
)
returns table (
  task_id uuid, project_id uuid, workspace_id uuid, module_id uuid,
  module_name text, title text, description text, acceptance_criteria text,
  assignee_id uuid, assignee_display_name text, reviewer_id uuid,
  reviewer_display_name text, priority public.task_priority, start_date date,
  due_date date, estimated_hours numeric,
  workload_level public.task_workload_level, visibility public.task_visibility,
  status public.task_status, progress smallint, collaborators jsonb,
  visibility_users jsonb, created_by uuid, created_at timestamptz,
  updated_by uuid, updated_at timestamptz, was_existing boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_actor_id uuid := public.current_app_user_id();
  v_existing public.tasks%rowtype;
  v_task_id uuid;
  v_title text := pg_catalog.regexp_replace(
    p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );
  v_description text := nullif(pg_catalog.btrim(p_description), '');
  v_acceptance text := nullif(pg_catalog.btrim(p_acceptance_criteria), '');
  v_collaborators uuid[] := coalesce(p_collaborator_ids, array[]::uuid[]);
  v_visibility_users uuid[] := coalesce(p_visibility_user_ids, array[]::uuid[]);
  v_existing_collaborators uuid[];
  v_existing_visibility_users uuid[];
  v_was_existing boolean := false;
begin
  select p.* into v_project from public.projects as p
  where p.id = p_project_id for update;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  perform public.lock_task_write_participants(
    p_project_id,
    array_cat(array[p_assignee_id, p_reviewer_id], array_cat(v_collaborators, v_visibility_users))
  );
  if v_actor_id is null
     or not public.can_read_project(p_project_id)
     or not public.can_manage_project_tasks(p_project_id)
  then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'task_project_archived' using errcode = '55000';
  end if;

  if p_module_id is null or p_idempotency_key is null
     or v_title is null or v_title = '' or pg_catalog.char_length(v_title) > 200
     or (v_description is not null and pg_catalog.char_length(v_description) > 10000)
     or (v_acceptance is not null and pg_catalog.char_length(v_acceptance) > 10000)
     or p_priority is null or p_workload_level is null or p_visibility is null
     or (p_start_date is not null and p_due_date is not null and p_due_date < p_start_date)
     or (p_estimated_hours is not null and (
       p_estimated_hours < 0
       or p_estimated_hours > 10000
       or p_estimated_hours <> pg_catalog.round(p_estimated_hours, 2)
     ))
  then
    raise exception 'task_validation_failed' using errcode = '22023';
  end if;

  perform public.validate_task_write_input(
    p_project_id, p_assignee_id, v_collaborators, p_reviewer_id,
    p_visibility, v_visibility_users
  );

  perform 1 from public.project_modules as m
  where m.id = p_module_id and m.project_id = p_project_id and m.deleted_at is null
  for update;
  if not found then
    raise exception 'task_module_invalid' using errcode = '22023';
  end if;

  select t.* into v_existing from public.tasks as t
  where t.project_id = p_project_id
    and t.created_by = v_actor_id
    and t.idempotency_key = p_idempotency_key;

  if found then
    select coalesce(pg_catalog.array_agg(tc.user_id order by tc.user_id), array[]::uuid[])
      into v_existing_collaborators
    from public.task_collaborators as tc where tc.task_id = v_existing.id;
    select coalesce(pg_catalog.array_agg(tvu.user_id order by tvu.user_id), array[]::uuid[])
      into v_existing_visibility_users
    from public.task_visibility_users as tvu where tvu.task_id = v_existing.id;

    if v_existing.module_id is distinct from p_module_id
       or v_existing.title is distinct from v_title
       or v_existing.description is distinct from v_description
       or v_existing.acceptance_criteria is distinct from v_acceptance
       or v_existing.assignee_id is distinct from p_assignee_id
       or v_existing.reviewer_id is distinct from p_reviewer_id
       or v_existing.priority is distinct from p_priority
       or v_existing.start_date is distinct from p_start_date
       or v_existing.due_date is distinct from p_due_date
       or v_existing.estimated_hours is distinct from p_estimated_hours
       or v_existing.workload_level is distinct from p_workload_level
       or v_existing.visibility is distinct from p_visibility
       or v_existing_collaborators is distinct from (
         select coalesce(pg_catalog.array_agg(id order by id), array[]::uuid[])
         from unnest(v_collaborators) as id
       )
       or v_existing_visibility_users is distinct from (
         select coalesce(pg_catalog.array_agg(id order by id), array[]::uuid[])
         from unnest(v_visibility_users) as id
       )
    then
      raise exception 'task_idempotency_conflict' using errcode = '23505';
    end if;
    v_task_id := v_existing.id;
    v_was_existing := true;
  else
    insert into public.tasks (
      project_id, module_id, title, description, acceptance_criteria,
      assignee_id, reviewer_id, priority, start_date, due_date,
      estimated_hours, workload_level, visibility, created_by, updated_by,
      idempotency_key
    ) values (
      p_project_id, p_module_id, v_title, v_description, v_acceptance,
      p_assignee_id, p_reviewer_id, p_priority, p_start_date, p_due_date,
      p_estimated_hours, p_workload_level, p_visibility, v_actor_id, v_actor_id,
      p_idempotency_key
    ) returning id into v_task_id;

    insert into public.task_collaborators (task_id, user_id)
    select v_task_id, id from unnest(v_collaborators) as id;
    insert into public.task_visibility_users (task_id, user_id)
    select v_task_id, id from unnest(v_visibility_users) as id;
  end if;

  return query select s.*, v_was_existing
  from public.task_snapshot(v_task_id) as s;
end;
$function$;

alter function public.create_task(
  uuid, uuid, text, text, text, uuid, uuid[], uuid, public.task_priority,
  date, date, numeric, public.task_workload_level, public.task_visibility,
  uuid[], uuid
) owner to postgres;
revoke all on function public.create_task(
  uuid, uuid, text, text, text, uuid, uuid[], uuid, public.task_priority,
  date, date, numeric, public.task_workload_level, public.task_visibility,
  uuid[], uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_task(
  uuid, uuid, text, text, text, uuid, uuid[], uuid, public.task_priority,
  date, date, numeric, public.task_workload_level, public.task_visibility,
  uuid[], uuid
) to authenticated;

create function public.update_task(
  p_project_id uuid,
  p_task_id uuid,
  p_module_id uuid,
  p_title text,
  p_description text,
  p_acceptance_criteria text,
  p_assignee_id uuid,
  p_collaborator_ids uuid[],
  p_reviewer_id uuid,
  p_priority public.task_priority,
  p_start_date date,
  p_due_date date,
  p_estimated_hours numeric,
  p_workload_level public.task_workload_level,
  p_visibility public.task_visibility,
  p_visibility_user_ids uuid[],
  p_expected_updated_at timestamptz
)
returns table (
  task_id uuid, project_id uuid, workspace_id uuid, module_id uuid,
  module_name text, title text, description text, acceptance_criteria text,
  assignee_id uuid, assignee_display_name text, reviewer_id uuid,
  reviewer_display_name text, priority public.task_priority, start_date date,
  due_date date, estimated_hours numeric,
  workload_level public.task_workload_level, visibility public.task_visibility,
  status public.task_status, progress smallint, collaborators jsonb,
  visibility_users jsonb, created_by uuid, created_at timestamptz,
  updated_by uuid, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.projects%rowtype;
  v_task public.tasks%rowtype;
  v_actor_id uuid := public.current_app_user_id();
  v_title text := pg_catalog.regexp_replace(
    p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );
  v_description text := nullif(pg_catalog.btrim(p_description), '');
  v_acceptance text := nullif(pg_catalog.btrim(p_acceptance_criteria), '');
  v_collaborators uuid[] := coalesce(p_collaborator_ids, array[]::uuid[]);
  v_visibility_users uuid[] := coalesce(p_visibility_user_ids, array[]::uuid[]);
  v_old_ids uuid[];
begin
  select p.* into v_project from public.projects as p
  where p.id = p_project_id for update;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  select t.* into v_task from public.tasks as t
  where t.id = p_task_id and t.project_id = p_project_id;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  select pg_catalog.array_agg(distinct id order by id) into v_old_ids
  from (
    select v_task.assignee_id as id
    union all select v_task.reviewer_id
    union all select tc.user_id from public.task_collaborators as tc where tc.task_id = p_task_id
    union all select tvu.user_id from public.task_visibility_users as tvu where tvu.task_id = p_task_id
  ) as participants;

  perform public.lock_task_write_participants(
    p_project_id,
    array_cat(
      coalesce(v_old_ids, array[]::uuid[]),
      array_cat(array[p_assignee_id, p_reviewer_id], array_cat(v_collaborators, v_visibility_users))
    )
  );
  if v_actor_id is null
     or not public.can_read_project(p_project_id)
     or not public.can_manage_project_tasks(p_project_id)
  then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'task_project_archived' using errcode = '55000';
  end if;

  if p_module_id is null or p_expected_updated_at is null
     or v_title is null or v_title = '' or pg_catalog.char_length(v_title) > 200
     or (v_description is not null and pg_catalog.char_length(v_description) > 10000)
     or (v_acceptance is not null and pg_catalog.char_length(v_acceptance) > 10000)
     or p_priority is null or p_workload_level is null or p_visibility is null
     or (p_start_date is not null and p_due_date is not null and p_due_date < p_start_date)
     or (p_estimated_hours is not null and (
       p_estimated_hours < 0
       or p_estimated_hours > 10000
       or p_estimated_hours <> pg_catalog.round(p_estimated_hours, 2)
     ))
  then
    raise exception 'task_validation_failed' using errcode = '22023';
  end if;
  perform public.validate_task_write_input(
    p_project_id, p_assignee_id, v_collaborators, p_reviewer_id,
    p_visibility, v_visibility_users
  );

  perform 1 from public.project_modules as m
  where m.id = p_module_id and m.project_id = p_project_id and m.deleted_at is null
  for update;
  if not found then
    raise exception 'task_module_invalid' using errcode = '22023';
  end if;

  select t.* into v_task from public.tasks as t
  where t.id = p_task_id and t.project_id = p_project_id
  for update;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception 'task_concurrent_update' using errcode = '40001';
  end if;

  delete from public.task_collaborators as tc where tc.task_id = p_task_id;
  delete from public.task_visibility_users as tvu where tvu.task_id = p_task_id;
  update public.tasks as task_row set
    module_id = p_module_id,
    title = v_title,
    description = v_description,
    acceptance_criteria = v_acceptance,
    assignee_id = p_assignee_id,
    reviewer_id = p_reviewer_id,
    priority = p_priority,
    start_date = p_start_date,
    due_date = p_due_date,
    estimated_hours = p_estimated_hours,
    workload_level = p_workload_level,
    visibility = p_visibility,
    updated_by = v_actor_id
  where task_row.id = p_task_id;
  insert into public.task_collaborators (task_id, user_id)
  select p_task_id, id from unnest(v_collaborators) as id;
  insert into public.task_visibility_users (task_id, user_id)
  select p_task_id, id from unnest(v_visibility_users) as id;

  return query select s.* from public.task_snapshot(p_task_id) as s;
end;
$function$;

alter function public.update_task(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], uuid,
  public.task_priority, date, date, numeric, public.task_workload_level,
  public.task_visibility, uuid[], timestamptz
) owner to postgres;
revoke all on function public.update_task(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], uuid,
  public.task_priority, date, date, numeric, public.task_workload_level,
  public.task_visibility, uuid[], timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.update_task(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], uuid,
  public.task_priority, date, date, numeric, public.task_workload_level,
  public.task_visibility, uuid[], timestamptz
) to authenticated;

-- Existing lifecycle operations now preserve task-person qualification. These
-- checks run while their target row is already locked; they take no additional
-- row locks and therefore do not invert the project-first task write order.
create or replace function public.project_members_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.project_id is distinct from old.project_id
    or new.user_id is distinct from old.user_id
    or new.joined_at is distinct from old.joined_at
  ) then
    raise exception 'project_member_identity_immutable' using errcode = '27000';
  end if;

  if tg_op = 'UPDATE' and new.role = 'viewer' and old.role <> 'viewer'
     and exists (
       select 1 from public.tasks as t
       where t.project_id = old.project_id
         and (
           t.assignee_id = old.user_id
           or t.reviewer_id = old.user_id
           or exists (
             select 1 from public.task_collaborators as tc
             where tc.task_id = t.id and tc.user_id = old.user_id
           )
         )
     )
  then
    raise exception 'task_responsibility_role_conflict' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' and exists (
    select 1 from public.tasks as t
    join public.projects as p on p.id = t.project_id
    where t.project_id = old.project_id
      and p.status <> 'archived'
      and (
        t.assignee_id = old.user_id
        or t.reviewer_id = old.user_id
        or exists (select 1 from public.task_collaborators as tc where tc.task_id = t.id and tc.user_id = old.user_id)
        or exists (select 1 from public.task_visibility_users as tvu where tvu.task_id = t.id and tvu.user_id = old.user_id)
      )
  ) then
    raise exception 'task_participant_project_membership_conflict' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

alter function public.project_members_guard() owner to postgres;

create or replace function public.guard_project_responsibility_on_workspace_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'active' and new.status <> 'active'
     and exists (
       select 1 from public.projects as p
       where p.workspace_id = old.workspace_id
         and (p.owner_id = old.user_id or p.lead_id = old.user_id)
         and p.status <> 'archived'
     )
  then
    raise exception 'workspace_member_project_responsibility_conflict' using errcode = '55000';
  end if;
  if old.status = 'active' and new.status <> 'active'
     and exists (
       select 1 from public.tasks as t
       join public.projects as p on p.id = t.project_id
       where p.workspace_id = old.workspace_id and p.status <> 'archived'
         and (
           t.assignee_id = old.user_id or t.reviewer_id = old.user_id
           or exists (select 1 from public.task_collaborators as tc where tc.task_id = t.id and tc.user_id = old.user_id)
           or exists (select 1 from public.task_visibility_users as tvu where tvu.task_id = t.id and tvu.user_id = old.user_id)
         )
     )
  then
    raise exception 'task_participant_workspace_membership_conflict' using errcode = '55000';
  end if;
  return new;
end;
$function$;

alter function public.guard_project_responsibility_on_workspace_status() owner to postgres;

create or replace function public.guard_project_responsibility_on_app_user_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'active' and new.status <> 'active'
     and exists (
       select 1 from public.projects as p
       where (p.owner_id = old.id or p.lead_id = old.id)
         and p.status <> 'archived'
     )
  then
    raise exception 'app_user_project_responsibility_conflict' using errcode = '55000';
  end if;
  if old.status = 'active' and new.status <> 'active'
     and exists (
       select 1 from public.tasks as t
       join public.projects as p on p.id = t.project_id
       where p.status <> 'archived'
         and (
           t.assignee_id = old.id or t.reviewer_id = old.id
           or exists (select 1 from public.task_collaborators as tc where tc.task_id = t.id and tc.user_id = old.id)
           or exists (select 1 from public.task_visibility_users as tvu where tvu.task_id = t.id and tvu.user_id = old.id)
         )
     )
  then
    raise exception 'task_participant_app_user_conflict' using errcode = '55000';
  end if;
  return new;
end;
$function$;

alter function public.guard_project_responsibility_on_app_user_status() owner to postgres;

-- Module deletion and task creation both lock projects first. After that lock,
-- checking for any task reference is race-free and preserves historical links.
create or replace function public.delete_project_module(
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
  perform 1 from public.project_modules as m
  where m.project_id = p_project_id and m.id = p_module_id and m.deleted_at is null
  for update;
  if not found then
    raise exception 'project_module_not_found_or_forbidden' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.tasks as t
    where t.project_id = p_project_id and t.module_id = p_module_id
  ) then
    raise exception 'project_module_not_empty' using errcode = '55000';
  end if;

  update public.project_modules as m set
    deleted_at = pg_catalog.clock_timestamp(), deleted_by = v_actor_id,
    updated_by = v_actor_id
  where m.project_id = p_project_id and m.id = p_module_id and m.deleted_at is null;

  select coalesce(pg_catalog.max(m.sort_position), -1) + count(*)::integer + 1
    into v_offset
  from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null;
  perform 1 from public.project_modules as m
  where m.project_id = p_project_id and m.deleted_at is null
  order by m.id for update;
  update public.project_modules as m set
    sort_position = m.sort_position + v_offset, updated_by = v_actor_id
  where m.project_id = p_project_id and m.deleted_at is null;
  with compacted as (
    select m.id, row_number() over (order by m.sort_position, m.id)::integer - 1 as position
    from public.project_modules as m
    where m.project_id = p_project_id and m.deleted_at is null
  )
  update public.project_modules as m set
    sort_position = compacted.position, updated_by = v_actor_id
  from compacted where m.id = compacted.id;
  update public.projects as p set updated_at = p.updated_at where p.id = p_project_id;
  return query select s.* from public.project_module_snapshot(p_project_id) as s;
end;
$function$;

alter function public.delete_project_module(uuid, uuid) owner to postgres;
revoke all on function public.delete_project_module(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_project_module(uuid, uuid) to authenticated;

-- Final least-privilege assertions.
revoke insert, update, delete on public.tasks
  from public, anon, authenticated, service_role;
revoke insert, update, delete on public.task_collaborators
  from public, anon, authenticated, service_role;
revoke insert, update, delete on public.task_visibility_users
  from public, anon, authenticated, service_role;
