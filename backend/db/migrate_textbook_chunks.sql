-- ===========================================================================
-- Migration: extend textbook_chunks for multimodal RAG + printed page citations
-- Run this in the Supabase SQL editor if schema.sql was already applied earlier.
-- ===========================================================================

alter table textbook_chunks
  add column if not exists book text,
  add column if not exists page_number int,
  add column if not exists pdf_page_index int,
  add column if not exists content_type text default 'text';

-- Backfill null content_type
update textbook_chunks set content_type = 'text' where content_type is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'textbook_chunks_content_type_check'
  ) then
    alter table textbook_chunks
      add constraint textbook_chunks_content_type_check
      check (content_type in ('text', 'figure', 'table'));
  end if;
end $$;

create index if not exists textbook_chunks_book_page_idx
  on textbook_chunks (book, page_number);

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
