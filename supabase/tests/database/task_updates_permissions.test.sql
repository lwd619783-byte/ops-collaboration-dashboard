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
  ('f1000000-0000-4000-8000-000000000001','active'),
  ('f1000000-0000-4000-8000-000000000002','active'),
  ('f1000000-0000-4000-8000-000000000003','active'),
  ('f1000000-0000-4000-8000-000000000004','active'),
  ('f1000000-0000-4000-8000-000000000005','active'),
  ('f1000000-0000-4000-8000-000000000006','active'),
  ('f1000000-0000-4000-8000-000000000007','active'),
  ('f1000000-0000-4000-8000-000000000008','active'),
  ('f1000000-0000-4000-8000-000000000009','active'),
  ('f1000000-0000-4000-8000-000000000010','active'),
  ('f1000000-0000-4000-8000-000000000011','active'),
  ('f1000000-0000-4000-8000-000000000012','active'),
  ('f1000000-0000-4000-8000-000000000013','active');

insert into public.profiles (user_id,display_name)
select id, 'Fictional progress user ' || right(id::text, 2)
from public.app_users where id::text like 'f1000000-%';

insert into public.user_identities (
  user_id,provider,provider_tenant,provider_subject,verified_at
)
select
  id,
  'supabase_auth',
  'https://progress-fixture.invalid',
  'progress-user-' || right(id::text, 2),
  now()
from public.app_users where id::text like 'f1000000-%';

insert into public.workspaces (id,name,owner_id,created_by) values (
  'f2000000-0000-4000-8000-000000000001',
  'Fictional progress workspace',
  'f1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001'
);

insert into public.workspace_members (
  workspace_id,user_id,role,status,invited_by,joined_at
)
select
  'f2000000-0000-4000-8000-000000000001',
  id,
  case
    when id='f1000000-0000-4000-8000-000000000001' then 'owner'::public.workspace_role
    when id='f1000000-0000-4000-8000-000000000013' then 'admin'::public.workspace_role
    else 'member'::public.workspace_role
  end,
  'active',
  'f1000000-0000-4000-8000-000000000001',
  now()
from public.app_users where id::text like 'f1000000-%';

insert into public.projects (
  id,workspace_id,name,status,owner_id,lead_id,created_by,idempotency_key
) values
  ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Fictional progress project','active','f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001'),
  ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001','Fictional archivable progress project','completed','f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000002');

insert into public.project_members (project_id,user_id,role)
select
  p.id,
  u.id,
  case
    when u.id='f1000000-0000-4000-8000-000000000001' then 'owner'::public.project_role
    when u.id='f1000000-0000-4000-8000-000000000002' then 'lead'::public.project_role
    when u.id='f1000000-0000-4000-8000-000000000008' then 'viewer'::public.project_role
    else 'member'::public.project_role
  end
from public.projects as p
cross join public.app_users as u
where p.id::text like 'f3000000-%'
  and u.id::text like 'f1000000-%'
  and u.id <> 'f1000000-0000-4000-8000-000000000013';

insert into public.project_modules (
  id,project_id,name,sort_position,created_by,updated_by
) values
  ('f5000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','Fictional progress module',0,'f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001'),
  ('f5000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000002','Fictional archived progress module',0,'f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');

insert into public.tasks (
  id,project_id,module_id,title,assignee_id,reviewer_id,visibility,
  created_by,updated_by,idempotency_key
) values
  ('f6000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional normal progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional block progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000002'),
  ('f6000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional already blocked progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000003'),
  ('f6000000-0000-4000-8000-000000000004','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional todo progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000004'),
  ('f6000000-0000-4000-8000-000000000005','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional pending review progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000005'),
  ('f6000000-0000-4000-8000-000000000006','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional completed progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000006'),
  ('f6000000-0000-4000-8000-000000000007','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional cancelled progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000007'),
  ('f6000000-0000-4000-8000-000000000008','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional restricted progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','restricted','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000008'),
  ('f6000000-0000-4000-8000-000000000009','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional permission progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000009'),
  ('f6000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000002','f5000000-0000-4000-8000-000000000002','Fictional archive retry progress','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000010'),
  ('f6000000-0000-4000-8000-000000000011','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional removed assignee progress','f1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000011'),
  ('f6000000-0000-4000-8000-000000000012','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional inactive assignee progress','f1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000012'),
  ('f6000000-0000-4000-8000-000000000013','f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Fictional separate idempotency domains','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000005','project','f1000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000013');

insert into public.task_collaborators (task_id,user_id) values
  ('f6000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000004');
insert into public.task_visibility_users (task_id,user_id) values
  ('f6000000-0000-4000-8000-000000000008','f1000000-0000-4000-8000-000000000007');

set local session_replication_role = replica;
update public.tasks set status='in_progress' where id in (
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000002',
  'f6000000-0000-4000-8000-000000000008',
  'f6000000-0000-4000-8000-000000000009',
  'f6000000-0000-4000-8000-000000000010',
  'f6000000-0000-4000-8000-000000000011',
  'f6000000-0000-4000-8000-000000000012',
  'f6000000-0000-4000-8000-000000000013'
);
update public.tasks set
  status='blocked',
  blocker_reason='Fictional existing blocker',
  blocked_at=now(),
  blocked_by='f1000000-0000-4000-8000-000000000003'
where id='f6000000-0000-4000-8000-000000000003';
update public.tasks set status='pending_review' where id='f6000000-0000-4000-8000-000000000005';
update public.tasks set status='completed' where id='f6000000-0000-4000-8000-000000000006';
update public.tasks set status='cancelled' where id='f6000000-0000-4000-8000-000000000007';
delete from public.project_members
where project_id='f3000000-0000-4000-8000-000000000001'
  and user_id='f1000000-0000-4000-8000-000000000012';
update public.app_users set status='suspended',disabled_at=now()
where id='f1000000-0000-4000-8000-000000000011';
set local session_replication_role = origin;

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update(gen_random_uuid(),current_date,'x',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'anon cannot execute update RPC');
select is(pg_temp.sqlstate_of($sql$ select * from public.list_task_updates(gen_random_uuid()) $sql$), '42501', 'anon cannot execute list RPC');
reset role;

set local "request.jwt.claims" = '{"sub":"progress-user-03","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((public.create_task_update('f6000000-0000-4000-8000-000000000001','2026-08-10','  Fictional completed work  ',40,'  Fictional issue  ','   ',true,false,null,'f8000000-0000-4000-8000-000000000001')->>'was_existing')::boolean, false, 'assignee creates a normalized update');
select is((select progress from public.get_task('f6000000-0000-4000-8000-000000000001')), 40::smallint, 'task progress updates atomically');
select ok((select last_progress_at is not null and last_progress_by='f1000000-0000-4000-8000-000000000003' from public.get_task('f6000000-0000-4000-8000-000000000001')), 'latest progress metadata is database-derived');
select is((select completed_content from public.list_task_updates('f6000000-0000-4000-8000-000000000001') where sequence=1), 'Fictional completed work', 'completed content is trimmed');
select is((select issues from public.list_task_updates('f6000000-0000-4000-8000-000000000001') where sequence=1), 'Fictional issue', 'issues are trimmed');
select ok((select next_steps is null from public.list_task_updates('f6000000-0000-4000-8000-000000000001') where sequence=1), 'blank next steps normalize to null');
select is((select record_date from public.list_task_updates('f6000000-0000-4000-8000-000000000001') where sequence=1), '2026-08-10'::date, 'record date preserves the submitted local calendar date');
select ok((select not (to_jsonb(u) ? 'idempotency_key') from public.list_task_updates('f6000000-0000-4000-8000-000000000001') as u limit 1), 'safe update projection excludes idempotency key');
select is((public.create_task_update('f6000000-0000-4000-8000-000000000001','2026-08-10','Fictional completed work',40,'Fictional issue',null,true,false,null,'f8000000-0000-4000-8000-000000000001')->>'was_existing')::boolean, true, 'same normalized payload and key replays one update');
select is((select count(*) from public.list_task_updates('f6000000-0000-4000-8000-000000000001')), 1::bigint, 'same key retry does not append');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001','2026-08-10','Different work',40,'Fictional issue',null,true,false,null,'f8000000-0000-4000-8000-000000000001') $sql$), '23505', 'same key with different payload conflicts');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000002','2026-08-10','Fictional completed work',40,'Fictional issue',null,true,false,null,'f8000000-0000-4000-8000-000000000001') $sql$), '23505', 'same key with different task conflicts');

select lives_ok($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001','2026-08-10','Progress zero',0,null,null,false,false,null,'f8000000-0000-4000-8000-000000000002') $sql$, 'progress zero is allowed');
select lives_ok($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001','2026-08-10','Progress one',1,null,null,false,false,null,'f8000000-0000-4000-8000-000000000003') $sql$, 'progress one is allowed');
select lives_ok($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001','2026-08-10','Progress ninety nine',99,null,null,false,false,null,'f8000000-0000-4000-8000-000000000004') $sql$, 'progress ninety nine is allowed');
select lives_ok($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001','2026-08-10','Progress one hundred',100,null,null,false,false,null,'f8000000-0000-4000-8000-000000000005') $sql$, 'progress one hundred is allowed');
select is((select status from public.get_task('f6000000-0000-4000-8000-000000000001')), 'in_progress'::public.task_status, '100 percent does not auto-complete');
select is((select pg_catalog.array_agg(sequence order by sequence) from public.list_task_updates('f6000000-0000-4000-8000-000000000001')), array[1,2,3,4,5]::bigint[], 'update sequence is contiguous and deterministic');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001',current_date,'negative',-1,null,null,false,false,null,gen_random_uuid()) $sql$), '22023', 'negative progress is rejected');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001',current_date,'over',101,null,null,false,false,null,gen_random_uuid()) $sql$), '22023', 'progress over one hundred is rejected');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001',current_date,'   ',1,null,null,false,false,null,gen_random_uuid()) $sql$), '22023', 'blank completed content is rejected');

select is((public.create_task_update('f6000000-0000-4000-8000-000000000002','2026-08-10','Blocked by dependency',55,null,'Wait for fictional dependency',true,true,'  Fictional blocker  ','f8000000-0000-4000-8000-000000000006')#>>'{task,status}'), 'blocked', 'progress update can atomically invoke Task 3.3 block');
select is((select progress from public.get_task('f6000000-0000-4000-8000-000000000002')), 55::smallint, 'block update also commits progress');
select is((select blocker_reason from public.get_task('f6000000-0000-4000-8000-000000000002')), 'Fictional blocker', 'block reason uses Task 3.3 normalization');
select ok((select block_transition_id is not null and is_blocked from public.list_task_updates('f6000000-0000-4000-8000-000000000002')), 'update links the exact block transition');
select is((select count(*) from public.list_task_status_history('f6000000-0000-4000-8000-000000000002') where action='block'), 1::bigint, 'one Task 3.3 block history row is appended');
select is((public.create_task_update('f6000000-0000-4000-8000-000000000002','2026-08-10','Blocked by dependency',55,null,'Wait for fictional dependency',true,true,'Fictional blocker','f8000000-0000-4000-8000-000000000006')->>'was_existing')::boolean, true, 'block update retry does not repeat transition');
select is((select count(*) from public.list_task_status_history('f6000000-0000-4000-8000-000000000002') where action='block'), 1::bigint, 'block retry preserves one transition');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000001',current_date,'Missing reason',50,null,null,false,true,'   ',gen_random_uuid()) $sql$), '22023', 'mark blocked requires a reason');

select lives_ok($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000003','2026-08-10','Working while blocked',60,null,null,true,false,null,'f8000000-0000-4000-8000-000000000007') $sql$, 'blocked task accepts an ordinary progress update');
select is((select status from public.get_task('f6000000-0000-4000-8000-000000000003')), 'blocked'::public.task_status, 'ordinary blocked update does not resume');
select is((select blocker_reason from public.get_task('f6000000-0000-4000-8000-000000000003')), 'Fictional existing blocker', 'ordinary blocked update preserves current blocker');
select is((select count(*) from public.list_task_status_history('f6000000-0000-4000-8000-000000000003')), 0::bigint, 'ordinary blocked update creates no fake transition');
select ok((select is_blocked and block_transition_id is null from public.list_task_updates('f6000000-0000-4000-8000-000000000003')), 'blocked snapshot is true without a duplicate block link');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000003',current_date,'Duplicate block',70,null,null,false,true,'another',gen_random_uuid()) $sql$), '55000', 'blocked task cannot create blocked-to-blocked transition');

select lives_ok($sql$ select public.block_task('f6000000-0000-4000-8000-000000000013','Fictional earlier blocker','f8000000-0000-4000-8000-000000000013') $sql$, 'standalone Task 3.3 block accepts a client key');
select lives_ok($sql$ select public.resume_task('f6000000-0000-4000-8000-000000000013','f8000000-0000-4000-8000-000000000014') $sql$, 'standalone Task 3.3 resume restores in_progress');
select is((public.create_task_update('f6000000-0000-4000-8000-000000000013','2026-08-10','New progress block',65,null,null,false,true,'Fictional new blocker','f8000000-0000-4000-8000-000000000013')#>>'{task,status}'), 'blocked', 'progress and status idempotency domains do not collide on the same client key');
select is((select count(*) from public.list_task_status_history('f6000000-0000-4000-8000-000000000013') where action='block'), 2::bigint, 'progress block appends a new transition after earlier block and resume');

select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000004',current_date,'todo',1,null,null,false,false,null,gen_random_uuid()) $sql$), '55000', 'todo rejects progress update');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000005',current_date,'pending',1,null,null,false,false,null,gen_random_uuid()) $sql$), '55000', 'pending review rejects progress update');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000006',current_date,'completed',1,null,null,false,false,null,gen_random_uuid()) $sql$), '55000', 'completed rejects progress update');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000007',current_date,'cancelled',1,null,null,false,false,null,gen_random_uuid()) $sql$), '55000', 'cancelled rejects progress update');
reset role;

set local "request.jwt.claims" = '{"sub":"progress-user-01","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'manager',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'project owner who is not assignee cannot write progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-02","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'lead',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'project lead who is not assignee cannot write progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-13","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'admin',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'workspace admin who is not assignee cannot write progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-04","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'collaborator',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'collaborator cannot write assignee progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-05","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'reviewer',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'reviewer cannot write assignee progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-06","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'creator',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'creator cannot write assignee progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-07","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.list_task_updates('f6000000-0000-4000-8000-000000000008')), 0::bigint, 'restricted visibility user may read update timeline');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'visibility',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'visibility relationship cannot write progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-08","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'viewer',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'viewer cannot write progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-09","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select * from public.list_task_updates('f6000000-0000-4000-8000-000000000008') $sql$), '42501', 'unrelated member cannot probe restricted updates');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000009',current_date,'member',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'ordinary member cannot write progress');
reset role;

set local "request.jwt.claims" = '{"sub":"progress-user-12","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000011',current_date,'removed',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'removed assignee cannot write progress');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-11","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000012',current_date,'inactive',1,null,null,false,false,null,gen_random_uuid()) $sql$), '42501', 'inactive assignee cannot write progress');
reset role;

set local "request.jwt.claims" = '{"sub":"progress-user-03","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select lives_ok($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000010','2026-08-10','Before archive',25,null,null,false,false,null,'f8000000-0000-4000-8000-000000000010') $sql$, 'assignee writes before project archive');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-01","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select lives_ok(format($sql$ select * from public.archive_project('f3000000-0000-4000-8000-000000000002',%L::timestamptz) $sql$, (select updated_at::text from public.projects where id='f3000000-0000-4000-8000-000000000002')), 'archive project after update');
reset role;
set local "request.jwt.claims" = '{"sub":"progress-user-03","iss":"https://progress-fixture.invalid","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('f6000000-0000-4000-8000-000000000010','2026-08-10','Before archive',25,null,null,false,false,null,'f8000000-0000-4000-8000-000000000010') $sql$), '55000', 'archived project rejects even an old idempotent retry');

select is(pg_temp.sqlstate_of($sql$
  insert into public.task_updates (
    task_id,update_seq,record_date,completed_content,progress,
    needs_assistance,is_blocked,created_by,idempotency_key
  ) values (
    'f6000000-0000-4000-8000-000000000001',99,current_date,'direct',1,
    false,false,'f1000000-0000-4000-8000-000000000003',gen_random_uuid()
  )
$sql$), '42501', 'authenticated direct INSERT is denied');
select is(pg_temp.sqlstate_of($sql$ update public.task_updates set completed_content='tampered' where task_id='f6000000-0000-4000-8000-000000000001' $sql$), '42501', 'authenticated direct UPDATE is denied');
select is(pg_temp.sqlstate_of($sql$ delete from public.task_updates where task_id='f6000000-0000-4000-8000-000000000001' $sql$), '42501', 'authenticated direct DELETE is denied');
reset role;

select is(pg_temp.sqlstate_of($sql$ update public.task_updates set completed_content='tampered' where task_id='f6000000-0000-4000-8000-000000000001' $sql$), '27000', 'ledger is append-only for privileged SQL');
select is(pg_temp.sqlstate_of($sql$
  insert into public.task_updates (
    task_id,update_seq,record_date,completed_content,progress,
    needs_assistance,is_blocked,created_by,idempotency_key
  ) values (
    'f6000000-0000-4000-8000-000000000001',99,current_date,'direct',1,
    false,false,'f1000000-0000-4000-8000-000000000003',gen_random_uuid()
  )
$sql$), '27000', 'ledger INSERT is controlled for privileged SQL');
select is(pg_temp.sqlstate_of($sql$ update public.tasks set progress=12 where id='f6000000-0000-4000-8000-000000000001' $sql$), '27000', 'direct task progress update is controlled');
select is(pg_temp.sqlstate_of($sql$ update public.tasks set last_progress_at=now(),last_progress_by='f1000000-0000-4000-8000-000000000003' where id='f6000000-0000-4000-8000-000000000001' $sql$), '27000', 'direct latest-progress metadata update is controlled');

select * from finish();
rollback;
