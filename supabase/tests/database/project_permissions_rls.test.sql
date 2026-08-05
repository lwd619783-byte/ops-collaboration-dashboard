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

create function pg_temp.project_count_for_key(p_workspace_id uuid, p_user_id uuid, p_key uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*)
  from public.projects
  where workspace_id = p_workspace_id
    and created_by = p_user_id
    and idempotency_key = p_key;
$function$;

create function pg_temp.project_owner_relation_count(p_project_id uuid, p_user_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*)
  from public.project_members
  where project_id = p_project_id and user_id = p_user_id and role = 'owner';
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.project_count_for_key(uuid, uuid, uuid) to public;
grant execute on function pg_temp.project_owner_relation_count(uuid, uuid) to public;

select plan(67);

insert into public.app_users (id, status, disabled_at) values
  ('71000000-0000-4000-8000-000000000001', 'active', null),
  ('71000000-0000-4000-8000-000000000002', 'active', null),
  ('71000000-0000-4000-8000-000000000003', 'active', null),
  ('71000000-0000-4000-8000-000000000004', 'active', null),
  ('71000000-0000-4000-8000-000000000005', 'active', null),
  ('71000000-0000-4000-8000-000000000006', 'suspended', now()),
  ('71000000-0000-4000-8000-000000000007', 'active', null),
  ('71000000-0000-4000-8000-000000000008', 'active', null),
  ('71000000-0000-4000-8000-000000000009', 'active', null),
  ('71000000-0000-4000-8000-000000000010', 'active', null);

insert into public.profiles (user_id, display_name) values
  ('71000000-0000-4000-8000-000000000001', 'Fixture Owner A'),
  ('71000000-0000-4000-8000-000000000002', 'Fixture Admin A'),
  ('71000000-0000-4000-8000-000000000003', 'Fixture Member A'),
  ('71000000-0000-4000-8000-000000000004', 'Fixture External A'),
  ('71000000-0000-4000-8000-000000000005', 'Fixture Suspended Member'),
  ('71000000-0000-4000-8000-000000000006', 'Fixture Suspended User'),
  ('71000000-0000-4000-8000-000000000007', 'Fixture Outsider'),
  ('71000000-0000-4000-8000-000000000008', 'Fixture Owner B'),
  ('71000000-0000-4000-8000-000000000009', 'Fixture Revoked Identity'),
  ('71000000-0000-4000-8000-000000000010', 'Fixture Unbound User');

insert into public.user_identities (
  user_id, provider, provider_tenant, provider_subject, verified_at, revoked_at
) values
  ('71000000-0000-4000-8000-000000000001', 'supabase_auth', 'https://project-fixture.invalid', 'owner-a', now(), null),
  ('71000000-0000-4000-8000-000000000002', 'supabase_auth', 'https://project-fixture.invalid', 'admin-a', now(), null),
  ('71000000-0000-4000-8000-000000000003', 'supabase_auth', 'https://project-fixture.invalid', 'member-a', now(), null),
  ('71000000-0000-4000-8000-000000000004', 'supabase_auth', 'https://project-fixture.invalid', 'external-a', now(), null),
  ('71000000-0000-4000-8000-000000000005', 'supabase_auth', 'https://project-fixture.invalid', 'suspended-member-a', now(), null),
  ('71000000-0000-4000-8000-000000000006', 'supabase_auth', 'https://project-fixture.invalid', 'suspended-user-a', now(), null),
  ('71000000-0000-4000-8000-000000000007', 'supabase_auth', 'https://project-fixture.invalid', 'outsider-a', now(), null),
  ('71000000-0000-4000-8000-000000000008', 'supabase_auth', 'https://project-fixture.invalid', 'owner-b', now(), null),
  ('71000000-0000-4000-8000-000000000009', 'supabase_auth', 'https://project-fixture.invalid', 'revoked-a', now(), now());

insert into public.workspaces (id, name, owner_id, created_by) values
  (
    '72000000-0000-4000-8000-000000000001', 'Fixture Workspace A',
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001'
  ),
  (
    '72000000-0000-4000-8000-000000000002', 'Fixture Workspace B',
    '71000000-0000-4000-8000-000000000008',
    '71000000-0000-4000-8000-000000000008'
  );

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at, disabled_at
) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'owner', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'admin', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'member', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004', 'external_collaborator', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000005', 'member', 'suspended', '71000000-0000-4000-8000-000000000001', now(), now()),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000006', 'member', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000009', 'member', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000010', 'member', 'active', '71000000-0000-4000-8000-000000000001', now(), null),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000008', 'owner', 'active', '71000000-0000-4000-8000-000000000008', now(), null);

insert into public.projects (
  id, workspace_id, name, description, status, owner_id, created_by,
  idempotency_key, archived_at
) values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Member Visible', 'Joined by member', 'active', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', null),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'Member Hidden', 'Not joined', 'active', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002', null),
  ('73000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', 'External Visible', 'Joined by external', 'active', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000003', null),
  ('73000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000001', 'Completed Fixture', 'Ready to archive', 'completed', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000004', null),
  ('73000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000001', 'Archived Fixture', 'Already archived', 'archived', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000005', now()),
  ('73000000-0000-4000-8000-000000000006', '72000000-0000-4000-8000-000000000001', 'Planning Fixture', 'Editable by admins', 'planning', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000006', null),
  ('73000000-0000-4000-8000-000000000007', '72000000-0000-4000-8000-000000000002', 'Workspace B Fixture', 'Isolated project', 'active', '71000000-0000-4000-8000-000000000008', '71000000-0000-4000-8000-000000000008', '74000000-0000-4000-8000-000000000007', null);

insert into public.project_members (project_id, user_id, role) values
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'owner'),
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'member'),
  ('73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', 'owner'),
  ('73000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', 'owner'),
  ('73000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000004', 'viewer'),
  ('73000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000001', 'owner'),
  ('73000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000001', 'owner'),
  ('73000000-0000-4000-8000-000000000006', '71000000-0000-4000-8000-000000000001', 'owner'),
  ('73000000-0000-4000-8000-000000000007', '71000000-0000-4000-8000-000000000008', 'owner');

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_projects('72000000-0000-4000-8000-000000000001') $sql$), '42501', 'anon cannot execute project list RPC');
select is(pg_temp.sqlstate_of($sql$ select * from public.projects $sql$), '42501', 'anon cannot directly read projects');
reset role;

set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000001')), 5::bigint, 'workspace owner lists every current project');
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000001', true)), 1::bigint, 'workspace owner lists archived projects explicitly');
select is((select count(*) from public.projects where workspace_id = '72000000-0000-4000-8000-000000000001'), 6::bigint, 'project RLS lets the workspace owner read all rows');
select is((select name from public.get_project('73000000-0000-4000-8000-000000000002')), 'Member Hidden', 'workspace owner reads any project detail in the workspace');
select pg_catalog.set_config(
  'test.owner_project_id',
  (select project_id::text from public.create_project(
    '72000000-0000-4000-8000-000000000001', '  Created By Owner  ',
    ' Safe description ', 'operations', 'planning', date '2026-08-04', date '2026-08-20',
    '75000000-0000-4000-8000-000000000001'
  )), true
);
select is(
  (select name from public.get_project(current_setting('test.owner_project_id')::uuid)),
  'Created By Owner',
  'owner creates a trimmed project and immediately reads its safe detail'
);
select is(
  (select owner_id = created_by from public.get_project(current_setting('test.owner_project_id')::uuid)),
  true,
  'create_project derives owner and creator from the current internal user'
);
select is(
  pg_temp.project_owner_relation_count(current_setting('test.owner_project_id')::uuid, '71000000-0000-4000-8000-000000000001'),
  1::bigint,
  'create_project atomically creates the owner relationship'
);
select is(
  (select project_id::text from public.create_project(
    '72000000-0000-4000-8000-000000000001', 'Created By Owner',
    'Safe description', 'operations', 'planning', date '2026-08-04', date '2026-08-20',
    '75000000-0000-4000-8000-000000000001'
  )),
  current_setting('test.owner_project_id'),
  'same actor workspace and key returns the original project'
);
select is(
  (select was_existing from public.create_project(
    '72000000-0000-4000-8000-000000000001', 'Created By Owner',
    'Safe description', 'operations', 'planning', date '2026-08-04', date '2026-08-20',
    '75000000-0000-4000-8000-000000000001'
  )),
  true,
  'an identical create retry is marked as an existing result'
);
select is(
  pg_temp.project_count_for_key('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001'),
  1::bigint,
  'an identical create retry never duplicates the project'
);
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    '72000000-0000-4000-8000-000000000001', 'Changed Payload',
    'Safe description', 'operations', 'planning', date '2026-08-04', date '2026-08-20',
    '75000000-0000-4000-8000-000000000001'
  )
$sql$), '23505', 'same idempotency key with changed input is rejected');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    '72000000-0000-4000-8000-000000000001', 'Invalid Initial State',
    null, 'operations', 'completed', null, null,
    '75000000-0000-4000-8000-000000000002'
  )
$sql$), '22023', 'creation only accepts planning or active initial status');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    '72000000-0000-4000-8000-000000000001', 'Invalid Dates',
    null, 'operations', 'planning', date '2026-08-20', date '2026-08-04',
    '75000000-0000-4000-8000-000000000003'
  )
$sql$), '22023', 'create_project rejects an invalid date range');
select is(pg_temp.sqlstate_of($sql$
  select idempotency_key from public.projects where id = '73000000-0000-4000-8000-000000000001'
$sql$), '42501', 'workspace owner cannot directly read idempotency_key');
reset role;

set local "request.jwt.claims" = '{"sub":"admin-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select pg_catalog.set_config(
  'test.admin_project_id',
  (select project_id::text from public.create_project(
    '72000000-0000-4000-8000-000000000001', 'Created By Admin', null,
    'operations', 'active', null, null,
    '75000000-0000-4000-8000-000000000001'
  )), true
);
select is(
  (select owner_id from public.get_project(current_setting('test.admin_project_id')::uuid)),
  '71000000-0000-4000-8000-000000000002'::uuid,
  'workspace admin can create and becomes project owner'
);
select is(
  pg_temp.project_owner_relation_count(current_setting('test.admin_project_id')::uuid, '71000000-0000-4000-8000-000000000002'),
  1::bigint,
  'admin creation initializes exactly one admin-owned project relationship'
);
select isnt(
  current_setting('test.admin_project_id'),
  current_setting('test.owner_project_id'),
  'the same idempotency key is scoped to the current actor'
);
select is(
  (select status::text from public.update_project(
    '73000000-0000-4000-8000-000000000006', 'Updated By Admin',
    'Edited safely', 'active', null, null,
    (select updated_at from public.projects where id = '73000000-0000-4000-8000-000000000006')
  )),
  'active',
  'workspace admin performs a legal optimistic edit'
);
select is(pg_temp.sqlstate_of($sql$
  select * from public.update_project(
    '73000000-0000-4000-8000-000000000006', 'Stale Edit', null,
    'active', null, null, timestamptz '2000-01-01 00:00:00+00'
  )
$sql$), '40001', 'stale optimistic edit is rejected');
reset role;

set local "request.jwt.claims" = '{"sub":"member-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000001')), 1::bigint, 'member lists only joined current projects');
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000001', true)), 0::bigint, 'member cannot infer unjoined archived projects');
select is((select count(*) from public.projects where workspace_id = '72000000-0000-4000-8000-000000000001'), 1::bigint, 'project table RLS limits member reads to joined projects');
select is((select count(*) from public.projects where id = '73000000-0000-4000-8000-000000000001' and name is not null), 1::bigint, 'member reads reviewed columns of a joined project directly');
select is((select count(*) from public.get_project('73000000-0000-4000-8000-000000000002')), 0::bigint, 'member detail for an unjoined project returns no row');
select is((select count(*) from public.get_project('73000000-0000-4000-8000-00000000ffff')), 0::bigint, 'guessed project UUID returns the same empty result');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project('72000000-0000-4000-8000-000000000001', 'Denied', null, 'operations', 'planning', null, null, '75000000-0000-4000-8000-000000000010')
$sql$), '42501', 'member cannot create projects');
select is(pg_temp.sqlstate_of($sql$
  select * from public.update_project('73000000-0000-4000-8000-000000000001', 'Denied', null, 'active', null, null, (select updated_at from public.projects where id = '73000000-0000-4000-8000-000000000001'))
$sql$), '42501', 'member cannot edit projects even when joined');
select is(pg_temp.sqlstate_of($sql$
  select * from public.archive_project('73000000-0000-4000-8000-000000000004', now())
$sql$), '42501', 'member cannot archive projects');
select is((select count(*) from public.get_project(current_setting('test.owner_project_id')::uuid)), 0::bigint, 'another user cannot reuse an idempotency key to discover its project');
reset role;

set local "request.jwt.claims" = '{"sub":"external-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000001')), 1::bigint, 'external collaborator lists only joined projects');
select is((select count(*) from public.projects where workspace_id = '72000000-0000-4000-8000-000000000001'), 1::bigint, 'project RLS limits external collaborator reads');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project('72000000-0000-4000-8000-000000000001', 'Denied External', null, 'operations', 'planning', null, null, '75000000-0000-4000-8000-000000000011')
$sql$), '42501', 'external collaborator cannot create projects');
reset role;

set local "request.jwt.claims" = '{"sub":"outsider-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_projects('72000000-0000-4000-8000-000000000001') $sql$), '42501', 'non-member cannot list a workspace');
select is((select count(*) from public.projects), 0::bigint, 'non-member reads no projects through RLS');
select is((select count(*) from public.get_project('73000000-0000-4000-8000-000000000001')), 0::bigint, 'non-member gets no project detail');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project('72000000-0000-4000-8000-000000000001', 'Denied Outsider', null, 'operations', 'planning', null, null, '75000000-0000-4000-8000-000000000012')
$sql$), '42501', 'non-member cannot create projects');
reset role;

set local "request.jwt.claims" = '{"sub":"suspended-member-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_projects('72000000-0000-4000-8000-000000000001') $sql$), '42501', 'suspended workspace member cannot list projects');
select is((select count(*) from public.projects), 0::bigint, 'suspended workspace member reads no projects');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project('72000000-0000-4000-8000-000000000001', 'Denied Suspended Member', null, 'operations', 'planning', null, null, '75000000-0000-4000-8000-000000000013')
$sql$), '42501', 'suspended workspace member cannot create projects');
reset role;

set local "request.jwt.claims" = '{"sub":"suspended-user-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_projects('72000000-0000-4000-8000-000000000001') $sql$), '42501', 'suspended app user cannot list projects');
select is((select count(*) from public.projects), 0::bigint, 'suspended app user reads no projects');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project('72000000-0000-4000-8000-000000000001', 'Denied Suspended User', null, 'operations', 'planning', null, null, '75000000-0000-4000-8000-000000000014')
$sql$), '42501', 'suspended app user cannot create projects');
reset role;

set local "request.jwt.claims" = '{"sub":"revoked-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_projects('72000000-0000-4000-8000-000000000001') $sql$), '42501', 'revoked identity cannot list projects');
select is((select count(*) from public.projects), 0::bigint, 'revoked identity reads no projects');
reset role;

set local "request.jwt.claims" = '{"sub":"unbound-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_projects('72000000-0000-4000-8000-000000000001') $sql$), '42501', 'unbound identity cannot list projects');
select is((select count(*) from public.projects), 0::bigint, 'unbound identity reads no projects');
reset role;

set local "request.jwt.claims" = '{"sub":"owner-b","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000002')), 1::bigint, 'workspace B owner lists workspace B projects');
select is((select count(*) from public.projects), 1::bigint, 'workspace B owner reads only workspace B through RLS');
select is((select count(*) from public.get_project('73000000-0000-4000-8000-000000000001')), 0::bigint, 'cross-workspace detail is hidden');
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project('72000000-0000-4000-8000-000000000001', 'Cross Workspace Denied', null, 'operations', 'planning', null, null, '75000000-0000-4000-8000-000000000001')
$sql$), '42501', 'another workspace owner cannot create in workspace A');
select isnt(
  (select project_id::text from public.create_project(
    '72000000-0000-4000-8000-000000000002', 'Workspace B Same Key', null,
    'operations', 'planning', null, null,
    '75000000-0000-4000-8000-000000000001'
  )),
  current_setting('test.owner_project_id'),
  'the same key in another workspace creates an isolated project, not a disclosure'
);
reset role;

set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select pg_catalog.set_config(
  'test.archived_updated_at',
  (select updated_at::text from public.archive_project(
    '73000000-0000-4000-8000-000000000004',
    (select updated_at from public.projects where id = '73000000-0000-4000-8000-000000000004')
  )), true
);
select is((select status::text from public.get_project('73000000-0000-4000-8000-000000000004')), 'archived', 'completed project archives successfully');
select ok((select archived_at is not null from public.get_project('73000000-0000-4000-8000-000000000004')), 'archive_project atomically records archived_at');
select is(
  (select updated_at::text from public.archive_project('73000000-0000-4000-8000-000000000004', timestamptz '2000-01-01 00:00:00+00')),
  current_setting('test.archived_updated_at'),
  'repeated archive is idempotent even with the original stale version'
);
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000001') where project_id = '73000000-0000-4000-8000-000000000004'), 0::bigint, 'archived project disappears from the default list');
select is((select count(*) from public.list_projects('72000000-0000-4000-8000-000000000001', true) where project_id = '73000000-0000-4000-8000-000000000004'), 1::bigint, 'archived project appears in the explicit archive filter');
select is(pg_temp.sqlstate_of($sql$
  select * from public.update_project('73000000-0000-4000-8000-000000000004', 'No Edit', null, 'archived', null, null, (select updated_at from public.projects where id = '73000000-0000-4000-8000-000000000004'))
$sql$), '55000', 'archived project rejects ordinary edit');
select is(pg_temp.sqlstate_of($sql$
  select * from public.archive_project('73000000-0000-4000-8000-000000000002', (select updated_at from public.projects where id = '73000000-0000-4000-8000-000000000002'))
$sql$), '55000', 'non-completed project cannot be archived');
select is(pg_temp.sqlstate_of($sql$
  select * from public.update_project('73000000-0000-4000-8000-000000000002', 'Illegal Transition', null, 'planning', null, null, (select updated_at from public.projects where id = '73000000-0000-4000-8000-000000000002'))
$sql$), '55000', 'ordinary update cannot bypass the status machine');
select is(pg_temp.sqlstate_of($sql$ update public.projects set created_by = '71000000-0000-4000-8000-000000000002' where id = '73000000-0000-4000-8000-000000000002' $sql$), '42501', 'browser cannot forge immutable project fields by direct update');
select is(pg_temp.sqlstate_of($sql$ delete from public.projects where id = '73000000-0000-4000-8000-000000000002' $sql$), '42501', 'browser has no project physical delete capability');
reset role;

create function pg_temp.reject_project_owner_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('test.reject_project_owner_insert', true) = '1' then
    raise exception 'fixture_project_member_failure' using errcode = '55000';
  end if;
  return new;
end;
$function$;

create trigger fixture_reject_project_owner_insert
  before insert on public.project_members
  for each row execute function pg_temp.reject_project_owner_insert();

select pg_catalog.set_config('test.reject_project_owner_insert', '1', true);
set local "request.jwt.claims" = '{"sub":"owner-a","iss":"https://project-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$
  select * from public.create_project(
    '72000000-0000-4000-8000-000000000001', 'Atomic Failure Fixture', null,
    'operations', 'planning', null, null,
    '75000000-0000-4000-8000-000000000099'
  )
$sql$), '55000', 'project member initialization failure aborts create_project');
reset role;
select is(
  pg_temp.project_count_for_key('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000099'),
  0::bigint,
  'failed owner relationship rolls back the project row'
);
select pg_catalog.set_config('test.reject_project_owner_insert', '0', true);

select ok(not has_table_privilege('authenticated', 'public.project_members', 'insert'), 'browser cannot directly write project members');
select ok(not has_table_privilege('service_role', 'public.project_members', 'insert'), 'service_role has no broad project member write grant');

select * from finish();
rollback;
