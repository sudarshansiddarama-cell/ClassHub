# ClassHub AI Assistant — Setup

ClassHub AI is a study chatbot built into the ClassHub page. It uses Groq's
OpenAI-compatible Chat Completions API with the `openai/gpt-oss-120b` model and
keeps the Groq API key on the server.

## How it fits together

| Piece | Where | Purpose |
| --- | --- | --- |
| UI | `index.html` (`#ai` section) | Chat page, history drawer, streaming messages, auth gate |
| Backend | `supabase/functions/ai-chat/index.ts` | Verifies the student, stores messages, calls Groq, proxies SSE |
| Shared helpers | `supabase/functions/_shared/groq.ts` | Validation, history mapping, and SSE parsing (also used by tests) |
| Knowledge source | `knowledge/classhub/*.md` | Human-edited, verified documentation about the ClassHub app |
| Origin and identity | `knowledge/classhub/19-origin-and-creator.md` | Creator, development journey, tools, challenges, purpose, and AI provider identity |
| Project history | `docs/CLASSHUB_ORIGIN_AND_PROJECT_KNOWLEDGE.md` | Full human-readable origin and project knowledge reference |
| Knowledge builder | `scripts/build-classhub-knowledge.mjs` | Generates the typed retrieval bundle from the Markdown |
| Retrieval | `supabase/functions/_shared/classhub-rag.ts` | Detects app questions, ranks chunks, builds the grounded prompt |
| Generated bundle | `supabase/functions/_shared/classhub-knowledge.generated.ts` | Do not edit by hand; regenerate with the builder |
| Database | `supabase/migrations/20261113000000_add_ai_chat.sql` | `ai_conversations` and `ai_messages` with row-level security |
| Tests | `tests/ai-chat.test.mjs`, `tests/classhub-rag.test.mjs` | `node --test tests/*.test.mjs` |

Security model:

- The browser only ever gets the Supabase publishable key that is already in
  `index.html`. `GROQ_API_KEY` exists only as a Supabase Edge Function secret.
- The Edge Function requires a signed-in user's access token, verifies it with
  Supabase Auth, and writes through RLS as that user.
- Every conversation and message belongs to `auth.uid()`. Other students cannot
  read or delete them.
- Groq is stateless, so the function replays the latest stored turns on every
  request.

## 1. Apply the database migration

Open the Supabase dashboard for project `oekunhqzhwwjfrcaiuit` → **SQL Editor**,
paste the contents of:

```
supabase/migrations/20261113000000_add_ai_chat.sql
```

and run it once. It is idempotent (`if not exists`, `drop policy if exists`), so
re-running is safe.

With the Supabase CLI you can instead run:

```bash
supabase link --project-ref oekunhqzhwwjfrcaiuit
supabase db push
```

Quick verification in the SQL editor:

```sql
select tablename, policyname, cmd
from pg_policies
where tablename in ('ai_conversations', 'ai_messages')
order by tablename, policyname;
```

You should see select/insert/update/delete policies on `ai_conversations` and
select/insert/delete policies on `ai_messages`.

## 2. Create a Groq API key

1. Open <https://console.groq.com/keys>.
2. Create an API key.
3. Keep the key private. Do not paste it into `index.html`, a commit, or chat.

## 3. Set the Edge Function secrets

```bash
supabase secrets set \
  GROQ_API_KEY=your-key-here \
  GROQ_MODEL=openai/gpt-oss-120b
```

`GROQ_MODEL` is optional and defaults to `openai/gpt-oss-120b`, a production
Groq model with streaming support. Any other Groq chat model that supports
OpenAI-compatible streaming can be used. Do not create a `VITE_` or
`SUPABASE_` prefixed variable for the Groq key; only the names above are read by
the function.

## 4. Deploy the function

```bash
supabase functions deploy ai-chat
```

The function is invoked by the page at:

```
https://oekunhqzhwwjfrcaiuit.supabase.co/functions/v1/ai-chat
```

If you deploy from the dashboard instead, deploy the `supabase/functions`
directory and make sure the entry point is `ai-chat/index.ts`.

## 5. Test it

1. Open ClassHub, sign in with Google, and choose **AI Assistant** in the
   sidebar, the home quick actions, or the **More** sheet.
2. Ask a question. The reply should appear word-by-word. The Stop button ends
   the stream.
3. Reload the page and reopen **AI Assistant**. The conversation and its title
   should still be listed under **Your chats**.
4. Delete a chat and confirm it disappears after a reload.
5. Open the browser console and watch for errors; check **Edge Functions → Logs**
   in Supabase if the request fails.

Local backend testing (needs the Supabase CLI and Docker):

```bash
cp supabase/functions/.env.example supabase/functions/.env
# put your real key in supabase/functions/.env
supabase functions serve ai-chat --env-file supabase/functions/.env
```

Front-end helper tests run without any credentials:

```bash
node --test tests/*.test.mjs
```

## Knowledge retrieval (RAG)

ClassHub AI answers questions about the app itself from a verified knowledge
base instead of guessing:

1. `supabase/functions/_shared/classhub-rag.ts` detects whether the student's
   message is about ClassHub (product name, app nouns, authentication, storage,
   AI conversations, and so on). General study questions are left alone.
2. For an app question, it tokenises the message, expands common synonyms, and
   scores chunks from `classhub-knowledge.generated.ts` with a small BM25-style
   lexical ranker. It uses no embeddings, vector database, or extra API.
3. The best three chunks above the score and coverage thresholds are inserted
   into the system prompt, capped at 5,000 characters. The rest of the docs are
   never sent.
4. The prompt tells the model to answer only from the retrieved knowledge, to
   state whether a feature is verified, partial, schema-only, planned, or
   unknown, and to say honestly when the knowledge base does not cover the
   question.
5. If an app question has no matching chunk, the model is told not to guess and
   to say that the answer is not verified in the current knowledge base.

For creator questions, the prompt requires the exact sentence: "ClassHub was
independently created by Sudarshan." For AI identity questions, it identifies
the Groq-powered configuration and the configured model, distinguishes the
development tools from the model currently in use, and does not claim to be
ChatGPT, OpenAI, or DeepSeek.

To update the knowledge:

```bash
# 1. Edit or add a document in knowledge/classhub/
# 2. Regenerate the typed bundle
node scripts/build-classhub-knowledge.mjs
# 3. Check that the bundle is current and retrieval still passes
node scripts/build-classhub-knowledge.mjs --check
node --test tests/*.test.mjs
```

Never put `GROQ_API_KEY`, tokens, passwords, student emails, private data, or the
CR user id in `knowledge/classhub/`. The generated file is bundled with the
server-side Edge Function, not sent to the browser.

## Troubleshooting

| Message | Likely cause | Fix |
| --- | --- | --- |
| "AI chat isn't set up yet" | Migration was not applied | Run step 1 |
| "Can't reach the AI service" | Function is not deployed, wrong project, or offline | Run step 4 and check the network |
| "The AI assistant is not configured yet" | `GROQ_API_KEY` secret is missing | Run step 3, then redeploy if needed |
| "The AI assistant is not configured correctly" | Groq rejected the API key | Check that `GROQ_API_KEY` is valid and active |
| "The AI could not process that request" | Bad `GROQ_MODEL` value or malformed request | Set it to `openai/gpt-oss-120b` |
| "This conversation is too long" | Groq returned a 413 for the request size | Start a new chat and try again |
| "Please sign in again" | Expired session or missing bearer token | Sign out and sign in again |
| "You're sending messages too quickly" | More than 10 messages in a minute | Wait a minute |
| "The AI is busy right now" | Groq returned a 429 rate limit or 498 queue full | Wait a few seconds and tap **Try again** |
| "The AI service is temporarily unavailable" | Groq returned a 5xx error | Wait a moment and retry |
| "The AI took too long to respond" | The 120-second request timeout elapsed | Retry with a shorter question |
| "The connection to the AI was interrupted" | The stream ended before completion | Tap **Try again** |
| Function returns 401 before your code runs | Supabase JWT verification rejected the token | Sign in again; check the project URL/key |

## Notes and limits

- Each question is capped at 4,000 characters; stored replies at 20,000
  characters. Replies are requested with a 4,096-token output cap.
- The backend allows 10 student messages per minute per account.
- The function sends the system prompt plus the latest 20 stored messages to
  Groq on every turn. Stored history is limited to the same 20-message window.
- App-specific questions add at most three retrieved knowledge chunks, capped at
  5,000 characters. General study questions do not trigger retrieval.
- The generated knowledge bundle is checked by `tests/classhub-rag.test.mjs`; it
  must be regenerated after any `knowledge/classhub/*.md` change.
- For `openai/gpt-oss-*` models the request sets `reasoning_effort: "low"` and
  `include_reasoning: false`, so the student sees only the final answer. Other
  `GROQ_MODEL` values omit those parameters.
- The legacy `ai_conversations.last_interaction_id` column is left in place for
  database compatibility but is no longer read or written.
- The UI renders replies as plain text (no HTML or Markdown injection), so
  model output cannot execute scripts in ClassHub.
- Conversations are never shared between accounts.
