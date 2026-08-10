-- Task 3.5 - submit, approve and return task review V1.
--
-- Review mutations share Task 3.3's authoritative status history and the
-- established project-first lock order. The review ledger is a separate,
-- append-only domain record linked one-to-one to the exact status transition.

create type public.task_review_action as enum ('submit', 'approve', 'return');

alter table public.tasks
  add column completed_at timestamptz,
  add column completed_by uuid
    references public.app_users (id) on delete restrict,
  add constraint tasks_completion_state_consistent check (
    (
      status = 'completed'
      and completed_at is not null
      and completed_by is not null
    )
    or (
      status <> 'completed'
      and completed_at is null
      and completed_by is null
    )
  );

create index tasks_completed_at_idx
  on public.tasks (completed_at desc, id)
  where completed_at is not null;
create index tasks_completed_by_idx
  on public.tasks (completed_by, completed_at desc, id)
  where completed_by is not null;

comment on column public.tasks.completed_at is
  'Database-authoritative completion time set only by approve_task_review().';
comment on column public.tasks.completed_by is
  'Database-derived internal app user who approved task completion.';

alter table public.task_status_history
  drop constraint task_status_history_transition_valid;

alter table public.task_status_history
  add constraint task_status_history_transition_valid check (
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
    or (
      action = 'submit_review'
      and from_status = 'in_progress'
      and to_status = 'pending_review'
      and reason is null
    )
    or (
      action = 'approve_review'
      and from_status = 'pending_review'
      and to_status = 'completed'
      and reason is null
    )
    or (
      action = 'return_review'
      and from_status = 'pending_review'
      and to_status = 'in_progress'
      and reason is not null
    )
  );

comment on column public.tasks.status is
  'Task status changes only through reviewed semantic Task 3.3 and Task 3.5 actions.';

create table public.task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  review_seq bigint not null,
  action public.task_review_action not null,
  actor_id uuid not null references public.app_users (id) on delete restrict,
  from_status public.task_status not null,
  to_status public.task_status not null,
  return_reason text,
  status_transition_id uuid not null
    references public.task_status_history (id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  idempotency_key uuid not null,
  constraint task_reviews_sequence_positive check (review_seq > 0),
  constraint task_reviews_return_reason_valid check (
    return_reason is null
    or (
      return_reason <> ''
      and return_reason = pg_catalog.regexp_replace(
        return_reason,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
      and pg_catalog.char_length(return_reason) <= 2000
    )
  ),
  constraint task_reviews_action_transition_valid check (
    (
      action = 'submit'
      and from_status = 'in_progress'
      and to_status = 'pending_review'
      and return_reason is null
    )
    or (
      action = 'approve'
      and from_status = 'pending_review'
      and to_status = 'completed'
      and return_reason is null
    )
    or (
      action = 'return'
      and from_status = 'pending_review'
      and to_status = 'in_progress'
      and return_reason is not null
    )
  ),
  constraint task_reviews_task_sequence_unique unique (task_id, review_seq),
  constraint task_reviews_actor_idempotency_unique
    unique (actor_id, idempotency_key),
  constraint task_reviews_status_transition_unique unique (status_transition_id)
);

create index task_reviews_task_order_idx
  on public.task_reviews (task_id, review_seq, id);
create index task_reviews_actor_task_idx
  on public.task_reviews (actor_id, task_id, id);

comment on table public.task_reviews is
  'Append-only Task 3.5 review ledger. Each row links one-to-one to the shared task status history.';
comment on column public.task_reviews.review_seq is
  'Per-task review order allocated while holding the task write lock.';
comment on column public.task_reviews.idempotency_key is
  'Actor-scoped review intent key excluded from browser projections.';
comment on column public.task_reviews.status_transition_id is
  'Exact Task 3.3/3.5 shared status-history row committed in the same transaction.';

create function public.task_reviews_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_expected_action public.task_status_action;
begin
  if tg_op <> 'INSERT' then
    raise exception 'task_review_append_only' using errcode = '27000';
  end if;
  if coalesce(
    pg_catalog.current_setting('app.task_review_id', true),
    ''
  ) <> new.id::text
     or coalesce(
       pg_catalog.current_setting('app.task_review_task_id', true),
       ''
     ) <> new.task_id::text
  then
    raise exception 'task_review_write_controlled' using errcode = '27000';
  end if;

  v_expected_action := case new.action
    when 'submit' then 'submit_review'::public.task_status_action
    when 'approve' then 'approve_review'::public.task_status_action
    when 'return' then 'return_review'::public.task_status_action
  end;

  if not exists (
    select 1
    from public.task_status_history as h
    where h.id = new.status_transition_id
      and h.task_id = new.task_id
      and h.actor_id = new.actor_id
      and h.from_status = new.from_status
      and h.to_status = new.to_status
      and h.action = v_expected_action
      and h.reason is not distinct from new.return_reason
      and h.created_at = new.created_at
  ) then
    raise exception 'task_review_transition_link_invalid' using errcode = '23514';
  end if;

  if new.action = 'approve' and not exists (
    select 1
    from public.tasks as t
    where t.id = new.task_id
      and t.status = 'completed'
      and t.completed_at = new.created_at
      and t.completed_by = new.actor_id
  ) then
    raise exception 'task_review_completion_link_invalid' using errcode = '23514';
  end if;
  return new;
end;
$function$;

alter function public.task_reviews_guard() owner to postgres;
revoke all on function public.task_reviews_guard()
  from public, anon, authenticated, service_role;

create trigger task_reviews_guard
  before insert or update or delete on public.task_reviews
  for each row execute function public.task_reviews_guard();

-- Completion metadata is writable only inside the exact review transaction.
-- Metadata editing is frozen after submission and after completion. A return
-- must first move pending_review back to in_progress before a later edit RPC.
create function public.tasks_review_freeze_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.completed_at is distinct from old.completed_at
    or new.completed_by is distinct from old.completed_by
  ) and coalesce(
    pg_catalog.current_setting('app.task_review_task_id', true),
    ''
  ) <> new.id::text
  then
    raise exception 'task_completion_controlled' using errcode = '27000';
  end if;

  if tg_op = 'UPDATE'
     and old.status in ('pending_review', 'completed')
     and (
       new.module_id is distinct from old.module_id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.acceptance_criteria is distinct from old.acceptance_criteria
       or new.assignee_id is distinct from old.assignee_id
       or new.reviewer_id is distinct from old.reviewer_id
       or new.priority is distinct from old.priority
       or new.start_date is distinct from old.start_date
       or new.due_date is distinct from old.due_date
       or new.estimated_hours is distinct from old.estimated_hours
       or new.workload_level is distinct from old.workload_level
       or new.visibility is distinct from old.visibility
     )
  then
    raise exception 'task_review_edit_frozen' using errcode = '55000';
  end if;
  return new;
end;
$function$;

alter function public.tasks_review_freeze_guard() owner to postgres;
revoke all on function public.tasks_review_freeze_guard()
  from public, anon, authenticated, service_role;

create trigger tasks_review_freeze_guard
  before insert or update or delete on public.tasks
  for each row execute function public.tasks_review_freeze_guard();

create function public.task_relations_review_freeze_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_task_id uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
begin
  if exists (
    select 1 from public.tasks as t
    where t.id = v_task_id and t.status in ('pending_review', 'completed')
  ) then
    raise exception 'task_review_edit_frozen' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

alter function public.task_relations_review_freeze_guard() owner to postgres;
revoke all on function public.task_relations_review_freeze_guard()
  from public, anon, authenticated, service_role;

create trigger task_collaborators_review_freeze_guard
  before insert or update or delete on public.task_collaborators
  for each row execute function public.task_relations_review_freeze_guard();
create trigger task_visibility_users_review_freeze_guard
  before insert or update or delete on public.task_visibility_users
  for each row execute function public.task_relations_review_freeze_guard();

create function public.task_review_task_snapshot(p_task_id uuid)
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
  completed_at timestamptz,
  completed_by uuid,
  completed_by_display_name text,
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
    s.last_progress_at,
    s.last_progress_by,
    s.last_progress_by_display_name,
    t.completed_at,
    t.completed_by,
    case
      when t.completed_by is null then null
      else coalesce(cp.display_name, '未设置显示名称')
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
  from public.task_progress_snapshot(p_task_id) as s
  join public.tasks as t on t.id = s.task_id
  left join public.profiles as cp on cp.user_id = t.completed_by;
$function$;

alter function public.task_review_task_snapshot(uuid) owner to postgres;
revoke all on function public.task_review_task_snapshot(uuid)
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
  completed_at timestamptz, completed_by uuid,
  completed_by_display_name text, blocker_reason text,
  blocked_at timestamptz, blocked_by uuid, blocked_by_display_name text,
  collaborators jsonb, visibility_users jsonb, created_by uuid,
  created_at timestamptz, updated_by uuid, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.* from public.task_review_task_snapshot(p_task_id) as s
  where public.can_read_task(p_task_id);
$function$;

alter function public.get_task(uuid) owner to postgres;
revoke all on function public.get_task(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_task(uuid) to authenticated;

create function public.task_review_snapshot(p_task_id uuid)
returns table (
  review_id uuid,
  task_id uuid,
  sequence bigint,
  action public.task_review_action,
  actor_id uuid,
  actor_display_name text,
  from_status public.task_status,
  to_status public.task_status,
  return_reason text,
  status_transition_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    r.id,
    r.task_id,
    r.review_seq,
    r.action,
    r.actor_id,
    coalesce(pr.display_name, '未设置显示名称'),
    r.from_status,
    r.to_status,
    r.return_reason,
    r.status_transition_id,
    r.created_at
  from public.task_reviews as r
  left join public.profiles as pr on pr.user_id = r.actor_id
  where r.task_id = p_task_id
  order by r.review_seq, r.id;
$function$;

alter function public.task_review_snapshot(uuid) owner to postgres;
revoke all on function public.task_review_snapshot(uuid)
  from public, anon, authenticated, service_role;

create function public.list_task_reviews(p_task_id uuid)
returns table (
  review_id uuid,
  task_id uuid,
  sequence bigint,
  action public.task_review_action,
  actor_id uuid,
  actor_display_name text,
  from_status public.task_status,
  to_status public.task_status,
  return_reason text,
  status_transition_id uuid,
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
  select s.* from public.task_review_snapshot(p_task_id) as s;
end;
$function$;

alter function public.list_task_reviews(uuid) owner to postgres;
revoke all on function public.list_task_reviews(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_task_reviews(uuid) to authenticated;

create function public.execute_task_review(
  p_task_id uuid,
  p_action public.task_review_action,
  p_return_reason text,
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
  v_existing public.task_reviews%rowtype;
  v_review public.task_reviews%rowtype;
  v_transition public.task_status_history%rowtype;
  v_return_reason text := case
    when p_return_reason is null then null
    else nullif(pg_catalog.regexp_replace(
      p_return_reason,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ), '')
  end;
  v_to_status public.task_status;
  v_status_action public.task_status_action;
  v_transition_seq bigint;
  v_review_seq bigint;
  v_transition_id uuid := gen_random_uuid();
  v_review_id uuid := gen_random_uuid();
  v_now timestamptz;
  v_task_json jsonb;
  v_review_json jsonb;
  v_transition_json jsonb;
begin
  if v_actor_id is null
     or p_task_id is null
     or p_action is null
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
    select v_actor_id as participant_id
    union all
    select t.assignee_id from public.tasks as t where t.id = p_task_id
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

  if p_action = 'submit' then
    if v_task.assignee_id is distinct from v_actor_id
       and not public.can_manage_project_tasks(v_project_id)
    then
      raise exception 'task_review_permission_denied' using errcode = '42501';
    end if;
  elsif v_task.reviewer_id is distinct from v_actor_id
        and not public.can_manage_project_tasks(v_project_id)
  then
    raise exception 'task_review_permission_denied' using errcode = '42501';
  end if;

  select r.* into v_existing
  from public.task_reviews as r
  where r.actor_id = v_actor_id
    and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.task_id is distinct from p_task_id
       or v_existing.action is distinct from p_action
       or v_existing.return_reason is distinct from v_return_reason
    then
      raise exception 'task_review_idempotency_conflict' using errcode = '23505';
    end if;
    select h.* into v_transition
    from public.task_status_history as h
    where h.id = v_existing.status_transition_id;
    if not found then
      raise exception 'task_review_concurrent_state_changed' using errcode = '40001';
    end if;
    select pg_catalog.to_jsonb(s) into v_task_json
    from public.task_review_task_snapshot(p_task_id) as s;
    select pg_catalog.to_jsonb(s) into v_review_json
    from public.task_review_snapshot(p_task_id) as s
    where s.review_id = v_existing.id;
    v_transition_json := pg_catalog.jsonb_build_object(
      'transition_id', v_transition.id,
      'task_id', v_transition.task_id,
      'sequence', v_transition.transition_seq,
      'from_status', v_transition.from_status,
      'to_status', v_transition.to_status,
      'action', v_transition.action,
      'created_at', v_transition.created_at
    );
    return pg_catalog.jsonb_build_object(
      'task', v_task_json,
      'review', v_review_json,
      'transition', v_transition_json,
      'was_existing', true
    );
  end if;

  if exists (
    select 1 from public.task_status_history as h
    where h.actor_id = v_actor_id and h.idempotency_key = p_idempotency_key
  ) then
    raise exception 'task_review_idempotency_conflict' using errcode = '23505';
  end if;

  if p_action = 'return' then
    if v_return_reason is null then
      raise exception 'task_review_return_reason_required' using errcode = '22023';
    end if;
    if pg_catalog.char_length(v_return_reason) > 2000 then
      raise exception 'task_review_return_reason_too_long' using errcode = '22023';
    end if;
  elsif p_return_reason is not null then
    raise exception 'task_review_payload_invalid' using errcode = '22023';
  end if;

  case p_action
    when 'submit' then
      if v_task.status <> 'in_progress' then
        raise exception 'task_review_invalid_status' using errcode = '55000';
      end if;
      if v_task.progress <> 100 then
        raise exception 'task_review_progress_required' using errcode = '55000';
      end if;
      v_to_status := 'pending_review';
      v_status_action := 'submit_review';
    when 'approve' then
      if v_task.status <> 'pending_review' then
        raise exception 'task_review_invalid_status' using errcode = '55000';
      end if;
      v_to_status := 'completed';
      v_status_action := 'approve_review';
    when 'return' then
      if v_task.status <> 'pending_review' then
        raise exception 'task_review_invalid_status' using errcode = '55000';
      end if;
      v_to_status := 'in_progress';
      v_status_action := 'return_review';
  end case;

  select coalesce(pg_catalog.max(h.transition_seq), 0) + 1
    into v_transition_seq
  from public.task_status_history as h
  where h.task_id = p_task_id;
  select coalesce(pg_catalog.max(r.review_seq), 0) + 1
    into v_review_seq
  from public.task_reviews as r
  where r.task_id = p_task_id;
  v_now := pg_catalog.clock_timestamp();

  perform pg_catalog.set_config(
    'app.task_transition_task_id',
    p_task_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.task_review_task_id',
    p_task_id::text,
    true
  );
  update public.tasks as task_row
  set
    status = v_to_status,
    completed_at = case when p_action = 'approve' then v_now else null end,
    completed_by = case when p_action = 'approve' then v_actor_id else null end,
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
      v_status_action,
      case when p_action = 'return' then v_return_reason else null end,
      v_actor_id,
      p_idempotency_key,
      v_transition_seq,
      v_now
    ) returning * into v_transition;
  exception when unique_violation then
    raise exception 'task_review_idempotency_conflict' using errcode = '23505';
  end;

  perform pg_catalog.set_config('app.task_review_id', v_review_id::text, true);
  begin
    insert into public.task_reviews (
      id,
      task_id,
      review_seq,
      action,
      actor_id,
      from_status,
      to_status,
      return_reason,
      status_transition_id,
      created_at,
      idempotency_key
    ) values (
      v_review_id,
      p_task_id,
      v_review_seq,
      p_action,
      v_actor_id,
      v_task.status,
      v_to_status,
      case when p_action = 'return' then v_return_reason else null end,
      v_transition.id,
      v_now,
      p_idempotency_key
    ) returning * into v_review;
  exception when unique_violation then
    raise exception 'task_review_idempotency_conflict' using errcode = '23505';
  end;

  perform pg_catalog.set_config('app.task_review_id', '', true);
  perform pg_catalog.set_config('app.task_transition_history_id', '', true);
  perform pg_catalog.set_config('app.task_review_task_id', '', true);
  perform pg_catalog.set_config('app.task_transition_task_id', '', true);

  select pg_catalog.to_jsonb(s) into v_task_json
  from public.task_review_task_snapshot(p_task_id) as s;
  select pg_catalog.to_jsonb(s) into v_review_json
  from public.task_review_snapshot(p_task_id) as s
  where s.review_id = v_review.id;
  v_transition_json := pg_catalog.jsonb_build_object(
    'transition_id', v_transition.id,
    'task_id', v_transition.task_id,
    'sequence', v_transition.transition_seq,
    'from_status', v_transition.from_status,
    'to_status', v_transition.to_status,
    'action', v_transition.action,
    'created_at', v_transition.created_at
  );
  return pg_catalog.jsonb_build_object(
    'task', v_task_json,
    'review', v_review_json,
    'transition', v_transition_json,
    'was_existing', false
  );
end;
$function$;

alter function public.execute_task_review(
  uuid, public.task_review_action, text, uuid
) owner to postgres;
revoke all on function public.execute_task_review(
  uuid, public.task_review_action, text, uuid
) from public, anon, authenticated, service_role;

create function public.submit_task_for_review(
  p_task_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.execute_task_review(
    p_task_id,
    'submit'::public.task_review_action,
    null,
    p_idempotency_key
  );
$function$;

create function public.approve_task_review(
  p_task_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.execute_task_review(
    p_task_id,
    'approve'::public.task_review_action,
    null,
    p_idempotency_key
  );
$function$;

create function public.return_task_review(
  p_task_id uuid,
  p_return_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.execute_task_review(
    p_task_id,
    'return'::public.task_review_action,
    p_return_reason,
    p_idempotency_key
  );
$function$;

alter function public.submit_task_for_review(uuid, uuid) owner to postgres;
alter function public.approve_task_review(uuid, uuid) owner to postgres;
alter function public.return_task_review(uuid, text, uuid) owner to postgres;
revoke all on function public.submit_task_for_review(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_task_review(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.return_task_review(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_task_for_review(uuid, uuid)
  to authenticated;
grant execute on function public.approve_task_review(uuid, uuid)
  to authenticated;
grant execute on function public.return_task_review(uuid, text, uuid)
  to authenticated;

alter table public.task_reviews enable row level security;
create policy task_reviews_select_authorized
  on public.task_reviews
  for select to authenticated
  using (public.can_read_task(task_id));

revoke all on public.task_reviews
  from public, anon, authenticated, service_role;
revoke insert, update, delete on public.tasks
  from public, anon, authenticated, service_role;
