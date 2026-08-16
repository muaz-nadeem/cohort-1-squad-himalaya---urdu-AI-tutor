-- ===========================================================================
-- Fix Ask Textbook chats visibility to the API (run after 003)
-- ===========================================================================

-- Confirm tables exist (should return textbook_chats / textbook_chat_messages)
-- select to_regclass('public.textbook_chats'), to_regclass('public.textbook_chat_messages');

grant select, insert, update, delete on table public.textbook_chats to authenticated, service_role;
grant select, insert, update, delete on table public.textbook_chat_messages to authenticated, service_role;

-- Force PostgREST to see the new tables (fixes PGRST205 schema cache misses)
notify pgrst, 'reload schema';
