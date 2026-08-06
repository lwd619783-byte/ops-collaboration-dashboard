begin;

create extension if not exists pgtap with schema extensions;

select plan(62);

select ok(to_regclass('public.project_members_one_owner_idx') is not null, 'partial owner uniqueness index exists');
select ok(to_regclass('public.project_members_one_lead_idx') is not null, 'partial lead uniqueness index exists');
select ok((select indisunique from pg_index where indexrelid = 'public.project_members_one_owner_idx'::regclass), 'owner index is unique');
select ok((select indisunique from pg_index where indexrelid = 'public.project_members_one_lead_idx'::regclass), 'lead index is unique');
select ok(pg_get_expr(indpred, indrelid) like '%role = ''owner''%', 'owner uniqueness is partial by role')
from pg_index where indexrelid = 'public.project_members_one_owner_idx'::regclass;
select ok(pg_get_expr(indpred, indrelid) like '%role = ''lead''%', 'lead uniqueness is partial by role')
from pg_index where indexrelid = 'public.project_members_one_lead_idx'::regclass;

select ok(exists(select 1 from pg_trigger where tgname = 'projects_owner_membership_required' and not tgisinternal), 'project-side consistency trigger exists');
select ok(exists(select 1 from pg_trigger where tgname = 'project_members_owner_membership_required' and not tgisinternal), 'member-side consistency trigger exists');
select ok((select tgdeferrable from pg_trigger where tgname = 'projects_owner_membership_required' and not tgisinternal), 'project-side consistency trigger is deferrable');
select ok((select tginitdeferred from pg_trigger where tgname = 'projects_owner_membership_required' and not tgisinternal), 'project-side consistency trigger starts deferred');
select ok((select tgdeferrable from pg_trigger where tgname = 'project_members_owner_membership_required' and not tgisinternal), 'member-side consistency trigger is deferrable');
select ok((select tginitdeferred from pg_trigger where tgname = 'project_members_owner_membership_required' and not tgisinternal), 'member-side consistency trigger starts deferred');
select ok(exists(select 1 from pg_trigger where tgname = 'guard_project_responsibility_on_workspace_status' and not tgisinternal), 'workspace suspension responsibility guard exists');
select ok(exists(select 1 from pg_trigger where tgname = 'guard_project_responsibility_on_app_user_status' and not tgisinternal), 'app-user suspension responsibility guard exists');
select ok(exists(select 1 from pg_trigger where tgname = 'projects_guard' and not tgisinternal), 'project mutation guard remains installed');
select ok(exists(select 1 from pg_trigger where tgname = 'project_members_guard' and not tgisinternal), 'project member mutation guard remains installed');

select ok(to_regprocedure('public.list_project_members(uuid)') is not null, 'safe member projection exists');
select ok(to_regprocedure('public.list_project_member_candidates(uuid)') is not null, 'safe candidate projection exists');
select ok(to_regprocedure('public.add_project_member(uuid,uuid,public.project_role)') is not null, 'ordinary add RPC exists');
select ok(to_regprocedure('public.set_project_member_role(uuid,uuid,public.project_role)') is not null, 'ordinary role RPC exists');
select ok(to_regprocedure('public.remove_project_member(uuid,uuid)') is not null, 'ordinary remove RPC exists');
select ok(to_regprocedure('public.set_project_lead(uuid,uuid,timestamptz)') is not null, 'lead assignment RPC exists');
select ok(to_regprocedure('public.clear_project_lead(uuid,timestamptz)') is not null, 'lead clear RPC exists');
select ok(to_regprocedure('public.transfer_project_owner(uuid,uuid,timestamptz)') is not null, 'owner transfer RPC exists');
select ok(to_regprocedure('public.add_project_member(uuid,uuid,public.project_role,uuid)') is null, 'write RPC has no client-supplied actor overload');

-- Internal lock helper used by every membership mutation RPC to close the
-- cross-table TOCTOU. It must exist, be SECURITY DEFINER with a pinned empty
-- search_path, carry no API-role execute grant, and accept no client-supplied
-- actor argument.
select ok(to_regprocedure('public.lock_membership_participants(uuid,uuid[])') is not null, 'internal lock helper exists');
select ok((
  select prosecdef
  from pg_proc
  where oid = 'public.lock_membership_participants(uuid,uuid[])'::regprocedure
), 'internal lock helper is SECURITY DEFINER');
select ok((
  select array_to_string(proconfig, ',') = 'search_path=""'
  from pg_proc
  where oid = 'public.lock_membership_participants(uuid,uuid[])'::regprocedure
), 'internal lock helper pins an empty search_path');
select ok(not has_function_privilege('public', 'public.lock_membership_participants(uuid,uuid[])', 'execute'), 'PUBLIC cannot execute the lock helper');
select ok(not has_function_privilege('anon', 'public.lock_membership_participants(uuid,uuid[])', 'execute'), 'anon cannot execute the lock helper');
select ok(not has_function_privilege('authenticated', 'public.lock_membership_participants(uuid,uuid[])', 'execute'), 'authenticated cannot execute the lock helper');
select ok(not has_function_privilege('service_role', 'public.lock_membership_participants(uuid,uuid[])', 'execute'), 'service_role cannot execute the lock helper');
select ok(to_regprocedure('public.lock_membership_participants(uuid)') is null, 'lock helper has no single-argument overload');
select ok(to_regprocedure('public.lock_membership_participants(uuid,uuid[],uuid)') is null, 'lock helper has no client-actor overload');

-- All six write RPCs must actually call the lock helper inside their body so
-- the cross-table TOCTOU guard is always engaged.
select ok((
  select pg_get_functiondef(oid) like '%perform public.lock_membership_participants(%'
  from pg_proc
  where oid = 'public.add_project_member(uuid,uuid,public.project_role)'::regprocedure
), 'add_project_member calls the lock helper');
select ok((
  select pg_get_functiondef(oid) like '%perform public.lock_membership_participants(%'
  from pg_proc
  where oid = 'public.set_project_member_role(uuid,uuid,public.project_role)'::regprocedure
), 'set_project_member_role calls the lock helper');
select ok((
  select pg_get_functiondef(oid) like '%perform public.lock_membership_participants(%'
  from pg_proc
  where oid = 'public.remove_project_member(uuid,uuid)'::regprocedure
), 'remove_project_member calls the lock helper');
select ok((
  select pg_get_functiondef(oid) like '%perform public.lock_membership_participants(%'
  from pg_proc
  where oid = 'public.set_project_lead(uuid,uuid,timestamptz)'::regprocedure
), 'set_project_lead calls the lock helper');
select ok((
  select pg_get_functiondef(oid) like '%perform public.lock_membership_participants(%'
  from pg_proc
  where oid = 'public.clear_project_lead(uuid,timestamptz)'::regprocedure
), 'clear_project_lead calls the lock helper');
select ok((
  select pg_get_functiondef(oid) like '%perform public.lock_membership_participants(%'
  from pg_proc
  where oid = 'public.transfer_project_owner(uuid,uuid,timestamptz)'::regprocedure
), 'transfer_project_owner calls the lock helper');

select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.list_project_members(uuid)'::regprocedure,
    'public.list_project_member_candidates(uuid)'::regprocedure,
    'public.add_project_member(uuid,uuid,public.project_role)'::regprocedure,
    'public.set_project_member_role(uuid,uuid,public.project_role)'::regprocedure,
    'public.remove_project_member(uuid,uuid)'::regprocedure,
    'public.set_project_lead(uuid,uuid,timestamptz)'::regprocedure,
    'public.clear_project_lead(uuid,timestamptz)'::regprocedure,
    'public.transfer_project_owner(uuid,uuid,timestamptz)'::regprocedure
  ]) and prosecdef),
  8::bigint,
  'all browser-facing membership functions are SECURITY DEFINER'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.list_project_members(uuid)'::regprocedure,
    'public.list_project_member_candidates(uuid)'::regprocedure,
    'public.add_project_member(uuid,uuid,public.project_role)'::regprocedure,
    'public.set_project_member_role(uuid,uuid,public.project_role)'::regprocedure,
    'public.remove_project_member(uuid,uuid)'::regprocedure,
    'public.set_project_lead(uuid,uuid,timestamptz)'::regprocedure,
    'public.clear_project_lead(uuid,timestamptz)'::regprocedure,
    'public.transfer_project_owner(uuid,uuid,timestamptz)'::regprocedure
  ]) and array_to_string(proconfig, ',') = 'search_path=""'),
  8::bigint,
  'all browser-facing membership functions pin an empty search_path'
);
select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text[]
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'project_role'),
  array['owner','lead','member','viewer']::text[],
  'project role enum remains closed and ordered'
);

select ok((
  select bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
  from pg_proc p where p.oid = any(array[
    'public.list_project_members(uuid)'::regprocedure,
    'public.list_project_member_candidates(uuid)'::regprocedure,
    'public.add_project_member(uuid,uuid,public.project_role)'::regprocedure,
    'public.set_project_member_role(uuid,uuid,public.project_role)'::regprocedure,
    'public.remove_project_member(uuid,uuid)'::regprocedure,
    'public.set_project_lead(uuid,uuid,timestamptz)'::regprocedure,
    'public.clear_project_lead(uuid,timestamptz)'::regprocedure,
    'public.transfer_project_owner(uuid,uuid,timestamptz)'::regprocedure
  ])
), 'authenticated can execute only the reviewed membership surface');
select ok((
  select bool_and(not has_function_privilege('anon', p.oid, 'execute'))
  from pg_proc p where p.oid = any(array[
    'public.list_project_members(uuid)'::regprocedure,
    'public.list_project_member_candidates(uuid)'::regprocedure,
    'public.add_project_member(uuid,uuid,public.project_role)'::regprocedure,
    'public.set_project_member_role(uuid,uuid,public.project_role)'::regprocedure,
    'public.remove_project_member(uuid,uuid)'::regprocedure,
    'public.set_project_lead(uuid,uuid,timestamptz)'::regprocedure,
    'public.clear_project_lead(uuid,timestamptz)'::regprocedure,
    'public.transfer_project_owner(uuid,uuid,timestamptz)'::regprocedure
  ])
), 'anon cannot execute the membership surface');
select ok((
  select bool_and(not has_function_privilege('service_role', p.oid, 'execute'))
  from pg_proc p where p.oid = any(array[
    'public.list_project_members(uuid)'::regprocedure,
    'public.list_project_member_candidates(uuid)'::regprocedure,
    'public.add_project_member(uuid,uuid,public.project_role)'::regprocedure,
    'public.set_project_member_role(uuid,uuid,public.project_role)'::regprocedure,
    'public.remove_project_member(uuid,uuid)'::regprocedure,
    'public.set_project_lead(uuid,uuid,timestamptz)'::regprocedure,
    'public.clear_project_lead(uuid,timestamptz)'::regprocedure,
    'public.transfer_project_owner(uuid,uuid,timestamptz)'::regprocedure
  ])
), 'service_role receives no browser membership grant');
select ok(not exists(
  select 1
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = any(array[
    'public.list_project_members(uuid)'::regprocedure,
    'public.list_project_member_candidates(uuid)'::regprocedure,
    'public.add_project_member(uuid,uuid,public.project_role)'::regprocedure,
    'public.set_project_member_role(uuid,uuid,public.project_role)'::regprocedure,
    'public.remove_project_member(uuid,uuid)'::regprocedure,
    'public.set_project_lead(uuid,uuid,timestamptz)'::regprocedure,
    'public.clear_project_lead(uuid,timestamptz)'::regprocedure,
    'public.transfer_project_owner(uuid,uuid,timestamptz)'::regprocedure
  ]) and a.grantee = 0 and a.privilege_type = 'EXECUTE'
), 'PUBLIC execute is revoked from the membership surface');

select ok(not has_table_privilege('authenticated', 'public.project_members', 'select'), 'browser has no direct member table SELECT');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'insert'), 'browser has no direct member table INSERT');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'update'), 'browser has no direct member table UPDATE');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'delete'), 'browser has no direct member table DELETE');
select ok(not has_table_privilege('authenticated', 'public.projects', 'insert'), 'browser has no direct project INSERT');
select ok(not has_table_privilege('authenticated', 'public.projects', 'update'), 'browser has no direct project UPDATE');
select ok(not has_table_privilege('authenticated', 'public.projects', 'delete'), 'browser has no direct project DELETE');
select ok((select relrowsecurity from pg_class where oid = 'public.project_members'::regclass), 'member table keeps RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), 'project table keeps RLS enabled');
select ok(not has_function_privilege('authenticated', 'public.can_manage_project_members(uuid)', 'execute'), 'ordinary management helper is internal');
select ok(not has_function_privilege('authenticated', 'public.can_manage_project_leadership(uuid)', 'execute'), 'leadership helper is internal');
select ok(not has_function_privilege('authenticated', 'public.project_role_for_current_user(uuid)', 'execute'), 'role resolver is internal');
select ok(not has_function_privilege('authenticated', 'public.assert_active_project_candidate(uuid,uuid)', 'execute'), 'candidate validator is internal');
select ok(lower(pg_get_function_result('public.list_project_members(uuid)'::regprocedure)) not like '%email%', 'member projection does not return email');
select ok(lower(pg_get_function_result('public.list_project_member_candidates(uuid)'::regprocedure)) not like '%contact%', 'candidate projection does not return contact data');

select * from finish();
rollback;
