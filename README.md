# ClassHub

ClassHub is a single-page class space with notes, papers, case studies, notices,
class chat, community posts, and an AI study assistant.

- `index.html` — the entire front-end app.
- `supabase/` — Edge Functions and database migrations.
- `knowledge/classhub/` — verified ClassHub documentation used by AI retrieval.
- `scripts/build-classhub-knowledge.mjs` — regenerates the knowledge bundle.
- `tests/` — Node tests for the AI chat helpers and retrieval.

The AI assistant setup (Groq key, Edge Function deployment, migration, knowledge
base) is documented in [AI_CHAT_SETUP.md](AI_CHAT_SETUP.md).
