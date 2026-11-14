---
id: security
title: Authentication, security, and privacy
status: verified
keywords: security, privacy, RLS, row level security, policies, authentication, authorization, secrets, API keys, publishable key, service role, storage, public bucket, private data, CR, anonymous, exposure, risk
---

## Security model

ClassHub has three layers of protection:

1. **Supabase Auth** identifies the student with Google OAuth.
2. **Row-level security (RLS)** decides which rows each role can read or write.
3. **Application checks** hide or disable actions in the UI.

The UI checks are for usability; RLS is the real database boundary.

## Keys and secrets

- The browser contains the Supabase URL and publishable key. These are intended to be public.
- The AI provider key (`GROQ_API_KEY`) is an Edge Function secret and is never sent to the browser.
- There is no service-role key in `index.html`.
- The knowledge base and generated retrieval file must never contain keys, tokens, passwords, or private student data.
- `.gitignore` excludes `supabase/functions/.env`, which is where local secrets live.

If a secret is ever committed or pasted into a public place, it should be rotated immediately.

## Authentication

Google OAuth is the only login method. Supabase Auth issues the session and access token. The AI Edge Function verifies the token with `auth.getUser()` and uses the caller's token for all database work, so the AI function cannot bypass RLS.

## RLS and data ownership

The strongest ownership rules are on AI data:

- `ai_conversations` and `ai_messages` are accessible only to authenticated users.
- Every row must belong to `auth.uid()`.
- AI messages must additionally belong to a conversation owned by the caller.
- The browser can read only the signed-in student's own conversations and messages.

Profiles and community data are readable by authenticated students, which is intended for a class directory/feed.

Notices are public to read; only the CR can insert or delete.

## CR restrictions

The CR is identified by a hard-coded user UUID in the front end and SQL. The CR can:

- Publish and delete notices.
- Delete any community post.
- Read the authors of anonymous community posts through a guarded RPC.
- Read account emails through a guarded RPC.

The CR cannot bypass AI ownership RLS, read private AI chats, or use a service-role key from the browser.

## Known weaknesses and partial protections

These are verified from the current policies and UI:

- **Anonymous writes on study content.** `pdfs`, `test_paper_folders`, `photos`, and their storage buckets allow anonymous inserts. The UI does not require sign-in for Notes, Test Papers, or Case Studies uploads. This means a signed-out visitor with the publishable key could potentially add content.
- **Public study files.** The `pdfs` and `photos` buckets are public. Anyone with a file URL can open the file. This is intentional for sharing class material but means URLs should be treated as public.
- **Legacy `notes` table.** Anonymous read, insert, and delete policies exist even though the table is unused.
- **Chat.** `chat_messages` allows anonymous inserts and reads at the database level, although the UI gates the room behind sign-in. Messages have no `user_id`, so authorship relies on the sender-name text and local device memory.
- **Reactions.** `chat_reactions` and `community_reactions` have permissive policies, but no UI uses them.
- **Comment anonymity.** Community comments are labelled anonymous in the UI but store `user_id`, and authenticated students can read the rows.
- **Case folder deletion.** A permissive delete policy exists for `case_folders`, though the UI has no delete action.
- **Role management.** The CR's identity is hard-coded rather than stored in a managed role, so changing the CR requires code and SQL changes.

These are documented as security notes, not as features to advertise.

## Private student information

The knowledge base and AI should never reveal:

- Email addresses, except that the CR sees them in the Accounts directory.
- Passwords, tokens, session data, or API keys.
- AI conversation contents belonging to another student.
- Anonymous post authors, except to the CR.
- Any row-level data from `auth.users`.

The AI does not receive student records. It only receives the current student's message, recent AI chat history, and retrieved ClassHub documentation.

## Storage access

- `pdfs` bucket: public read; anonymous and authenticated upload; CR-only delete policy exists; no UI delete.
- `photos` bucket: public read; anonymous and authenticated upload; no delete policy.
- `community-media` bucket: private; authenticated upload into a folder named after the user's id; authenticated read. No UI uses it.

## Deployment security

The Edge Function must keep `GROQ_API_KEY` as a Supabase secret. Do not create a `VITE_` or `SUPABASE_`-prefixed variable for it, and do not place it in `index.html`.

The Supabase project's Auth redirect URLs, Google OAuth client, and Edge Function secrets are configured outside the repository and must be checked in the Supabase dashboard.

Status: verified from code and live policies. Security is only as strong as the current RLS policies and deployment configuration; both can change outside this repository.
