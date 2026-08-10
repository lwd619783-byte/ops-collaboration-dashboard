begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(to_regclass('public.task_status_history') is not null, 'task status history exists');
select columns_are('public', 'task_status_history', array[
  'id','task_id','from_status','to_status','action','reason','actor_id',
  'idempotency_key','transition_seq','created_at'
], 'task status history is structured and minimal');
select is(
  (select enum_range(null::public.task_status_action)::text),
  '{start,block,resume,cancel,submit_review,approve_review,return_review}',
  'shared status action vocabulary contains only reviewed Task 3.3 and Task 3.5 actions'
);
select is(
  (select confdeltype::text from pg_constraint where conname='tasks_blocked_by_fkey'),
  'r',
  'current blocker actor deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='task_status_history_task_id_fkey'),
  'r',
  'history task deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='task_status_history_actor_id_fkey'),
  'r',
  'history actor deletion is restricted'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_status_history_task_sequence_unique'::regclass),
  'transition sequence is unique per task'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_status_history_actor_idempotency_unique'::regclass),
  'transition idempotency key is unique per actor'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.task_status_history'::regclass),
  'history has RLS enabled'
);
select policies_are(
  'public',
  'task_status_history',
  array['task_status_history_select_authorized'],
  'history has one reviewed read policy'
);

select ok(to_regprocedure('public.start_task(uuid,uuid)') is not null, 'start RPC exists');
select ok(to_regprocedure('public.block_task(uuid,text,uuid)') is not null, 'block RPC exists');
select ok(to_regprocedure('public.resume_task(uuid,uuid)') is not null, 'resume RPC exists');
select ok(to_regprocedure('public.cancel_task(uuid,uuid)') is not null, 'cancel RPC exists');
select ok(to_regprocedure('public.list_task_status_history(uuid)') is not null, 'history RPC exists');
select ok(to_regprocedure('public.start_task(uuid,uuid,uuid)') is null, 'start accepts no client actor');
select ok(to_regprocedure('public.block_task(uuid,text,uuid,uuid)') is null, 'block accepts no client actor');
select is(
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('set_task_status','update_task_status')),
  0::bigint,
  'no public generic target-status setter exists'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.start_task(uuid,uuid)'::regprocedure,
    'public.block_task(uuid,text,uuid)'::regprocedure,
    'public.resume_task(uuid,uuid)'::regprocedure,
    'public.cancel_task(uuid,uuid)'::regprocedure,
    'public.list_task_status_history(uuid)'::regprocedure
  ]) and prosecdef),
  5::bigint,
  'all browser status RPCs are SECURITY DEFINER'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.start_task(uuid,uuid)'::regprocedure,
    'public.block_task(uuid,text,uuid)'::regprocedure,
    'public.resume_task(uuid,uuid)'::regprocedure,
    'public.cancel_task(uuid,uuid)'::regprocedure,
    'public.list_task_status_history(uuid)'::regprocedure
  ]) and array_to_string(proconfig, ',')='search_path=""'),
  5::bigint,
  'all browser status RPCs pin an empty search_path'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.start_task(uuid,uuid)'::regprocedure,
    'public.block_task(uuid,text,uuid)'::regprocedure,
    'public.resume_task(uuid,uuid)'::regprocedure,
    'public.cancel_task(uuid,uuid)'::regprocedure,
    'public.list_task_status_history(uuid)'::regprocedure
  ]) and pg_get_userbyid(proowner)='postgres'),
  5::bigint,
  'all browser status RPCs belong to postgres'
);
select ok(has_function_privilege('authenticated','public.start_task(uuid,uuid)','execute'), 'authenticated can start');
select ok(has_function_privilege('authenticated','public.block_task(uuid,text,uuid)','execute'), 'authenticated can block');
select ok(has_function_privilege('authenticated','public.resume_task(uuid,uuid)','execute'), 'authenticated can resume');
select ok(has_function_privilege('authenticated','public.cancel_task(uuid,uuid)','execute'), 'authenticated can cancel subject to policy');
select ok(has_function_privilege('authenticated','public.list_task_status_history(uuid)','execute'), 'authenticated can read authorized history');
select ok(not has_function_privilege('anon','public.start_task(uuid,uuid)','execute'), 'anon cannot start');
select ok(not has_function_privilege('service_role','public.start_task(uuid,uuid)','execute'), 'service_role gets no start grant');
select ok(not has_function_privilege('authenticated','public.execute_task_transition(uuid,public.task_status_action,text,uuid)','execute'), 'generic internal transition helper is revoked');
select ok(not has_function_privilege('service_role','public.execute_task_transition(uuid,public.task_status_action,text,uuid)','execute'), 'service_role cannot invoke internal transition helper');
select ok(not has_function_privilege('authenticated','public.task_status_snapshot(uuid)','execute'), 'status snapshot is internal');
select ok(not has_table_privilege('authenticated','public.task_status_history','select'), 'authenticated has no direct history SELECT');
select ok(not has_table_privilege('authenticated','public.task_status_history','insert'), 'authenticated has no direct history INSERT');
select ok(not has_table_privilege('authenticated','public.task_status_history','update'), 'authenticated has no direct history UPDATE');
select ok(not has_table_privilege('authenticated','public.task_status_history','delete'), 'authenticated has no direct history DELETE');
select ok(not has_table_privilege('service_role','public.task_status_history','insert'), 'service_role gets no history INSERT');
select ok(not has_column_privilege('authenticated','public.tasks','blocker_reason','select'), 'current blocker reason is detail-RPC only');

select * from finish();
rollback;
