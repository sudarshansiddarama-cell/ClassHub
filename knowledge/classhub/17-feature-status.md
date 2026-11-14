---
id: feature-status
title: Feature status: implemented, partial, and not implemented
status: verified
keywords: features, implemented, incomplete, partial, missing, status, verified, schema-only, unused, planned, unknown, roadmap, what works, what does not work, feature list
---

## Feature status overview

ClassHub's features fall into four verified groups:

- **Fully implemented and used**: the feature is present in the front end and backed by working Supabase tables, policies, storage, or functions.
- **Partially implemented (incomplete or limited)**: the feature works but is missing important related actions or has significant limits.
- **Schema-only, legacy, or unused**: a table, column, policy, or bucket exists, but no active UI feature uses it.
- **Not implemented**: commonly assumed features that do not exist in the app.

There is no maintained roadmap that verifies planned features, so unlisted future ideas are unknown rather than planned. The detailed lists follow in the next sections.

## Fully implemented and used

These features are implemented in the front end and backed by working Supabase tables, policies, storage, or functions:

- **Google sign-in and sign-out** through Supabase Auth.
- **Student profiles**: display name, bio, status, Google avatar, and profile row creation.
- **Accounts directory** for signed-in students, with search by name, status, and bio.
- **CR tools**: publish notices, delete any community post, see anonymous post authors, and see account emails.
- **Notes library**: five hard-coded subjects, subcategories, PDF browsing, filename search, upload, public open link, and re-scan.
- **Test Papers library**: PYQ and Current Year collections, folders, PDF upload, browsing, filename search, and re-scan.
- **Case Studies library**: case folders, multi-photo upload, unfiled photos, and public view links.
- **PDF text extraction and OCR** with PDF.js and Tesseract.js, stored in `pdfs.content_text` with page markers.
- **Topic Search** across all PDFs using substring search, spelling variants, full-text search, client-side hit extraction, page numbers, and an in-app PDF viewer with highlights.
- **Notices**: public reading, CR publishing, realtime toast/sound, unread badge, and browser notifications while the page is open.
- **Class Chat**: one shared room, latest 100 messages, sign-in gate, sending, and realtime inserts.
- **Class Community**: signed-in text posts, optional anonymity, likes, anonymous comments, CR moderation, and realtime likes/comments.
- **ClassHub AI**: private conversations, saved messages, streaming replies, Stop, retry, conversation history, delete chat, and automatic titles.
- **ClassHub knowledge retrieval (RAG)**: documentation chunks, app-question detection, lexical retrieval, grounded prompt injection, and an honest "not verified" fallback.
- **Theme toggle**, responsive navigation, connection indicator, loading states, empty states, and toast messages.

## Partially implemented

These features work but have important limits or missing related actions:

- **Notes lifecycle**: no delete, rename, move, or subject-edit UI. Only one upload job at a time. OCR is English-only by default.
- **Test Papers lifecycle**: no rename, delete, move, or reorder UI for folders or papers.
- **Case Studies management**: no rename, delete, caption, tag, or in-app gallery. Photos open in a new tab. `photos.folder_id` has no foreign key.
- **Topic Search coverage**: depends on extracted text; image-only PDFs without successful OCR are not searchable. Extraction is capped at 2,000 pages and about 9 million characters.
- **Notices management**: no edit, delete, pin, schedule, rich text, or attachments. Browser notifications work only while the page is open.
- **Class Chat**: no direct messages, rooms, threads, attachments, editing, deletion, moderation UI, or reactions. Authorship is not stored as a user id.
- **Community identity and privacy**: comments are labelled anonymous but store `user_id`; anonymous post authors are hidden only from non-CR users. No post or comment editing UI; comments cannot be deleted in the UI.
- **Community media**: database columns and a private bucket exist, but there is no upload flow.
- **Accounts**: no profile-detail page, follow/message action, or avatar upload.
- **AI knowledge coverage**: answers are limited to the maintained knowledge base. Deployment state, live data, and external provider behavior are not verified.
- **Security posture**: several study-content and chat writes are more permissive at the database level than the UI suggests.

## Schema-only, legacy, or unused

These objects exist but are not active user-facing features:

- `notes` table: legacy; Notes uses `pdfs`. No rows and no UI.
- `community_comments` table: legacy; the UI uses `post_comments`.
- `community_reactions` table: no UI or front-end calls.
- `chat_reactions` table: no UI or front-end calls.
- `community_feed` view: exists, but the UI calls `community_get_feed`.
- `community_toggle_like` RPC: exists, but the UI writes `post_likes` directly.
- `community-media` storage bucket: private and unused by the UI.
- `community_posts.media_url` and `media_type`: displayed if present, but no upload path.
- `chat_messages.message_type`, `media_url`, and `reply_to_id`: columns exist; the UI uses only text messages.
- `ai_conversations.last_interaction_id`: legacy column, not read or written.
- Permissive `case_folders` delete policy and `notes` anonymous policies: no matching UI actions.

## Not implemented
<!-- keywords: delete account, account deletion, missing features, not available -->

These are commonly assumed but are not present:

- Teacher, admin, principal, or parent dashboards.
- Attendance, marks, fees, timetable, assignments, or exams modules.
- Password/email login, password reset, account deletion, phone login, or account registration forms.
- Direct messages between individual students.
- Push notifications when the app is closed.
- In-app PDF, photo, post, or chat deletion for ordinary students.
- Community media uploads, stories, polls, or reactions UI.
- AI access to class PDFs, notes, marks, attendance, or private student records.
- AI web browsing, file upload, image understanding, or voice input.
- Multi-class or multi-school tenancy.
- Offline mode.
- A public API for third-party clients.

## Planned

No maintained roadmap or TODO list in the repository verifies future features. Treat unlisted future ideas as unknown, not planned.

## Unknown or unverified

These cannot be confirmed from the repository alone:

- Whether the currently deployed site matches the latest source.
- Whether the `ai-chat` Edge Function is deployed and which model/secret it uses.
- The live Supabase Auth provider configuration and redirect allow-list.
- Current data volumes and whether any content is stale.
- Browser/device-specific behaviour, especially for large PDFs, OCR, and notifications.
- The provider's current model availability, pricing, and quotas.

Status: verified against the repository and live database schema at the time of writing.
