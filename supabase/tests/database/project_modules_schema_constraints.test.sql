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

grant execute on function pg_temp.sqlstate_of(text) to public;

select no_plan();

select ok(to_regclass('public.project_modules') is not null, 'project_modules exists');
select columns_are(
  'public',
  'project_modules',
  array[
    'id','project_id','name','sort_position','created_by','updated_by',
    'created_at','updated_at','deleted_at','deleted_by'
  ],
  'project_modules has the reviewed V1 columns'
);
select is(
  (select confdeltype::text from pg_constraint where conname = 'project_modules_project_id_fkey'),
  'r',
  'module project deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname = 'project_modules_created_by_fkey'),
  'r',
  'module creator deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname = 'project_modules_updated_by_fkey'),
  'r',
  'module updater deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname = 'project_modules_deleted_by_fkey'),
  'r',
  'module deleting actor deletion is restricted'
);
select ok(
  (select indisunique from pg_index where indexrelid = 'public.project_modules_active_position_idx'::regclass),
  'active position index is unique'
);
select ok(
  pg_get_expr(
    (select indpred from pg_index where indexrelid = 'public.project_modules_active_position_idx'::regclass),
    'public.project_modules'::regclass
  ) like '%deleted_at IS NULL%',
  'position uniqueness applies only to active modules'
);
select ok(
  (select indisunique from pg_index where indexrelid = 'public.project_modules_active_name_idx'::regclass),
  'active normalized name index is unique'
);
select ok(
  pg_get_indexdef('public.project_modules_active_name_idx'::regclass) like '%lower(normalize_project_module_name(name))%',
  'active name uniqueness is normalized and case insensitive'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.project_modules'::regclass),
  'project_modules has RLS enabled'
);
select policies_are(
  'public',
  'project_modules',
  array['project_modules_select_active_members'],
  'project_modules exposes one reviewed read policy'
);

insert into public.app_users (id, status) values
  ('a1000000-0000-4000-8000-000000000001', 'active'),
  ('a1000000-0000-4000-8000-000000000002', 'active');

insert into public.profiles (user_id, display_name) values
  ('a1000000-0000-4000-8000-000000000001', 'Fictional module owner A'),
  ('a1000000-0000-4000-8000-000000000002', 'Fictional module owner B');

insert into public.workspaces (id, name, owner_id, created_by) values
  ('a2000000-0000-4000-8000-000000000001', 'Fictional module workspace A', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002', 'Fictional module workspace B', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at
) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', 'active', 'a1000000-0000-4000-8000-000000000001', now()),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'owner', 'active', 'a1000000-0000-4000-8000-000000000002', now());

insert into public.projects (
  id, workspace_id, name, owner_id, created_by, idempotency_key
) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Fictional module project A', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'Fictional module project B', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002');

insert into public.project_members (project_id, user_id, role) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'owner');

insert into public.project_modules (
  id, project_id, name, sort_position, created_by, updated_by
) values
  ('a5000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Module One', 0, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'Module Two', 1, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002', 'Module One', 0, 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');

select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', '   ', 2, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23514', 'blank module name is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', ' Untrimmed ', 2, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23514', 'untrimmed module name is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', E'Whitespace\tRun', 2, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23514', 'module name must use canonical internal whitespace');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', repeat('x', 121), 2, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23514', 'module name longer than 120 characters is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', 'Negative Position', -1, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23514', 'negative module position is rejected');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', 'Duplicate Position', 1, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23505', 'active position is unique inside a project');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', 'module one', 2, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23505', 'active names are case-insensitively unique inside a project');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('a3000000-0000-4000-8000-000000000001', 'Module  Two', 2, 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')
$sql$), '23514', 'names cannot bypass normalization with repeated spaces');
select lives_ok($sql$
  insert into public.project_modules (
    project_id, name, sort_position, created_by, updated_by, deleted_at, deleted_by
  ) values (
    'a3000000-0000-4000-8000-000000000001', 'Module One', 0,
    'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
    now(), 'a1000000-0000-4000-8000-000000000001'
  )
$sql$, 'deleted history does not reserve active name or position');
select is(pg_temp.sqlstate_of($sql$
  delete from public.project_modules where id = 'a5000000-0000-4000-8000-000000000001'
$sql$), '27000', 'physical module deletion is rejected even for table owner');
select is(pg_temp.sqlstate_of($sql$
  update public.projects set module_preset_initialized = true where id = 'a3000000-0000-4000-8000-000000000001'
$sql$), '27000', 'preset idempotency input is immutable after project creation');

select is(
  (select count(*) from public.operations_project_module_presets()),
  4::bigint,
  'operations preset has four authoritative entries'
);
select is(
  (select array_agg(sort_position order by sort_position) from public.operations_project_module_presets()),
  array[0,1,2,3]::integer[],
  'operations preset positions are continuous and deterministic'
);
select ok(
  (select bool_and(module_name = public.normalize_project_module_name(module_name) and module_name <> '') from public.operations_project_module_presets()),
  'operations preset names use the canonical nonblank normalization'
);
select is(
  (select count(distinct pg_catalog.lower(public.normalize_project_module_name(module_name))) from public.operations_project_module_presets()),
  4::bigint,
  'operations preset names are normalized-unique'
);

select ok(to_regprocedure('public.list_project_modules(uuid)') is not null, 'module list RPC exists');
select ok(to_regprocedure('public.add_project_module(uuid,text)') is not null, 'module add RPC exists');
select ok(to_regprocedure('public.rename_project_module(uuid,uuid,text)') is not null, 'module rename RPC exists');
select ok(to_regprocedure('public.reorder_project_modules(uuid,uuid[])') is not null, 'module reorder RPC exists');
select ok(to_regprocedure('public.delete_project_module(uuid,uuid)') is not null, 'module delete RPC exists');
select ok(to_regprocedure('public.add_project_module(uuid,text,uuid)') is null, 'module add RPC accepts no client actor');
select ok(to_regprocedure('public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid)') is not null, 'legacy create_project signature remains');
select ok(to_regprocedure('public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,boolean)') is not null, 'preset-aware create_project signature exists');
select is(
  (select pronargdefaults from pg_proc where oid = 'public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,boolean)'::regprocedure),
  0::smallint,
  'preset-aware overload has no default and cannot make the legacy signature ambiguous'
);

select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.list_project_modules(uuid)'::regprocedure,
    'public.add_project_module(uuid,text)'::regprocedure,
    'public.rename_project_module(uuid,uuid,text)'::regprocedure,
    'public.reorder_project_modules(uuid,uuid[])'::regprocedure,
    'public.delete_project_module(uuid,uuid)'::regprocedure,
    'public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,boolean)'::regprocedure
  ]) and prosecdef),
  6::bigint,
  'all browser-facing Task 2.3 functions are SECURITY DEFINER'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.list_project_modules(uuid)'::regprocedure,
    'public.add_project_module(uuid,text)'::regprocedure,
    'public.rename_project_module(uuid,uuid,text)'::regprocedure,
    'public.reorder_project_modules(uuid,uuid[])'::regprocedure,
    'public.delete_project_module(uuid,uuid)'::regprocedure,
    'public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,boolean)'::regprocedure
  ]) and array_to_string(proconfig, ',') = 'search_path=""'),
  6::bigint,
  'all browser-facing Task 2.3 functions pin an empty search_path'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.list_project_modules(uuid)'::regprocedure,
    'public.add_project_module(uuid,text)'::regprocedure,
    'public.rename_project_module(uuid,uuid,text)'::regprocedure,
    'public.reorder_project_modules(uuid,uuid[])'::regprocedure,
    'public.delete_project_module(uuid,uuid)'::regprocedure,
    'public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,boolean)'::regprocedure
  ]) and pg_get_userbyid(proowner) = 'postgres'),
  6::bigint,
  'all browser-facing Task 2.3 functions explicitly belong to postgres'
);
select ok(
  (select bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p where p.oid = any(array[
    'public.list_project_modules(uuid)'::regprocedure,
    'public.add_project_module(uuid,text)'::regprocedure,
    'public.rename_project_module(uuid,uuid,text)'::regprocedure,
    'public.reorder_project_modules(uuid,uuid[])'::regprocedure,
    'public.delete_project_module(uuid,uuid)'::regprocedure,
    'public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,boolean)'::regprocedure
  ])),
  'authenticated can execute the reviewed Task 2.3 surface'
);
select ok(
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute'))
   from pg_proc p where p.oid = any(array[
    'public.list_project_modules(uuid)'::regprocedure,
    'public.add_project_module(uuid,text)'::regprocedure,
    'public.rename_project_module(uuid,uuid,text)'::regprocedure,
    'public.reorder_project_modules(uuid,uuid[])'::regprocedure,
    'public.delete_project_module(uuid,uuid)'::regprocedure,
    'public.create_project(uuid,text,text,public.project_type,public.project_status,date,date,uuid,boolean)'::regprocedure
  ])),
  'anon cannot execute the Task 2.3 surface'
);
select ok(not has_function_privilege('authenticated', 'public.project_module_snapshot(uuid)', 'execute'), 'module snapshot helper is internal');
select ok(not has_function_privilege('authenticated', 'public.lock_project_for_module_write(uuid)', 'execute'), 'module lock helper is internal');
select ok(not has_function_privilege('authenticated', 'public.operations_project_module_presets()', 'execute'), 'preset authority is internal');
select ok(not has_function_privilege('authenticated', 'public.normalize_project_module_name(text)', 'execute'), 'name normalizer is internal');

select ok(not has_table_privilege('authenticated', 'public.project_modules', 'select'), 'authenticated has no blanket module SELECT');
select ok(has_column_privilege('authenticated', 'public.project_modules', 'name', 'select'), 'authenticated may read reviewed module name through RLS');
select ok(not has_column_privilege('authenticated', 'public.project_modules', 'deleted_at', 'select'), 'authenticated cannot read deletion metadata');
select ok(not has_table_privilege('authenticated', 'public.project_modules', 'insert'), 'authenticated cannot directly insert modules');
select ok(not has_table_privilege('authenticated', 'public.project_modules', 'update'), 'authenticated cannot directly update modules');
select ok(not has_table_privilege('authenticated', 'public.project_modules', 'delete'), 'authenticated cannot directly delete modules');
select ok(not has_table_privilege('service_role', 'public.project_modules', 'insert'), 'service_role receives no module insert grant');
select ok(not has_table_privilege('service_role', 'public.project_modules', 'delete'), 'service_role receives no module delete grant');

select * from finish();
rollback;
