-- ===========================================================================
-- Ask Textbook conversation history (ChatGPT-style threads)
-- Run in Supabase SQL editor.
-- ===========================================================================

create table if not exists textbook_chats (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  title        text not null default 'New chat',
  book_filter  text,  -- null = both | fsc_bio_part1 | fsc_bio_part2
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists textbook_chats_student_updated_idx
  on textbook_chats (student_id, updated_at desc);

create table if not exists textbook_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references textbook_chats(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  sources     jsonb not null default '[]'::jsonb,
  citation    text,
  created_at  timestamptz not null default now()
);

create index if not exists textbook_chat_messages_chat_created_idx
  on textbook_chat_messages (chat_id, created_at);

alter table textbook_chats enable row level security;
alter table textbook_chat_messages enable row level security;

drop policy if exists textbook_chats_own on textbook_chats;
create policy textbook_chats_own on textbook_chats
  for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

drop policy if exists textbook_chat_messages_own on textbook_chat_messages;
create policy textbook_chat_messages_own on textbook_chat_messages
  for all
  using (
    exists (
      select 1 from textbook_chats c
      where c.id = chat_id and c.student_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from textbook_chats c
      where c.id = chat_id and c.student_id = auth.uid()
    )
  );

-- API access (service_role bypasses RLS; grants still required for PostgREST)
grant select, insert, update, delete on table public.textbook_chats to authenticated, service_role;
grant select, insert, update, delete on table public.textbook_chat_messages to authenticated, service_role;

notify pgrst, 'reload schema';
