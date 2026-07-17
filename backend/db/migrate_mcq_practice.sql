-- ===========================================================================
-- MCQ practice platform migration
-- Run once in Supabase SQL editor after schema.sql
-- ===========================================================================

alter table questions add column if not exists book text;
alter table questions add column if not exists source_type text;
alter table questions add column if not exists unit text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_source_type_check'
  ) then
    alter table questions add constraint questions_source_type_check
      check (source_type is null or source_type in (
        'academy_test', 'flp', 'past_paper', 'most_repeated'
      ));
  end if;
end $$;

create index if not exists questions_chapter_idx on questions (chapter);
create index if not exists questions_book_chapter_idx on questions (book, chapter);
create index if not exists questions_source_type_idx on questions (source_type);

alter table students add column if not exists diagnostic_done boolean not null default false;

alter table sessions drop constraint if exists sessions_mode_check;
alter table sessions add constraint sessions_mode_check check (
  mode in (
    'diagnostic',
    'drill',
    'chapter_practice',
    'full_length_practice',
    'full_length_timed',
    'custom'
  )
);

create table if not exists daily_plans (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  plan_date   date not null,
  items       jsonb not null,
  created_at  timestamptz not null default now(),
  unique (student_id, plan_date)
);

create table if not exists mnemonic_chunks (
  id          uuid primary key default gen_random_uuid(),
  topic       text,
  content     text not null,
  page_number int,
  embedding   vector(768),
  created_at  timestamptz not null default now()
);

create index if not exists mnemonic_chunks_embedding_idx
  on mnemonic_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 50);

create or replace function sample_questions(
  match_count    int default 25,
  filter_chapter text default null,
  filter_book    text default null
)
returns setof questions
language sql stable
as $$
  select *
  from questions
  where (filter_chapter is null or chapter = filter_chapter)
    and (filter_book is null or book = filter_book)
  order by random()
  limit match_count;
$$;

create or replace function match_mnemonic_chunks(
  query_embedding vector(768),
  match_count     int default 3
)
returns table (
  id          uuid,
  topic       text,
  content     text,
  page_number int,
  similarity  float
)
language sql stable
as $$
  select
    mc.id,
    mc.topic,
    mc.content,
    mc.page_number,
    1 - (mc.embedding <=> query_embedding) as similarity
  from mnemonic_chunks mc
  where mc.embedding is not null
  order by mc.embedding <=> query_embedding
  limit match_count;
$$;
