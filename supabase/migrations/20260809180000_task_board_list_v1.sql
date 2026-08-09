-- Task 3.2 - read-only project task summary projection for board/list V1.
--
-- The projection first verifies project access and then applies can_read_task
-- to every returned row. Counts and filters are intentionally left to the
-- already-authorized result set so restricted tasks cannot be inferred.

create function public.list_project_tasks(p_project_id uuid)
returns table (
  task_id uuid,
  project_id uuid,
  workspace_id uuid,
  module_id uuid,
  module_name text,
  title text,
  assignee_id uuid,
  assignee_display_name text,
  collaborators jsonb,
  priority public.task_priority,
  start_date date,
  due_date date,
  estimated_hours numeric,
  workload_level public.task_workload_level,
  visibility public.task_visibility,
  status public.task_status,
  progress smallint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_project_id is null
     or not exists (
       select 1
       from public.projects as p
       where p.id = p_project_id
     )
     or not public.can_read_project(p_project_id)
  then
    raise exception 'task_not_found_or_forbidden' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.project_id,
    p.workspace_id,
    t.module_id,
    m.name,
    t.title,
    t.assignee_id,
    coalesce(ap.display_name, '未设置显示名称'),
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
    t.priority,
    t.start_date,
    t.due_date,
    t.estimated_hours,
    t.workload_level,
    t.visibility,
    t.status,
    t.progress,
    t.updated_at
  from public.tasks as t
  join public.projects as p on p.id = t.project_id
  join public.project_modules as m
    on m.id = t.module_id
   and m.project_id = t.project_id
   and m.deleted_at is null
  left join public.profiles as ap on ap.user_id = t.assignee_id
  where t.project_id = p_project_id
    and public.can_read_task(t.id)
  order by t.updated_at desc, t.id;
end;
$function$;

alter function public.list_project_tasks(uuid) owner to postgres;
revoke all on function public.list_project_tasks(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_tasks(uuid) to authenticated;
