-- ClassHub: AI-formatted page text for the reading mode.
--
-- Each PDF page is cleaned once by the format-pdf Edge Function and stored
-- here as a JSON object: { "1": "markdown…", "2": "markdown…" }.
-- The reader uses it when present, so opening a book never waits for AI.
--
-- Rows are written only by the Edge Function with the service role.

alter table public.pdfs
  add column if not exists formatted_pages jsonb;

comment on column public.pdfs.formatted_pages is
  'AI-cleaned Markdown per PDF page, keyed by page number. Written by the format-pdf Edge Function.';

-- Atomic per-page upsert: two pages can be formatted concurrently without
-- one overwriting the other's result.
create or replace function public.classhub_set_formatted_page(
  p_pdf_id bigint,
  p_page integer,
  p_text text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pdfs
  set formatted_pages =
        coalesce(formatted_pages, '{}'::jsonb)
        || jsonb_build_object(p_page::text, p_text)
  where id = p_pdf_id;
$$;

revoke all on function public.classhub_set_formatted_page(bigint, integer, text)
  from public, anon, authenticated;
grant execute on function public.classhub_set_formatted_page(bigint, integer, text)
  to service_role;
