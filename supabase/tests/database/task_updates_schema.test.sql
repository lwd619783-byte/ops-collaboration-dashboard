begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(to_regclass('public.task_updates') is not null, 'task updates table exists');
select columns_are('public', 'task_updates', array[
  'id','task_id','update_seq','record_date','completed_content','progress',
  'issues','next_steps','needs_assistance','is_blocked','block_transition_id',
  'created_by','created_at','idempotency_key'
], 'task updates has the reviewed append-only shape');
select col_type_is('public', 'task_updates', 'update_seq', 'bigint', 'update sequence is bigint');
select col_type_is('public', 'task_updates', 'record_date', 'date', 'record date is a business date');
select col_type_is('public', 'task_updates', 'progress', 'smallint', 'progress is a bounded integer');
select col_not_null('public', 'task_updates', 'completed_content', 'completed content is required');
select col_not_null('public', 'task_updates', 'needs_assistance', 'assistance flag is required');
select col_not_null('public', 'task_updates', 'is_blocked', 'blocked snapshot is required');
select col_has_default('public', 'task_updates', 'created_at', 'created timestamp is database-derived');

select is(
  (select confdeltype::text from pg_constraint where conname='task_updates_task_id_fkey'),
  'r',
  'task deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='task_updates_created_by_fkey'),
  'r',
  'update author deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='task_updates_block_transition_id_fkey'),
  'r',
  'linked block transition deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='tasks_last_progress_by_fkey'),
  'r',
  'latest progress author deletion is restricted'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_updates_task_sequence_unique'::regclass),
  'update sequence is unique per task'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_updates_actor_idempotency_unique'::regclass),
  'update idempotency key is unique per actor'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_updates_block_transition_unique'::regclass),
  'one block transition can link to only one update'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.task_updates'::regclass),
  'task updates has RLS enabled'
);
select policies_are(
  'public',
  'task_updates',
  array['task_updates_select_authorized'],
  'task updates has one reviewed read policy'
);

select ok(to_regprocedure('public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid)') is not null, 'create update RPC exists');
select ok(to_regprocedure('public.list_task_updates(uuid)') is not null, 'list updates RPC exists');
select ok(to_regprocedure('public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid,uuid)') is null, 'create update accepts no client actor');
select is(
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('update_task_update','delete_task_update')),
  0::bigint,
  'no update or delete RPC exists for the append-only ledger'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid)'::regprocedure,
    'public.list_task_updates(uuid)'::regprocedure
  ]) and prosecdef),
  2::bigint,
  'browser progress RPCs are SECURITY DEFINER'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid)'::regprocedure,
    'public.list_task_updates(uuid)'::regprocedure
  ]) and array_to_string(proconfig, ',')='search_path=""'),
  2::bigint,
  'browser progress RPCs pin an empty search_path'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid)'::regprocedure,
    'public.list_task_updates(uuid)'::regprocedure
  ]) and pg_get_userbyid(proowner)='postgres'),
  2::bigint,
  'browser progress RPCs belong to postgres'
);

select ok(has_function_privilege('authenticated','public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid)','execute'), 'authenticated may call reviewed update RPC');
select ok(has_function_privilege('authenticated','public.list_task_updates(uuid)','execute'), 'authenticated may call reviewed list RPC');
select ok(not has_function_privilege('anon','public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid)','execute'), 'anon cannot create updates');
select ok(not has_function_privilege('service_role','public.create_task_update(uuid,date,text,integer,text,text,boolean,boolean,text,uuid)','execute'), 'service role receives no update mutation grant');
select ok(not has_function_privilege('authenticated','public.task_update_snapshot(uuid)','execute'), 'safe update snapshot remains internal');
select ok(not has_function_privilege('authenticated','public.task_progress_snapshot(uuid)','execute'), 'progress task snapshot remains internal');
select ok(not has_function_privilege('authenticated','public.task_updates_guard()','execute'), 'ledger guard remains internal');

select ok(not has_table_privilege('authenticated','public.task_updates','select'), 'authenticated has no direct update SELECT');
select ok(not has_table_privilege('authenticated','public.task_updates','insert'), 'authenticated has no direct update INSERT');
select ok(not has_table_privilege('authenticated','public.task_updates','update'), 'authenticated has no direct update UPDATE');
select ok(not has_table_privilege('authenticated','public.task_updates','delete'), 'authenticated has no direct update DELETE');
select ok(not has_table_privilege('service_role','public.task_updates','insert'), 'service role has no direct update INSERT');
select ok(not has_table_privilege('service_role','public.task_updates','update'), 'service role has no direct update UPDATE');
select ok(not has_table_privilege('service_role','public.task_updates','delete'), 'service role has no direct update DELETE');
select ok(not has_column_privilege('authenticated','public.tasks','last_progress_at','select'), 'latest progress time is detail-RPC only');
select ok(not has_column_privilege('authenticated','public.tasks','last_progress_by','select'), 'latest progress actor is detail-RPC only');

select * from finish();
rollback;
