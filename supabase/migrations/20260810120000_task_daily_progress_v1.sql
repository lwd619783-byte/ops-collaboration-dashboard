-- Task 3.4 - append-only daily task progress V1.
--
-- A progress intent is committed as one transaction: the permanent update
-- ledger row, tasks.progress/latest-progress metadata, and an optional Task
-- 3.3 block transition. Browser callers never receive direct table DML.

alter table public.tasks
  add column last_progress_at timestamptz,
  add column last_progress_by uuid
    references public.app_users (id) on delete restrict,
  add constraint tasks_last_progress_consistent check (
    (last_progress_at is null and last_progress_by is null)
    or (last_progress_at is not null and last_progress_by is not null)
  );

create index tasks_last_progress_idx
  on public.tasks (last_progress_at desc, id)
  where last_progress_at is not null;
create index tasks_last_progress_by_idx
  on public.tasks (last_progress_by, last_progress_at desc, id)
  where last_progress_by is not null;

create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  update_seq bigint not null,
  record_date date not null,
  completed_content text not null,
  progress smallint not null,
  issues text,
  next_steps text,
  needs_assistance boolean not null default false,
  is_blocked boolean not null,
  block_transition_id uuid
    references public.task_status_history (id) on delete restrict,
  created_by uuid not null references public.app_users (id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  idempotency_key uuid not null,
  constraint task_updates_sequence_positive check (update_seq > 0),
  constraint task_updates_progress_range check (progress between 0 and 100),
  constraint task_updates_completed_content_valid check (
    completed_content <> ''
    and completed_content = pg_catalog.regexp_replace(
      completed_content,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    )
    and pg_catalog.char_length(completed_content) <= 10000
  ),
  constraint task_updates_issues_valid check (
    issues is null
    or (
      issues <> ''
      and issues = pg_catalog.regexp_replace(
        issues,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
      and pg_catalog.char_length(issues) <= 10000
    )
  ),
  constraint task_updates_next_steps_valid check (
    next_steps is null
    or (
      next_steps <> ''
      and next_steps = pg_catalog.regexp_replace(
        next_steps,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
      and pg_catalog.char_length(next_steps) <= 10000
    )
  ),
  constraint task_updates_block_link_consistent check (
    block_transition_id is null or is_blocked
  ),
  constraint task_updates_task_sequence_unique unique (task_id, update_seq),
  constraint task_updates_actor_idempotency_unique
    unique (created_by, idempotency_key),
  constraint task_updates_block_transition_unique unique (block_transition_id)
);

create index task_updates_task_order_idx
  on public.task_updates (task_id, update_seq, id);
create index task_updates_created_by_task_idx
  on public.task_updates (created_by, task_id, id);

comment on table public.task_updates is
  'Append-only Task 3.4 daily progress ledger. Writes occur only through create_task_update().';
comment on column public.task_updates.update_seq is
  'Per-task order allocated while holding the task write lock.';
comment on column public.task_updates.record_date is
  'User-confirmed local-calendar business date; created_at remains the authoritative absolute timestamp.';
comment on column public.task_updates.idempotency_key is
  'Actor-scoped retry key excluded from browser projections.';
comment on column public.task_updates.block_transition_id is
  'Optional exact Task 3.3 block transition atomically triggered by this update.';
comment on column public.tasks.last_progress_at is
  'Authoritative latest daily-progress timestamp, independent from generic updated_at.';
comment on column public.tasks.last_progress_by is
  'Database-derived actor for the latest daily-progress update.';

-- The ledger is immutable. INSERT also requires the exact transaction-local
-- identity established by the revoked mutation RPC. A linked transition must
-- be the same task/actor and the Task 3.3 block action.
create function public.task_updates_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception 'task_update_append_only' using errcode = '27000';
  end if;
  if coalesce(
    pg_catalog.current_setting('app.task_update_id', true),
    ''
  ) <> new.id::text
     or coalesce(
       pg_catalog.current_setting('app.task_update_task_id', true),
       ''
     ) <> new.task_id::text
  then
    raise exception 'task_update_write_controlled' using errcode = '27000';
  end if;
  if new.block_transition_id is not null and not exists (
    select 1
    from public.task_status_history as h
    where h.id = new.block_transition_id
      and h.task_id = new.task_id
      and h.actor_id = new.created_by
      and h.action = 'block'
      and h.to_status = 'blocked'
  ) then
    raise exception 'task_update_block_link_invalid' using errcode = '23514';
  end if;
  return new;
end;
$function$;

alter function public.task_updates_guard() owner to postgres;
revoke all on function public.task_updates_guard()
  from public, anon, authenticated, service_role;

create trigger task_updates_guard
  before insert or update or delete on public.task_updates
  for each row execute function public.task_updates_guard();

-- Extend the Task 3.3 guard without widening metadata editing. Progress and
-- latest-progress fields require the exact internal Task 3.4 context; status
-- and current blocker fields retain their Task 3.3 context.
create or replace function public.tasks_guard()
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

  if tg_op = 'INSERT' and (
    new.status <> 'todo'
    or new.progress <> 0
    or new.blocker_reason is not null
    or new.blocked_at is not null
    or new.blocked_by is not null
    or new.last_progress_at is not null
    or new.last_progress_by is not null
  ) then
    raise exception 'task_execution_state_controlled' using errcode = '27000';
  end if;

  if tg_op = 'UPDATE' and (
    new.progress is distinct from old.progress
    or new.last_progress_at is distinct from old.last_progress_at
    or new.last_progress_by is distinct from old.last_progress_by
  ) and coalesce(
    pg_catalog.current_setting('app.task_progress_task_id', true),
    ''
  ) <> new.id::text
  then
    raise exception 'task_execution_state_controlled' using errcode = '27000';
  end if;

  if tg_op = 'UPDATE' and (
    new.status is distinct from old.status
    or new.blocker_reason is distinct from old.blocker_reason
    or new.blocked_at is distinct from old.blocked_at
    or new.blocked_by is distinct from old.blocked_by
  ) and coalesce(
    pg_catalog.current_setting('app.task_transition_task_id', true),
    ''
  ) <> new.id::text
  then
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

-- The Task 3.3 snapshot remains unchanged for its existing public RPC
-- behavior. This new internal snapshot extends the full detail contract with
-- unambiguous latest-progress metadata.
create function public.task_progress_snapshot(p_task_id uuid)
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
  last_progress_at timestamptz,
  last_progress_by uuid,
  last_progress_by_display_name text,
  blocker_reason text,
  blocked_at timestamptz,
  blocked_by uuid,
  blocked_by_display_name text,
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
    s.task_id,
    s.project_id,
    s.workspace_id,
    s.module_id,
    s.module_name,
    s.title,
    s.description,
    s.acceptance_criteria,
    s.assignee_id,
    s.assignee_display_name,
    s.reviewer_id,
    s.reviewer_display_name,
    s.priority,
    s.start_date,
    s.due_date,
    s.estimated_hours,
    s.workload_level,
    s.visibility,
    s.status,
    s.progress,
    t.last_progress_at,
    t.last_progress_by,
    case
      when t.last_progress_by is null then null
      else coalesce(lp.display_name, '未设置显示名称')
    end,
    s.blocker_reason,
    s.blocked_at,
    s.blocked_by,
    s.blocked_by_display_name,
    s.collaborators,
    s.visibility_users,
    s.created_by,
    s.created_at,
    s.updated_by,
    s.updated_at
  from public.task_status_snapshot(p_task_id) as s
  join public.tasks as t on t.id = s.task_id
  left join public.profiles as lp on lp.user_id = t.last_progress_by;
$function$;

alter function public.task_progress_snapshot(uuid) owner to postgres;
revoke all on function public.task_progress_snapshot(uuid)
  from public, anon, authenticated, service_role;

drop function public.get_task(uuid);

create function public.get_task(p_task_id uuid)
returns table (
  task_id uuid, project_id uuid, workspace_id uuid, module_id uuid,
  module_name text, title text, description text, acceptance_criteria text,
  assignee_id uuid, assignee_display_name text, reviewer_id uuid,
  reviewer_display_name text, priority public.task_priority, start_date date,
  due_date date, estimated_hours numeric,
  workload_level public.task_workload_level, visibility public.task_visibility,
  status public.task_status, progress smallint, last_progress_at timestamptz,
  last_progress_by uuid, last_progress_by_display_name text,
  blocker_reason text, blocked_at timestamptz, blocked_by uuid,
  blocked_by_display_name text, collaborators jsonb, visibility_users jsonb,
  created_by uuid, created_at timestamptz, updated_by uuid,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.* from public.task_progress_snapshot(p_task_id) as s
  where public.can_read_task(p_task_id);
$function$;

alter function public.get_task(uuid) owner to postgres;
revoke all on function public.get_task(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_task(uuid) to authenticated;

create function public.task_update_snapshot(p_task_id uuid)
returns table (
  update_id uuid,
  task_id uuid,
  sequence bigint,
  record_date date,
  completed_content text,
  progress smallint,
  issues text,
  next_steps text,
  needs_assistance boolean,
  is_blocked boolean,
  block_transition_id uuid,
  created_by uuid,
  created_by_display_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    u.id,
    u.task_id,
    u.update_seq,
    u.record_date,
    u.completed_content,
    u.progress,
    u.issues,
    u.next_steps,
    u.needs_assistance,
    u.is_blocked,
    u.block_transition_id,
    u.created_by,
    coalesce(pr.display_name, '未设置显示名称'),
    u.created_at
  from public.task_updates as u
  left join public.profiles as pr on pr.user_id = u.created_by
  where u.task_id = p_task_id
  order by u.update_seq, u.id;
$function$;

alter function public.task_update_snapshot(uuid) owner to postgres;
revoke all on function public.task_update_snapshot(uuid)
  from public, anon, authenticated, service_role;

create function public.list_task_updates(p_task_id uuid)
returns table (
  update_id uuid,
  task_id uuid,
  sequence bigint,
  record_date date,
  completed_content text,
  progress smallint,
  issues text,
  next_steps text,
  needs_assistance boolean,
  is_blocked boolean,
  block_transition_id uuid,
  created_by uuid,
  created_by_display_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_task_id is null or not public.can_read_task(p_task_id) then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  return query
  select s.* from public.task_update_snapshot(p_task_id) as s;
end;
$function$;

alter function public.list_task_updates(uuid) owner to postgres;
revoke all on function public.list_task_updates(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_task_updates(uuid) to authenticated;

create function public.create_task_update(
  p_task_id uuid,
  p_record_date date,
  p_completed_content text,
  p_progress integer,
  p_issues text,
  p_next_steps text,
  p_needs_assistance boolean,
  p_mark_blocked boolean,
  p_blocker_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_project_id uuid;
  v_project public.projects%rowtype;
  v_task public.tasks%rowtype;
  v_participant_ids uuid[];
  v_existing public.task_updates%rowtype;
  v_existing_blocker_reason text;
  v_update public.task_updates%rowtype;
  v_update_id uuid := gen_random_uuid();
  v_update_seq bigint;
  v_completed_content text := case
    when p_completed_content is null then null
    else pg_catalog.regexp_replace(
      p_completed_content,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    )
  end;
  v_issues text := case
    when p_issues is null then null
    else nullif(pg_catalog.regexp_replace(
      p_issues,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ), '')
  end;
  v_next_steps text := case
    when p_next_steps is null then null
    else nullif(pg_catalog.regexp_replace(
      p_next_steps,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ), '')
  end;
  v_blocker_reason text := case
    when p_blocker_reason is null then null
    else nullif(pg_catalog.regexp_replace(
      p_blocker_reason,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ), '')
  end;
  v_transition_result jsonb;
  v_block_transition_id uuid;
  v_now timestamptz;
  v_task_json jsonb;
  v_update_json jsonb;
begin
  if v_actor_id is null
     or p_task_id is null
     or p_idempotency_key is null
  then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  select t.project_id into v_project_id
  from public.tasks as t
  where t.id = p_task_id;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  select p.* into v_project
  from public.projects as p
  where p.id = v_project_id
  for update;
  if not found or not public.can_read_task(p_task_id) then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  select pg_catalog.array_agg(distinct participant_id order by participant_id)
    into v_participant_ids
  from (
    select t.assignee_id as participant_id
    from public.tasks as t where t.id = p_task_id
    union all
    select t.reviewer_id from public.tasks as t where t.id = p_task_id
    union all
    select tc.user_id from public.task_collaborators as tc where tc.task_id = p_task_id
    union all
    select tvu.user_id from public.task_visibility_users as tvu where tvu.task_id = p_task_id
  ) as participants;

  perform public.lock_task_write_participants(
    v_project_id,
    coalesce(v_participant_ids, array[]::uuid[])
  );

  select t.* into v_task
  from public.tasks as t
  where t.id = p_task_id and t.project_id = v_project_id;
  if not found then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  perform 1
  from public.project_modules as m
  where m.id = v_task.module_id
    and m.project_id = v_project_id
    and m.deleted_at is null
  for update;
  if not found then
    raise exception 'task_module_invalid' using errcode = '22023';
  end if;

  select t.* into v_task
  from public.tasks as t
  where t.id = p_task_id and t.project_id = v_project_id
  for update;
  if not found
     or public.current_app_user_id() is distinct from v_actor_id
     or not public.can_read_task(p_task_id)
  then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;
  if v_project.status = 'archived' then
    raise exception 'task_project_archived' using errcode = '55000';
  end if;
  if v_task.assignee_id is distinct from v_actor_id then
    raise exception 'task_update_permission_denied' using errcode = '42501';
  end if;
  perform public.assert_task_candidate(v_project_id, v_actor_id, true);

  select u.* into v_existing
  from public.task_updates as u
  where u.created_by = v_actor_id
    and u.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.block_transition_id is not null then
      select h.reason into v_existing_blocker_reason
      from public.task_status_history as h
      where h.id = v_existing.block_transition_id;
    end if;
    if v_existing.task_id is distinct from p_task_id
       or v_existing.record_date is distinct from p_record_date
       or v_existing.completed_content is distinct from v_completed_content
       or v_existing.progress is distinct from p_progress::smallint
       or v_existing.issues is distinct from v_issues
       or v_existing.next_steps is distinct from v_next_steps
       or v_existing.needs_assistance is distinct from p_needs_assistance
       or (v_existing.block_transition_id is not null) is distinct from p_mark_blocked
       or v_existing_blocker_reason is distinct from v_blocker_reason
    then
      raise exception 'task_update_idempotency_conflict' using errcode = '23505';
    end if;
    select pg_catalog.to_jsonb(s) into v_task_json
    from public.task_progress_snapshot(p_task_id) as s;
    select pg_catalog.to_jsonb(s) into v_update_json
    from public.task_update_snapshot(p_task_id) as s
    where s.update_id = v_existing.id;
    return pg_catalog.jsonb_build_object(
      'task', v_task_json,
      'update', v_update_json,
      'was_existing', true
    );
  end if;

  if p_record_date is null
     or v_completed_content is null
     or v_completed_content = ''
     or pg_catalog.char_length(v_completed_content) > 10000
     or p_progress is null
     or p_progress < 0
     or p_progress > 100
     or (v_issues is not null and pg_catalog.char_length(v_issues) > 10000)
     or (v_next_steps is not null and pg_catalog.char_length(v_next_steps) > 10000)
     or p_needs_assistance is null
     or p_mark_blocked is null
     or (not p_mark_blocked and v_blocker_reason is not null)
  then
    raise exception 'task_update_validation_failed' using errcode = '22023';
  end if;
  if p_mark_blocked and v_blocker_reason is null then
    raise exception 'task_update_block_reason_required' using errcode = '22023';
  end if;
  if p_mark_blocked and pg_catalog.char_length(v_blocker_reason) > 2000 then
    raise exception 'task_update_block_reason_too_long' using errcode = '22023';
  end if;
  if v_task.status not in ('in_progress', 'blocked') then
    raise exception 'task_update_invalid_status' using errcode = '55000';
  end if;
  if p_mark_blocked and v_task.status <> 'in_progress' then
    raise exception 'task_update_block_state_invalid' using errcode = '55000';
  end if;

  if p_mark_blocked then
    begin
      v_transition_result := public.execute_task_transition(
        p_task_id,
        'block'::public.task_status_action,
        v_blocker_reason,
        v_update_id
      );
    exception when unique_violation then
      raise exception 'task_update_idempotency_conflict' using errcode = '23505';
    end;
    begin
      v_block_transition_id := (
        v_transition_result #>> '{transition,transition_id}'
      )::uuid;
    exception when others then
      raise exception 'task_update_concurrent_state_changed' using errcode = '40001';
    end;
    if v_block_transition_id is null then
      raise exception 'task_update_concurrent_state_changed' using errcode = '40001';
    end if;
  end if;

  select coalesce(pg_catalog.max(u.update_seq), 0) + 1
    into v_update_seq
  from public.task_updates as u
  where u.task_id = p_task_id;
  v_now := pg_catalog.clock_timestamp();

  perform pg_catalog.set_config(
    'app.task_progress_task_id',
    p_task_id::text,
    true
  );
  update public.tasks as task_row
  set
    progress = p_progress::smallint,
    last_progress_at = v_now,
    last_progress_by = v_actor_id,
    updated_by = v_actor_id
  where task_row.id = p_task_id;
  perform pg_catalog.set_config('app.task_progress_task_id', '', true);

  perform pg_catalog.set_config('app.task_update_id', v_update_id::text, true);
  perform pg_catalog.set_config(
    'app.task_update_task_id',
    p_task_id::text,
    true
  );
  begin
    insert into public.task_updates (
      id,
      task_id,
      update_seq,
      record_date,
      completed_content,
      progress,
      issues,
      next_steps,
      needs_assistance,
      is_blocked,
      block_transition_id,
      created_by,
      created_at,
      idempotency_key
    ) values (
      v_update_id,
      p_task_id,
      v_update_seq,
      p_record_date,
      v_completed_content,
      p_progress::smallint,
      v_issues,
      v_next_steps,
      p_needs_assistance,
      v_task.status = 'blocked' or p_mark_blocked,
      v_block_transition_id,
      v_actor_id,
      v_now,
      p_idempotency_key
    ) returning * into v_update;
  exception when unique_violation then
    raise exception 'task_update_idempotency_conflict' using errcode = '23505';
  end;
  perform pg_catalog.set_config('app.task_update_id', '', true);
  perform pg_catalog.set_config('app.task_update_task_id', '', true);

  select pg_catalog.to_jsonb(s) into v_task_json
  from public.task_progress_snapshot(p_task_id) as s;
  select pg_catalog.to_jsonb(s) into v_update_json
  from public.task_update_snapshot(p_task_id) as s
  where s.update_id = v_update.id;
  return pg_catalog.jsonb_build_object(
    'task', v_task_json,
    'update', v_update_json,
    'was_existing', false
  );
end;
$function$;

alter function public.create_task_update(
  uuid, date, text, integer, text, text, boolean, boolean, text, uuid
) owner to postgres;
revoke all on function public.create_task_update(
  uuid, date, text, integer, text, text, boolean, boolean, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_task_update(
  uuid, date, text, integer, text, text, boolean, boolean, text, uuid
) to authenticated;

alter table public.task_updates enable row level security;
create policy task_updates_select_authorized
  on public.task_updates
  for select to authenticated
  using (public.can_read_task(task_id));

revoke all on public.task_updates
  from public, anon, authenticated, service_role;
revoke insert, update, delete on public.tasks
  from public, anon, authenticated, service_role;
