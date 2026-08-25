-- Stage 4.1 - authoritative cross-project "my tasks" read model.
--
-- This RPC deliberately models responsibility rather than general visibility.
-- It reuses the existing project/task read boundaries and does not copy task
-- data or introduce a dashboard table.

create function public.list_my_tasks(p_workspace_id uuid)
returns table (
  task_id uuid,
  workspace_id uuid,
  project_id uuid,
  project_name text,
  module_id uuid,
  module_name text,
  title text,
  status public.task_status,
  priority public.task_priority,
  progress smallint,
  start_date date,
  due_date date,
  updated_at timestamptz,
  assignee_id uuid,
  assignee_display_name text,
  reviewer_id uuid,
  reviewer_display_name text,
  collaborators jsonb,
  is_assignee boolean,
  is_collaborator boolean,
  is_reviewer boolean,
  can_decide_review boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
begin
  if p_workspace_id is null
     or not public.is_active_workspace_member(p_workspace_id)
  then
    raise exception 'task_permission_denied' using errcode = '42501';
  end if;

  v_actor_id := public.current_app_user_id();

  return query
  select
    t.id,
    p.workspace_id,
    t.project_id,
    p.name,
    t.module_id,
    m.name,
    t.title,
    t.status,
    t.priority,
    t.progress,
    t.start_date,
    t.due_date,
    t.updated_at,
    t.assignee_id,
    coalesce(ap.display_name, '未设置显示名称'),
    t.reviewer_id,
    coalesce(rp.display_name, '未设置显示名称'),
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
    t.assignee_id = v_actor_id,
    exists (
      select 1
      from public.task_collaborators as mine
      where mine.task_id = t.id and mine.user_id = v_actor_id
    ),
    t.reviewer_id = v_actor_id,
    (
      t.reviewer_id = v_actor_id
      or public.can_manage_project_tasks(t.project_id)
    )
  from public.tasks as t
  join public.projects as p on p.id = t.project_id
  join public.project_modules as m
    on m.id = t.module_id
   and m.project_id = t.project_id
   and m.deleted_at is null
  left join public.profiles as ap on ap.user_id = t.assignee_id
  left join public.profiles as rp on rp.user_id = t.reviewer_id
  where p.workspace_id = p_workspace_id
    and p.status <> 'archived'
    and public.can_read_project(p.id)
    and public.can_read_task(t.id)
    and (
      t.assignee_id = v_actor_id
      or t.reviewer_id = v_actor_id
      or exists (
        select 1
        from public.task_collaborators as mine
        where mine.task_id = t.id and mine.user_id = v_actor_id
      )
      or (
        t.status = 'pending_review'
        and public.can_manage_project_tasks(t.project_id)
      )
    )
  order by
    case t.status
      when 'blocked' then 0
      when 'pending_review' then 1
      when 'todo' then 2
      when 'in_progress' then 3
      when 'completed' then 4
      when 'cancelled' then 5
    end,
    t.due_date asc nulls last,
    case t.priority
      when 'urgent' then 0
      when 'high' then 1
      when 'medium' then 2
      when 'low' then 3
    end,
    t.updated_at desc,
    t.id;
end;
$function$;

alter function public.list_my_tasks(uuid) owner to postgres;
revoke all on function public.list_my_tasks(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_tasks(uuid) to authenticated;
