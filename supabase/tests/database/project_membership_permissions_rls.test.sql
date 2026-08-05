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

create function pg_temp.member_role_count(p_project_id uuid, p_user_id uuid, p_role public.project_role)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.project_members
  where project_id = p_project_id and user_id = p_user_id and role = p_role;
$function$;

create function pg_temp.member_relation_count(p_project_id uuid, p_user_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select count(*) from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
$function$;

create function pg_temp.project_consistent(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select
    count(*) filter (where pm.role = 'owner') = 1
    and count(*) filter (where pm.role = 'lead') <= 1
    and bool_and((pm.role = 'owner') = (pm.user_id = p.owner_id))
    and bool_and((pm.role = 'lead') = (pm.user_id is not distinct from p.lead_id))
  from public.projects p
  join public.project_members pm on pm.project_id = p.id
  where p.id = p_project_id
  group by p.id;
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.member_role_count(uuid, uuid, public.project_role) to public;
grant execute on function pg_temp.member_relation_count(uuid, uuid) to public;
grant execute on function pg_temp.project_consistent(uuid) to public;

select * from no_plan();

insert into public.app_users (id, status, disabled_at) values
  ('81000000-0000-4000-8000-000000000001', 'active', null),
  ('81000000-0000-4000-8000-000000000002', 'active', null),
  ('81000000-0000-4000-8000-000000000003', 'active', null),
  ('81000000-0000-4000-8000-000000000004', 'active', null),
  ('81000000-0000-4000-8000-000000000005', 'active', null),
  ('81000000-0000-4000-8000-000000000006', 'active', null),
  ('81000000-0000-4000-8000-000000000007', 'active', null),
  ('81000000-0000-4000-8000-000000000008', 'active', null),
  ('81000000-0000-4000-8000-000000000009', 'active', null),
  ('81000000-0000-4000-8000-000000000010', 'suspended', now()),
  ('81000000-0000-4000-8000-000000000011', 'active', null),
  ('81000000-0000-4000-8000-000000000012', 'active', null),
  ('81000000-0000-4000-8000-000000000013', 'active', null),
  ('81000000-0000-4000-8000-000000000014', 'active', null);

insert into public.profiles (user_id, display_name) values
  ('81000000-0000-4000-8000-000000000001', 'Membership Workspace Owner'),
  ('81000000-0000-4000-8000-000000000002', 'Membership Workspace Admin'),
  ('81000000-0000-4000-8000-000000000003', 'Membership Project Owner'),
  ('81000000-0000-4000-8000-000000000004', 'Membership Project Lead'),
  ('81000000-0000-4000-8000-000000000005', 'Membership Project Member'),
  ('81000000-0000-4000-8000-000000000006', 'Membership Project Viewer'),
  ('81000000-0000-4000-8000-000000000007', 'Membership Workspace Only'),
  ('81000000-0000-4000-8000-000000000008', 'Membership Other Workspace'),
  ('81000000-0000-4000-8000-000000000009', 'Membership Suspended Workspace'),
  ('81000000-0000-4000-8000-000000000010', 'Membership Suspended App User'),
  ('81000000-0000-4000-8000-000000000011', 'Membership Candidate One'),
  ('81000000-0000-4000-8000-000000000012', 'Membership Candidate Two'),
  ('81000000-0000-4000-8000-000000000013', 'Membership Archived Member'),
  ('81000000-0000-4000-8000-000000000014', 'Membership Historical Member');

insert into public.user_identities (
  user_id, provider, provider_tenant, provider_subject, verified_at, revoked_at
) values
  ('81000000-0000-4000-8000-000000000001', 'supabase_auth', 'https://membership-fixture.invalid', 'workspace-owner', now(), null),
  ('81000000-0000-4000-8000-000000000002', 'supabase_auth', 'https://membership-fixture.invalid', 'workspace-admin', now(), null),
  ('81000000-0000-4000-8000-000000000003', 'supabase_auth', 'https://membership-fixture.invalid', 'project-owner', now(), null),
  ('81000000-0000-4000-8000-000000000004', 'supabase_auth', 'https://membership-fixture.invalid', 'project-lead', now(), null),
  ('81000000-0000-4000-8000-000000000005', 'supabase_auth', 'https://membership-fixture.invalid', 'project-member', now(), null),
  ('81000000-0000-4000-8000-000000000006', 'supabase_auth', 'https://membership-fixture.invalid', 'project-viewer', now(), null),
  ('81000000-0000-4000-8000-000000000007', 'supabase_auth', 'https://membership-fixture.invalid', 'workspace-only', now(), null),
  ('81000000-0000-4000-8000-000000000008', 'supabase_auth', 'https://membership-fixture.invalid', 'other-workspace', now(), null),
  ('81000000-0000-4000-8000-000000000009', 'supabase_auth', 'https://membership-fixture.invalid', 'suspended-workspace', now(), null),
  ('81000000-0000-4000-8000-000000000010', 'supabase_auth', 'https://membership-fixture.invalid', 'suspended-app', now(), null),
  ('81000000-0000-4000-8000-000000000011', 'supabase_auth', 'https://membership-fixture.invalid', 'candidate-one', now(), null),
  ('81000000-0000-4000-8000-000000000012', 'supabase_auth', 'https://membership-fixture.invalid', 'candidate-two', now(), null),
  ('81000000-0000-4000-8000-000000000013', 'supabase_auth', 'https://membership-fixture.invalid', 'archived-member', now(), null),
  ('81000000-0000-4000-8000-000000000014', 'supabase_auth', 'https://membership-fixture.invalid', 'historical-member', now(), null);

insert into public.workspaces (id, name, owner_id, created_by) values
  ('82000000-0000-4000-8000-000000000001', 'Membership Workspace A', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000002', 'Membership Workspace B', '81000000-0000-4000-8000-000000000008', '81000000-0000-4000-8000-000000000008');

insert into public.workspace_members (
  workspace_id, user_id, role, status, invited_by, joined_at, disabled_at
) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'owner', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'admin', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000004', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000006', 'external_collaborator', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000007', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000009', 'member', 'suspended', '81000000-0000-4000-8000-000000000001', now(), now()),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000010', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000012', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000013', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000014', 'member', 'active', '81000000-0000-4000-8000-000000000001', now(), null),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000008', 'owner', 'active', '81000000-0000-4000-8000-000000000008', now(), null);

insert into public.projects (
  id, workspace_id, name, status, owner_id, lead_id, created_by, idempotency_key, archived_at
) values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'Membership Main Project', 'active', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', null),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'Membership Owner Project', 'active', '81000000-0000-4000-8000-000000000003', null, '81000000-0000-4000-8000-000000000003', '84000000-0000-4000-8000-000000000002', null),
  ('83000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', 'Membership Archived Project', 'archived', '81000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000003', now()),
  ('83000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000001', 'Membership History Project', 'active', '81000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000004', null),
  ('83000000-0000-4000-8000-000000000005', '82000000-0000-4000-8000-000000000001', 'Membership Admin Project', 'active', '81000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000005', null),
  ('83000000-0000-4000-8000-000000000006', '82000000-0000-4000-8000-000000000001', 'Transfer Lead Project', 'active', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000006', null),
  ('83000000-0000-4000-8000-000000000007', '82000000-0000-4000-8000-000000000001', 'Transfer Member Project', 'active', '81000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000007', null),
  ('83000000-0000-4000-8000-000000000008', '82000000-0000-4000-8000-000000000001', 'Transfer Viewer Project', 'active', '81000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000008', null),
  ('83000000-0000-4000-8000-000000000009', '82000000-0000-4000-8000-000000000001', 'Transfer New Project', 'active', '81000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000009', null),
  ('83000000-0000-4000-8000-000000000010', '82000000-0000-4000-8000-000000000002', 'Other Workspace Project', 'active', '81000000-0000-4000-8000-000000000008', null, '81000000-0000-4000-8000-000000000008', '84000000-0000-4000-8000-000000000010', null);

insert into public.project_members (project_id, user_id, role) values
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000004', 'lead'),
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005', 'member'),
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000006', 'viewer'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003', 'owner'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000005', 'member'),
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000013', 'member'),
  ('83000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000014', 'member'),
  ('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000004', 'lead'),
  ('83000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000005', 'member'),
  ('83000000-0000-4000-8000-000000000008', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000008', '81000000-0000-4000-8000-000000000006', 'viewer'),
  ('83000000-0000-4000-8000-000000000009', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('83000000-0000-4000-8000-000000000010', '81000000-0000-4000-8000-000000000008', 'owner');

-- Anonymous callers have no projection or mutation capability.
set local role anon;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_project_members('83000000-0000-4000-8000-000000000001') $sql$), '42501', 'anon cannot list project members');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member') $sql$), '42501', 'anon cannot add project members');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'anon cannot transfer project ownership');
reset role;

-- Project member and viewer can read but cannot perform any write class.
set local "request.jwt.claims" = '{"sub":"project-member","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000001')), 4::bigint, 'project member reads the safe member directory');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member') $sql$), '42501', 'project member cannot add');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_member_role('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000006', 'member') $sql$), '42501', 'project member cannot change ordinary roles');
select is(pg_temp.sqlstate_of($sql$ select * from public.remove_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000006') $sql$), '42501', 'project member cannot remove');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_lead('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'project member cannot assign lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.clear_project_lead('83000000-0000-4000-8000-000000000001', now()) $sql$), '42501', 'project member cannot clear lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'project member cannot transfer owner');
reset role;

set local "request.jwt.claims" = '{"sub":"project-viewer","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000001')), 4::bigint, 'project viewer reads the safe member directory');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'viewer') $sql$), '42501', 'project viewer cannot add');
select is(pg_temp.sqlstate_of($sql$ select * from public.remove_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005') $sql$), '42501', 'project viewer cannot remove');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_lead('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'project viewer cannot assign lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'project viewer cannot transfer owner');
reset role;

-- Same-workspace non-member, other-workspace, suspended membership and inactive app user all read zero rows and cannot write.
set local "request.jwt.claims" = '{"sub":"workspace-only","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000001')), 0::bigint, 'same-workspace non-project user cannot read members');
select is((select count(*) from public.get_project('83000000-0000-4000-8000-000000000001')), 0::bigint, 'same-workspace non-project user cannot read detail');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member') $sql$), '42501', 'same-workspace non-project user cannot add');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_member_role('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005', 'viewer') $sql$), '42501', 'same-workspace non-project user cannot change role');
select is(pg_temp.sqlstate_of($sql$ select * from public.remove_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005') $sql$), '42501', 'same-workspace non-project user cannot remove');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_lead('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'same-workspace non-project user cannot assign lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.clear_project_lead('83000000-0000-4000-8000-000000000001', now()) $sql$), '42501', 'same-workspace non-project user cannot clear lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'same-workspace non-project user cannot transfer owner');
reset role;

set local "request.jwt.claims" = '{"sub":"other-workspace","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000001')), 0::bigint, 'other-workspace user cannot read members');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member') $sql$), '42501', 'other-workspace user cannot add');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'other-workspace user cannot transfer owner');
reset role;

set local "request.jwt.claims" = '{"sub":"suspended-workspace","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000001')), 0::bigint, 'suspended workspace member cannot read members');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member') $sql$), '42501', 'suspended workspace member cannot add');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'suspended workspace member cannot transfer owner');
reset role;

set local "request.jwt.claims" = '{"sub":"suspended-app","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000001')), 0::bigint, 'inactive app user cannot read members');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member') $sql$), '42501', 'inactive app user cannot add');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', now()) $sql$), '42501', 'inactive app user cannot transfer owner');
reset role;

-- Project lead manages only member/viewer and removal is immediately effective across every read RPC.
set local "request.jwt.claims" = '{"sub":"project-lead","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_member_candidates('83000000-0000-4000-8000-000000000001')), 11::bigint, 'project lead sees only active workspace candidates');
select is((select changed from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member')), true, 'project lead adds an ordinary member');
select is((select changed from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'member')), false, 'repeated ordinary add is idempotent');
select is((select changed from public.set_project_member_role('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'viewer')), true, 'project lead changes member to viewer');
select is((select changed from public.set_project_member_role('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', 'viewer')), false, 'repeated ordinary role change is idempotent');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_member_role('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'member') $sql$), '42501', 'project lead cannot modify owner through ordinary RPC');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_lead('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000001')) $sql$), '42501', 'project lead cannot assign lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.clear_project_lead('83000000-0000-4000-8000-000000000001', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000001')) $sql$), '42501', 'project lead cannot clear lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000001')) $sql$), '42501', 'project lead cannot transfer owner');
select is((select changed from public.remove_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011')), true, 'project lead removes an ordinary member');
select is((select changed from public.remove_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011')), false, 'repeated ordinary removal is idempotent');
reset role;

set local "request.jwt.claims" = '{"sub":"candidate-one","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_projects('82000000-0000-4000-8000-000000000001') where project_id = '83000000-0000-4000-8000-000000000001'), 0::bigint, 'removed user immediately disappears from list_projects');
select is((select count(*) from public.get_project('83000000-0000-4000-8000-000000000001')), 0::bigint, 'removed user immediately loses get_project');
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000001')), 0::bigint, 'removed user immediately loses member projection');
reset role;

-- Project owner with ordinary workspace role can perform all ordinary and leadership operations on the owned project.
set local "request.jwt.claims" = '{"sub":"project-owner","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000002')), 2::bigint, 'project owner reads the owned project directory');
select is((select changed from public.add_project_member('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', 'viewer')), true, 'project owner adds viewer');
select is((select changed from public.set_project_member_role('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', 'member')), true, 'project owner changes ordinary role');
select is((select changed from public.remove_project_member('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007')), true, 'project owner removes ordinary member');
select is((select changed from public.set_project_lead('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000002'))), true, 'project owner atomically adds and appoints lead');
select is(pg_temp.member_role_count('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', 'lead'), 1::bigint, 'lead field and membership are aligned');
select is((select changed from public.clear_project_lead('83000000-0000-4000-8000-000000000002', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000002'))), true, 'project owner clears lead');
select is((select changed from public.clear_project_lead('83000000-0000-4000-8000-000000000002', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000002'))), false, 'repeated clear lead is idempotent');
select is((select changed from public.set_project_lead('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000002'))), true, 'project owner restores lead before owner transfer');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_lead('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000012', timestamptz '2000-01-01 00:00:00+00') $sql$), '40001', 'stale lead assignment is rejected');
select is((select changed from public.transfer_project_owner('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000002'))), true, 'owner transfer to current lead succeeds atomically');
reset role;
select is(pg_temp.member_role_count('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', 'owner'), 1::bigint, 'new owner is unique after lead-to-owner transfer');
select is(pg_temp.member_role_count('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003', 'member'), 1::bigint, 'old owner is demoted to member');
select is((select lead_id is null from public.projects where id = '83000000-0000-4000-8000-000000000002'), true, 'lead is cleared when the lead becomes owner');
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000002'), 'lead-to-owner transfer leaves no owner or lead drift');

-- Workspace owner and admin can manage every workspace project.
set local "request.jwt.claims" = '{"sub":"workspace-owner","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_member_candidates('83000000-0000-4000-8000-000000000005')), 11::bigint, 'workspace owner lists active candidates for any project');
select is((select changed from public.add_project_member('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000012', 'member')), true, 'workspace owner adds ordinary member');
select is((select changed from public.set_project_member_role('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000012', 'viewer')), true, 'workspace owner changes ordinary role');
select is((select changed from public.remove_project_member('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000012')), true, 'workspace owner removes ordinary member');
select is((select changed from public.set_project_lead('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000012', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000005'))), true, 'workspace owner sets lead');
select is((select changed from public.clear_project_lead('83000000-0000-4000-8000-000000000005', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000005'))), true, 'workspace owner clears lead');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000012', timestamptz '2000-01-01 00:00:00+00') $sql$), '40001', 'stale owner transfer is rejected');
select is((select changed from public.transfer_project_owner('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000012', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000005'))), true, 'workspace owner transfers owner to a not-yet-joined candidate');
reset role;
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000005'), 'workspace owner operations preserve consistency');

set local "request.jwt.claims" = '{"sub":"workspace-admin","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000005')), 2::bigint, 'workspace admin reads any project members');
select is((select changed from public.add_project_member('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000011', 'member')), true, 'workspace admin adds member');
select is((select changed from public.set_project_member_role('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000011', 'viewer')), true, 'workspace admin changes role');
select is((select changed from public.remove_project_member('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000011')), true, 'workspace admin removes member');
select is((select changed from public.set_project_lead('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000011', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000005'))), true, 'workspace admin sets lead');
select is((select changed from public.clear_project_lead('83000000-0000-4000-8000-000000000005', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000005'))), true, 'workspace admin clears lead');
select is((select changed from public.transfer_project_owner('83000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000011', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000005'))), true, 'workspace admin transfers owner');
reset role;
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000005'), 'workspace admin operations preserve consistency');

-- Owner transfer covers targets that begin as lead, member, viewer and non-member.
set local "request.jwt.claims" = '{"sub":"workspace-owner","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select changed from public.transfer_project_owner('83000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000004', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000006'))), true, 'transfer accepts current lead and clears lead');
select is((select changed from public.transfer_project_owner('83000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000005', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000007'))), true, 'transfer accepts current member');
select is((select changed from public.transfer_project_owner('83000000-0000-4000-8000-000000000008', '81000000-0000-4000-8000-000000000006', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000008'))), true, 'transfer accepts current viewer');
select is((select changed from public.transfer_project_owner('83000000-0000-4000-8000-000000000009', '81000000-0000-4000-8000-000000000011', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000009'))), true, 'transfer atomically inserts a not-yet-joined owner');
reset role;
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000006'), 'lead target transfer remains consistent');
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000007'), 'member target transfer remains consistent');
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000008'), 'viewer target transfer remains consistent');
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000009'), 'new target transfer remains consistent');

-- Invalid candidates and protected roles fail without partial writes.
set local "request.jwt.claims" = '{"sub":"workspace-owner","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000009', 'member') $sql$), '22023', 'suspended workspace candidate is rejected');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000010', 'member') $sql$), '22023', 'inactive app user candidate is rejected');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000008', 'member') $sql$), '22023', 'cross-workspace candidate is rejected');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000012', 'owner') $sql$), '22023', 'ordinary add cannot assign owner');
select is(pg_temp.sqlstate_of($sql$ select * from public.remove_project_member('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001') $sql$), '42501', 'ordinary remove cannot delete owner');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_lead('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000001')) $sql$), '22023', 'owner cannot also become lead');
reset role;
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000001'), 'invalid operations leave the main project consistent');

-- Archived projects retain readable history but reject every write RPC.
set local "request.jwt.claims" = '{"sub":"workspace-owner","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000003')), 2::bigint, 'archived project retains readable member history');
select is(pg_temp.sqlstate_of($sql$ select * from public.add_project_member('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000011', 'member') $sql$), '55000', 'archived project rejects add');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_member_role('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000013', 'viewer') $sql$), '55000', 'archived project rejects ordinary role change');
select is(pg_temp.sqlstate_of($sql$ select * from public.remove_project_member('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000013') $sql$), '55000', 'archived project rejects removal');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_project_lead('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000011', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000003')) $sql$), '55000', 'archived project rejects lead assignment');
select is(pg_temp.sqlstate_of($sql$ select * from public.clear_project_lead('83000000-0000-4000-8000-000000000003', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000003')) $sql$), '55000', 'archived project rejects lead clear even when already clear');
select is(pg_temp.sqlstate_of($sql$ select * from public.transfer_project_owner('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000011', (select updated_at from public.projects where id = '83000000-0000-4000-8000-000000000003')) $sql$), '55000', 'archived project rejects owner transfer');
reset role;

-- Conservative workspace suspension: owner/lead blocked; ordinary relation retained as inert history and deliberately restored on reactivation.
set local "request.jwt.claims" = '{"sub":"workspace-owner","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_status('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005', 'suspended') $sql$), '55000', 'workspace cannot suspend an active project owner before transfer');
select is(pg_temp.sqlstate_of($sql$ select * from public.set_workspace_member_status('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000004', 'suspended') $sql$), '55000', 'workspace cannot suspend an active project lead before clear or replacement');
select is((select status::text from public.set_workspace_member_status('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000014', 'suspended')), 'suspended', 'ordinary project member can be suspended');
reset role;
select is(pg_temp.member_relation_count('83000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000014'), 1::bigint, 'ordinary suspended relationship is retained as explicit history');

set local "request.jwt.claims" = '{"sub":"historical-member","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_projects('82000000-0000-4000-8000-000000000001') $sql$), '42501', 'suspended ordinary member immediately loses list access');
select is((select count(*) from public.get_project('83000000-0000-4000-8000-000000000004')), 0::bigint, 'suspended ordinary member immediately loses detail access');
select is((select count(*) from public.list_project_members('83000000-0000-4000-8000-000000000004')), 0::bigint, 'suspended ordinary member immediately loses member history access');
reset role;

set local "request.jwt.claims" = '{"sub":"workspace-owner","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select status::text from public.set_workspace_member_status('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000014', 'active')), 'active', 'ordinary historical member can be deliberately reactivated');
reset role;

set local "request.jwt.claims" = '{"sub":"historical-member","iss":"https://membership-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.get_project('83000000-0000-4000-8000-000000000004')), 1::bigint, 'reactivation deliberately restores access through the retained relation');
reset role;

select is(pg_temp.sqlstate_of($sql$ update public.app_users set status = 'suspended', disabled_at = now() where id = '81000000-0000-4000-8000-000000000005' $sql$), '55000', 'app-user guard blocks suspending a project owner');
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000001'), 'final main-project owner and lead state is consistent');
select ok(pg_temp.project_consistent('83000000-0000-4000-8000-000000000003'), 'archived project remains consistent after rejected writes');

select * from finish();
rollback;
