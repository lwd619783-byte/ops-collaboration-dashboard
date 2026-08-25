begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.sqlstate_of(p_sql text)
returns text language plpgsql as $function$
begin execute p_sql; return null;
exception when others then return sqlstate::text;
end;
$function$;
grant execute on function pg_temp.sqlstate_of(text) to public;

select no_plan();

select ok(to_regprocedure('public.list_my_tasks(uuid)') is not null, 'list_my_tasks exists');
select ok((select prosecdef from pg_proc where oid = 'public.list_my_tasks(uuid)'::regprocedure), 'list_my_tasks is SECURITY DEFINER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid = 'public.list_my_tasks(uuid)'::regprocedure), 'search_path=""', 'list_my_tasks pins an empty search_path');
select is((select pg_get_userbyid(proowner) from pg_proc where oid = 'public.list_my_tasks(uuid)'::regprocedure), 'postgres', 'list_my_tasks belongs to postgres');
select ok(has_function_privilege('authenticated', 'public.list_my_tasks(uuid)', 'execute'), 'authenticated may execute list_my_tasks');
select ok(not has_function_privilege('anon', 'public.list_my_tasks(uuid)', 'execute'), 'anon cannot execute list_my_tasks');
select ok(not has_function_privilege('service_role', 'public.list_my_tasks(uuid)', 'execute'), 'service_role has no list_my_tasks grant');

insert into public.app_users (id, status) values
  ('e1000000-0000-4000-8000-000000000001', 'active'),
  ('e1000000-0000-4000-8000-000000000002', 'active'),
  ('e1000000-0000-4000-8000-000000000003', 'active'),
  ('e1000000-0000-4000-8000-000000000004', 'active'),
  ('e1000000-0000-4000-8000-000000000005', 'active'),
  ('e1000000-0000-4000-8000-000000000006', 'active'),
  ('e1000000-0000-4000-8000-000000000007', 'active'),
  ('e1000000-0000-4000-8000-000000000008', 'active'),
  ('e1000000-0000-4000-8000-000000000009', 'active');
insert into public.profiles (user_id, display_name) values
  ('e1000000-0000-4000-8000-000000000001', 'Fictional current member'),
  ('e1000000-0000-4000-8000-000000000002', 'Fictional project owner'),
  ('e1000000-0000-4000-8000-000000000003', 'Fictional assignee'),
  ('e1000000-0000-4000-8000-000000000004', 'Fictional reviewer'),
  ('e1000000-0000-4000-8000-000000000005', 'Fictional ordinary member'),
  ('e1000000-0000-4000-8000-000000000006', 'Fictional other project owner'),
  ('e1000000-0000-4000-8000-000000000007', 'Fictional other workspace owner'),
  ('e1000000-0000-4000-8000-000000000008', 'Fictional visibility member'),
  ('e1000000-0000-4000-8000-000000000009', 'Fictional inactive member');
insert into public.user_identities (
  user_id, provider, provider_tenant, provider_subject, verified_at
) values
  ('e1000000-0000-4000-8000-000000000001', 'supabase_auth', 'https://my-tasks.invalid', 'current-member', now()),
  ('e1000000-0000-4000-8000-000000000002', 'supabase_auth', 'https://my-tasks.invalid', 'project-owner', now()),
  ('e1000000-0000-4000-8000-000000000003', 'supabase_auth', 'https://my-tasks.invalid', 'assignee', now()),
  ('e1000000-0000-4000-8000-000000000004', 'supabase_auth', 'https://my-tasks.invalid', 'reviewer', now()),
  ('e1000000-0000-4000-8000-000000000005', 'supabase_auth', 'https://my-tasks.invalid', 'ordinary-member', now()),
  ('e1000000-0000-4000-8000-000000000006', 'supabase_auth', 'https://my-tasks.invalid', 'other-project-owner', now()),
  ('e1000000-0000-4000-8000-000000000007', 'supabase_auth', 'https://my-tasks.invalid', 'other-workspace-owner', now()),
  ('e1000000-0000-4000-8000-000000000008', 'supabase_auth', 'https://my-tasks.invalid', 'visibility-member', now()),
  ('e1000000-0000-4000-8000-000000000009', 'supabase_auth', 'https://my-tasks.invalid', 'inactive-member', now());

insert into public.workspaces (id, name, owner_id, created_by) values
  ('e2000000-0000-4000-8000-000000000001', 'Fictional my tasks workspace', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002'),
  ('e2000000-0000-4000-8000-000000000002', 'Fictional isolated workspace', 'e1000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000007');
insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at, disabled_at
) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'member', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'owner', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'member', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'member', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000005', 'member', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000006', 'member', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000008', 'member', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000009', 'member', 'active', 'e1000000-0000-4000-8000-000000000002', now(), null),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000007', 'owner', 'active', 'e1000000-0000-4000-8000-000000000007', now(), null);
update public.workspace_members
set status = 'suspended', disabled_at = now()
where workspace_id = 'e2000000-0000-4000-8000-000000000001'
  and user_id = 'e1000000-0000-4000-8000-000000000009';

insert into public.projects (
  id, workspace_id, name, status, owner_id, created_by, idempotency_key, archived_at
) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Fictional primary project', 'active', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001', null),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Fictional unrelated project', 'active', 'e1000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000006', 'e3100000-0000-4000-8000-000000000002', null),
  ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'Fictional archived project', 'archived', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000003', now()),
  ('e3000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002', 'Fictional isolated project', 'active', 'e1000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000007', 'e3100000-0000-4000-8000-000000000004', null);
insert into public.project_members (project_id, user_id, role) values
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'member'),
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'owner'),
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'member'),
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'member'),
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000005', 'member'),
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000008', 'member'),
  ('e3000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000006', 'owner'),
  ('e3000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'member'),
  ('e3000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000002', 'owner'),
  ('e3000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000007', 'owner');
insert into public.project_modules (id, project_id, name, sort_position, created_by, updated_by) values
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'Primary module', 0, 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000002', 'Unrelated module', 0, 'e1000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000006'),
  ('e4000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000003', 'Archived module', 0, 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000004', 'Isolated module', 0, 'e1000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000007');

set local session_replication_role = replica;
insert into public.tasks (
  id, project_id, module_id, title, assignee_id, reviewer_id, priority,
  visibility, status, progress, due_date, created_by, updated_by, idempotency_key
) values
  ('e5000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Assigned to current member', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'high', 'project', 'todo', 0, '2026-08-26', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Collaborated by current member', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004', 'medium', 'project', 'in_progress', 40, '2026-08-27', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Reviewed by current member', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'urgent', 'restricted', 'pending_review', 100, '2026-08-25', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000003'),
  ('e5000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Visible but not responsible', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004', 'low', 'project', 'todo', 0, null, 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000004'),
  ('e5000000-0000-4000-8000-000000000005', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Restricted visibility only', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004', 'low', 'restricted', 'todo', 0, null, 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000005'),
  ('e5000000-0000-4000-8000-000000000006', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Restricted assigned task', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'high', 'restricted', 'todo', 0, '2026-08-24', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000006'),
  ('e5000000-0000-4000-8000-000000000007', 'e3000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000002', 'Unrelated project task', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000006', 'medium', 'project', 'todo', 0, null, 'e1000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000006', 'e5100000-0000-4000-8000-000000000007'),
  ('e5000000-0000-4000-8000-000000000008', 'e3000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-000000000004', 'Other workspace task', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000007', 'medium', 'project', 'todo', 0, null, 'e1000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000007', 'e5100000-0000-4000-8000-000000000008'),
  ('e5000000-0000-4000-8000-000000000009', 'e3000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000003', 'Archived project task', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'medium', 'project', 'todo', 0, null, 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000009'),
  ('e5000000-0000-4000-8000-000000000010', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Pending review for manager', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004', 'urgent', 'project', 'pending_review', 100, '2026-08-24', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000003', 'e5100000-0000-4000-8000-000000000010'),
  ('e5000000-0000-4000-8000-000000000011', 'e3000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Multiple responsibility task', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'medium', 'project', 'todo', 0, null, 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000011');
insert into public.task_collaborators (task_id, user_id) values
  ('e5000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000001');
insert into public.task_visibility_users (task_id, user_id) values
  ('e5000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001');
set local session_replication_role = origin;

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') $sql$), '42501', 'anon execution is rejected');
reset role;

set local "request.jwt.claims" = '{"sub":"current-member","iss":"https://my-tasks.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_tasks('e2000000-0000-4000-8000-000000000001')), 5::bigint, 'ordinary member gets only responsibility tasks');
select ok(exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id = 'e5000000-0000-4000-8000-000000000001' and is_assignee), 'assignee task is returned');
select ok(exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id = 'e5000000-0000-4000-8000-000000000002' and is_collaborator), 'collaborator task is returned');
select ok(exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id = 'e5000000-0000-4000-8000-000000000003' and is_reviewer and can_decide_review), 'reviewer task carries review authority');
select ok(not exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id in ('e5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005')), 'project visibility and explicit visibility alone do not create responsibility');
select ok(exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id = 'e5000000-0000-4000-8000-000000000006' and is_assignee), 'authorized restricted assignee task is returned');
select ok(not exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where project_id in ('e3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000004')), 'unrelated project and workspace tasks do not leak');
select ok(not exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where project_id = 'e3000000-0000-4000-8000-000000000003'), 'archived project tasks are excluded');
select is((select count(*) from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id = 'e5000000-0000-4000-8000-000000000011'), 1::bigint, 'multiple responsibility relations still return one task row');
reset role;

set local "request.jwt.claims" = '{"sub":"project-owner","iss":"https://my-tasks.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_tasks('e2000000-0000-4000-8000-000000000001')), 2::bigint, 'project manager receives only pending review action tasks without general responsibility expansion');
select ok(exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id = 'e5000000-0000-4000-8000-000000000010' and can_decide_review and not is_assignee and not is_collaborator and not is_reviewer), 'manager pending review task has explicit decision authority');
select ok(not exists(select 1 from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') where task_id = 'e5000000-0000-4000-8000-000000000004'), 'manager project visibility alone does not add an ordinary task');
reset role;

set local "request.jwt.claims" = '{"sub":"ordinary-member","iss":"https://my-tasks.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_my_tasks('e2000000-0000-4000-8000-000000000001')), 0::bigint, 'ordinary project member receives no other users tasks');
reset role;

set local "request.jwt.claims" = '{"sub":"inactive-member","iss":"https://my-tasks.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_my_tasks('e2000000-0000-4000-8000-000000000001') $sql$), '42501', 'inactive workspace member is rejected');
reset role;

select * from finish();
rollback;
