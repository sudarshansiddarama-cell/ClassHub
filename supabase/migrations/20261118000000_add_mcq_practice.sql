-- ClassHub MCQ Practice: AI-generated quiz sessions built from uploaded PDFs.
--
-- Run once in the Supabase SQL Editor, or apply with:  supabase db push
--
-- Security model:
--  * Every table is RLS-enabled and scoped to auth.uid().
--  * mcq_answer_keys has NO select policy for authenticated users: the correct
--    answer and explanation are inserted by the server and never readable by the
--    browser. This prevents answer-key leakage before a student checks an answer.
--  * Scores are computed server-side (mcq Edge Function); the client never
--    submits or is trusted with a score.

/* ================= 1. QUIZ SESSIONS ================= */
create table if not exists public.mcq_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_pdf_id uuid not null references public.pdfs(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'generating'
    check (status in ('generating','ready','failed')),
  total_questions int not null default 0 check (total_questions >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mcq_sessions_user_updated_idx
  on public.mcq_sessions (user_id, updated_at desc);
create index if not exists mcq_sessions_pdf_idx
  on public.mcq_sessions (source_pdf_id);

/* ================= 2. GENERATED QUESTIONS (sanitised) =================
   options is a JSONB array of exactly 4 {index, text} objects.
   No correct answer and no explanation here — those live in mcq_answer_keys.
*/
create table if not exists public.mcq_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mcq_sessions(id) on delete cascade,
  question_text text not null check (char_length(question_text) between 1 and 2000),
  options jsonb not null default '[]'
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  subject_topic text,
  source_page text,
  difficulty text not null default 'medium'
    check (difficulty in ('easy','medium','hard')),
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists mcq_questions_session_order_idx
  on public.mcq_questions (session_id, order_index asc);

/* ================= 3. SERVER-ONLY ANSWER KEY =================
   correct_option_index and explanation are write-only for the client.
   The mcq Edge Function (service_role) reads them to validate answers.
*/
create table if not exists public.mcq_answer_keys (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.mcq_questions(id) on delete cascade unique,
  correct_option_index int not null check (correct_option_index between 0 and 3),
  explanation text not null default '' check (char_length(explanation) between 0 and 1000),
  created_at timestamptz not null default now()
);

/* ================= 4. STUDENT ATTEMPTS ================= */
create table if not exists public.mcq_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mcq_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score int not null default 0 check (score >= 0),
  total int not null default 0 check (total >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  time_taken_seconds int check (time_taken_seconds >= 0)
);

create index if not exists mcq_attempts_user_session_idx
  on public.mcq_attempts (user_id, session_id, started_at desc);

/* ================= 5. STUDENT RESPONSES ================= */
create table if not exists public.mcq_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.mcq_attempts(id) on delete cascade,
  question_id uuid not null references public.mcq_questions(id) on delete cascade,
  selected_option_index int not null check (selected_option_index between 0 and 3),
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);

create index if not exists mcq_responses_attempt_idx
  on public.mcq_responses (attempt_id);

create unique index if not exists mcq_responses_attempt_question_idx
  on public.mcq_responses (attempt_id, question_id);

/* ================= RLS ================= */
alter table public.mcq_sessions enable row level security;
alter table public.mcq_questions enable row level security;
alter table public.mcq_answer_keys enable row level security;
alter table public.mcq_attempts enable row level security;
alter table public.mcq_responses enable row level security;

revoke all on public.mcq_sessions from anon;
revoke all on public.mcq_questions from anon;
revoke all on public.mcq_answer_keys from anon;
revoke all on public.mcq_attempts from anon;
revoke all on public.mcq_responses from anon;

grant select, insert on public.mcq_sessions to authenticated;
grant select on public.mcq_questions to authenticated;
grant insert on public.mcq_answer_keys to authenticated;   -- insert only, no select
grant select, insert on public.mcq_attempts to authenticated;
grant select, insert on public.mcq_responses to authenticated;

/* Sessions: own only */
drop policy if exists "Students read their own mcq sessions" on public.mcq_sessions;
create policy "Students read their own mcq sessions"
  on public.mcq_sessions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Students create their own mcq sessions" on public.mcq_sessions;
create policy "Students create their own mcq sessions"
  on public.mcq_sessions for insert to authenticated
  with check (user_id = (select auth.uid()));

/* Questions: readable only for the student's own sessions */
drop policy if exists "Students read questions for their own sessions" on public.mcq_questions;
create policy "Students read questions for their own sessions"
  on public.mcq_questions for select to authenticated
  using (
    exists (
      select 1 from public.mcq_sessions s
      where s.id = mcq_questions.session_id
        and s.user_id = (select auth.uid())
    )
  );

/* Answer keys: insert only (server validates). No select policy -> client can never read. */
drop policy if exists "Students insert answer keys for their own sessions" on public.mcq_answer_keys;
create policy "Students insert answer keys for their own sessions"
  on public.mcq_answer_keys for insert to authenticated
  with check (
    exists (
      select 1 from public.mcq_questions q
      join public.mcq_sessions s on s.id = q.session_id
      where q.id = mcq_answer_keys.question_id
        and s.user_id = (select auth.uid())
    )
  );

/* Attempts: own only */
drop policy if exists "Students read their own mcq attempts" on public.mcq_attempts;
create policy "Students read their own mcq attempts"
  on public.mcq_attempts for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Students create their own mcq attempts" on public.mcq_attempts;
create policy "Students create their own mcq attempts"
  on public.mcq_attempts for insert to authenticated
  with check (user_id = (select auth.uid()));

/* Responses: own attempt only */
drop policy if exists "Students read responses for their own attempts" on public.mcq_responses;
create policy "Students read responses for their own attempts"
  on public.mcq_responses for select to authenticated
  using (
    exists (
      select 1 from public.mcq_attempts a
      where a.id = mcq_responses.attempt_id
        and a.user_id = (select auth.uid())
    )
  );
drop policy if exists "Students create responses for their own attempts" on public.mcq_responses;
create policy "Students create responses for their own attempts"
  on public.mcq_responses for insert to authenticated
  with check (
    exists (
      select 1 from public.mcq_attempts a
      where a.id = mcq_responses.attempt_id
        and a.user_id = (select auth.uid())
    )
  );
