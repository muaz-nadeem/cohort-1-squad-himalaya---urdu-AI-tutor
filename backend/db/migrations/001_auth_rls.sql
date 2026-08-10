-- ===========================================================================
-- Auth + RLS migration
-- Run in the Supabase SQL editor AFTER the base schema.
--
-- Identity model: students.id MUST equal auth.users.id (auth.uid()).
-- FastAPI uses the service role key (bypasses RLS) but still verifies JWTs.
-- RLS is defense-in-depth if the anon key is ever exposed to the browser.
-- ===========================================================================

-- Document identity contract on students
comment on table students is
  'Student profile. Primary key id must equal auth.users.id (Supabase Auth).';

-- ---------------------------------------------------------------------------
-- Per-student tables: enable RLS + owner policies
-- ---------------------------------------------------------------------------
alter table students enable row level security;
alter table sessions enable row level security;
alter table student_attempts enable row level security;
alter table weak_spots enable row level security;
alter table weekly_plans enable row level security;
alter table daily_plans enable row level security;

-- students
drop policy if exists students_select_own on students;
create policy students_select_own on students
  for select to authenticated
  using (id = auth.uid());

drop policy if exists students_insert_own on students;
create policy students_insert_own on students
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists students_update_own on students;
create policy students_update_own on students
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- sessions
drop policy if exists sessions_select_own on sessions;
create policy sessions_select_own on sessions
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists sessions_insert_own on sessions;
create policy sessions_insert_own on sessions
  for insert to authenticated
  with check (student_id = auth.uid());

drop policy if exists sessions_update_own on sessions;
create policy sessions_update_own on sessions
  for update to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- student_attempts
drop policy if exists attempts_select_own on student_attempts;
create policy attempts_select_own on student_attempts
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists attempts_insert_own on student_attempts;
create policy attempts_insert_own on student_attempts
  for insert to authenticated
  with check (student_id = auth.uid());

-- weak_spots
drop policy if exists weak_spots_select_own on weak_spots;
create policy weak_spots_select_own on weak_spots
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists weak_spots_insert_own on weak_spots;
create policy weak_spots_insert_own on weak_spots
  for insert to authenticated
  with check (student_id = auth.uid());

drop policy if exists weak_spots_update_own on weak_spots;
create policy weak_spots_update_own on weak_spots
  for update to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- weekly_plans
drop policy if exists weekly_plans_select_own on weekly_plans;
create policy weekly_plans_select_own on weekly_plans
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists weekly_plans_insert_own on weekly_plans;
create policy weekly_plans_insert_own on weekly_plans
  for insert to authenticated
  with check (student_id = auth.uid());

drop policy if exists weekly_plans_update_own on weekly_plans;
create policy weekly_plans_update_own on weekly_plans
  for update to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- daily_plans
drop policy if exists daily_plans_select_own on daily_plans;
create policy daily_plans_select_own on daily_plans
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists daily_plans_insert_own on daily_plans;
create policy daily_plans_insert_own on daily_plans
  for insert to authenticated
  with check (student_id = auth.uid());

drop policy if exists daily_plans_update_own on daily_plans;
create policy daily_plans_update_own on daily_plans
  for update to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Catalog tables: authenticated read-only (writes via service role only)
-- ---------------------------------------------------------------------------
alter table concepts enable row level security;
alter table questions enable row level security;
alter table textbook_chunks enable row level security;
alter table mnemonic_chunks enable row level security;

drop policy if exists concepts_select_authenticated on concepts;
drop policy if exists concepts_select_public on concepts;
create policy concepts_select_public on concepts
  for select
  using (true);

drop policy if exists questions_select_authenticated on questions;
drop policy if exists questions_select_public on questions;
-- Temporary public read of MCQ bank (tighten later when API always uses service_role).
create policy questions_select_public on questions
  for select
  using (true);

drop policy if exists textbook_chunks_select_authenticated on textbook_chunks;
create policy textbook_chunks_select_authenticated on textbook_chunks
  for select to authenticated
  using (true);

drop policy if exists mnemonic_chunks_select_authenticated on mnemonic_chunks;
create policy mnemonic_chunks_select_authenticated on mnemonic_chunks
  for select to authenticated
  using (true);

-- Note: no INSERT/UPDATE/DELETE policies for catalog tables for `authenticated`.
-- Service role bypasses RLS and remains the write path for ingest scripts.
