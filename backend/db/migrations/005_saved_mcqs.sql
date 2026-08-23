-- ===========================================================================
-- Saved MCQs — bookmark questions from practice with answer + AI explanation
-- Run in Supabase SQL editor.
-- ===========================================================================

create table if not exists saved_mcqs (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete cascade,
  question_id      uuid not null references questions(id) on delete cascade,
  selected_option  text not null,
  correct_option   text not null,
  is_correct       boolean not null,
  chapter          text,
  explanation      jsonb,
  reviewed         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (student_id, question_id)
);

create index if not exists saved_mcqs_student_updated_idx
  on saved_mcqs (student_id, updated_at desc);

alter table saved_mcqs enable row level security;

drop policy if exists saved_mcqs_own on saved_mcqs;
create policy saved_mcqs_own on saved_mcqs
  for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

grant select, insert, update, delete on table public.saved_mcqs
  to authenticated, service_role;

notify pgrst, 'reload schema';
