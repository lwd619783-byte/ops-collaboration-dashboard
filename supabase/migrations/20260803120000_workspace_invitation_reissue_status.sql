-- Task 1.4 round 2 audit: completed reissue for existing invitees.
--
-- Part 1 of 2: adds the 'reissue_prepared' status value ONLY. PostgreSQL does
-- not allow using a newly added enum value inside the transaction that added
-- it (55P04), so this migration must commit before any migration references
-- 'reissue_prepared'. The actual reissue model, RPCs and directory changes
-- live in the sibling 20260803120100 migration.

alter type public.workspace_invitation_status
  add value if not exists 'reissue_prepared' after 'prepared';
