-- ===========================================================================
-- MDCAT AI Tutor — Supabase schema
-- Run this in the Supabase SQL editor (or `psql`) once, in order.
-- ===========================================================================

-- pgvector for embeddings
create extension if not exists vector;
-- gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- students — profile + onboarding data
-- ---------------------------------------------------------------------------
create table if not exists students (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  email            text unique,
  exam             text not null default 'MDCAT 2026',
  subject          text not null default 'Biology',
  level            text check (level in ('just_starting', 'halfway', 'almost_done')),
  daily_time       text check (daily_time in ('30min', '1hr', '2hr_plus')),
  diagnostic_done  boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- concepts — Biology concepts mapped to MDCAT syllabus weightage
-- ---------------------------------------------------------------------------
create table if not exists concepts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  chapter         text not null,
  mdcat_weightage int  not null default 1,     -- 1..5, higher = more exam weight
  ptb_chapter_ref text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- questions — full MCQ bank, past papers tagged by concept + difficulty
-- ---------------------------------------------------------------------------
create table if not exists questions (
  id             uuid primary key default gen_random_uuid(),
  concept_id     uuid references concepts(id) on delete set null,
  chapter        text,
  book           text,                         -- fsc_part1 | fsc_part2
  unit           text,
  difficulty     int not null default 1 check (difficulty in (1, 2, 3)),
  question_text  text not null,
  options        jsonb not null,               -- [{ "key": "A", "text": "..." }, ...]
  correct_option text not null,                -- "A" | "B" | "C" | "D"
  explanation    text,                         -- optional pre-written fallback
  source         text,                         -- e.g. "kips_unit1" | "mdcat_2023"
  source_type    text check (source_type is null or source_type in (
                   'academy_test', 'flp', 'past_paper', 'most_repeated'
                 )),
  year           int,
  created_at     timestamptz not null default now()
);

create index if not exists questions_chapter_idx on questions (chapter);
create index if not exists questions_book_chapter_idx on questions (book, chapter);

-- ---------------------------------------------------------------------------
-- textbook_chunks — FSc textbook passages + figure/table captions (pgvector)
-- Embeddings: local fastembed nomic-embed-text-v1.5 => 768 dimensions
-- ---------------------------------------------------------------------------
create table if not exists textbook_chunks (
  id              uuid primary key default gen_random_uuid(),
  concept_id      uuid references concepts(id) on delete set null,
  concept         text,
  book            text,                              -- fsc_bio_part1 | fsc_bio_part2
  chapter         text,
  page_number     int,                               -- printed textbook page
  pdf_page_index  int,                               -- 0-based PDF page index
  content_type    text not null default 'text'
                  check (content_type in ('text', 'figure', 'table')),
  content         text not null,
  embedding       vector(768),
  created_at      timestamptz not null default now()
);

-- approximate nearest-neighbour index for cosine similarity
create index if not exists textbook_chunks_embedding_idx
  on textbook_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists textbook_chunks_book_page_idx
  on textbook_chunks (book, page_number);

-- ---------------------------------------------------------------------------
-- sessions — session-level tracking for dashboard + progress
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  mode        text not null check (mode in (
                'diagnostic', 'drill', 'chapter_practice',
                'full_length_practice', 'full_length_timed', 'custom'
              )),
  concept_id  uuid references concepts(id) on delete set null,
  chapter     text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  score       int,                             -- correct answers this session
  total       int                              -- total answered this session
);

-- ---------------------------------------------------------------------------
-- student_attempts — every answer logged (powers all weak-spot analysis)
-- ---------------------------------------------------------------------------
create table if not exists student_attempts (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  question_id     uuid not null references questions(id) on delete cascade,
  concept_id      uuid references concepts(id) on delete set null,
  session_id      uuid references sessions(id) on delete set null,
  selected_option text not null,
  is_correct      boolean not null,
  created_at      timestamptz not null default now()
);

create index if not exists student_attempts_student_idx on student_attempts(student_id);
create index if not exists student_attempts_concept_idx on student_attempts(concept_id);

-- ---------------------------------------------------------------------------
-- weak_spots — pre-computed weak spot ranking, updated after each session
-- ---------------------------------------------------------------------------
create table if not exists weak_spots (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  concept_id     uuid not null references concepts(id) on delete cascade,
  accuracy_pct   numeric not null default 0,
  attempts       int not null default 0,
  correct_streak int not null default 0,       -- consecutive correct (mastery detection)
  last_wrong_at  timestamptz,
  priority_score numeric not null default 0,    -- higher = drill sooner
  updated_at     timestamptz not null default now(),
  unique (student_id, concept_id)
);

-- ---------------------------------------------------------------------------
-- weekly_plans — generated every Sunday from weak-spot scores
-- ---------------------------------------------------------------------------
create table if not exists weekly_plans (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  week_start  date not null,
  plan        jsonb not null,                  -- [{ day, concept_id, concept, minutes, question_count }]
  created_at  timestamptz not null default now(),
  unique (student_id, week_start)
);

-- ---------------------------------------------------------------------------
-- daily_plans — adaptive day plan from weak spots
-- ---------------------------------------------------------------------------
create table if not exists daily_plans (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  plan_date   date not null,
  items       jsonb not null,
  created_at  timestamptz not null default now(),
  unique (student_id, plan_date)
);

-- ---------------------------------------------------------------------------
-- mnemonic_chunks — memory tricks from MDCAT mnemonic PDF
-- ---------------------------------------------------------------------------
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

-- ===========================================================================
-- match_chunks — cosine-similarity retrieval RPC used by the RAG pipeline
-- ===========================================================================
create or replace function match_chunks(
  query_embedding vector(768),
  match_count     int default 2,
  filter_concept  text default null,
  filter_book     text default null
)
returns table (
  id             uuid,
  content        text,
  concept        text,
  chapter        text,
  book           text,
  page_number    int,
  content_type   text,
  similarity     float
)
language sql stable
as $$
  select
    tc.id,
    tc.content,
    tc.concept,
    tc.chapter,
    tc.book,
    tc.page_number,
    tc.content_type,
    1 - (tc.embedding <=> query_embedding) as similarity
  from textbook_chunks tc
  where tc.embedding is not null
    and (filter_concept is null or tc.concept = filter_concept)
    and (filter_book is null or tc.book = filter_book)
  order by tc.embedding <=> query_embedding
  limit match_count;
$$;

-- random sample for mixed practice / platform FLP
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
