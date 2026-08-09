begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.sqlstate_of(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate::text;
end;
$function$;
grant execute on function pg_temp.sqlstate_of(text) to public;

select no_plan();

insert into public.app_users (id,status) values
  ('e1000000-0000-4000-8000-000000000001','active'),
  ('e1000000-0000-4000-8000-000000000002','active'),
  ('e1000000-0000-4000-8000-000000000003','active'),
  ('e1000000-0000-4000-8000-000000000004','active'),
  ('e1000000-0000-4000-8000-000000000005','active'),
  ('e1000000-0000-4000-8000-000000000006','active'),
  ('e1000000-0000-4000-8000-000000000007','active'),
  ('e1000000-0000-4000-8000-000000000008','active'),
  ('e1000000-0000-4000-8000-000000000009','active'),
  ('e1000000-0000-4000-8000-000000000010','active'),
  ('e1000000-0000-4000-8000-000000000011','active'),
  ('e1000000-0000-4000-8000-000000000012','active'),
  ('e1000000-0000-4000-8000-000000000013','active'),
  ('e1000000-0000-4000-8000-000000000014','active');

insert into public.profiles (user_id,display_name)
select id, 'Fictional transition member ' || right(id::text, 2)
from public.app_users
where id::text like 'e1000000-%';

insert into public.user_identities (
  user_id,provider,provider_tenant,provider_subject,verified_at
) values
  ('e1000000-0000-4000-8000-000000000001','supabase_auth','https://transition-fixture.invalid','transition-owner',now()),
  ('e1000000-0000-4000-8000-000000000002','supabase_auth','https://transition-fixture.invalid','transition-lead',now()),
  ('e1000000-0000-4000-8000-000000000003','supabase_auth','https://transition-fixture.invalid','transition-assignee',now()),
  ('e1000000-0000-4000-8000-000000000004','supabase_auth','https://transition-fixture.invalid','transition-collaborator',now()),
  ('e1000000-0000-4000-8000-000000000005','supabase_auth','https://transition-fixture.invalid','transition-reviewer',now()),
  ('e1000000-0000-4000-8000-000000000006','supabase_auth','https://transition-fixture.invalid','transition-creator',now()),
  ('e1000000-0000-4000-8000-000000000007','supabase_auth','https://transition-fixture.invalid','transition-viewer',now()),
  ('e1000000-0000-4000-8000-000000000008','supabase_auth','https://transition-fixture.invalid','transition-ordinary',now()),
  ('e1000000-0000-4000-8000-000000000009','supabase_auth','https://transition-fixture.invalid','transition-admin',now()),
  ('e1000000-0000-4000-8000-000000000010','supabase_auth','https://transition-fixture.invalid','transition-unrelated',now()),
  ('e1000000-0000-4000-8000-000000000011','supabase_auth','https://transition-fixture.invalid','transition-terminal-assignee',now()),
  ('e1000000-0000-4000-8000-000000000012','supabase_auth','https://transition-fixture.invalid','transition-terminal-reviewer',now()),
  ('e1000000-0000-4000-8000-000000000013','supabase_auth','https://transition-fixture.invalid','transition-terminal-collaborator',now()),
  ('e1000000-0000-4000-8000-000000000014','supabase_auth','https://transition-fixture.invalid','transition-active-assignee',now());

insert into public.workspaces (id,name,owner_id,created_by) values (
  'e2000000-0000-4000-8000-000000000001',
  'Fictional transition workspace',
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001'
);

insert into public.workspace_members (
  workspace_id,user_id,role,status,invited_by,joined_at
)
select
  'e2000000-0000-4000-8000-000000000001',
  id,
  case
    when id='e1000000-0000-4000-8000-000000000001' then 'owner'::public.workspace_role
    when id='e1000000-0000-4000-8000-000000000009' then 'admin'::public.workspace_role
    else 'member'::public.workspace_role
  end,
  'active',
  'e1000000-0000-4000-8000-000000000001',
  now()
from public.app_users
where id::text like 'e1000000-%';

insert into public.projects (
  id,workspace_id,name,status,owner_id,lead_id,created_by,idempotency_key
) values
  ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Fictional transition project','active','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001'),
  ('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','Fictional terminal project','active','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002'),
  ('e3000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001','Fictional archive race project','completed','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000003');

insert into public.project_members (project_id,user_id,role)
select
  p.id,
  u.id,
  case
    when u.id='e1000000-0000-4000-8000-000000000001' then 'owner'::public.project_role
    when u.id='e1000000-0000-4000-8000-000000000002' then 'lead'::public.project_role
    when u.id='e1000000-0000-4000-8000-000000000007' then 'viewer'::public.project_role
    else 'member'::public.project_role
  end
from public.projects as p
cross join public.app_users as u
where p.id::text like 'e3000000-%'
  and u.id::text like 'e1000000-%'
  and u.id <> 'e1000000-0000-4000-8000-000000000009';

insert into public.project_modules (
  id,project_id,name,sort_position,created_by,updated_by
) values
  ('e5000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Fictional transition module',0,'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','Fictional terminal module',0,'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000003','Fictional archived module',0,'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001');

insert into public.tasks (
  id,project_id,module_id,title,assignee_id,reviewer_id,visibility,
  created_by,updated_by,idempotency_key,updated_at
) values
  ('e6000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','Fictional transition chain','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000005','restricted','e1000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001',now()-interval '1 second'),
  ('e6000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','Fictional permission task','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000005','project','e1000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000002',now()-interval '1 second'),
  ('e6000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','Fictional lead task','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000005','project','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000003',now()-interval '1 second'),
  ('e6000000-0000-4000-8000-000000000004','e3000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','Fictional admin task','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000005','project','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000004',now()-interval '1 second'),
  ('e6000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000002','Fictional terminal lifecycle task','e1000000-0000-4000-8000-000000000011','e1000000-0000-4000-8000-000000000012','project','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000005',now()-interval '1 second'),
  ('e6000000-0000-4000-8000-000000000006','e3000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000002','Fictional active lifecycle task','e1000000-0000-4000-8000-000000000014','e1000000-0000-4000-8000-000000000002','project','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000006',now()-interval '1 second'),
  ('e6000000-0000-4000-8000-000000000007','e3000000-0000-4000-8000-000000000003','e5000000-0000-4000-8000-000000000003','Fictional archived mutation task','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000002','project','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000007',now()-interval '1 second');

insert into public.task_collaborators (task_id,user_id) values
  ('e6000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004'),
  ('e6000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000004'),
  ('e6000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000013');

select pg_catalog.set_config(
  'test.transition_original_updated_at',
  (select updated_at::text from public.tasks where id='e6000000-0000-4000-8000-000000000001'),
  true
);

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select public.start_task(gen_random_uuid(),gen_random_uuid()) $sql$), '42501', 'anon cannot execute status RPC');
select is(pg_temp.sqlstate_of($sql$ select * from public.list_task_status_history(gen_random_uuid()) $sql$), '42501', 'anon cannot execute history RPC');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-assignee","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((public.start_task('e6000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001')->>'was_existing')::boolean, false, 'assignee starts todo task');
select is((public.start_task('e6000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001')->>'was_existing')::boolean, true, 'identical start retry replays existing transition');
select is((select count(*) from public.list_task_status_history('e6000000-0000-4000-8000-000000000001')), 1::bigint, 'identical retry writes one history row');
select is(pg_temp.sqlstate_of($sql$ select public.resume_task('e6000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001') $sql$), '23505', 'same key with different action conflicts');
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000002','e8000000-0000-4000-8000-000000000001') $sql$), '23505', 'same key with different task conflicts');
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000001',gen_random_uuid()) $sql$), '55000', 'start rejects in_progress task');
select is(pg_temp.sqlstate_of($sql$ select public.block_task('e6000000-0000-4000-8000-000000000001','   ',gen_random_uuid()) $sql$), '22023', 'block rejects whitespace reason');
select is(pg_temp.sqlstate_of($sql$ select public.block_task('e6000000-0000-4000-8000-000000000001',repeat('x',2001),gen_random_uuid()) $sql$), '22023', 'block rejects overlong reason');
select is((public.block_task('e6000000-0000-4000-8000-000000000001','  Fictional dependency  ','e8000000-0000-4000-8000-000000000002')#>>'{transition,to_status}'), 'blocked', 'assignee blocks in_progress task');
select is((select blocker_reason from public.get_task('e6000000-0000-4000-8000-000000000001')), 'Fictional dependency', 'current blocker reason is trimmed');
select is((select blocked_by from public.get_task('e6000000-0000-4000-8000-000000000001')), 'e1000000-0000-4000-8000-000000000003'::uuid, 'current blocker actor is database-derived');
select ok((select blocked_at is not null from public.get_task('e6000000-0000-4000-8000-000000000001')), 'blocked_at is present while blocked');
select is((select reason from public.list_task_status_history('e6000000-0000-4000-8000-000000000001') where action='block'), 'Fictional dependency', 'history preserves normalized block reason');
select is(pg_temp.sqlstate_of($sql$ select public.block_task('e6000000-0000-4000-8000-000000000001','Different dependency','e8000000-0000-4000-8000-000000000002') $sql$), '23505', 'same block key with different reason conflicts');
select is((public.resume_task('e6000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000003')#>>'{transition,to_status}'), 'in_progress', 'assignee resumes blocked task');
select ok((select blocker_reason is null and blocked_at is null and blocked_by is null from public.get_task('e6000000-0000-4000-8000-000000000001')), 'resume clears current blocker fields');
select is((select reason from public.list_task_status_history('e6000000-0000-4000-8000-000000000001') where sequence=2), 'Fictional dependency', 'resume does not erase historical blocker reason');
select is(pg_temp.sqlstate_of($sql$ select public.cancel_task('e6000000-0000-4000-8000-000000000001',gen_random_uuid()) $sql$), '42501', 'ordinary assignee cannot cancel');
select is((public.block_task('e6000000-0000-4000-8000-000000000001','Fictional second dependency','e8000000-0000-4000-8000-000000000004')#>>'{transition,sequence}'), '4', 'second block receives the next deterministic sequence');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-owner","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of(format($sql$
  select * from public.update_task(
    'e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001','Fictional stale edit',null,null,
    'e1000000-0000-4000-8000-000000000003',array['e1000000-0000-4000-8000-000000000004'::uuid],
    'e1000000-0000-4000-8000-000000000005','medium',null,null,null,'m','restricted',array[]::uuid[],%L::timestamptz
  )
$sql$, current_setting('test.transition_original_updated_at'))), '40001', 'status transition invalidates stale metadata edit version');
select is((public.cancel_task('e6000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000005')#>>'{transition,to_status}'), 'cancelled', 'manager cancels blocked task');
select ok((select blocker_reason is null and blocked_at is null and blocked_by is null from public.get_task('e6000000-0000-4000-8000-000000000001')), 'cancel from blocked clears current blocker fields');
select is((select reason from public.list_task_status_history('e6000000-0000-4000-8000-000000000001') where sequence=4), 'Fictional second dependency', 'cancel preserves prior block reason in history');
select is((select pg_catalog.array_agg(sequence order by sequence) from public.list_task_status_history('e6000000-0000-4000-8000-000000000001')), array[1,2,3,4,5]::bigint[], 'history sequence is deterministic and contiguous');
select ok(not exists (
  select 1 from (
    select sequence,from_status,pg_catalog.lag(to_status) over (order by sequence) as previous_to
    from public.list_task_status_history('e6000000-0000-4000-8000-000000000001')
  ) as chain where sequence > 1 and from_status is distinct from previous_to
), 'history from/to chain is continuous');
select is((select to_status from public.list_task_status_history('e6000000-0000-4000-8000-000000000001') order by sequence desc limit 1), (select status from public.get_task('e6000000-0000-4000-8000-000000000001')), 'history tail matches current task status');
select ok((select not (to_jsonb(h) ? 'idempotency_key') from public.list_task_status_history('e6000000-0000-4000-8000-000000000001') as h limit 1), 'history projection excludes idempotency internals');
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000001',gen_random_uuid()) $sql$), '55000', 'cancelled task cannot restart');
select is(pg_temp.sqlstate_of($sql$ select public.cancel_task('e6000000-0000-4000-8000-000000000001',gen_random_uuid()) $sql$), '55000', 'cancelled task cannot be cancelled twice');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-collaborator","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000002',gen_random_uuid()) $sql$), '42501', 'collaborator alone cannot change status');
select is((select count(*) from public.list_task_status_history('e6000000-0000-4000-8000-000000000001')), 5::bigint, 'authorized restricted collaborator can read history');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-reviewer","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000002',gen_random_uuid()) $sql$), '42501', 'reviewer alone cannot change status');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-creator","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000002',gen_random_uuid()) $sql$), '42501', 'creator alone cannot change status');
select is((select count(*) from public.list_task_status_history('e6000000-0000-4000-8000-000000000001')), 5::bigint, 'restricted creator retains read-only history access');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-viewer","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000002',gen_random_uuid()) $sql$), '42501', 'viewer cannot change status');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-ordinary","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_task_status_history('e6000000-0000-4000-8000-000000000001') $sql$), '42501', 'unrelated member cannot probe restricted history');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-assignee","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((public.start_task('e6000000-0000-4000-8000-000000000002',gen_random_uuid())#>>'{transition,to_status}'), 'in_progress', 'assignee can start a project-visible task');
select is(pg_temp.sqlstate_of($sql$ select public.resume_task('e6000000-0000-4000-8000-000000000002',gen_random_uuid()) $sql$), '55000', 'resume rejects in_progress task');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-lead","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((public.start_task('e6000000-0000-4000-8000-000000000003',gen_random_uuid())#>>'{transition,to_status}'), 'in_progress', 'project lead can start');
select is((public.cancel_task('e6000000-0000-4000-8000-000000000003',gen_random_uuid())#>>'{transition,to_status}'), 'cancelled', 'project lead can cancel');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-admin","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((public.start_task('e6000000-0000-4000-8000-000000000004',gen_random_uuid())#>>'{transition,to_status}'), 'in_progress', 'workspace admin can start without project membership');
select is((public.cancel_task('e6000000-0000-4000-8000-000000000004',gen_random_uuid())#>>'{transition,to_status}'), 'cancelled', 'workspace admin can cancel');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-owner","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select lives_ok(format($sql$ select * from public.archive_project('e3000000-0000-4000-8000-000000000003',%L::timestamptz) $sql$, (select updated_at::text from public.projects where id='e3000000-0000-4000-8000-000000000003')), 'archive fixture project');
select is(pg_temp.sqlstate_of($sql$ select public.start_task('e6000000-0000-4000-8000-000000000007',gen_random_uuid()) $sql$), '55000', 'archived project rejects status mutation');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-terminal-assignee","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select lives_ok($sql$ select public.start_task('e6000000-0000-4000-8000-000000000005',gen_random_uuid()) $sql$, 'terminal fixture assignee starts and becomes history actor');
reset role;

set local "request.jwt.claims" = '{"sub":"transition-owner","iss":"https://transition-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select lives_ok($sql$ select public.cancel_task('e6000000-0000-4000-8000-000000000005',gen_random_uuid()) $sql$, 'manager cancels terminal lifecycle task');
select is((select changed from public.remove_project_member('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000011')), true, 'cancelled assignee and history actor no longer blocks removal');
select is((select changed from public.remove_project_member('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000012')), true, 'cancelled reviewer no longer blocks removal');
select is((select changed from public.remove_project_member('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000013')), true, 'cancelled collaborator no longer blocks removal');
select is(pg_temp.sqlstate_of($sql$ select * from public.remove_project_member('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000014') $sql$), '55000', 'non-terminal assignee still blocks removal');
reset role;

select is(pg_temp.sqlstate_of($sql$
  update public.task_status_history set reason='tampered'
  where task_id='e6000000-0000-4000-8000-000000000001'
$sql$), '27000', 'history is append-only for privileged SQL');
select is(pg_temp.sqlstate_of($sql$
  insert into public.task_status_history (
    task_id,from_status,to_status,action,actor_id,idempotency_key,transition_seq
  ) values (
    'e6000000-0000-4000-8000-000000000002','todo','in_progress','start',
    'e1000000-0000-4000-8000-000000000001',gen_random_uuid(),99
  )
$sql$), '27000', 'history INSERT is controlled even for privileged application SQL');

select * from finish();
rollback;
