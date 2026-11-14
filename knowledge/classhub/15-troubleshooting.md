---
id: troubleshooting
title: Error handling and troubleshooting
status: verified
keywords: error, errors, fail, failed, failure, problem, troubleshoot, troubleshooting, fix, network, offline, sign in, session, upload, pdf, search, notices, chat, community, ai, rate limit, timeout, not configured, migration, deployment
---

## How ClassHub handles errors

Most sections show errors in a status line near the action, and important successes or failures also appear as a toast. Technical details are logged to the browser console. The AI section maps provider and network failures to friendly messages and sometimes offers Try again.

A global connection pill shows "Connected", "Connection issue", "Offline", or "Reconnecting…" based on a test query and Realtime subscription status. It is an indicator, not a full network monitor.

## Sign-in and session problems

- **Google button does nothing or stays disabled:** the OAuth redirect may be blocked or misconfigured. Check the Supabase Auth provider settings and allowed redirect URLs. Returning with the Back button re-enables the button.
- **"Please sign in again":** the session expired or the AI request had no valid bearer token. Sign out and sign in again.
- **"Sign-in failed":** the OAuth flow returned an error. Check the browser console and Supabase Auth logs.
- **Profile will not save:** the display name may be empty, or the network/RLS request failed. The profile page shows the reason.

## Backend and deployment problems

- **"AI chat isn't set up yet. Please apply the AI chat database migration."** The `ai_conversations` or `ai_messages` table is missing. Apply `supabase/migrations/20261113000000_add_ai_chat.sql` in the Supabase SQL editor or with the CLI.
- **"Can't reach the AI service":** the `ai-chat` function is not deployed, the project URL is wrong, or the browser is offline.
- **"The AI assistant is not configured yet":** the `GROQ_API_KEY` secret is missing.
- **"The AI assistant is not configured correctly":** Groq rejected the API key (401/403). Check or rotate the key.
- **"The AI could not process that request":** usually a bad `GROQ_MODEL` value or malformed request. The default is `openai/gpt-oss-120b`.
- **413 "This conversation is too long":** the request exceeded the provider's context limit. Start a new chat.
- **429 "You're sending messages too quickly":** more than 10 user messages in 60 seconds. Wait a minute.
- **503 "The AI is busy right now":** the provider returned a rate limit or queue-full response. Wait a few seconds and retry.
- **503 "temporarily unavailable":** the provider returned a 5xx error.
- **504 "The AI took too long to respond":** the 120-second timeout elapsed.
- **"The connection to the AI was interrupted":** the stream ended before completion. Try again.
- **"The AI reply was cut off before it finished":** the output token limit was reached. Ask a shorter question.
- **"The AI returned an empty response":** no text was produced. Retry.

## PDF upload problems

- **"Please select a PDF file":** the file is not a PDF or the picker was cancelled.
- **"This file is over 50 MB":** choose a smaller file.
- **"Upload failed":** storage upload or database insert failed. The app tries to remove an orphan storage file. Check the console and RLS/storage policies.
- **"PDF uploaded, but no readable text was found":** the PDF is saved but not searchable. Try a clearer scan; OCR may not have found enough text.
- **"No readable text found — old text kept":** a re-scan did not improve the file.
- **Another PDF task is already running:** only one upload, re-scan, or OCR job can run at a time.
- **Upload seems stuck:** large scanned books can take minutes because extraction and OCR run in the browser. The progress bar has a Cancel button.

## Topic Search problems

- **"Type at least 2 characters":** the query is too short.
- **No matches:** the word may not exist in extracted text, the PDF may be image-only, OCR may have failed, or the spelling is different. Try a shorter word or another spelling.
- **"Search failed":** all database search strategies failed. Check the connection and whether `pdfs.content_text` is readable.
- **Page numbers look wrong:** page numbers come from `[[PAGE n]]` markers created during extraction. A PDF with unusual page structure may not match its printed page numbers.
- **Viewer will not open the book:** the PDF may be too large or unusual for PDF.js. Use the external "Open in browser" link.

## Notices problems

- **"Only the class representative can publish notices":** the signed-in user is not the CR.
- **No sound:** the sound toggle may be off, the browser may block autoplay until the first interaction, or the device may be muted.
- **No browser notification:** permission may be denied or unavailable. In-page toasts still work. Notifications only arrive while the page is open.
- **No realtime updates:** the Realtime connection may be down; the connection pill shows "Reconnecting…". Refresh the page.

## Chat problems

- **Sign-in gate:** Class Chat requires sign-in in the UI, even though the database policy is more permissive.
- **"Message failed":** the insert was rejected or the network failed. Check message and sender-name lengths.
- **Own messages appear on the wrong side:** the table has no `user_id`; the app remembers sent message ids per user in local storage. Clearing browser storage can lose that memory.
- **Messages do not appear immediately:** Realtime may be disconnected; refresh or check the connection pill.

## Community problems

- **"Join the community":** the user is signed out.
- **"Could not publish post":** empty content, network failure, or an RLS rejection.
- **"Like failed":** the optimistic like was reverted because the write failed.
- **"Could not post comment":** the comment insert failed.
- **"Could not load posts":** the `community_get_feed` RPC or network failed.
- **"You do not have permission to delete this post":** the delete was blocked by RLS.
- **Anonymous author appears as "Anonymous":** this is expected for everyone except the CR.

## Accounts and profile problems

- **"Could not load accounts":** the profile query failed, or the user is signed out.
- **Emails missing for the CR:** the `cr_get_account_emails` RPC failed; the page shows an email warning.
- **Avatar does not change:** avatars come from Google metadata; there is no upload flow.
- **Role cannot be changed:** role changes are protected by database triggers and there is no role UI.

## When information is unavailable

If a question asks about behaviour that is not in this knowledge base, the correct answer is that it is not verified in the current ClassHub knowledge base. Do not invent a table, endpoint, permission, or feature. Suggest checking the source, the Supabase dashboard, or the ClassHub developer/CR.
