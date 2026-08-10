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

create function pg_temp.authenticate(p_subject text)
returns void
language plpgsql
as $function$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object(
      'sub', p_subject,
      'iss', 'https://review-fixture.invalid',
      'role', 'authenticated'
    )::text,
    true
  );
end;
$function$;

grant execute on function pg_temp.sqlstate_of(text) to public;
grant execute on function pg_temp.authenticate(text) to public;

select no_plan();

insert into public.app_users (id,status) values
  ('a1100000-0000-4000-8000-000000000001','active'),
  ('a1100000-0000-4000-8000-000000000002','active'),
  ('a1100000-0000-4000-8000-000000000003','active'),
  ('a1100000-0000-4000-8000-000000000004','active'),
  ('a1100000-0000-4000-8000-000000000005','active'),
  ('a1100000-0000-4000-8000-000000000006','active'),
  ('a1100000-0000-4000-8000-000000000007','active'),
  ('a1100000-0000-4000-8000-000000000008','active'),
  ('a1100000-0000-4000-8000-000000000009','active'),
  ('a1100000-0000-4000-8000-000000000010','active'),
  ('a1100000-0000-4000-8000-000000000011','active'),
  ('a1100000-0000-4000-8000-000000000012','active'),
  ('a1100000-0000-4000-8000-000000000013','active'),
  ('a1100000-0000-4000-8000-000000000014','active'),
  ('a1100000-0000-4000-8000-000000000015','active');

insert into public.profiles (user_id,display_name)
select id, 'Fictional review user ' || right(id::text, 2)
from public.app_users where id::text like 'a1100000-%';

insert into public.user_identities (
  user_id,provider,provider_tenant,provider_subject,verified_at
)
select
  id,
  'supabase_auth',
  'https://review-fixture.invalid',
  'review-user-' || right(id::text, 2),
  now()
from public.app_users where id::text like 'a1100000-%';

insert into public.workspaces (id,name,owner_id,created_by) values (
  'a1200000-0000-4000-8000-000000000001',
  'Fictional review workspace',
  'a1100000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000001'
);

insert into public.workspace_members (
  workspace_id,user_id,role,status,invited_by,joined_at
)
select
  'a1200000-0000-4000-8000-000000000001',
  id,
  case
    when id='a1100000-0000-4000-8000-000000000001' then 'owner'::public.workspace_role
    when id='a1100000-0000-4000-8000-000000000012' then 'admin'::public.workspace_role
    else 'member'::public.workspace_role
  end,
  'active',
  'a1100000-0000-4000-8000-000000000001',
  now()
from public.app_users where id::text like 'a1100000-%';

insert into public.projects (
  id,workspace_id,name,status,owner_id,lead_id,created_by,idempotency_key
) values
  ('a1300000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','Fictional review project','active','a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001'),
  ('a1300000-0000-4000-8000-000000000002','a1200000-0000-4000-8000-000000000001','Fictional archivable review project','completed','a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000002');

insert into public.project_members (project_id,user_id,role)
select
  p.id,
  u.id,
  case
    when u.id='a1100000-0000-4000-8000-000000000001' then 'owner'::public.project_role
    when u.id='a1100000-0000-4000-8000-000000000002' then 'lead'::public.project_role
    when u.id='a1100000-0000-4000-8000-000000000008' then 'viewer'::public.project_role
    else 'member'::public.project_role
  end
from public.projects as p
cross join public.app_users as u
where u.id <> 'a1100000-0000-4000-8000-000000000012';

insert into public.project_modules (
  id,project_id,name,sort_position,created_by,updated_by
) values
  ('a1500000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001','Fictional review module',0,'a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001'),
  ('a1500000-0000-4000-8000-000000000002','a1300000-0000-4000-8000-000000000002','Fictional archived review module',0,'a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001');

insert into public.tasks (
  id,project_id,module_id,title,assignee_id,reviewer_id,visibility,
  created_by,updated_by,idempotency_key
) values
  ('a1600000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional happy review','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000001'),
  ('a1600000-0000-4000-8000-000000000002','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional under progress','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000002'),
  ('a1600000-0000-4000-8000-000000000003','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional restricted permissions','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','restricted','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000003'),
  ('a1600000-0000-4000-8000-000000000004','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional owner review','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000004'),
  ('a1600000-0000-4000-8000-000000000005','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional lead review','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000005'),
  ('a1600000-0000-4000-8000-000000000006','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional admin review','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000006'),
  ('a1600000-0000-4000-8000-000000000007','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional return review','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000007'),
  ('a1600000-0000-4000-8000-000000000008','a1300000-0000-4000-8000-000000000002','a1500000-0000-4000-8000-000000000002','Fictional archived retry','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000008'),
  ('a1600000-0000-4000-8000-000000000009','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional removed assignee','a1100000-0000-4000-8000-000000000010','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000009'),
  ('a1600000-0000-4000-8000-000000000010','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional inactive assignee','a1100000-0000-4000-8000-000000000011','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000010'),
  ('a1600000-0000-4000-8000-000000000011','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional terminal lifecycle','a1100000-0000-4000-8000-000000000013','a1100000-0000-4000-8000-000000000014','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000011'),
  ('a1600000-0000-4000-8000-000000000012','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional ordinary member review','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000012'),
  ('a1600000-0000-4000-8000-000000000013','a1300000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','Fictional todo review','a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000004','project','a1100000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000013');

insert into public.task_collaborators (task_id,user_id) values
  ('a1600000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000005'),
  ('a1600000-0000-4000-8000-000000000011','a1100000-0000-4000-8000-000000000015');
insert into public.task_visibility_users (task_id,user_id) values
  ('a1600000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000007'),
  ('a1600000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000008');

set local session_replication_role = replica;
update public.tasks set status='in_progress',progress=100
where id between 'a1600000-0000-4000-8000-000000000001' and 'a1600000-0000-4000-8000-000000000012';
update public.tasks set progress=80 where id='a1600000-0000-4000-8000-000000000002';
delete from public.project_members
where project_id='a1300000-0000-4000-8000-000000000001'
  and user_id='a1100000-0000-4000-8000-000000000010';
update public.app_users set status='suspended',disabled_at=now()
where id='a1100000-0000-4000-8000-000000000011';
set local session_replication_role = origin;

set local role anon;
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review(gen_random_uuid(),gen_random_uuid()) $sql$), '42501', 'anon cannot execute submit RPC');
select is(pg_temp.sqlstate_of($sql$ select * from public.list_task_reviews(gen_random_uuid()) $sql$), '42501', 'anon cannot execute review timeline RPC');
reset role;

set local role authenticated;
select pg_temp.authenticate('review-user-03');
select is((public.submit_task_for_review('a1600000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000001')->>'was_existing')::boolean, false, 'assignee submits a 100 percent task');
select is((public.submit_task_for_review('a1600000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000001')->>'was_existing')::boolean, true, 'identical submit retry replays existing review');
select is((select status from public.get_task('a1600000-0000-4000-8000-000000000001')), 'pending_review'::public.task_status, 'submit moves task to pending review');
select is((select progress from public.get_task('a1600000-0000-4000-8000-000000000001')), 100::smallint, 'submit preserves progress');
select is((select count(*) from public.list_task_reviews('a1600000-0000-4000-8000-000000000001')), 1::bigint, 'submit retry creates one review row');
select is((select count(*) from public.list_task_status_history('a1600000-0000-4000-8000-000000000001')), 1::bigint, 'submit retry creates one status row');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000002','a1800000-0000-4000-8000-000000000001') $sql$), '23505', 'same actor key reused for another task conflicts');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000002',gen_random_uuid()) $sql$), '55000', 'progress below 100 cannot be submitted');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000013',gen_random_uuid()) $sql$), '55000', 'todo task cannot be submitted');
select is(pg_temp.sqlstate_of($sql$ select public.approve_task_review('a1600000-0000-4000-8000-000000000001',gen_random_uuid()) $sql$), '42501', 'assignee alone cannot approve pending review');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('a1600000-0000-4000-8000-000000000001',current_date,'pending',100,null,null,false,false,null,gen_random_uuid()) $sql$), '55000', 'pending review rejects progress update');

select pg_temp.authenticate('review-user-01');
select is(pg_temp.sqlstate_of(format($sql$
  select * from public.update_task(
    'a1300000-0000-4000-8000-000000000001',
    'a1600000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000001',
    'Changed while pending',null,null,
    'a1100000-0000-4000-8000-000000000003',array[]::uuid[],
    'a1100000-0000-4000-8000-000000000004','medium',null,null,null,'m',
    'project',array[]::uuid[],%L::timestamptz
  )
$sql$, (select updated_at::text from public.get_task('a1600000-0000-4000-8000-000000000001')))), '55000', 'pending review freezes update_task metadata editing');

select pg_temp.authenticate('review-user-04');
select is((public.approve_task_review('a1600000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000002')->>'was_existing')::boolean, false, 'current reviewer approves');
select is((public.approve_task_review('a1600000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000002')->>'was_existing')::boolean, true, 'identical approve retry replays existing review');
select ok((select status='completed' and completed_at is not null and completed_by='a1100000-0000-4000-8000-000000000004' from public.get_task('a1600000-0000-4000-8000-000000000001')), 'approve atomically sets completed status and authoritative metadata');
select is((select completed_at from public.get_task('a1600000-0000-4000-8000-000000000001')), (select created_at from public.list_task_reviews('a1600000-0000-4000-8000-000000000001') where action='approve'), 'completion time equals approve review time');
select is((select progress from public.get_task('a1600000-0000-4000-8000-000000000001')), 100::smallint, 'approve does not fabricate progress');
select is((select pg_catalog.array_agg(sequence order by sequence) from public.list_task_reviews('a1600000-0000-4000-8000-000000000001')), array[1,2]::bigint[], 'review sequence is stable and contiguous');
select is((select count(*) from public.list_task_reviews('a1600000-0000-4000-8000-000000000001') as r join public.list_task_status_history('a1600000-0000-4000-8000-000000000001') as h on h.transition_id=r.status_transition_id and h.task_id=r.task_id and h.actor_id=r.actor_id and h.from_status=r.from_status and h.to_status=r.to_status), 2::bigint, 'every review links the exact legal status transition');
select ok((select not (to_jsonb(r) ? 'idempotency_key') from public.list_task_reviews('a1600000-0000-4000-8000-000000000001') as r limit 1), 'review projection excludes idempotency internals');
select pg_temp.authenticate('review-user-03');
select is(pg_temp.sqlstate_of($sql$ select public.start_task('a1600000-0000-4000-8000-000000000001',gen_random_uuid()) $sql$), '55000', 'completed task cannot restart');
select is(pg_temp.sqlstate_of($sql$ select public.create_task_update('a1600000-0000-4000-8000-000000000001',current_date,'completed',100,null,null,false,false,null,gen_random_uuid()) $sql$), '55000', 'completed task rejects progress update');
select pg_temp.authenticate('review-user-04');
select is(pg_temp.sqlstate_of($sql$ select public.return_task_review('a1600000-0000-4000-8000-000000000001','reopen',gen_random_uuid()) $sql$), '55000', 'completed task cannot reopen through return');

select pg_temp.authenticate('review-user-03');
select lives_ok($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000007','a1800000-0000-4000-8000-000000000007') $sql$, 'assignee submits return-flow task');
select pg_temp.authenticate('review-user-04');
select is(pg_temp.sqlstate_of($sql$ select public.return_task_review('a1600000-0000-4000-8000-000000000007','   ',gen_random_uuid()) $sql$), '22023', 'return rejects blank reason');
select is(pg_temp.sqlstate_of($sql$ select public.return_task_review('a1600000-0000-4000-8000-000000000007',repeat('x',2001),gen_random_uuid()) $sql$), '22023', 'return rejects overlong reason');
select is((public.return_task_review('a1600000-0000-4000-8000-000000000007','  Fictional acceptance gap  ','a1800000-0000-4000-8000-000000000008')#>>'{review,return_reason}'), 'Fictional acceptance gap', 'reviewer returns with normalized required reason');
select is((public.return_task_review('a1600000-0000-4000-8000-000000000007','Fictional acceptance gap','a1800000-0000-4000-8000-000000000008')->>'was_existing')::boolean, true, 'identical return retry replays existing review');
select ok((select status='in_progress' and progress=100 and completed_at is null and completed_by is null from public.get_task('a1600000-0000-4000-8000-000000000007')), 'return restores in_progress and preserves progress without completion metadata');
select is((select reason from public.list_task_status_history('a1600000-0000-4000-8000-000000000007') where action='return_review'), 'Fictional acceptance gap', 'shared status history preserves return reason');

select pg_temp.authenticate('review-user-01');
select lives_ok(format($sql$
  select * from public.update_task(
    'a1300000-0000-4000-8000-000000000001',
    'a1600000-0000-4000-8000-000000000007',
    'a1500000-0000-4000-8000-000000000001',
    'Editable after return',null,null,
    'a1100000-0000-4000-8000-000000000003',array[]::uuid[],
    'a1100000-0000-4000-8000-000000000004','medium',null,null,null,'m',
    'project',array[]::uuid[],%L::timestamptz
  )
$sql$, (select updated_at::text from public.get_task('a1600000-0000-4000-8000-000000000007'))), 'returned task metadata becomes editable in in_progress');

select pg_temp.authenticate('review-user-05');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'collaborator alone cannot submit');
select pg_temp.authenticate('review-user-04');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'reviewer relation alone cannot submit');
select pg_temp.authenticate('review-user-06');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'creator relation alone cannot submit');
select pg_temp.authenticate('review-user-07');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'explicit visibility relation alone cannot submit');
select is((select count(*) from public.list_task_reviews('a1600000-0000-4000-8000-000000000003')), 0::bigint, 'explicit visibility user may read empty review timeline');
select pg_temp.authenticate('review-user-08');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'viewer cannot submit');
select pg_temp.authenticate('review-user-09');
select is(pg_temp.sqlstate_of($sql$ select * from public.list_task_reviews('a1600000-0000-4000-8000-000000000003') $sql$), '42501', 'unrelated member cannot probe restricted reviews');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000012',gen_random_uuid()) $sql$), '42501', 'ordinary member cannot submit project-visible task');

select pg_temp.authenticate('review-user-03');
select lives_ok($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$, 'assignee submits restricted permission task');
select is(pg_temp.sqlstate_of($sql$ select public.approve_task_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'assignee alone cannot approve');
select pg_temp.authenticate('review-user-05');
select is(pg_temp.sqlstate_of($sql$ select public.approve_task_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'collaborator alone cannot approve');
select pg_temp.authenticate('review-user-06');
select is(pg_temp.sqlstate_of($sql$ select public.return_task_review('a1600000-0000-4000-8000-000000000003','creator cannot return',gen_random_uuid()) $sql$), '42501', 'creator alone cannot return');
select pg_temp.authenticate('review-user-07');
select is(pg_temp.sqlstate_of($sql$ select public.approve_task_review('a1600000-0000-4000-8000-000000000003',gen_random_uuid()) $sql$), '42501', 'visibility user alone cannot approve');
select pg_temp.authenticate('review-user-08');
select is(pg_temp.sqlstate_of($sql$ select public.return_task_review('a1600000-0000-4000-8000-000000000003','viewer cannot return',gen_random_uuid()) $sql$), '42501', 'viewer cannot return');
select pg_temp.authenticate('review-user-04');
select lives_ok($sql$ select public.return_task_review('a1600000-0000-4000-8000-000000000003','Fictional permission return',gen_random_uuid()) $sql$, 'current reviewer may return');

select pg_temp.authenticate('review-user-01');
select lives_ok($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000004',gen_random_uuid()) $sql$, 'project owner may submit');
select lives_ok($sql$ select public.approve_task_review('a1600000-0000-4000-8000-000000000004',gen_random_uuid()) $sql$, 'project owner may approve');
select pg_temp.authenticate('review-user-02');
select lives_ok($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000005',gen_random_uuid()) $sql$, 'project lead may submit');
select lives_ok($sql$ select public.return_task_review('a1600000-0000-4000-8000-000000000005','Fictional lead return',gen_random_uuid()) $sql$, 'project lead may return');
select pg_temp.authenticate('review-user-12');
select lives_ok($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000006',gen_random_uuid()) $sql$, 'workspace admin may submit without project membership');
select lives_ok($sql$ select public.approve_task_review('a1600000-0000-4000-8000-000000000006',gen_random_uuid()) $sql$, 'workspace admin may approve without project membership');

select pg_temp.authenticate('review-user-10');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000009',gen_random_uuid()) $sql$), '42501', 'removed assignee cannot submit');
select pg_temp.authenticate('review-user-11');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000010',gen_random_uuid()) $sql$), '42501', 'inactive assignee cannot submit');

select pg_temp.authenticate('review-user-03');
select lives_ok($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000008','a1800000-0000-4000-8000-000000000009') $sql$, 'assignee submits before project archive');
select pg_temp.authenticate('review-user-01');
select lives_ok(format($sql$ select * from public.archive_project('a1300000-0000-4000-8000-000000000002',%L::timestamptz) $sql$, (select updated_at::text from public.projects where id='a1300000-0000-4000-8000-000000000002')), 'archive project after submit');
select pg_temp.authenticate('review-user-03');
select is(pg_temp.sqlstate_of($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000008','a1800000-0000-4000-8000-000000000009') $sql$), '55000', 'archived project rejects old idempotent retry');

select pg_temp.authenticate('review-user-13');
select lives_ok($sql$ select public.submit_task_for_review('a1600000-0000-4000-8000-000000000011',gen_random_uuid()) $sql$, 'terminal fixture assignee submits');
select pg_temp.authenticate('review-user-14');
select lives_ok($sql$ select public.approve_task_review('a1600000-0000-4000-8000-000000000011',gen_random_uuid()) $sql$, 'terminal fixture reviewer approves');
select pg_temp.authenticate('review-user-01');
select is((select changed from public.remove_project_member('a1300000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000013')), true, 'completed assignee no longer blocks removal');
select is((select changed from public.remove_project_member('a1300000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000014')), true, 'completed reviewer and review actor no longer block removal');
select is((select changed from public.remove_project_member('a1300000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000015')), true, 'completed collaborator no longer blocks removal');

select is(pg_temp.sqlstate_of($sql$ insert into public.task_reviews (task_id,review_seq,action,actor_id,from_status,to_status,status_transition_id,idempotency_key) values (gen_random_uuid(),1,'submit',gen_random_uuid(),'in_progress','pending_review',gen_random_uuid(),gen_random_uuid()) $sql$), '42501', 'authenticated direct review INSERT is denied');
select is(pg_temp.sqlstate_of($sql$ update public.task_reviews set return_reason='tampered' where task_id='a1600000-0000-4000-8000-000000000001' $sql$), '42501', 'authenticated direct review UPDATE is denied');
select is(pg_temp.sqlstate_of($sql$ delete from public.task_reviews where task_id='a1600000-0000-4000-8000-000000000001' $sql$), '42501', 'authenticated direct review DELETE is denied');
reset role;

select is(pg_temp.sqlstate_of($sql$ update public.task_reviews set return_reason='tampered' where task_id='a1600000-0000-4000-8000-000000000001' $sql$), '27000', 'review ledger is append-only for privileged SQL');
select is(pg_temp.sqlstate_of($sql$ delete from public.task_reviews where task_id='a1600000-0000-4000-8000-000000000001' $sql$), '27000', 'privileged review DELETE is rejected');
select is(pg_temp.sqlstate_of($sql$ update public.tasks set completed_at=now(),completed_by='a1100000-0000-4000-8000-000000000001' where id='a1600000-0000-4000-8000-000000000007' $sql$), '27000', 'direct completion metadata mutation is controlled');
select is(pg_temp.sqlstate_of($sql$ update public.tasks set title='tampered completed title' where id='a1600000-0000-4000-8000-000000000001' $sql$), '55000', 'completed task metadata is frozen for privileged SQL');
select is(pg_temp.sqlstate_of($sql$ delete from public.task_collaborators where task_id='a1600000-0000-4000-8000-000000000011' $sql$), '55000', 'completed task relation metadata is frozen');

select * from finish();
rollback;
