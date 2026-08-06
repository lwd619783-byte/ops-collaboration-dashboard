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

create function pg_temp.module_history_count(p_project_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.project_modules where project_id = p_project_id;
$function$;

create function pg_temp.deleted_module_count(p_project_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.project_modules
  where project_id = p_project_id and deleted_at is not null;
$function$;

create function pg_temp.project_count_for_key(p_key uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.projects where idempotency_key = p_key;
$function$;

create function pg_temp.project_member_count_for_key(p_key uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*)
  from public.project_members as pm
  join public.projects as p on p.id = pm.project_id
  where p.idempotency_key = p_key;
$function$;

create function pg_temp.project_module_count_for_key(p_key uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*)
  from public.project_modules as m
  join public.projects as p on p.id = m.project_id
  where p.idempotency_key = p_key;
$function$;

create function pg_temp.preset_count()
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.operations_project_module_presets();
$function$;

create function pg_temp.preset_match_count(p_project_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*)
  from public.project_modules as m
  join public.operations_project_module_presets() as p
    on p.module_name = m.name and p.sort_position = m.sort_position
  where m.project_id = p_project_id and m.deleted_at is null;
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.module_history_count(uuid) to public;
grant execute on function pg_temp.deleted_module_count(uuid) to public;
grant execute on function pg_temp.project_count_for_key(uuid) to public;
grant execute on function pg_temp.project_member_count_for_key(uuid) to public;
grant execute on function pg_temp.project_module_count_for_key(uuid) to public;
grant execute on function pg_temp.preset_count() to public;
grant execute on function pg_temp.preset_match_count(uuid) to public;

select no_plan();

insert into public.app_users (id, status, disabled_at) values
  ('b1000000-0000-4000-8000-000000000001', 'active', null),
  ('b1000000-0000-4000-8000-000000000002', 'active', null),
  ('b1000000-0000-4000-8000-000000000003', 'active', null),
  ('b1000000-0000-4000-8000-000000000004', 'active', null),
  ('b1000000-0000-4000-8000-000000000005', 'active', null),
  ('b1000000-0000-4000-8000-000000000006', 'active', null),
  ('b1000000-0000-4000-8000-000000000007', 'active', null),
  ('b1000000-0000-4000-8000-000000000008', 'active', null),
  ('b1000000-0000-4000-8000-000000000009', 'active', null),
  ('b1000000-0000-4000-8000-000000000010', 'active', null),
  ('b1000000-0000-4000-8000-000000000011', 'suspended', now());

insert into public.profiles (user_id, display_name) values
  ('b1000000-0000-4000-8000-000000000001', 'Fictional module owner'),
  ('b1000000-0000-4000-8000-000000000002', 'Fictional module lead'),
  ('b1000000-0000-4000-8000-000000000003', 'Fictional module member'),
  ('b1000000-0000-4000-8000-000000000004', 'Fictional module viewer'),
  ('b1000000-0000-4000-8000-000000000005', 'Fictional workspace admin'),
  ('b1000000-0000-4000-8000-000000000006', 'Fictional outsider'),
  ('b1000000-0000-4000-8000-000000000007', 'Fictional other owner'),
  ('b1000000-0000-4000-8000-000000000008', 'Fictional revoked member'),
  ('b1000000-0000-4000-8000-000000000009', 'Fictional removable member'),
  ('b1000000-0000-4000-8000-000000000010', 'Fictional suspended workspace admin'),
  ('b1000000-0000-4000-8000-000000000011', 'Fictional inactive app admin');

insert into public.user_identities (
  user_id, provider, provider_tenant, provider_subject, verified_at, revoked_at
) values
  ('b1000000-0000-4000-8000-000000000001', 'supabase_auth', 'https://module-fixture.invalid', 'module-owner', now(), null),
  ('b1000000-0000-4000-8000-000000000002', 'supabase_auth', 'https://module-fixture.invalid', 'module-lead', now(), null),
  ('b1000000-0000-4000-8000-000000000003', 'supabase_auth', 'https://module-fixture.invalid', 'module-member', now(), null),
  ('b1000000-0000-4000-8000-000000000004', 'supabase_auth', 'https://module-fixture.invalid', 'module-viewer', now(), null),
  ('b1000000-0000-4000-8000-000000000005', 'supabase_auth', 'https://module-fixture.invalid', 'module-admin', now(), null),
  ('b1000000-0000-4000-8000-000000000006', 'supabase_auth', 'https://module-fixture.invalid', 'module-outsider', now(), null),
  ('b1000000-0000-4000-8000-000000000007', 'supabase_auth', 'https://module-fixture.invalid', 'module-other-owner', now(), null),
  ('b1000000-0000-4000-8000-000000000008', 'supabase_auth', 'https://module-fixture.invalid', 'module-revoked', now(), now()),
  ('b1000000-0000-4000-8000-000000000009', 'supabase_auth', 'https://module-fixture.invalid', 'module-removable', now(), null),
  ('b1000000-0000-4000-8000-000000000010', 'supabase_auth', 'https://module-fixture.invalid', 'module-suspended-admin', now(), null),
  ('b1000000-0000-4000-8000-000000000011', 'supabase_auth', 'https://module-fixture.invalid', 'module-inactive-admin', now(), null);

insert into public.workspaces (id, name, owner_id, created_by) values
  ('b2000000-0000-4000-8000-000000000001', 'Fictional module workspace', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'Fictional isolated workspace', 'b1000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000007');

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at
) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'owner', 'active', 'b1000000-0000-4000-8000-000000000001', now()),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'member', 'active', 'b1000000-0000-4000-8000-000000000001', now()),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'member', 'active', 'b1000000-0000-4000-8000-000000000001', now()),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004', 'member', 'active', 'b1000000-0000-4000-8000-000000000001', now()),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000005', 'admin', 'active', 'b1000000-0000-4000-8000-000000000001', now()),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000008', 'member', 'active', 'b1000000-0000-4000-8000-000000000001', now()),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000009', 'member', 'active', 'b1000000-0000-4000-8000-000000000001', now()),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000007', 'owner', 'active', 'b1000000-0000-4000-8000-000000000007', now());

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at, disabled_at
) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000010', 'admin', 'suspended', 'b1000000-0000-4000-8000-000000000001', now(), now()),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000011', 'admin', 'active', 'b1000000-0000-4000-8000-000000000001', now(), null);

insert into public.projects (
  id, workspace_id, name, status, owner_id, lead_id, created_by,
  idempotency_key, archived_at
) values
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Fictional module operations', 'active', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', null),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'Fictional admin managed project', 'active', 'b1000000-0000-4000-8000-000000000001', null, 'b1000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000002', null),
  ('b3000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'Fictional archived modules', 'archived', 'b1000000-0000-4000-8000-000000000001', null, 'b1000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000003', now()),
  ('b3000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000002', 'Fictional other project', 'active', 'b1000000-0000-4000-8000-000000000007', null, 'b1000000-0000-4000-8000-000000000007', 'b4000000-0000-4000-8000-000000000004', null);

insert into public.project_members (project_id, user_id, role) values
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'owner'),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'lead'),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'member'),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004', 'viewer'),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000008', 'member'),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000009', 'member'),
  ('b3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'owner'),
  ('b3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'owner'),
  ('b3000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000007', 'owner');

insert into public.project_modules (
  id, project_id, name, sort_position, created_by, updated_by
) values
  ('b5000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'Fictional Alpha', 0, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000001', 'Fictional Beta', 1, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000003', 'b3000000-0000-4000-8000-000000000001', 'Fictional Gamma', 2, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000004', 'b3000000-0000-4000-8000-000000000002', 'Fictional Admin Module', 0, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000005', 'b3000000-0000-4000-8000-000000000003', 'Fictional Archived Module', 0, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000006', 'b3000000-0000-4000-8000-000000000004', 'Fictional Other Module', 0, 'b1000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000007');

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_project_modules('b3000000-0000-4000-8000-000000000001') $sql$), '42501', 'anon cannot execute module list');
select is(pg_temp.sqlstate_of($sql$ select name from public.project_modules $sql$), '42501', 'anon cannot read module table');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_module('b3000000-0000-4000-8000-000000000001', 'Denied') $sql$), '42501', 'anon cannot execute module writes');
reset role;

set local "request.jwt.claims" = '{"sub":"module-owner","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_modules('b3000000-0000-4000-8000-000000000001')), 3::bigint, 'project owner lists active modules');
select is((select count(name) from public.project_modules where project_id = 'b3000000-0000-4000-8000-000000000001'), 3::bigint, 'module RLS lets owner read active rows');
select is(
  (select name from public.add_project_module('b3000000-0000-4000-8000-000000000001', E'  New\tModule  ') where module_id not in (
    'b5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000003'
  )),
  'New Module',
  'add normalizes whitespace and returns the new active list'
);
select pg_catalog.set_config(
  'test.added_module_id',
  (select module_id::text from public.list_project_modules('b3000000-0000-4000-8000-000000000001') where name = 'New Module'),
  true
);
select is(
  (select sort_position from public.list_project_modules('b3000000-0000-4000-8000-000000000001') where module_id = current_setting('test.added_module_id')::uuid),
  3,
  'new module is automatically appended'
);
select is(
  (select created_by from public.list_project_modules('b3000000-0000-4000-8000-000000000001') where module_id = current_setting('test.added_module_id')::uuid),
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'module actor is derived from current_app_user_id'
);
select is(pg_temp.sqlstate_of($sql$
  select * from public.add_project_module('b3000000-0000-4000-8000-000000000001', 'new module')
$sql$), '23505', 'case-only duplicate module name is rejected with a stable conflict');
select is(pg_temp.sqlstate_of($sql$
  select * from public.add_project_module('b3000000-0000-4000-8000-000000000001', '   ')
$sql$), '22023', 'blank add is rejected');
select is(pg_temp.sqlstate_of($sql$
  select * from public.add_project_module('b3000000-0000-4000-8000-000000000001', repeat('x', 121))
$sql$), '22023', 'overlong add is rejected');
select is(
  (select name from public.rename_project_module(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000002',
    '  Renamed   Module '
  ) where module_id = 'b5000000-0000-4000-8000-000000000002'),
  'Renamed Module',
  'rename applies the canonical name normalization'
);
select is(pg_temp.sqlstate_of($sql$
  select * from public.rename_project_module(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000001',
    'renamed module'
  )
$sql$), '23505', 'rename cannot create a normalized duplicate');
select is(pg_temp.sqlstate_of($sql$
  select * from public.rename_project_module(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000006',
    'Cross Project'
  )
$sql$), '42501', 'rename cannot target a module from another project');

select lives_ok(format(
  $sql$select * from public.reorder_project_modules(
    'b3000000-0000-4000-8000-000000000001',
    array[%L::uuid,%L::uuid,%L::uuid,%L::uuid]
  )$sql$,
  current_setting('test.added_module_id'),
  'b5000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000002',
  'b5000000-0000-4000-8000-000000000003'
), 'owner atomically submits a complete reordered module set');
select is(
  (select array_agg(module_id order by sort_position) from public.list_project_modules('b3000000-0000-4000-8000-000000000001')),
  array[
    current_setting('test.added_module_id')::uuid,
    'b5000000-0000-4000-8000-000000000001'::uuid,
    'b5000000-0000-4000-8000-000000000002'::uuid,
    'b5000000-0000-4000-8000-000000000003'::uuid
  ],
  'reorder persists the exact submitted order'
);
select is(
  (select array_agg(sort_position order by sort_position) from public.list_project_modules('b3000000-0000-4000-8000-000000000001')),
  array[0,1,2,3]::integer[],
  'reorder normalizes positions to a continuous zero-based sequence'
);
select is(pg_temp.sqlstate_of(format(
  $sql$select * from public.reorder_project_modules('b3000000-0000-4000-8000-000000000001', array[%L::uuid,%L::uuid,%L::uuid,%L::uuid])$sql$,
  current_setting('test.added_module_id'), current_setting('test.added_module_id'),
  'b5000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000003'
)), '22023', 'reorder rejects duplicate ids');
select is(pg_temp.sqlstate_of(format(
  $sql$select * from public.reorder_project_modules('b3000000-0000-4000-8000-000000000001', array[%L::uuid,%L::uuid,%L::uuid])$sql$,
  current_setting('test.added_module_id'), 'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000002'
)), '22023', 'reorder rejects an incomplete list');
select is(pg_temp.sqlstate_of(format(
  $sql$select * from public.reorder_project_modules('b3000000-0000-4000-8000-000000000001', array[%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid])$sql$,
  current_setting('test.added_module_id'), 'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000002',
  'b5000000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000006'
)), '22023', 'reorder rejects extra and cross-project ids');
select is(pg_temp.sqlstate_of($sql$
  select * from public.reorder_project_modules('b3000000-0000-4000-8000-000000000001', null)
$sql$), '22023', 'reorder rejects a null list');

select is(
  (select count(*) from public.delete_project_module(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000002'
  )),
  3::bigint,
  'controlled delete returns only the three remaining active modules'
);
select is(
  (select array_agg(sort_position order by sort_position) from public.list_project_modules('b3000000-0000-4000-8000-000000000001')),
  array[0,1,2]::integer[],
  'delete compacts remaining positions in the same transaction'
);
select is(pg_temp.deleted_module_count('b3000000-0000-4000-8000-000000000001'), 1::bigint, 'controlled delete retains one immutable history row');
select is(pg_temp.module_history_count('b3000000-0000-4000-8000-000000000001'), 4::bigint, 'controlled delete does not physically delete the module');
select is((select count(name) from public.project_modules where project_id = 'b3000000-0000-4000-8000-000000000001'), 3::bigint, 'RLS hides deleted module history');
select is(pg_temp.sqlstate_of(format(
  $sql$select * from public.reorder_project_modules('b3000000-0000-4000-8000-000000000001', array[%L::uuid,%L::uuid,%L::uuid])$sql$,
  current_setting('test.added_module_id'), 'b5000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000003'
)), '22023', 'deleted module ids cannot re-enter active ordering');
select is(pg_temp.sqlstate_of($sql$
  insert into public.project_modules (project_id, name, sort_position, created_by, updated_by)
  values ('b3000000-0000-4000-8000-000000000001', 'Direct Insert', 9, 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001')
$sql$), '42501', 'owner cannot bypass add RPC with direct insert');
select is(pg_temp.sqlstate_of($sql$
  update public.project_modules set name = 'Direct Rename' where id = 'b5000000-0000-4000-8000-000000000001'
$sql$), '42501', 'owner cannot bypass rename RPC with direct update');
select is(pg_temp.sqlstate_of($sql$
  delete from public.project_modules where id = 'b5000000-0000-4000-8000-000000000001'
$sql$), '42501', 'owner cannot bypass delete RPC with direct delete');
reset role;

set local "request.jwt.claims" = '{"sub":"module-lead","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_modules('b3000000-0000-4000-8000-000000000001')), 3::bigint, 'lead reads project modules');
select is((select count(*) from public.add_project_module('b3000000-0000-4000-8000-000000000001', 'Lead Added Module')), 4::bigint, 'lead can add modules under inherited management rules');
reset role;

set local "request.jwt.claims" = '{"sub":"module-member","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_modules('b3000000-0000-4000-8000-000000000001')), 4::bigint, 'member reads active modules');
select is((select count(name) from public.project_modules where project_id = 'b3000000-0000-4000-8000-000000000001'), 4::bigint, 'member RLS read succeeds');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_module('b3000000-0000-4000-8000-000000000001', 'Member Denied') $sql$), '42501', 'member cannot add modules');
select is(pg_temp.sqlstate_of($sql$ select * from public.reorder_project_modules('b3000000-0000-4000-8000-000000000001', array[]::uuid[]) $sql$), '42501', 'member cannot reorder modules');
select is(pg_temp.sqlstate_of($sql$ select * from public.delete_project_module('b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001') $sql$), '42501', 'member cannot delete modules');
select is(pg_temp.sqlstate_of($sql$ select public.lock_workspace_project_creator('b2000000-0000-4000-8000-000000000001') $sql$), '42501', 'authenticated browser cannot directly execute the project creator lock helper');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional denied member create', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000011', true
  )
$sql$), '42501', 'active workspace member without owner or admin role is rejected after the creator lock');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000011'), 0::bigint, 'denied member create leaves no project');
select is(pg_temp.project_member_count_for_key('b6000000-0000-4000-8000-000000000011'), 0::bigint, 'denied member create leaves no project owner relation');
select is(pg_temp.project_module_count_for_key('b6000000-0000-4000-8000-000000000011'), 0::bigint, 'denied member preset create leaves no modules');

set local "request.jwt.claims" = '{"sub":"module-viewer","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_modules('b3000000-0000-4000-8000-000000000001')), 4::bigint, 'viewer reads active modules');
select is(pg_temp.sqlstate_of($sql$ select * from public.rename_project_module('b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'Viewer Denied') $sql$), '42501', 'viewer cannot rename modules');
reset role;

set local "request.jwt.claims" = '{"sub":"module-admin","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_modules('b3000000-0000-4000-8000-000000000002')), 1::bigint, 'workspace admin reads a project without direct project membership');
select is((select count(*) from public.add_project_module('b3000000-0000-4000-8000-000000000002', 'Admin Added Module')), 2::bigint, 'workspace admin management strictly inherits current project rules');
select is((select count(*) from public.create_project(
  'b2000000-0000-4000-8000-000000000001', 'Fictional admin locked create', null,
  'operations', 'planning', null, null,
  'b6000000-0000-4000-8000-000000000016', false
)), 1::bigint, 'active workspace admin remains authorized after creator locks are acquired');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000016'), 1::bigint, 'authorized admin create persists exactly one project');

set local "request.jwt.claims" = '{"sub":"module-suspended-admin","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional suspended member create', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000012', true
  )
$sql$), '42501', 'suspended workspace admin is rejected by lock-after-auth create boundary');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000012'), 0::bigint, 'suspended workspace member leaves no project');
select is(pg_temp.project_member_count_for_key('b6000000-0000-4000-8000-000000000012'), 0::bigint, 'suspended workspace member leaves no project relation');
select is(pg_temp.project_module_count_for_key('b6000000-0000-4000-8000-000000000012'), 0::bigint, 'suspended workspace member leaves no preset modules');

set local "request.jwt.claims" = '{"sub":"module-inactive-admin","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional inactive app create', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000013'
  )
$sql$), '42501', 'inactive app user is rejected through the legacy eight-argument wrapper');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000013'), 0::bigint, 'inactive app user leaves no project');
select is(pg_temp.project_member_count_for_key('b6000000-0000-4000-8000-000000000013'), 0::bigint, 'inactive app user leaves no project relation');
select is(pg_temp.project_module_count_for_key('b6000000-0000-4000-8000-000000000013'), 0::bigint, 'legacy denied create leaves no modules');

set local "request.jwt.claims" = '{"sub":"module-revoked","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional revoked identity create', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000014', true
  )
$sql$), '42501', 'revoked identity cannot enter the project creator lock boundary');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000014'), 0::bigint, 'revoked identity leaves no project');
select is(pg_temp.project_member_count_for_key('b6000000-0000-4000-8000-000000000014'), 0::bigint, 'revoked identity leaves no project relation');
select is(pg_temp.project_module_count_for_key('b6000000-0000-4000-8000-000000000014'), 0::bigint, 'revoked identity leaves no preset modules');

set local "request.jwt.claims" = '{"sub":"module-outsider","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_project_modules('b3000000-0000-4000-8000-000000000001') $sql$), '42501', 'workspace outsider cannot list modules');
select is((select count(name) from public.project_modules), 0::bigint, 'workspace outsider RLS reads no modules');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_module('b3000000-0000-4000-8000-000000000001', 'Outsider Denied') $sql$), '42501', 'workspace outsider cannot mutate guessed project modules');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional outsider create', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000015', true
  )
$sql$), '42501', 'unauthorized existing workspace returns the generic project permission state');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000015'), 0::bigint, 'outsider create leaves no project');

set local "request.jwt.claims" = '{"sub":"module-owner","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-00000000ffff', 'Fictional missing workspace create', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000017', true
  )
$sql$), '42501', 'missing workspace returns the same generic project permission state');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000017'), 0::bigint, 'missing workspace create leaves no project');

set local "request.jwt.claims" = '{"sub":"module-other-owner","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_modules('b3000000-0000-4000-8000-000000000004')), 1::bigint, 'other workspace owner reads own modules');
select is(pg_temp.sqlstate_of($sql$ select * from public.list_project_modules('b3000000-0000-4000-8000-000000000001') $sql$), '42501', 'other workspace owner cannot list cross-workspace modules');
select is((select count(name) from public.project_modules), 1::bigint, 'other workspace owner RLS sees only own project modules');
select is(pg_temp.sqlstate_of($sql$ select * from public.rename_project_module('b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000006', 'Cross Workspace') $sql$), '42501', 'cross-workspace module id cannot be used against another project');
reset role;

set local "request.jwt.claims" = '{"sub":"module-owner","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_modules('b3000000-0000-4000-8000-000000000003')), 1::bigint, 'archived project modules remain readable');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_module('b3000000-0000-4000-8000-000000000003', 'Archived Denied') $sql$), '55000', 'archived project rejects module add');
select is(pg_temp.sqlstate_of($sql$ select * from public.reorder_project_modules('b3000000-0000-4000-8000-000000000003', array['b5000000-0000-4000-8000-000000000005'::uuid]) $sql$), '55000', 'archived project rejects module reorder');
select is(pg_temp.sqlstate_of($sql$ select * from public.delete_project_module('b3000000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000005') $sql$), '55000', 'archived project rejects module delete');
reset role;

-- Removing a project membership immediately removes read access even though
-- the user remains an active workspace member and active app user.
delete from public.project_members
where project_id = 'b3000000-0000-4000-8000-000000000001'
  and user_id = 'b1000000-0000-4000-8000-000000000009';
set local "request.jwt.claims" = '{"sub":"module-removable","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_project_modules('b3000000-0000-4000-8000-000000000001') $sql$), '42501', 'removed project member immediately loses module RPC reads');
select is((select count(name) from public.project_modules), 0::bigint, 'removed project member immediately loses module RLS reads');
reset role;

-- A plain viewer may be suspended without violating owner/lead responsibility.
update public.app_users
set status = 'suspended', disabled_at = now()
where id = 'b1000000-0000-4000-8000-000000000004';
set local "request.jwt.claims" = '{"sub":"module-viewer","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_project_modules('b3000000-0000-4000-8000-000000000001') $sql$), '42501', 'suspended app user immediately loses module RPC reads');
select is((select count(name) from public.project_modules), 0::bigint, 'suspended app user immediately loses module RLS reads');
reset role;

set local "request.jwt.claims" = '{"sub":"module-revoked","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_project_modules('b3000000-0000-4000-8000-000000000001') $sql$), '42501', 'revoked identity cannot list modules');
select is((select count(name) from public.project_modules), 0::bigint, 'revoked identity reads no module rows');
reset role;

-- The active workspace owner remains authorized after the creator locks, and
-- project creation plus preset insertion are one idempotent transaction. Tests
-- compare created rows to the authoritative preset function instead of
-- maintaining a second copy of names.
set local "request.jwt.claims" = '{"sub":"module-owner","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select pg_catalog.set_config(
  'test.preset_project_id',
  (select project_id::text from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional preset project', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000001', true
  )),
  true
);
select is(
  (select count(*) from public.list_project_modules(current_setting('test.preset_project_id')::uuid)),
  pg_temp.preset_count(),
  'workspace owner remains authorized after creator locks and atomically creates every authoritative preset module'
);
select is(
  pg_temp.preset_match_count(current_setting('test.preset_project_id')::uuid),
  pg_temp.preset_count(),
  'created preset names and order exactly match the one database authority'
);
select is(
  (select was_existing from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional preset project', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000001', true
  )),
  true,
  'identical preset-aware retry returns the existing project'
);
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional preset project', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000001', false
  )
$sql$), '23505', 'same idempotency key with a different preset choice is rejected');
select pg_catalog.set_config(
  'test.no_preset_project_id',
  (select project_id::text from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional no-preset project', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000002', false
  )),
  true
);
select is((select count(*) from public.list_project_modules(current_setting('test.no_preset_project_id')::uuid)), 0::bigint, 'explicitly unselected preset creates no modules');
select pg_catalog.set_config(
  'test.legacy_project_id',
  (select project_id::text from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional legacy project', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000003'
  )),
  true
);
select is((select count(*) from public.list_project_modules(current_setting('test.legacy_project_id')::uuid)), 0::bigint, 'legacy eight-argument create preserves no-preset behavior');
reset role;

create function pg_temp.reject_preset_module()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('test.reject_preset_module', true) = '1'
     and new.sort_position = 2
  then
    raise exception 'fixture_preset_module_failure' using errcode = '55000';
  end if;
  return new;
end;
$function$;

create trigger fixture_reject_preset_module
  before insert on public.project_modules
  for each row execute function pg_temp.reject_preset_module();

select pg_catalog.set_config('test.reject_preset_module', '1', true);
set local "request.jwt.claims" = '{"sub":"module-owner","iss":"https://module-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    'b2000000-0000-4000-8000-000000000001', 'Fictional atomic failure', null,
    'operations', 'planning', null, null,
    'b6000000-0000-4000-8000-000000000099', true
  )
$sql$), '55000', 'preset module failure aborts create_project');
reset role;
select is(pg_temp.project_count_for_key('b6000000-0000-4000-8000-000000000099'), 0::bigint, 'failed preset initialization leaves no project row');
select is((select count(*) from public.project_modules where project_id in (select id from public.projects where idempotency_key = 'b6000000-0000-4000-8000-000000000099')), 0::bigint, 'failed preset initialization leaves no partial module rows');

select * from finish();
rollback;
