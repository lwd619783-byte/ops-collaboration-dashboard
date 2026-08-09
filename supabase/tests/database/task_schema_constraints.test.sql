begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.sqlstate_of(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception when others then return sqlstate::text;
end;
$function$;
grant execute on function pg_temp.sqlstate_of(text) to public;

select no_plan();

select ok(to_regclass('public.tasks') is not null, 'tasks exists');
select ok(to_regclass('public.task_collaborators') is not null, 'task_collaborators exists');
select ok(to_regclass('public.task_visibility_users') is not null, 'task_visibility_users exists');
select columns_are('public', 'tasks', array[
  'id','project_id','module_id','title','description','acceptance_criteria',
  'assignee_id','reviewer_id','priority','start_date','due_date',
  'estimated_hours','workload_level','visibility','status','progress',
  'created_by','updated_by','idempotency_key','created_at','updated_at'
], 'tasks has the reviewed Task 3.1 columns');
select columns_are('public', 'task_collaborators', array['task_id','user_id','created_at'], 'collaborator relation stays minimal');
select columns_are('public', 'task_visibility_users', array['task_id','user_id','created_at'], 'visibility relation stays minimal');

select is((select enum_range(null::public.task_priority)::text), '{low,medium,high,urgent}', 'priority enum is closed');
select is((select enum_range(null::public.task_workload_level)::text), '{xs,s,m,l,xl}', 'workload enum is closed');
select is((select enum_range(null::public.task_visibility)::text), '{project,restricted}', 'visibility enum is closed');
select is((select enum_range(null::public.task_status)::text), '{todo,in_progress,blocked,pending_review,completed,cancelled}', 'future-compatible status vocabulary is closed');

select is((select confdeltype::text from pg_constraint where conname = 'tasks_project_id_fkey'), 'r', 'task project deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'tasks_module_project_fkey'), 'r', 'task module deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'tasks_assignee_id_fkey'), 'r', 'assignee deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'tasks_reviewer_id_fkey'), 'r', 'reviewer deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'tasks_created_by_fkey'), 'r', 'creator deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'tasks_updated_by_fkey'), 'r', 'updater deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'task_collaborators_task_id_fkey'), 'r', 'collaborator task deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'task_visibility_users_task_id_fkey'), 'r', 'visibility task deletion is restricted');
select ok((select indisunique from pg_index where indexrelid = 'public.project_modules_id_project_unique'::regclass), 'module composite candidate key is unique');
select ok((select indisunique from pg_index where indexrelid = 'public.tasks_actor_idempotency'::regclass), 'task actor idempotency constraint has a unique index');

select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.task_collaborators'::regclass), 'task_collaborators has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.task_visibility_users'::regclass), 'task_visibility_users has RLS enabled');
select policies_are('public', 'tasks', array['tasks_select_authorized'], 'tasks has one reviewed read policy');
select policies_are('public', 'task_collaborators', array['task_collaborators_select_authorized'], 'collaborators have one reviewed read policy');
select policies_are('public', 'task_visibility_users', array['task_visibility_users_select_authorized'], 'visibility users have one reviewed read policy');

select ok(to_regprocedure('public.get_task(uuid)') is not null, 'get_task exists');
select ok(to_regprocedure('public.list_project_tasks(uuid)') is not null, 'Task 3.2 list projection exists');
select ok(to_regprocedure('public.list_task_assignment_candidates(uuid)') is not null, 'candidate RPC exists');
select ok(to_regprocedure('public.create_task(uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],uuid)') is not null, 'create_task exists');
select ok(to_regprocedure('public.update_task(uuid,uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],timestamptz)') is not null, 'update_task exists');
select ok(to_regprocedure('public.create_task(uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],uuid,uuid)') is null, 'create_task accepts no client actor');

select is((
  select count(*) from pg_proc where oid = any(array[
    'public.get_task(uuid)'::regprocedure,
    'public.list_project_tasks(uuid)'::regprocedure,
    'public.list_task_assignment_candidates(uuid)'::regprocedure,
    'public.create_task(uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],uuid)'::regprocedure,
    'public.update_task(uuid,uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],timestamptz)'::regprocedure
  ]) and prosecdef
), 5::bigint, 'all browser task RPCs are SECURITY DEFINER');
select is((
  select count(*) from pg_proc where oid = any(array[
    'public.get_task(uuid)'::regprocedure,
    'public.list_project_tasks(uuid)'::regprocedure,
    'public.list_task_assignment_candidates(uuid)'::regprocedure,
    'public.create_task(uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],uuid)'::regprocedure,
    'public.update_task(uuid,uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],timestamptz)'::regprocedure
  ]) and array_to_string(proconfig, ',') = 'search_path=""'
), 5::bigint, 'all browser task RPCs pin an empty search_path');
select is((
  select count(*) from pg_proc where oid = any(array[
    'public.get_task(uuid)'::regprocedure,
    'public.list_project_tasks(uuid)'::regprocedure,
    'public.list_task_assignment_candidates(uuid)'::regprocedure,
    'public.create_task(uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],uuid)'::regprocedure,
    'public.update_task(uuid,uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],timestamptz)'::regprocedure
  ]) and pg_get_userbyid(proowner) = 'postgres'
), 5::bigint, 'all browser task RPCs belong to postgres');
select ok(has_function_privilege('authenticated', 'public.get_task(uuid)', 'execute'), 'authenticated can get an authorized task');
select ok(has_function_privilege('authenticated', 'public.list_project_tasks(uuid)', 'execute'), 'authenticated can list authorized task summaries');
select ok(not has_function_privilege('anon', 'public.list_project_tasks(uuid)', 'execute'), 'anon cannot list task summaries');
select ok(not has_function_privilege('service_role', 'public.list_project_tasks(uuid)', 'execute'), 'service_role gets no task list RPC grant');
select ok(not has_function_privilege('anon', 'public.get_task(uuid)', 'execute'), 'anon cannot get a task');
select ok(not has_function_privilege('authenticated', 'public.task_snapshot(uuid)', 'execute'), 'task snapshot is internal');
select ok(not has_function_privilege('authenticated', 'public.lock_task_write_participants(uuid,uuid[])', 'execute'), 'task lock helper is internal');
select ok(not has_function_privilege('authenticated', 'public.validate_task_write_input(uuid,uuid,uuid[],uuid,public.task_visibility,uuid[])', 'execute'), 'task validator is internal');
select ok(not has_function_privilege('service_role', 'public.create_task(uuid,uuid,text,text,text,uuid,uuid[],uuid,public.task_priority,date,date,numeric,public.task_workload_level,public.task_visibility,uuid[],uuid)', 'execute'), 'service_role gets no task create RPC grant');

select ok(not has_table_privilege('authenticated', 'public.tasks', 'select'), 'authenticated has no blanket task SELECT');
select ok(has_column_privilege('authenticated', 'public.tasks', 'title', 'select'), 'authenticated may read reviewed task columns through RLS');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'idempotency_key', 'select'), 'idempotency key is not browser-readable');
select ok(not has_table_privilege('authenticated', 'public.tasks', 'insert'), 'authenticated cannot directly insert tasks');
select ok(not has_table_privilege('authenticated', 'public.tasks', 'update'), 'authenticated cannot directly update tasks');
select ok(not has_table_privilege('authenticated', 'public.tasks', 'delete'), 'authenticated cannot directly delete tasks');
select ok(not has_table_privilege('service_role', 'public.tasks', 'insert'), 'service_role gets no task insert grant');
select ok(not has_table_privilege('authenticated', 'public.task_collaborators', 'insert'), 'authenticated cannot directly insert collaborators');
select ok(not has_table_privilege('authenticated', 'public.task_visibility_users', 'delete'), 'authenticated cannot directly delete visibility users');

insert into public.app_users (id, status) values
  ('c1000000-0000-4000-8000-000000000001','active'),
  ('c1000000-0000-4000-8000-000000000002','active'),
  ('c1000000-0000-4000-8000-000000000003','active'),
  ('c1000000-0000-4000-8000-000000000004','active');
insert into public.workspaces (id,name,owner_id,created_by) values
  ('c2000000-0000-4000-8000-000000000001','Fictional task schema workspace A','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002','Fictional task schema workspace B','c1000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000004');
insert into public.workspace_members (workspace_id,user_id,role,status,invited_by,joined_at) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','owner','active','c1000000-0000-4000-8000-000000000001',now()),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','member','active','c1000000-0000-4000-8000-000000000001',now()),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','member','active','c1000000-0000-4000-8000-000000000001',now()),
  ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000004','owner','active','c1000000-0000-4000-8000-000000000004',now());
insert into public.projects (id,workspace_id,name,status,owner_id,created_by,idempotency_key) values
  ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Fictional task schema project A','active','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001'),
  ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','Fictional task schema project B','active','c1000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000004','c4000000-0000-4000-8000-000000000002');
insert into public.project_members (project_id,user_id,role) values
  ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','owner'),
  ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','member'),
  ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','viewer'),
  ('c3000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000004','owner');
insert into public.project_modules (id,project_id,name,sort_position,created_by,updated_by) values
  ('c5000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','Schema module A',0,'c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002','Schema module B',0,'c1000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000004');

insert into public.tasks (
  id,project_id,module_id,title,assignee_id,reviewer_id,created_by,updated_by,idempotency_key
) values (
  'c6000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','Valid schema task',
  'c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001'
);
select is((select status from public.tasks where id='c6000000-0000-4000-8000-000000000001'), 'todo'::public.task_status, 'task defaults to todo');
select is((select progress from public.tasks where id='c6000000-0000-4000-8000-000000000001'), 0::smallint, 'task defaults to zero progress');
select is(pg_temp.sqlstate_of($sql$
  update public.project_modules set deleted_at=now(),deleted_by='c1000000-0000-4000-8000-000000000001'
  where id='c5000000-0000-4000-8000-000000000001'
$sql$), '55000', 'direct module soft deletion cannot bypass task references');
select is(pg_temp.sqlstate_of($sql$ delete from public.tasks where id='c6000000-0000-4000-8000-000000000001' $sql$), '27000', 'physical task deletion is rejected');
select is(pg_temp.sqlstate_of($sql$ update public.tasks set status='in_progress' where id='c6000000-0000-4000-8000-000000000001' $sql$), '27000', 'Task 3.1 cannot change status');
select is(pg_temp.sqlstate_of($sql$ update public.tasks set progress=10 where id='c6000000-0000-4000-8000-000000000001' $sql$), '27000', 'Task 3.1 cannot change progress');
select is(pg_temp.sqlstate_of($sql$
  insert into public.tasks (project_id,module_id,title,assignee_id,reviewer_id,created_by,updated_by,idempotency_key)
  values ('c3000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','   ','c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000002')
$sql$), '23514', 'blank title is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.tasks (project_id,module_id,title,assignee_id,reviewer_id,created_by,updated_by,idempotency_key)
  values ('c3000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001',E'\t\n','c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000006')
$sql$), '23514', 'control-whitespace-only title is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.tasks (project_id,module_id,title,assignee_id,reviewer_id,start_date,due_date,created_by,updated_by,idempotency_key)
  values ('c3000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','Bad dates','c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','2026-08-10','2026-08-09','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000003')
$sql$), '23514', 'invalid date order is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.tasks (project_id,module_id,title,assignee_id,reviewer_id,estimated_hours,created_by,updated_by,idempotency_key)
  values ('c3000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','Bad hours','c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001',-1,'c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000004')
$sql$), '23514', 'negative estimated hours is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.tasks (project_id,module_id,title,assignee_id,reviewer_id,created_by,updated_by,idempotency_key)
  values ('c3000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000002','Cross module','c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000005')
$sql$), '22023', 'cross-project module is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.task_collaborators (task_id,user_id) values ('c6000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002')
$sql$), '23514', 'assignee cannot also be collaborator');
select is(pg_temp.sqlstate_of($sql$
  insert into public.task_collaborators (task_id,user_id) values ('c6000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003')
$sql$), '22023', 'viewer cannot be collaborator');
select is(pg_temp.sqlstate_of($sql$
  insert into public.task_visibility_users (task_id,user_id) values ('c6000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003')
$sql$), '23514', 'project-visible task cannot store explicit visibility rows');
select lives_ok($sql$ update public.tasks set visibility='restricted' where id='c6000000-0000-4000-8000-000000000001' $sql$, 'task may switch to restricted before adding visibility rows');
select lives_ok($sql$ insert into public.task_visibility_users (task_id,user_id) values ('c6000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003') $sql$, 'viewer may receive explicit visibility');
select is(pg_temp.sqlstate_of($sql$ update public.tasks set visibility='project' where id='c6000000-0000-4000-8000-000000000001' $sql$), '23514', 'project visibility rejects retained explicit rows');
select is(pg_temp.sqlstate_of($sql$ insert into public.task_visibility_users (task_id,user_id) values ('c6000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003') $sql$), '23505', 'visibility user relation is unique');

select * from finish();
rollback;
