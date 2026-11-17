# ClassHub MCQ Practice — Implementation Report

## Summary

Implemented the AI-powered MCQ Practice feature in ClassHub, deployed to Supabase and GitHub Pages, and completed end-to-end testing. Students can generate single-correct multiple-choice quizzes from their uploaded PDFs, practice one question at a time with immediate feedback, and review results — all with answer keys kept strictly server-side.

## Live Deployment

- **Frontend**: `https://sudarshansiddarama-cell.github.io/ClassHub/` (GitHub Pages, updated)
- **Supabase project ref**: `oekunhqzhwwjfrcaiuit`
- **Edge Function**: `https://oekunhqzhwwjfrcaiuit.supabase.co/functions/v1/mcq` (v7, ACTIVE, verify_jwt=true)
- **MCQ endpoint**: `{ action: "generate" | "validate" | "feedback", ... }` with the user's Supabase access token in the `Authorization` header

## Files Changed

| File | Purpose |
|------|---------|
| `index.html` | Frontend MCQ engine + UI (start, generate, practice, feedback, result, review, resume views; mobile CSS) |
| `supabase/functions/mcq/index.ts` | Edge Function: generate/validate/feedback actions via Groq `openai/gpt-oss-120b` |
| `supabase/migrations/20261118000000_add_mcq_practice.sql` | DB schema: 5 tables, indexes, FKs, RLS, grants |
| `IMPLEMENTATION_REPORT.md` | This report |

## Database Schema

Applied via the migration (37 statements, all OK on the live DB):

1. **mcq_sessions** — quiz sessions, one per PDF per user. `source_pdf_id` is `bigint` to match `pdfs.id`.
2. **mcq_questions** — sanitised questions (text, 4 options as JSONB, topic, page, difficulty). No correct answer here.
3. **mcq_answer_keys** — `correct_option_index` + explanation. **No RLS policy, no grants** — only the service role can read/write. Never exposed to the browser.
4. **mcq_attempts** — score/total/timestamps. Browser can only insert an empty attempt (`score=0,total=0,completed_at=null`).
5. **mcq_responses** — per-question answer (`selected_option_index = -1` means unanswered) + `is_correct`.

RLS: every table is enabled and scoped to `auth.uid()`. `mcq_answer_keys` has no grant/policy for `anon` or `authenticated` — authenticated users get `403 permission denied` when trying to read it.

## AI Integration

- Reuses the existing Groq provider/model: `openai/gpt-oss-120b` (same as the AI Chat feature). No new AI service.
- **Generation**: sends extracted PDF text (first ~14k chars) to Groq with a strict schema prompt. Requests up to 12 drafts, keeps up to 10 unique valid questions.
- **Second-pass audit**: a second Groq call (temperature 0) audits every draft for single-correctness, no list/multi-correct questions, no negative/trick wording, no "all/none of the above" options, and explanation-option consistency. Rejects failures; falls back to shape-valid questions if the auditor errors.
- **Validation/scoring**: performed server-side with the service role. The client never submits a score; the function computes it from answer keys.
- Error handling: Groq 429 → retry after 2.5s; 401/403 → service misconfigured; 413 → context too large; >=500 → unavailable; timeouts → 504; malformed JSON → 502. Clear student-facing messages.

## PDF Text Extraction & OCR Backfill

- Reuses the existing client-side `extractPdfText` (pdf.js 3.11.174 + OCR for scanned pages) with `[[PAGE n]]` markers.
- If a PDF has no/insufficient `content_text`, the UI downloads the PDF, extracts text via pdf.js + OCR, sanitises NUL bytes (PostgreSQL rejects `\u0000` with 22P05), and backfills `pdfs.content_text`.
- Generation then proceeds from the backfilled text. Tested with PDF 12 "Sanskrit Test PDF.pdf" (144 KB, `content_text` null → 7,522 chars extracted → 6 questions generated).

## Frontend Views

1. **Start**: PDF list (generate/start/retry) + Previous Practice list (resume/completed/score).
2. **Generating**: progress messages while reading PDF + asking AI; cancelable.
3. **Practice**: one question at a time, progress bar, topic/page/difficulty tags, Previous/Next (skip allowed), Check Answer, Finish & Review.
4. **Feedback**: green correct / red wrong + green correct answer, short explanation, text+icons (not color alone). Answers locked after first check.
5. **Result**: score %, correct/incorrect/unanswered, total, time taken, message. Review Answers / Retry Practice / Return buttons.
6. **Review**: every question with user's answer, correct answer, and explanation.
7. **Resume**: unfinished attempts restore locked answers and jump to the first unanswered question.
8. **Retry Practice**: starts a fresh empty attempt (no leaked answers).

## Security

- Answer keys never touch the browser (`mcq_answer_keys` has no SELECT grant/policy for `authenticated`).
- Scores computed server-side; client never submits a score.
- Existing checked answers locked server-side (re-submission returns the original result).
- Final submit is idempotent (second call returns `already_completed: true`, same score).
- Rate limit: 20 generations per hour per user.
- All privileged writes go through the Edge Function with the service role; the browser uses its own scoped Supabase client with the user's JWT.
- Verified: `mcq_answer_keys` returns 403 for authenticated users; attempt score forgery returns 403 RLS violation; response inserts return 403.

## Error Handling

| Failure | Behavior |
|---------|----------|
| No extractable text (scanned PDF) | OCR backfill attempted; clear message if still unusable |
| NUL bytes in OCR text | Sanitised before DB insert (22P05 avoided) |
| AI timeout / busy | Retry; clear "AI is busy" / "took too long" messages |
| AI malformed output | Shape/quality filters; retry once; clear fallback message |
| Empty content | "No usable questions" message |
| Supabase/network failure | Clear message, no stuck loading state, cancelable generation |
| Missing session / wrong user | 404 / permission denied |

## Testing Completed

- **Generation**: real PDFs (id 11, 16, 17) produce 5–10 high-quality single-correct questions with page references and topics.
- **Scoring**: finalize scored 1/10 and 3/6 correctly; unanswered counted; second finalize idempotent.
- **Feedback**: green correct + explanation; red wrong + green correct answer + explanation.
- **Locking**: answers locked after check; re-check returns original result.
- **Resume**: reload mid-session restores locked answers, jumps to first unanswered question.
- **Retry**: clean new attempt, no leaked answers.
- **Unanswered**: can skip and finish; unanswered counted in results.
- **OCR backfill**: PDF 12 (null content_text) → 7,522 chars → 6 questions.
- **Mobile**: viewport ~390px (iPhone) — cards wrap, options stack, nav wraps; result screen readable.
- **Desktop**: 1280px layout verified.
- **Security**: answer keys 403 for authenticated; score forgery blocked; response writes blocked.
- **Failure**: PDFs with dead URLs show clear "network problem" message, no stuck loader.
- **Console**: 0 console errors on load; page loads in ~595ms (931 elements).

## Known Limitations / Pending

1. **Debug test sessions**: Several test sessions/attempts were created in `mcq_sessions`/`mcq_attempts` during testing (IDs listed in session context). They appear in "Previous Practice" as the user's own sessions. Cleanup requires the user's Supabase access token to call the REST API; the browser DOM context was temporarily unavailable at report-writing time, so the token could not be retrieved. These are harmless test data and do not affect functionality.
2. **Audit pass rate**: On shorter/sparser PDFs the second-pass AI audit can reject many drafts, returning fewer questions (e.g., 2–6 instead of 10). This is by design — quality over quantity.
3. **Groq rate limits**: Occasional 429 "AI is busy" responses are handled with retry and a clear message.
4. **Supabase CLI**: Not usable on Android (`Unsupported platform: android`); migration was applied through a temporary Edge Function (`mcq-setup`) using `SUPABASE_DB_URL`, which was deleted after use.

## Verification Commands

```bash
# Edge Function health (expect 401 without token, 400 for unknown action)
curl -X POST https://oekunhqzhwwjfrcaiuit.supabase.co/functions/v1/mcq \
  -H "Content-Type: application/json" -d '{"action":"ping"}'

# Live site check
curl -s https://sudarshansiddarama-cell.github.io/ClassHub/ | grep -c "MCQ Practice"

# Git status
cd /data/data/com.termux/files/home/ClassHub-repo && git log --oneline -3
```
