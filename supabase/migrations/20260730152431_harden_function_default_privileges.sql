-- PostgreSQL's built-in function default grants EXECUTE to PUBLIC globally.
-- A schema-scoped revoke cannot subtract that global default, so the project
-- migration role must first lose the global PUBLIC grant.
alter default privileges for role postgres
  revoke execute on functions from public;

-- Future public RPCs must receive an explicit, reviewed EXECUTE grant.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
