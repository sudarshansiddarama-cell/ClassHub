# ClassHub AI Assistant — Setup

ClassHub AI is a study chatbot built into the ClassHub page. It uses the Google
Gemini Interactions API (`gemini-3.8-flash`) and keeps the Gemini API key on the
server.

## How it fits together

| Piece | Where | Purpose |
| --- | --- | --- |
| UI | `index.html` (`#ai` section) | Chat page, history drawer, streaming messages, auth gate |
| Backend | `supabase/functions/ai-chat/index.ts` | Verifies the student, stores messages, calls Gemini, proxies SSE |
| Shared helpers | `supabase/functions/_shared/gemini.ts` | Validation and SSE parsing (also used by tests) |
| Database | `supabase/migrations/20261113000000_add_ai_chat.sql` | `ai_conversations` and `ai_messages` with row-level security |
| Tests | `tests/ai-chat.test.mjs` | `node --test tests/ai-chat.test.mjs` |

Security model:

- The browser only ever gets the Supabase publishable key that is already in
  `index.html`. `GEMINI_API_KEY` exists only as a Supabase Edge Function secret.
- The Edge Function requires a signed-in user's access token, verifies it with
  Supabase Auth, and writes through RLS as that user.
- Every conversation and message belongs to `auth.uid()`. Other students cannot
  read or delete them.
- Conversations continue with Gemini's `previous_interaction_id`, so the
  student's earlier turns are understood without resending the whole chat.

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

## 2. Create a Gemini API key

1. Open <https://aistudio.google.com/apikey>.
2. Create an API key in the same Google Cloud project you want to use.
3. Keep the key private. Do not paste it into `index.html`, a commit, or chat.

## 3. Set the Edge Function secrets

```bash
supabase secrets set \
  GEMINI_API_KEY=your-key-here \
  GEMINI_MODEL=gemini-3.8-flash
```

`GEMINI_MODEL` is optional and defaults to `gemini-3.8-flash`. Do not create a
`VITE_` or `SUPABASE_` prefixed variable for the Gemini key; only the names above
are read by the function.

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
node --test tests/ai-chat.test.mjs
```

## Troubleshooting

| Message | Likely cause | Fix |
| --- | --- | --- |
| "AI chat isn't set up yet" | Migration was not applied | Run step 1 |
| "Can't reach the AI service" | Function is not deployed, wrong project, or offline | Run step 4 and check the network |
| "The AI assistant is not configured yet" | `GEMINI_API_KEY` secret is missing | Run step 3, then redeploy if needed |
| "The AI model is unavailable" | Bad `GEMINI_MODEL` value | Set it to `gemini-3.8-flash` |
| "Please sign in again" | Expired session or missing bearer token | Sign out and sign in again |
| "You're sending messages too quickly" | More than 10 messages in a minute | Wait a minute |
| "The AI is busy right now" | Google returned a transient 429/5xx demand spike | The function retries automatically; if it persists, wait a few seconds and tap **Try again** |
| Function returns 401 before your code runs | Supabase JWT verification rejected the token | Sign in again; check the project URL/key |

## Notes and limits

- Each question is capped at 4,000 characters; stored replies at 20,000
  characters. Replies are requested with a 4,096-token output cap.
- The backend allows 10 student messages per minute per account.
- Transient Gemini overloads (429/500/502/503/504) are retried up to three
  times with exponential backoff and jitter before the student sees an error.
- Gemini stores the interaction when `store: true`. If Google expires an
  interaction, the function clears the stored ID and replays the latest stored
  turns; if replay is rejected, it answers from the new message alone. The full
  ClassHub chat history remains visible in Supabase either way.
- The UI renders replies as plain text (no HTML or Markdown injection), so
  model output cannot execute scripts in ClassHub.
- Conversations are never shared between accounts.
