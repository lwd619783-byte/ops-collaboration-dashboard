-- Task 3.3 - controlled task status transitions and blocking V1.
--
-- Public callers receive semantic actions only. The target status, actor,
-- ordering, blocker audit fields and history rows are derived under the
-- existing project-first task lock order.

create type public.task_status_action as enum (
  'start',
  'block',
  'resume',
  'cancel'
);

alter table public.tasks
  add column blocker_reason text,
  add column blocked_at timestamptz,
  add column blocked_by uuid references public.app_users (id) on delete restrict;

alter table public.tasks
  add constraint tasks_blocker_reason_valid check (
    blocker_reason is null
    or (
      blocker_reason <> ''
      and blocker_reason = pg_catalog.regexp_replace(
        blocker_reason,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
      and pg_catalog.char_length(blocker_reason) <= 2000
    )
  ),
  add constraint tasks_blocker_state_consistent check (
    (
      status = 'blocked'
      and blocker_reason is not null
      and blocked_at is not null
      and blocked_by is not null
    )
    or (
      status <> 'blocked'
      and blocker_reason is null
      and blocked_at is null
      and blocked_by is null
    )
  );

create index tasks_blocked_by_idx
  on public.tasks (blocked_by, project_id, id)
  where blocked_by is not null;

create table public.task_status_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  from_status public.task_status not null,
  to_status public.task_status not null,
  action public.task_status_action not null,
  reason text,
  actor_id uuid not null references public.app_users (id) on delete restrict,
  idempotency_key uuid not null,
  transition_seq bigint not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint task_status_history_sequence_positive check (transition_seq > 0),
  constraint task_status_history_reason_valid check (
    reason is null
    or (
      reason <> ''
      and reason = pg_catalog.regexp_replace(
        reason,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
      and pg_catalog.char_length(reason) <= 2000
    )
  ),
  constraint task_status_history_transition_valid check (
    (
      action = 'start'
      and from_status = 'todo'
      and to_status = 'in_progress'
      and reason is null
    )
    or (
      action = 'block'
      and from_status = 'in_progress'
      and to_status = 'blocked'
      and reason is not null
    )
    or (
      action = 'resume'
      and from_status = 'blocked'
      and to_status = 'in_progress'
      and reason is null
    )
    or (
      action = 'cancel'
      and from_status in ('todo', 'in_progress', 'blocked')
      and to_status = 'cancelled'
      and reason is null
    )
  ),
  constraint task_status_history_task_sequence_unique
    unique (task_id, transition_seq),
  constraint task_status_history_actor_idempotency_unique
    unique (actor_id, idempotency_key)
);

create index task_status_history_task_order_idx
  on public.task_status_history (task_id, transition_seq, id);
create index task_status_history_actor_task_idx
  on public.task_status_history (actor_id, task_id, id);

comment on table public.task_status_history is
  'Append-only Task 3.3 transition ledger. Browser reads use the safe history RPC; writes only occur inside controlled transition RPCs.';
comment on column public.task_status_history.idempotency_key is
  'Actor-scoped retry key. It is never returned by browser projections.';
comment on column public.task_status_history.transition_seq is
  'Per-task order allocated while holding the task write lock.';
comment on column public.tasks.status is
  'Task 3.3 exposes only start, block, resume and cancel semantic transitions. Review and completion remain reserved.';
comment on column public.tasks.progress is
  'Task 3.3 does not modify progress. Progress remains reserved for Task 3.4.';

-- The table is immutable even for privileged application SQL. INSERT is also
-- guarded by a transaction-local transition identity set only by the revoked
-- internal helper. API roles have no table DML, including service_role.
create function public.task_status_history_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception 'task_status_history_append_only' using errcode = '27000';
  end if;
  if coalesce(
    pg_catalog.current_setting('app.task_transition_history_id', true),
    ''
  ) <> new.id::text
     or coalesce(
       pg_catalog.current_setting('app.task_transition_task_id', true),
       ''
     ) <> new.task_id::text
  then
    raise exception 'task_status_history_write_controlled' using errcode = '27000';
  end if;
  return new;
end;
$function$;

alter function public.task_status_history_guard() owner to postgres;
revoke all on function public.task_status_history_guard()
  from public, anon, authenticated, service_role;

create trigger task_status_history_guard
  before insert or update or delete on public.task_status_history
  for each row execute function public.task_status_history_guard();

-- Task metadata remains editable through update_task(), but status and current
-- blocker fields can change only while the internal transition helper has set
-- the exact task identity. Progress remains controlled and unchanged.
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
  ) then
    raise exception 'task_execution_state_controlled' using errcode = '27000';
  end if;

  if tg_op = 'UPDATE' and new.progress is distinct from old.progress then
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

-- Extend the full detail projection without widening the Task 3.2 summary.
create function public.task_status_snapshot(p_task_id uuid)
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
    t.blocker_reason,
    t.blocked_at,
    t.blocked_by,
    case
      when t.blocked_by is null then null
      else coalesce(bp.display_name, '未设置显示名称')
    end,
    s.collaborators,
    s.visibility_users,
    s.created_by,
    s.created_at,
    s.updated_by,
    s.updated_at
  from public.task_snapshot(p_task_id) as s
  join public.tasks as t on t.id = s.task_id
  left join public.profiles as bp on bp.user_id = t.blocked_by;
$function$;

alter function public.task_status_snapshot(uuid) owner to postgres;
revoke all on function public.task_status_snapshot(uuid)
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
  status public.task_status, progress smallint, blocker_reason text,
  blocked_at timestamptz, blocked_by uuid, blocked_by_display_name text,
  collaborators jsonb, visibility_users jsonb, created_by uuid,
  created_at timestamptz, updated_by uuid, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.* from public.task_status_snapshot(p_task_id) as s
  where public.can_read_task(p_task_id);
$function$;

alter function public.get_task(uuid) owner to postgres;
revoke all on function public.get_task(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_task(uuid) to authenticated;

create function public.execute_task_transition(
  p_task_id uuid,
  p_action public.task_status_action,
  p_reason text,
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
  v_existing public.task_status_history%rowtype;
  v_transition public.task_status_history%rowtype;
  v_reason text := case
    when p_reason is null then null
    else pg_catalog.regexp_replace(
      p_reason,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    )
  end;
  v_to_status public.task_status;
  v_transition_seq bigint;
  v_transition_id uuid := gen_random_uuid();
  v_now timestamptz;
  v_task_json jsonb;
begin
  if v_actor_id is null
     or p_task_id is null
     or p_action is null
     or p_idempotency_key is null
  then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  -- project_id is immutable, so a non-locking lookup may establish the first
  -- row lock without creating a task-first lock inversion.
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

  select h.* into v_existing
  from public.task_status_history as h
  where h.actor_id = v_actor_id
    and h.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.task_id is distinct from p_task_id
       or v_existing.action is distinct from p_action
       or v_existing.reason is distinct from v_reason
    then
      raise exception 'task_transition_idempotency_conflict' using errcode = '23505';
    end if;
    select pg_catalog.to_jsonb(s) into v_task_json
    from public.task_status_snapshot(p_task_id) as s;
    return pg_catalog.jsonb_build_object(
      'task', v_task_json,
      'transition', pg_catalog.jsonb_build_object(
        'transition_id', v_existing.id,
        'task_id', v_existing.task_id,
        'sequence', v_existing.transition_seq,
        'from_status', v_existing.from_status,
        'to_status', v_existing.to_status,
        'action', v_existing.action,
        'created_at', v_existing.created_at
      ),
      'was_existing', true
    );
  end if;

  if p_action = 'block' and (
    v_reason is null
    or v_reason = ''
  ) then
    raise exception 'task_block_reason_required' using errcode = '22023';
  end if;
  if p_action = 'block' and pg_catalog.char_length(v_reason) > 2000 then
    raise exception 'task_block_reason_too_long' using errcode = '22023';
  end if;
  if p_action <> 'block' and v_reason is not null then
    raise exception 'task_transition_payload_invalid' using errcode = '22023';
  end if;

  if p_action = 'cancel' then
    if not public.can_manage_project_tasks(v_project_id) then
      raise exception 'task_permission_denied' using errcode = '42501';
    end if;
  elsif v_task.assignee_id <> v_actor_id
        and not public.can_manage_project_tasks(v_project_id)
  then
    raise exception 'task_permission_denied' using errcode = '42501';
  end if;

  case p_action
    when 'start' then
      if v_task.status <> 'todo' then
        raise exception 'task_invalid_transition' using errcode = '55000';
      end if;
      v_to_status := 'in_progress';
    when 'block' then
      if v_task.status <> 'in_progress' then
        raise exception 'task_invalid_transition' using errcode = '55000';
      end if;
      v_to_status := 'blocked';
    when 'resume' then
      if v_task.status <> 'blocked' then
        raise exception 'task_invalid_transition' using errcode = '55000';
      end if;
      v_to_status := 'in_progress';
    when 'cancel' then
      if v_task.status not in ('todo', 'in_progress', 'blocked') then
        raise exception 'task_invalid_transition' using errcode = '55000';
      end if;
      v_to_status := 'cancelled';
  end case;

  select coalesce(pg_catalog.max(h.transition_seq), 0) + 1
    into v_transition_seq
  from public.task_status_history as h
  where h.task_id = p_task_id;
  v_now := pg_catalog.clock_timestamp();

  perform pg_catalog.set_config(
    'app.task_transition_task_id',
    p_task_id::text,
    true
  );
  update public.tasks as task_row
  set
    status = v_to_status,
    blocker_reason = case when p_action = 'block' then v_reason else null end,
    blocked_at = case when p_action = 'block' then v_now else null end,
    blocked_by = case when p_action = 'block' then v_actor_id else null end,
    updated_by = v_actor_id
  where task_row.id = p_task_id;

  perform pg_catalog.set_config(
    'app.task_transition_history_id',
    v_transition_id::text,
    true
  );
  begin
    insert into public.task_status_history (
      id,
      task_id,
      from_status,
      to_status,
      action,
      reason,
      actor_id,
      idempotency_key,
      transition_seq,
      created_at
    ) values (
      v_transition_id,
      p_task_id,
      v_task.status,
      v_to_status,
      p_action,
      case when p_action = 'block' then v_reason else null end,
      v_actor_id,
      p_idempotency_key,
      v_transition_seq,
      v_now
    ) returning * into v_transition;
  exception when unique_violation then
    raise exception 'task_transition_idempotency_conflict' using errcode = '23505';
  end;

  perform pg_catalog.set_config('app.task_transition_history_id', '', true);
  perform pg_catalog.set_config('app.task_transition_task_id', '', true);

  select pg_catalog.to_jsonb(s) into v_task_json
  from public.task_status_snapshot(p_task_id) as s;
  return pg_catalog.jsonb_build_object(
    'task', v_task_json,
    'transition', pg_catalog.jsonb_build_object(
      'transition_id', v_transition.id,
      'task_id', v_transition.task_id,
      'sequence', v_transition.transition_seq,
      'from_status', v_transition.from_status,
      'to_status', v_transition.to_status,
      'action', v_transition.action,
      'created_at', v_transition.created_at
    ),
    'was_existing', false
  );
end;
$function$;

alter function public.execute_task_transition(
  uuid, public.task_status_action, text, uuid
) owner to postgres;
revoke all on function public.execute_task_transition(
  uuid, public.task_status_action, text, uuid
) from public, anon, authenticated, service_role;

create function public.start_task(
  p_task_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.execute_task_transition(
    p_task_id,
    'start'::public.task_status_action,
    null,
    p_idempotency_key
  );
$function$;

create function public.block_task(
  p_task_id uuid,
  p_blocker_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.execute_task_transition(
    p_task_id,
    'block'::public.task_status_action,
    p_blocker_reason,
    p_idempotency_key
  );
$function$;

create function public.resume_task(
  p_task_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.execute_task_transition(
    p_task_id,
    'resume'::public.task_status_action,
    null,
    p_idempotency_key
  );
$function$;

create function public.cancel_task(
  p_task_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.execute_task_transition(
    p_task_id,
    'cancel'::public.task_status_action,
    null,
    p_idempotency_key
  );
$function$;

alter function public.start_task(uuid, uuid) owner to postgres;
alter function public.block_task(uuid, text, uuid) owner to postgres;
alter function public.resume_task(uuid, uuid) owner to postgres;
alter function public.cancel_task(uuid, uuid) owner to postgres;
revoke all on function public.start_task(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.block_task(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.resume_task(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_task(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.start_task(uuid, uuid) to authenticated;
grant execute on function public.block_task(uuid, text, uuid) to authenticated;
grant execute on function public.resume_task(uuid, uuid) to authenticated;
grant execute on function public.cancel_task(uuid, uuid) to authenticated;

create function public.list_task_status_history(p_task_id uuid)
returns table (
  transition_id uuid,
  task_id uuid,
  sequence bigint,
  from_status public.task_status,
  to_status public.task_status,
  action public.task_status_action,
  reason text,
  actor_id uuid,
  actor_display_name text,
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
  select
    h.id,
    h.task_id,
    h.transition_seq,
    h.from_status,
    h.to_status,
    h.action,
    h.reason,
    h.actor_id,
    coalesce(pr.display_name, '未设置显示名称'),
    h.created_at
  from public.task_status_history as h
  left join public.profiles as pr on pr.user_id = h.actor_id
  where h.task_id = p_task_id
  order by h.transition_seq, h.id;
end;
$function$;

alter function public.list_task_status_history(uuid) owner to postgres;
revoke all on function public.list_task_status_history(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_task_status_history(uuid) to authenticated;

alter table public.task_status_history enable row level security;
create policy task_status_history_select_authorized
  on public.task_status_history
  for select to authenticated
  using (public.can_read_task(task_id));

revoke all on public.task_status_history
  from public, anon, authenticated, service_role;

-- Terminal task responsibilities are historical. Non-terminal tasks continue
-- to protect active assignee/collaborator/reviewer/visibility relationships.
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
         and t.status in ('todo', 'in_progress', 'blocked', 'pending_review')
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
      and t.status in ('todo', 'in_progress', 'blocked', 'pending_review')
      and (
        t.assignee_id = old.user_id
        or t.reviewer_id = old.user_id
        or exists (
          select 1 from public.task_collaborators as tc
          where tc.task_id = t.id and tc.user_id = old.user_id
        )
        or exists (
          select 1 from public.task_visibility_users as tvu
          where tvu.task_id = t.id and tvu.user_id = old.user_id
        )
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
       where p.workspace_id = old.workspace_id
         and p.status <> 'archived'
         and t.status in ('todo', 'in_progress', 'blocked', 'pending_review')
         and (
           t.assignee_id = old.user_id
           or t.reviewer_id = old.user_id
           or exists (
             select 1 from public.task_collaborators as tc
             where tc.task_id = t.id and tc.user_id = old.user_id
           )
           or exists (
             select 1 from public.task_visibility_users as tvu
             where tvu.task_id = t.id and tvu.user_id = old.user_id
           )
         )
     )
  then
    raise exception 'task_participant_workspace_membership_conflict' using errcode = '55000';
  end if;
  return new;
end;
$function$;

alter function public.guard_project_responsibility_on_workspace_status()
  owner to postgres;

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
         and t.status in ('todo', 'in_progress', 'blocked', 'pending_review')
         and (
           t.assignee_id = old.id
           or t.reviewer_id = old.id
           or exists (
             select 1 from public.task_collaborators as tc
             where tc.task_id = t.id and tc.user_id = old.id
           )
           or exists (
             select 1 from public.task_visibility_users as tvu
             where tvu.task_id = t.id and tvu.user_id = old.id
           )
         )
     )
  then
    raise exception 'task_participant_app_user_conflict' using errcode = '55000';
  end if;
  return new;
end;
$function$;

alter function public.guard_project_responsibility_on_app_user_status()
  owner to postgres;

-- Final least-privilege assertions. Current blocker columns are intentionally
-- not added to the direct authenticated SELECT grant; full details use get_task.
revoke insert, update, delete on public.tasks
  from public, anon, authenticated, service_role;
revoke all on public.task_status_history
  from public, anon, authenticated, service_role;
