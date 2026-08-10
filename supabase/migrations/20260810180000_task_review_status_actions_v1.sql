-- Task 3.5 - reserve review actions in the shared status-history vocabulary.
--
-- PostgreSQL requires newly added enum values to be committed before a later
-- migration can use them in constraints and function bodies. The review
-- schema and RPCs therefore live in the immediately following migration.

alter type public.task_status_action add value if not exists 'submit_review';
alter type public.task_status_action add value if not exists 'approve_review';
alter type public.task_status_action add value if not exists 'return_review';
