-- ===========================================================================
-- Temporary: allow reading the MCQ bank without authenticated-role RLS.
-- Run in Supabase SQL editor.
--
-- Why: backend often uses the anon key; after 001_auth_rls, only the
-- `authenticated` role could SELECT questions, so chapter counts became 0.
-- App login still gates the UI; this only unlocks DB reads of the bank.
-- Re-tighten later when the API always uses the service_role key.
-- ===========================================================================

drop policy if exists questions_select_authenticated on questions;
drop policy if exists questions_select_public on questions;

-- Readable by anon + authenticated (PostgREST roles used by the API key).
create policy questions_select_public on questions
  for select
  using (true);

-- Keep catalog readable the same way (safe metadata).
drop policy if exists concepts_select_authenticated on concepts;
drop policy if exists concepts_select_public on concepts;
create policy concepts_select_public on concepts
  for select
  using (true);
