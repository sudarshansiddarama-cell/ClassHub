# ClassHub

ClassHub is a single-page class space with notes, papers, case studies, notices,
class chat, community posts, and an AI study assistant. It was independently
created by Sudarshan, who began building it in September 2026 on an Android
phone.

- `index.html` — the entire front-end app.
- `supabase/` — Edge Functions and database migrations.
- `knowledge/classhub/` — verified ClassHub documentation used by AI retrieval.
- `docs/CLASSHUB_ORIGIN_AND_PROJECT_KNOWLEDGE.md` — creator, origin, tools, challenges, verified architecture, AI identity, and future direction.
- `scripts/build-classhub-knowledge.mjs` — regenerates the knowledge bundle.
- `tests/` — Node tests for the AI chat helpers and retrieval.

The AI assistant setup (Groq key, Edge Function deployment, migration, knowledge
base) is documented in [AI_CHAT_SETUP.md](AI_CHAT_SETUP.md).
