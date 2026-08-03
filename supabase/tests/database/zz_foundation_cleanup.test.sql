begin;

select plan(1);

select ok(
  to_regprocedure('public.default_privilege_probe()') is null,
  'the rolled-back default privilege probe is absent'
);

select * from finish();

rollback;
