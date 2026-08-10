begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(to_regclass('public.task_reviews') is not null, 'task reviews table exists');
select columns_are('public', 'task_reviews', array[
  'id','task_id','review_seq','action','actor_id','from_status','to_status',
  'return_reason','status_transition_id','created_at','idempotency_key'
], 'task reviews has the reviewed append-only shape');
select is(
  (select enum_range(null::public.task_review_action)::text),
  '{submit,approve,return}',
  'review action vocabulary is closed'
);
select col_type_is('public', 'task_reviews', 'review_seq', 'bigint', 'review sequence is bigint');
select col_not_null('public', 'task_reviews', 'status_transition_id', 'every review links a status transition');
select col_has_default('public', 'task_reviews', 'created_at', 'review time is database-derived');
select col_type_is('public', 'tasks', 'completed_at', 'timestamp with time zone', 'task has authoritative completion time');
select col_type_is('public', 'tasks', 'completed_by', 'uuid', 'task has authoritative completion actor');

select is(
  (select confdeltype::text from pg_constraint where conname='task_reviews_task_id_fkey'),
  'r',
  'review task deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='task_reviews_actor_id_fkey'),
  'r',
  'review actor deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='task_reviews_status_transition_id_fkey'),
  'r',
  'linked status transition deletion is restricted'
);
select is(
  (select confdeltype::text from pg_constraint where conname='tasks_completed_by_fkey'),
  'r',
  'completion actor deletion is restricted'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_reviews_task_sequence_unique'::regclass),
  'review sequence is unique per task'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_reviews_actor_idempotency_unique'::regclass),
  'review idempotency is unique per actor'
);
select ok(
  (select indisunique from pg_index where indexrelid='public.task_reviews_status_transition_unique'::regclass),
  'one status transition can link to only one review'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.task_reviews'::regclass),
  'task reviews has RLS enabled'
);
select policies_are(
  'public',
  'task_reviews',
  array['task_reviews_select_authorized'],
  'task reviews has one reviewed read policy'
);

select ok(to_regprocedure('public.submit_task_for_review(uuid,uuid)') is not null, 'submit review RPC exists');
select ok(to_regprocedure('public.approve_task_review(uuid,uuid)') is not null, 'approve review RPC exists');
select ok(to_regprocedure('public.return_task_review(uuid,text,uuid)') is not null, 'return review RPC exists');
select ok(to_regprocedure('public.list_task_reviews(uuid)') is not null, 'review timeline RPC exists');
select ok(to_regprocedure('public.submit_task_for_review(uuid,uuid,uuid)') is null, 'submit accepts no client actor');
select ok(to_regprocedure('public.approve_task_review(uuid,uuid,uuid)') is null, 'approve accepts no client actor');
select ok(to_regprocedure('public.return_task_review(uuid,text,uuid,uuid)') is null, 'return accepts no client actor');
select is(
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('set_task_status','set_task_review_status','reopen_task')),
  0::bigint,
  'no generic status setter or completed reopen RPC exists'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.submit_task_for_review(uuid,uuid)'::regprocedure,
    'public.approve_task_review(uuid,uuid)'::regprocedure,
    'public.return_task_review(uuid,text,uuid)'::regprocedure,
    'public.list_task_reviews(uuid)'::regprocedure
  ]) and prosecdef),
  4::bigint,
  'all browser review RPCs are SECURITY DEFINER'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.submit_task_for_review(uuid,uuid)'::regprocedure,
    'public.approve_task_review(uuid,uuid)'::regprocedure,
    'public.return_task_review(uuid,text,uuid)'::regprocedure,
    'public.list_task_reviews(uuid)'::regprocedure
  ]) and array_to_string(proconfig, ',')='search_path=""'),
  4::bigint,
  'all browser review RPCs pin an empty search_path'
);
select is(
  (select count(*) from pg_proc where oid = any(array[
    'public.submit_task_for_review(uuid,uuid)'::regprocedure,
    'public.approve_task_review(uuid,uuid)'::regprocedure,
    'public.return_task_review(uuid,text,uuid)'::regprocedure,
    'public.list_task_reviews(uuid)'::regprocedure
  ]) and pg_get_userbyid(proowner)='postgres'),
  4::bigint,
  'all browser review RPCs belong to postgres'
);

select ok(has_function_privilege('authenticated','public.submit_task_for_review(uuid,uuid)','execute'), 'authenticated may call reviewed submit RPC');
select ok(has_function_privilege('authenticated','public.approve_task_review(uuid,uuid)','execute'), 'authenticated may call reviewed approve RPC');
select ok(has_function_privilege('authenticated','public.return_task_review(uuid,text,uuid)','execute'), 'authenticated may call reviewed return RPC');
select ok(has_function_privilege('authenticated','public.list_task_reviews(uuid)','execute'), 'authenticated may call reviewed timeline RPC');
select ok(not has_function_privilege('anon','public.submit_task_for_review(uuid,uuid)','execute'), 'anon cannot submit review');
select ok(not has_function_privilege('service_role','public.approve_task_review(uuid,uuid)','execute'), 'service role receives no review mutation grant');
select ok(not has_function_privilege('authenticated','public.execute_task_review(uuid,public.task_review_action,text,uuid)','execute'), 'generic review helper remains internal');
select ok(not has_function_privilege('authenticated','public.task_review_snapshot(uuid)','execute'), 'review snapshot remains internal');
select ok(not has_function_privilege('authenticated','public.task_review_task_snapshot(uuid)','execute'), 'completion task snapshot remains internal');
select ok(not has_function_privilege('authenticated','public.task_reviews_guard()','execute'), 'review guard remains internal');

select ok(not has_table_privilege('authenticated','public.task_reviews','select'), 'authenticated has no direct review SELECT');
select ok(not has_table_privilege('authenticated','public.task_reviews','insert'), 'authenticated has no direct review INSERT');
select ok(not has_table_privilege('authenticated','public.task_reviews','update'), 'authenticated has no direct review UPDATE');
select ok(not has_table_privilege('authenticated','public.task_reviews','delete'), 'authenticated has no direct review DELETE');
select ok(not has_table_privilege('service_role','public.task_reviews','insert'), 'service role has no direct review INSERT');
select ok(not has_table_privilege('service_role','public.task_reviews','update'), 'service role has no direct review UPDATE');
select ok(not has_table_privilege('service_role','public.task_reviews','delete'), 'service role has no direct review DELETE');
select ok(not has_column_privilege('authenticated','public.tasks','completed_at','select'), 'completion time is detail-RPC only');
select ok(not has_column_privilege('authenticated','public.tasks','completed_by','select'), 'completion actor is detail-RPC only');

select * from finish();
rollback;
