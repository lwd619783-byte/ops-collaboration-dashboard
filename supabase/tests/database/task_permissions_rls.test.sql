begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.sqlstate_of(p_sql text)
returns text language plpgsql as $function$
begin execute p_sql; return null;
exception when others then return sqlstate::text;
end;
$function$;
create function pg_temp.task_count_for_key(p_key uuid)
returns bigint language sql security definer set search_path = '' as $function$
  select count(*) from public.tasks where idempotency_key = p_key;
$function$;
grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.task_count_for_key(uuid) to public;

select no_plan();

insert into public.app_users (id,status,disabled_at) values
  ('d1000000-0000-4000-8000-000000000001','active',null),
  ('d1000000-0000-4000-8000-000000000002','active',null),
  ('d1000000-0000-4000-8000-000000000003','active',null),
  ('d1000000-0000-4000-8000-000000000004','active',null),
  ('d1000000-0000-4000-8000-000000000005','active',null),
  ('d1000000-0000-4000-8000-000000000006','active',null),
  ('d1000000-0000-4000-8000-000000000007','active',null),
  ('d1000000-0000-4000-8000-000000000008','active',null),
  ('d1000000-0000-4000-8000-000000000009','active',null),
  ('d1000000-0000-4000-8000-000000000010','suspended',now()),
  ('d1000000-0000-4000-8000-000000000011','active',null);
insert into public.profiles (user_id,display_name) values
  ('d1000000-0000-4000-8000-000000000001','Fictional task owner'),
  ('d1000000-0000-4000-8000-000000000002','Fictional task lead'),
  ('d1000000-0000-4000-8000-000000000003','Fictional task assignee'),
  ('d1000000-0000-4000-8000-000000000004','Fictional task collaborator'),
  ('d1000000-0000-4000-8000-000000000005','Fictional task viewer'),
  ('d1000000-0000-4000-8000-000000000006','Fictional task explicit member'),
  ('d1000000-0000-4000-8000-000000000007','Fictional task ordinary member'),
  ('d1000000-0000-4000-8000-000000000008','Fictional task removable member'),
  ('d1000000-0000-4000-8000-000000000009','Fictional other project owner'),
  ('d1000000-0000-4000-8000-000000000010','Fictional suspended user'),
  ('d1000000-0000-4000-8000-000000000011','Fictional workspace admin');
insert into public.user_identities (user_id,provider,provider_tenant,provider_subject,verified_at) values
  ('d1000000-0000-4000-8000-000000000001','supabase_auth','https://task-fixture.invalid','task-owner',now()),
  ('d1000000-0000-4000-8000-000000000002','supabase_auth','https://task-fixture.invalid','task-lead',now()),
  ('d1000000-0000-4000-8000-000000000003','supabase_auth','https://task-fixture.invalid','task-assignee',now()),
  ('d1000000-0000-4000-8000-000000000004','supabase_auth','https://task-fixture.invalid','task-collaborator',now()),
  ('d1000000-0000-4000-8000-000000000005','supabase_auth','https://task-fixture.invalid','task-viewer',now()),
  ('d1000000-0000-4000-8000-000000000006','supabase_auth','https://task-fixture.invalid','task-explicit',now()),
  ('d1000000-0000-4000-8000-000000000007','supabase_auth','https://task-fixture.invalid','task-ordinary',now()),
  ('d1000000-0000-4000-8000-000000000008','supabase_auth','https://task-fixture.invalid','task-removable',now()),
  ('d1000000-0000-4000-8000-000000000009','supabase_auth','https://task-fixture.invalid','task-other-owner',now()),
  ('d1000000-0000-4000-8000-000000000010','supabase_auth','https://task-fixture.invalid','task-suspended',now()),
  ('d1000000-0000-4000-8000-000000000011','supabase_auth','https://task-fixture.invalid','task-admin',now());

insert into public.workspaces (id,name,owner_id,created_by) values
  ('d2000000-0000-4000-8000-000000000001','Fictional task workspace','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002','Fictional other workspace','d1000000-0000-4000-8000-000000000009','d1000000-0000-4000-8000-000000000009');
insert into public.workspace_members (workspace_id,user_id,role,status,invited_by,joined_at) values
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','owner','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','member','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','member','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','member','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','member','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006','member','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','member','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008','member','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000011','admin','active','d1000000-0000-4000-8000-000000000001',now()),
  ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000009','owner','active','d1000000-0000-4000-8000-000000000009',now());

insert into public.projects (id,workspace_id,name,status,owner_id,lead_id,created_by,idempotency_key,archived_at) values
  ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Fictional task project','active','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001',null),
  ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002','Fictional other project','active','d1000000-0000-4000-8000-000000000009',null,'d1000000-0000-4000-8000-000000000009','d4000000-0000-4000-8000-000000000002',null),
  ('d3000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001','Fictional archived task project','archived','d1000000-0000-4000-8000-000000000001',null,'d1000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000003',now());
insert into public.project_members (project_id,user_id,role) values
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','owner'),
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','lead'),
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','member'),
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','member'),
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','viewer'),
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006','member'),
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','member'),
  ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008','member'),
  ('d3000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000009','owner'),
  ('d3000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','owner');
insert into public.project_modules (id,project_id,name,sort_position,created_by,updated_by,deleted_at,deleted_by) values
  ('d5000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Task module',0,'d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',null,null),
  ('d5000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001','Empty module',1,'d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',null,null),
  ('d5000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000001','Deleted module',9,'d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',now(),'d1000000-0000-4000-8000-000000000001'),
  ('d5000000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000002','Other module',0,'d1000000-0000-4000-8000-000000000009','d1000000-0000-4000-8000-000000000009',null,null),
  ('d5000000-0000-4000-8000-000000000005','d3000000-0000-4000-8000-000000000003','Archived module',0,'d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',null,null);

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select * from public.get_task(gen_random_uuid()) $sql$), '42501', 'anon cannot execute task reads');
select is(pg_temp.sqlstate_of($sql$ select title from public.tasks $sql$), '42501', 'anon cannot read task tables');
select is(pg_temp.sqlstate_of($sql$ select * from public.create_task(null,null,null,null,null,null,array[]::uuid[],null,'medium',null,null,null,'m','project',array[]::uuid[],gen_random_uuid()) $sql$), '42501', 'anon cannot execute task writes');
reset role;

set local "request.jwt.claims" = '{"sub":"task-owner","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select pg_catalog.set_config('test.task_id', (
  select task_id::text from public.create_task(
    'd3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001',
    '  First project task  ',' Description ',' Acceptance ',
    'd1000000-0000-4000-8000-000000000003',array['d1000000-0000-4000-8000-000000000004'::uuid],
    'd1000000-0000-4000-8000-000000000002','high','2026-08-09','2026-08-10',4.5,'m','project',array[]::uuid[],
    'd6000000-0000-4000-8000-000000000001'
  )
), true);
select is((select title from public.get_task(current_setting('test.task_id')::uuid)), 'First project task', 'create normalizes title and returns a readable snapshot');
select is((select status from public.get_task(current_setting('test.task_id')::uuid)), 'todo'::public.task_status, 'create fixes initial status to todo');
select is((select progress from public.get_task(current_setting('test.task_id')::uuid)), 0::smallint, 'create fixes progress to zero');
select is((select created_by from public.get_task(current_setting('test.task_id')::uuid)), 'd1000000-0000-4000-8000-000000000001'::uuid, 'create derives actor from current_app_user_id');
select is((select jsonb_array_length(collaborators) from public.get_task(current_setting('test.task_id')::uuid)), 1, 'create atomically writes collaborator set');
select is((select jsonb_array_length(visibility_users) from public.get_task(current_setting('test.task_id')::uuid)), 0, 'project visibility stores no explicit users');
select is((
  select was_existing from public.create_task(
    'd3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001',
    'First project task','Description','Acceptance','d1000000-0000-4000-8000-000000000003',
    array['d1000000-0000-4000-8000-000000000004'::uuid],'d1000000-0000-4000-8000-000000000002',
    'high','2026-08-09','2026-08-10',4.5,'m','project',array[]::uuid[],'d6000000-0000-4000-8000-000000000001'
  )
), true, 'identical retry returns the existing task');
select is(pg_temp.task_count_for_key('d6000000-0000-4000-8000-000000000001'), 1::bigint, 'identical retry creates no duplicate');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Changed retry','Description','Acceptance','d1000000-0000-4000-8000-000000000003',array['d1000000-0000-4000-8000-000000000004'::uuid],'d1000000-0000-4000-8000-000000000002','high','2026-08-09','2026-08-10',4.5,'m','project',array[]::uuid[],'d6000000-0000-4000-8000-000000000001')
$sql$), '23505', 'idempotency payload mismatch is rejected');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Duplicate collaborators',null,null,'d1000000-0000-4000-8000-000000000003',array['d1000000-0000-4000-8000-000000000004'::uuid,'d1000000-0000-4000-8000-000000000004'::uuid],'d1000000-0000-4000-8000-000000000002','medium',null,null,null,'m','project',array[]::uuid[],gen_random_uuid())
$sql$), '22023', 'duplicate collaborators are rejected');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Invalid hour precision',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','medium',null,null,1.234,'m','project',array[]::uuid[],gen_random_uuid())
$sql$), '22023', 'estimated hours beyond two decimal places are rejected');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Assignee duplicate',null,null,'d1000000-0000-4000-8000-000000000003',array['d1000000-0000-4000-8000-000000000003'::uuid],'d1000000-0000-4000-8000-000000000002','medium',null,null,null,'m','project',array[]::uuid[],gen_random_uuid())
$sql$), '22023', 'assignee cannot also be collaborator');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Viewer assignment',null,null,'d1000000-0000-4000-8000-000000000005',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','medium',null,null,null,'m','project',array[]::uuid[],gen_random_uuid())
$sql$), '22023', 'viewer cannot hold responsibility');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000004','Cross module',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','medium',null,null,null,'m','project',array[]::uuid[],gen_random_uuid())
$sql$), '22023', 'cross-project module is rejected');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000003','Deleted module',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','medium',null,null,null,'m','project',array[]::uuid[],gen_random_uuid())
$sql$), '22023', 'deleted module is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.tasks (project_id,module_id,title,assignee_id,reviewer_id,created_by,updated_by,idempotency_key)
  values ('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Direct write','d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',gen_random_uuid())
$sql$), '42501', 'authenticated cannot bypass create RPC');

select pg_catalog.set_config('test.original_version', (select updated_at::text from public.get_task(current_setting('test.task_id')::uuid)), true);
select is((
  select title from public.update_task(
    'd3000000-0000-4000-8000-000000000001',current_setting('test.task_id')::uuid,'d5000000-0000-4000-8000-000000000001',
    'Updated task','Updated description','Updated acceptance','d1000000-0000-4000-8000-000000000003',
    array['d1000000-0000-4000-8000-000000000006'::uuid],'d1000000-0000-4000-8000-000000000002','urgent',
    '2026-08-09','2026-08-11',8,'l','project',array[]::uuid[],current_setting('test.original_version')::timestamptz
  )
), 'Updated task', 'owner updates core metadata');
select is((select collaborators->0->>'app_user_id' from public.get_task(current_setting('test.task_id')::uuid)), 'd1000000-0000-4000-8000-000000000006', 'update atomically replaces collaborators');
select is(pg_temp.sqlstate_of(format($sql$
  select * from public.update_task('d3000000-0000-4000-8000-000000000001',%L::uuid,'d5000000-0000-4000-8000-000000000001','Stale',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','medium',null,null,null,'m','project',array[]::uuid[],%L::timestamptz)
$sql$, current_setting('test.task_id'), (current_setting('test.original_version')::timestamptz - interval '1 second')::text)), '40001', 'stale update is rejected');

select pg_catalog.set_config('test.restricted_task_id', (
  select task_id::text from public.create_task(
    'd3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Restricted task',null,'Restricted acceptance',
    'd1000000-0000-4000-8000-000000000003',array['d1000000-0000-4000-8000-000000000004'::uuid],
    'd1000000-0000-4000-8000-000000000002','medium',null,null,null,'s','restricted',
    array['d1000000-0000-4000-8000-000000000005'::uuid],'d6000000-0000-4000-8000-000000000002'
  )
), true);
select is((select jsonb_array_length(visibility_users) from public.get_task(current_setting('test.restricted_task_id')::uuid)), 1, 'restricted create stores explicit visibility set');
select is(pg_temp.sqlstate_of($sql$ select * from public.delete_project_module('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001') $sql$), '55000', 'module containing tasks cannot be deleted');
select is((select count(*) from public.delete_project_module('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000002')), 1::bigint, 'empty module still deletes and compacts normally');
select is(pg_temp.sqlstate_of($sql$ select * from public.remove_project_member('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004') $sql$), '55000', 'assigned collaborator cannot be removed from active project');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_status('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','suspended') $sql$), '55000', 'active assignee cannot be suspended');
select is((select count(*) from public.list_task_assignment_candidates('d3000000-0000-4000-8000-000000000001') where can_hold_responsibility), 7::bigint, 'candidate projection marks non-viewer active members as responsibility-capable');
select is((select can_hold_responsibility from public.list_task_assignment_candidates('d3000000-0000-4000-8000-000000000001') where app_user_id='d1000000-0000-4000-8000-000000000005'), false, 'viewer candidate is visibility-only');
reset role;

set local "request.jwt.claims" = '{"sub":"task-lead","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.restricted_task_id')::uuid)), 1::bigint, 'project lead can read restricted task');
select lives_ok($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Lead task',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','low',null,null,null,'xs','project',array[]::uuid[],gen_random_uuid())
$sql$, 'project lead can create tasks');
reset role;

set local "request.jwt.claims" = '{"sub":"task-admin","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select lives_ok($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Admin task',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','low',null,null,null,'xs','project',array[]::uuid[],gen_random_uuid())
$sql$, 'workspace admin can create tasks without a project-member relation');
reset role;

set local "request.jwt.claims" = '{"sub":"task-assignee","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.restricted_task_id')::uuid)), 1::bigint, 'restricted assignee can read');
select is(pg_temp.sqlstate_of(format($sql$
  select * from public.update_task('d3000000-0000-4000-8000-000000000001',%L::uuid,'d5000000-0000-4000-8000-000000000001','Member rewrite',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','medium',null,null,null,'m','project',array[]::uuid[],(select updated_at from public.get_task(%L::uuid)))
$sql$, current_setting('test.task_id'), current_setting('test.task_id'))), '42501', 'ordinary member cannot edit or reassign task');
reset role;

set local "request.jwt.claims" = '{"sub":"task-collaborator","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.restricted_task_id')::uuid)), 1::bigint, 'restricted collaborator can read');
reset role;

set local "request.jwt.claims" = '{"sub":"task-viewer","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.restricted_task_id')::uuid)), 1::bigint, 'explicit viewer can read restricted task');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Viewer write',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','low',null,null,null,'xs','project',array[]::uuid[],gen_random_uuid())
$sql$), '42501', 'viewer cannot create tasks');
reset role;

set local "request.jwt.claims" = '{"sub":"task-ordinary","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.restricted_task_id')::uuid)), 0::bigint, 'ordinary member cannot discover restricted task');
select is((select count(title) from public.tasks where id=current_setting('test.restricted_task_id')::uuid), 0::bigint, 'task RLS hides restricted task row');
select is((select count(user_id) from public.task_collaborators where task_id=current_setting('test.restricted_task_id')::uuid), 0::bigint, 'relation RLS hides restricted collaborators');
select is((select count(user_id) from public.task_visibility_users where task_id=current_setting('test.restricted_task_id')::uuid), 0::bigint, 'relation RLS hides restricted visibility list');
select is((select count(*) from public.get_task(current_setting('test.task_id')::uuid)), 1::bigint, 'ordinary member reads project-visible task');
reset role;

set local "request.jwt.claims" = '{"sub":"task-owner","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select changed from public.remove_project_member('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008')), true, 'unassigned ordinary member may still be removed');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000003','d5000000-0000-4000-8000-000000000005','Archived create',null,null,'d1000000-0000-4000-8000-000000000001',array[]::uuid[],'d1000000-0000-4000-8000-000000000001','medium',null,null,null,'m','project',array[]::uuid[],gen_random_uuid())
$sql$), '55000', 'archived project rejects task creation');
reset role;

set local "request.jwt.claims" = '{"sub":"task-removable","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.task_id')::uuid)), 0::bigint, 'removed project member immediately loses task reads');
reset role;

set local "request.jwt.claims" = '{"sub":"task-other-owner","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.task_id')::uuid)), 0::bigint, 'cross-project user cannot discover task');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_task('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Cross project write',null,null,'d1000000-0000-4000-8000-000000000003',array[]::uuid[],'d1000000-0000-4000-8000-000000000002','low',null,null,null,'xs','project',array[]::uuid[],gen_random_uuid())
$sql$), '42501', 'cross-project user cannot create task');
reset role;

set local "request.jwt.claims" = '{"sub":"task-suspended","iss":"https://task-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_task(current_setting('test.task_id')::uuid)), 0::bigint, 'suspended app user receives no task row');
reset role;

select * from finish();
rollback;
