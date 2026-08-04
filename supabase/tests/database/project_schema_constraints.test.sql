begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.sqlstate_of(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception
  when others then return sqlstate::text;
end;
$function$;

create function pg_temp.project_owner_invariant_state()
returns text
language plpgsql
as $function$
begin
  insert into public.projects (
    id, workspace_id, name, owner_id, created_by, idempotency_key
  ) values (
    '63000000-0000-4000-8000-000000000099',
    '62000000-0000-4000-8000-000000000001',
    'Missing Owner Relation',
    '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000099'
  );
  set constraints projects_owner_membership_required immediate;
  return null;
exception
  when others then return sqlstate::text;
end;
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;

select plan(62);

select ok(to_regclass('public.projects') is not null, 'projects exists');
select ok(to_regclass('public.project_members') is not null, 'project_members exists');
select ok(to_regtype('public.project_type') is not null, 'project_type exists');
select ok(to_regtype('public.project_status') is not null, 'project_status exists');
select ok(to_regtype('public.project_role') is not null, 'project_role exists');

select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text[]
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'project_type'),
  array['operations']::text[],
  'project_type exposes operations only'
);
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text[]
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'project_status'),
  array['planning','active','paused','completed','archived']::text[],
  'project_status labels are closed and ordered'
);
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text[]
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'project_role'),
  array['owner','lead','member','viewer']::text[],
  'project_role labels reserve the Task 2.2 vocabulary'
);

select columns_are(
  'public',
  'projects',
  array[
    'id','workspace_id','name','description','project_type','status',
    'owner_id','lead_id','start_date','due_date','created_by',
    'idempotency_key','created_at','updated_at','archived_at'
  ],
  'projects has the reviewed Task 2.1 columns'
);
select columns_are(
  'public',
  'project_members',
  array['project_id','user_id','role','joined_at'],
  'project_members is minimal and stable'
);
select is(
  (select array_length(c.conkey, 1) from pg_constraint c
   where c.conrelid = 'public.project_members'::regclass and c.contype = 'p'),
  2,
  'project_members primary key is project_id plus user_id'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'projects_actor_idempotency'),
  'project creation idempotency constraint exists'
);
select is((select confdeltype::text from pg_constraint where conname = 'projects_workspace_id_fkey'), 'r', 'project workspace deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'projects_owner_id_fkey'), 'r', 'project owner deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'projects_lead_id_fkey'), 'r', 'project lead deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'projects_created_by_fkey'), 'r', 'project creator deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'project_members_project_id_fkey'), 'r', 'project member project deletion is restricted');
select is((select confdeltype::text from pg_constraint where conname = 'project_members_user_id_fkey'), 'r', 'project member user deletion is restricted');

insert into public.app_users (id, status) values
  ('61000000-0000-4000-8000-000000000001', 'active'),
  ('61000000-0000-4000-8000-000000000002', 'active'),
  ('61000000-0000-4000-8000-000000000003', 'active'),
  ('61000000-0000-4000-8000-000000000004', 'active'),
  ('61000000-0000-4000-8000-000000000005', 'active');

insert into public.profiles (user_id, display_name) values
  ('61000000-0000-4000-8000-000000000001', 'Fixture Owner A'),
  ('61000000-0000-4000-8000-000000000002', 'Fixture Member A'),
  ('61000000-0000-4000-8000-000000000003', 'Fixture Lead A'),
  ('61000000-0000-4000-8000-000000000004', 'Fixture Owner B'),
  ('61000000-0000-4000-8000-000000000005', 'Fixture Outsider');

insert into public.workspaces (id, name, owner_id, created_by) values
  (
    '62000000-0000-4000-8000-000000000001', 'Fixture Workspace A',
    '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001'
  ),
  (
    '62000000-0000-4000-8000-000000000002', 'Fixture Workspace B',
    '61000000-0000-4000-8000-000000000004',
    '61000000-0000-4000-8000-000000000004'
  );

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at
) values
  (
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001', 'owner', 'active',
    '61000000-0000-4000-8000-000000000001', now()
  ),
  (
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000002', 'member', 'active',
    '61000000-0000-4000-8000-000000000001', now()
  ),
  (
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000003', 'member', 'active',
    '61000000-0000-4000-8000-000000000001', now()
  ),
  (
    '62000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000004', 'owner', 'active',
    '61000000-0000-4000-8000-000000000004', now()
  );

insert into public.projects (
  id, workspace_id, name, description, status, owner_id, lead_id,
  start_date, due_date, created_by, idempotency_key
) values
  (
    '63000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001',
    'Lifecycle Fixture', 'Schema checks', 'planning',
    '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000003',
    date '2026-08-01', date '2026-08-31',
    '61000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000001'
  ),
  (
    '63000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000001',
    'Illegal Lifecycle Fixture', null, 'planning',
    '61000000-0000-4000-8000-000000000001', null, null, null,
    '61000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000002'
  );

insert into public.project_members (project_id, user_id, role) values
  ('63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'owner'),
  ('63000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001', 'owner');

select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, owner_id, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', '   ', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000010')
$sql$), '23514', 'blank project names are rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, owner_id, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', ' Untrimmed ', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000011')
$sql$), '23514', 'untrimmed project names are rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, owner_id, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', repeat('x', 121), '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000012')
$sql$), '23514', 'project names longer than 120 are rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, description, owner_id, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', 'Description Limit', repeat('x', 2001), '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000013')
$sql$), '23514', 'project descriptions longer than 2000 are rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, owner_id, start_date, due_date, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', 'Date Order', '61000000-0000-4000-8000-000000000001', date '2026-09-02', date '2026-09-01', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000014')
$sql$), '23514', 'due date cannot precede start date');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, status, owner_id, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', 'Archive Missing Time', 'archived', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000015')
$sql$), '23514', 'archived status requires archived_at');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, status, owner_id, created_by, idempotency_key, archived_at)
  values ('62000000-0000-4000-8000-000000000001', 'Active With Archive Time', 'active', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000016', now())
$sql$), '23514', 'non-archived status rejects archived_at');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, owner_id, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', 'Invalid Owner', '61000000-0000-4000-8000-000000000005', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000017')
$sql$), '23514', 'project owner must be an active workspace member');
select is(pg_temp.sqlstate_of($sql$
  insert into public.projects (workspace_id, name, owner_id, lead_id, created_by, idempotency_key)
  values ('62000000-0000-4000-8000-000000000001', 'Invalid Lead', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000018')
$sql$), '23514', 'project lead must be an active workspace member');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_members (project_id, user_id, role)
  values ('63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004', 'member')
$sql$), '23514', 'project member must be active in the same workspace');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_members (project_id, user_id, role)
  values ('63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'owner')
$sql$), '23505', 'duplicate project membership is rejected');

select is(pg_temp.sqlstate_of($sql$ update public.projects set status = 'active' where id = '63000000-0000-4000-8000-000000000001' $sql$), null::text, 'planning can move to active');
select is(pg_temp.sqlstate_of($sql$ update public.projects set status = 'paused' where id = '63000000-0000-4000-8000-000000000001' $sql$), null::text, 'active can move to paused');
select is(pg_temp.sqlstate_of($sql$ update public.projects set status = 'active' where id = '63000000-0000-4000-8000-000000000001' $sql$), null::text, 'paused can return to active');
select is(pg_temp.sqlstate_of($sql$ update public.projects set status = 'completed' where id = '63000000-0000-4000-8000-000000000001' $sql$), null::text, 'active can move to completed');
select is(pg_temp.sqlstate_of($sql$ update public.projects set status = 'archived', archived_at = clock_timestamp() where id = '63000000-0000-4000-8000-000000000001' $sql$), null::text, 'completed can move to archived with a timestamp');
select is(pg_temp.sqlstate_of($sql$ update public.projects set status = 'completed' where id = '63000000-0000-4000-8000-000000000002' $sql$), '55000', 'planning cannot jump to completed');
select is(pg_temp.sqlstate_of($sql$ update public.projects set status = 'active' where id = '63000000-0000-4000-8000-000000000002'; update public.projects set status = 'archived', archived_at = clock_timestamp() where id = '63000000-0000-4000-8000-000000000002' $sql$), '55000', 'active cannot jump to archived');
select is(pg_temp.sqlstate_of($sql$ update public.projects set name = 'Changed Archive' where id = '63000000-0000-4000-8000-000000000001' $sql$), '55000', 'archived projects reject ordinary edits');
select ok(
  (select status = 'archived' and archived_at is not null from public.projects where id = '63000000-0000-4000-8000-000000000001'),
  'archived status and timestamp remain consistent'
);
update public.projects
set updated_at = timestamptz '2000-01-01 00:00:00+00'
where id = '63000000-0000-4000-8000-000000000002';
select isnt(
  (select updated_at from public.projects where id = '63000000-0000-4000-8000-000000000002'),
  timestamptz '2000-01-01 00:00:00+00',
  'updated_at ignores a supplied timestamp and remains database-controlled'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'projects_set_updated_at' and not tgisinternal),
  'projects uses the repository timestamp trigger'
);

select ok((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), 'projects has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.project_members'::regclass), 'project_members has RLS enabled');
select ok(has_table_privilege('authenticated', 'public.projects', 'select'), 'authenticated has project SELECT for RLS-filtered reads');
select ok(not has_table_privilege('authenticated', 'public.projects', 'insert'), 'authenticated has no direct project INSERT');
select ok(not has_table_privilege('authenticated', 'public.projects', 'update'), 'authenticated has no direct project UPDATE');
select ok(not has_table_privilege('authenticated', 'public.projects', 'delete'), 'authenticated has no project DELETE');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'select'), 'authenticated has no direct project member SELECT');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'insert'), 'authenticated has no direct project member INSERT');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'update'), 'authenticated has no direct project member UPDATE');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'delete'), 'authenticated has no direct project member DELETE');
select ok(not has_table_privilege('anon', 'public.projects', 'select'), 'anon has no project table privileges');
select ok(not has_function_privilege('authenticated', 'public.project_snapshot(uuid)', 'execute'), 'authenticated cannot execute the internal snapshot helper');

select ok(to_regprocedure('public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid)') is not null, 'create_project signature exists');
select ok(to_regprocedure('public.update_project(uuid,text,text,public.project_status,date,date,timestamptz)') is not null, 'update_project signature exists');
select ok(to_regprocedure('public.archive_project(uuid,timestamptz)') is not null, 'archive_project signature exists');
select ok(to_regprocedure('public.list_projects(uuid,boolean,public.project_status,text)') is not null, 'list_projects signature exists');
select ok(to_regprocedure('public.get_project(uuid)') is not null, 'get_project signature exists');
select ok(
  to_regprocedure('public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,uuid)') is null,
  'create_project has no client-supplied actor argument'
);
select is(pg_temp.project_owner_invariant_state(), '23514', 'a project must retain its owner membership');
select is(pg_temp.sqlstate_of($sql$ delete from public.projects where id = '63000000-0000-4000-8000-000000000002' $sql$), '27000', 'project physical deletion is rejected');
select is(pg_temp.sqlstate_of($sql$ update public.project_members set role = 'lead' where project_id = '63000000-0000-4000-8000-000000000002' and user_id = '61000000-0000-4000-8000-000000000001' $sql$), '27000', 'project member updates are closed in Task 2.1');
select is(pg_temp.sqlstate_of($sql$ delete from public.project_members where project_id = '63000000-0000-4000-8000-000000000002' and user_id = '61000000-0000-4000-8000-000000000001' $sql$), '27000', 'project member deletes are closed in Task 2.1');

select * from finish();
rollback;
