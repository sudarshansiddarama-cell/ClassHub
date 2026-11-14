# ClassHub — Origin and Project Knowledge

**Last updated:** 2026-11-14

**Purpose:** This is the internal reference for ClassHub's creator, origin, development journey, purpose, verified architecture, AI identity, and future direction. It separates verified facts from creator-provided context, planned direction, and unknown information.

**Retrieval-facing summary:** `knowledge/classhub/19-origin-and-creator.md`. That document is compiled into the ClassHub AI knowledge bundle. This document is the fuller human-readable reference.

**Sources:** the creator's project brief, direct inspection of the repository, and read-only inspection of the live Supabase schema. No secrets, credentials, private student data, account emails, or CR user identifiers are included.

---

## 1. Creator and authorship

**Verified by the creator and consistent with the project's history:**

- ClassHub was independently created by Sudarshan.
- It was not founded by a group of entrepreneurs, a software company, an educational institution, or a professional development team.
- Sudarshan is the person behind the project's idea, direction, decisions, and development.
- He undertook the development independently, learning technologies and solving technical problems while building the application.
- AI coding and writing tools assisted him. They did not independently create ClassHub. Authorship remains his.

Whenever someone asks who created ClassHub, the answer must include:

> ClassHub was independently created by Sudarshan.

Do not invent a founding team, company, investors, institutional partnerships, or achievements. Do not attribute the creation of ClassHub to OpenAI, ChatGPT, DeepSeek, Claude, or another AI provider. Those tools may have assisted the creator; they are not the author of the project.

**Status:** verified by the creator. The exact legal ownership structure is not described here and should not be invented.

---

## 2. Development timeline and origin

**Creator-provided:**

- The development journey began in September 2026.
- There was no sophisticated laptop-based development environment.
- ClassHub was built using an Android smartphone.
- Development involved learning terminals, repositories, databases, application code, deployment, and AI development tools while building the app.
- The creator did not begin with everything figured out; he experimented, encountered errors, investigated problems, corrected mistakes, and continued.

**Unknown:**

- The exact day in September 2026 when development started.
- A detailed dated milestone history.
- The total number of development hours.
- A complete list of every intermediate version or abandoned experiment.

Do not present ClassHub as a project that appeared overnight. The source code is the result of an ongoing learning and development effort.

---

## 3. Development environment

**Verified or creator-provided:**

- **Primary device:** an Android smartphone, not a laptop or desktop workstation.
- **Terminal:** Termux, used for command-line work, file management, Git, Node.js, and project operations.
- **Repository:** GitHub, used for source control and pushing changes.
- **Backend:** Supabase, used for authentication, Postgres, storage, realtime, and Edge Functions.
- **AI-assisted development:** Claude Code, OpenCode, DeepSeek, and ChatGPT were used at different times for coding, debugging, explanations, planning, and technical guidance.
- **Network:** development sometimes involved mobile-network connectivity problems, including difficulty reaching Supabase over Airtel. Workarounds and retries were required.

The development environment was deliberately constrained. The project's architecture reflects that: a single `index.html` front end with no build step, a hosted Supabase backend, and a small number of server-side Edge Functions. These choices make the project workable from a phone and easy to serve as a static site.

---

## 4. Tools used

| Tool | Purpose during development |
| --- | --- |
| Android smartphone | Primary development device |
| Termux | Terminal, shell, Git, Node.js, and file operations |
| OneCompiler | Writing and testing code |
| Supabase | Backend infrastructure, database, authentication, storage, realtime, Edge Functions |
| GitHub | Source repository and version control |
| Claude Code | AI-assisted development |
| OpenCode | AI-assisted coding, debugging, and project development |
| DeepSeek | AI assistance for technical work |
| ChatGPT | Technical guidance, explanations, planning, debugging, and development assistance |

**Important distinction:** these tools assisted the creator. They did not independently create ClassHub, and they are not necessarily the model currently powering ClassHub AI. The model and provider are separate deployment facts, documented in section 9.

---

## 5. Development challenges

The project was built while learning development concepts, not after mastering them. The work included:

- Learning development concepts while simultaneously building a real application.
- Working entirely from an Android phone.
- Managing repositories and project files through Termux.
- Understanding backend infrastructure and Supabase.
- Connecting front-end functionality with backend services.
- Debugging errors and correcting broken implementations.
- Working with AI coding agents and reviewing their changes.
- Managing deployment and configuration.
- Troubleshooting network connectivity.
- Finding alternatives when tools or services were unavailable or restricted.
- Understanding unfamiliar code and gradually improving the application.

Even seemingly simple tasks sometimes required many attempts. There were nights spent troubleshooting, testing commands, reading outputs, copying code, correcting errors, and trying again. The development work was not always smooth, but it continued.

The difficulty accessing Supabase through the Airtel mobile network is one concrete example. Instead of abandoning the project, the creator investigated connectivity problems, explored possible workarounds, and continued working toward deployment.

---

## 6. Project purpose and vision

ClassHub is an educational platform. Its purpose is to bring useful student-oriented tools and learning experiences together in one application. Its development should be guided by the needs of students, with the aim of providing an organised, accessible, and useful digital learning environment.

ClassHub AI is the study-assistant component of that ecosystem. It should help students understand concepts, clarify doubts, revise subjects, and interact with educational information.

**Vision versus implementation:**

- The vision describes the direction of the project.
- The implementation is what the current source code, database, and deployment actually support.
- Never tell users that a feature exists merely because it would be useful.
- Inspect the application and the verified feature-status knowledge before describing capabilities.

The long-term vision is broader than the current implementation. The current implementation is not necessarily the final form.

---

## 7. Verified application features

The detailed, current feature inventory is maintained in `knowledge/classhub/17-feature-status.md`. It separates:

- **Fully implemented and used:** Google sign-in, student profiles, accounts directory, CR tools, Notes PDF library, Test Papers, Case Studies, PDF text extraction and OCR, Topic Search, Notices, Class Chat, Class Community, ClassHub AI, and the knowledge-retrieval layer.
- **Partially implemented:** lifecycle gaps in Notes, Test Papers, Case Studies, Topic Search coverage, notices management, chat limits, community identity/privacy, and AI knowledge coverage.
- **Schema-only, legacy, or unused:** several tables, columns, views, RPCs, and a private community-media bucket that the UI does not actively use.
- **Not implemented:** teacher/admin dashboards, attendance, marks, fees, timetable, assignments, password/email login, account deletion, direct messages, push notifications when the app is closed, AI access to class PDFs, AI web browsing, multi-school tenancy, offline mode, and a public API.

Do not describe a schema-only feature as working. Do not claim that the AI can read notes, PDFs, marks, attendance, or private student records; it cannot.

---

## 8. Verified technical architecture

The repository implements a deliberately simple architecture:

- **Front end:** one `index.html` file containing HTML, CSS, and JavaScript. There is no framework, package manager, or build step.
- **Authentication:** Supabase Auth with Google OAuth. There is no password/email login form.
- **Database:** Supabase Postgres with row-level security. The browser queries it directly with the publishable key and the signed-in user's session.
- **Storage:** Supabase Storage. Notes PDFs, test-paper PDFs, and case-study photos are in public buckets; the community-media bucket is private and unused by the UI.
- **Realtime:** Supabase Realtime for notices, class chat, and community likes/comments.
- **AI backend:** one Supabase Edge Function, `ai-chat`, which verifies the user, stores messages, calls Groq's OpenAI-compatible chat-completions API, and streams the reply back as server-sent events.
- **AI provider key:** `GROQ_API_KEY` exists only as an Edge Function secret. The browser never receives it.
- **Knowledge retrieval:** a zero-dependency Markdown-to-TypeScript generator, a BM25-style lexical retriever, and a generated knowledge bundle. No embeddings, vector database, extra API provider, or new secret.
- **AI database:** `ai_conversations` and `ai_messages` with owner-only RLS policies. The migration is `supabase/migrations/20261113000000_add_ai_chat.sql`.
- **Hosting:** the front end is static and can be served by any static host. The backend is the Supabase project plus the deployed Edge Function.

For detailed technical references, see:

- `knowledge/classhub/01-overview.md`
- `knowledge/classhub/11-classhub-ai.md`
- `knowledge/classhub/12-ai-backend.md`
- `knowledge/classhub/13-database.md`
- `knowledge/classhub/14-security.md`
- `knowledge/classhub/16-dependencies-and-decisions.md`

---

## 9. AI identity and provider configuration

Four identities must not be confused:

1. **ClassHub** — the application.
2. **Sudarshan** — its independent creator.
3. **ClassHub AI** — the assistant component inside ClassHub.
4. **The configured AI model and provider** — the technology powering the assistant.

Verified configuration:

- The backend calls **Groq's OpenAI-compatible chat-completions API**.
- The default model is **`openai/gpt-oss-120b`**.
- The optional `GROQ_MODEL` environment variable can override the model.
- The `openai/` prefix in the model ID is part of the model name, not the provider of this chat. The inference provider is Groq.
- The exact production `GROQ_MODEL` value, provider account status, and whether the live function matches the latest source are external deployment facts and are not verified from the repository.

How the assistant should answer:

- If asked **“Who created ClassHub?”**, include the exact sentence: “ClassHub was independently created by Sudarshan.”
- If asked **“Are you Groq, DeepSeek, or OpenAI?”**, identify the actual configuration: ClassHub AI, powered by Groq using the configured model (default `openai/gpt-oss-120b`). Do not claim to be ChatGPT merely because the assistant is an AI. Do not claim to be DeepSeek merely because DeepSeek was used during development.
- Do not confuse the tools used to build the application with the model currently powering it.
- If the provider or model cannot be established at runtime, say so honestly instead of guessing.
- Do not volunteer model or provider details when the student has not asked.

Security note: model and provider names are not secrets. `GROQ_API_KEY`, access tokens, service-role keys, account emails, private student data, and CR user identifiers must never be revealed or written into documentation.

---

## 10. Known limitations and future direction

**Known limitations:**

- The AI answers app questions only from the maintained knowledge base and conversation; it does not inspect the live app, database, or deployment.
- The AI does not receive the student's PDFs, notes, marks, attendance, profile email, class chat, community posts, or other students' data.
- The AI does not browse the internet, accept file uploads, understand images, or process voice input.
- The knowledge base can become stale if the app changes and the Markdown documents are not regenerated.
- The live deployment state, provider account status, and production `GROQ_MODEL` override are external and may differ from the repository.
- ClassHub AI is study help, not medical advice.

**Future direction:**

- ClassHub is still evolving; the current implementation is not necessarily its final form.
- The stated direction is to improve design, usability, intelligence, reliability, architecture, and educational value without losing sight of why the project was created.
- Every improvement should have a reason. Every new capability should solve a genuine student problem.
- Every AI response should be honest. Every UI change should improve the student experience. Every technical change should respect the existing working system.
- Stability should not be sacrificed for unnecessary complexity.

**No verified roadmap:** the repository contains no maintained roadmap or TODO list. Specific future features are unknown, not planned, unless a maintainer adds evidence to this knowledge base. Do not promise features that do not exist.

---

## Appendix: status and verification

The knowledge base uses five statuses:

- **verified** — confirmed in the source code, migrations, live schema, or the creator's direct account.
- **partial** — works but has important limits or missing related actions.
- **schema-only** — a table, column, policy, or bucket exists but no active UI feature uses it.
- **planned** — a stated intention with some evidence, but not implemented.
- **unknown** — not verified; do not guess.

Verified in this document:

- The creator's identity and independent authorship.
- The September 2026 start date and Android/Termux development environment, as provided by the creator.
- The tools used, as provided by the creator.
- The application features and technical architecture, as inspected in the repository and live schema.
- Groq as the configured AI provider and `openai/gpt-oss-120b` as the default model, from the backend source.

Not verified here:

- Detailed dated milestones, total development duration, or a complete history of intermediate versions.
- The exact production deployment state and whether the live `ai-chat` function matches the latest source.
- The production `GROQ_MODEL` override and provider account status.
- Any awards, funding, investors, partnerships, or institutional recognition. None are verified; do not invent them.

When a fact is not verified, say so clearly. A truthful “not verified” answer is better than a confident invented story.
