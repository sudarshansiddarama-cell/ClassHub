-- ClassHub MCQ Practice: user-uploaded MCQs from text.
--
-- Students can paste typed questions in text format. These are stored per
-- user per topic. When a student starts MCQ Practice for a topic that has
-- uploaded questions, those take priority over AI generation.
--
-- Security model:
--  * RLS enabled, scoped to auth.uid().
--  * Students can only read/insert their own rows.

create table if not exists public.mcq_uploaded_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 200),
  question_text text not null check (char_length(question_text) between 1 and 2000),
  options jsonb not null default '[]'
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option_index int not null check (correct_option_index between 0 and 3),
  explanation text not null default '' check (char_length(explanation) between 0 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists mcq_uploaded_questions_user_topic_idx
  on public.mcq_uploaded_questions (user_id, topic);
create index if not exists mcq_uploaded_questions_topic_idx
  on public.mcq_uploaded_questions (topic);

alter table public.mcq_uploaded_questions enable row level security;

revoke all on public.mcq_uploaded_questions from anon, authenticated;
grant select, insert on public.mcq_uploaded_questions to authenticated;

drop policy if exists "Students read their own uploaded mcq questions" on public.mcq_uploaded_questions;
create policy "Students read their own uploaded mcq questions"
  on public.mcq_uploaded_questions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Students insert their own uploaded mcq questions" on public.mcq_uploaded_questions;
create policy "Students insert their own uploaded mcq questions"
  on public.mcq_uploaded_questions for insert to authenticated
  with check (user_id = (select auth.uid()));
