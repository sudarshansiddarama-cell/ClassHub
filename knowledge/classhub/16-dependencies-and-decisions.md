---
id: dependencies
title: Dependencies and technical decisions
status: verified
keywords: dependencies, stack, libraries, CDN, Supabase JS, PDF.js, Tesseract.js, OCR, fonts, build, no build, static, architecture, decisions, Groq, Edge Function, storage, direct database, RLS, hard-coded, subject list, CR, limitations, roadmap, planned
---

## Runtime dependencies

ClassHub has no package manager or build step. Its runtime pieces are:

- `index.html`: the entire front end.
- Supabase JS v2 from jsDelivr: auth, database, storage, and realtime client.
- PDF.js 3.11.174 from cdnjs: PDF text extraction and the in-app viewer.
- Tesseract.js 5.1.0 from jsDelivr, loaded on demand: OCR for scanned pages.
- Tesseract language data from the `naptha/tessdata` GitHub Pages CDN.
- Geist and Geist Mono fonts from Google Fonts.
- Supabase: Auth (Google OAuth), Postgres with RLS, Storage, Realtime, and Edge Functions.
- Groq's OpenAI-compatible chat-completions API, called only from the `ai-chat` Edge Function.

There are no npm dependencies for the app and no test dependencies; the Node tests use the built-in `node:test` runner.

## Important technical decisions

### One HTML file, no framework

The whole UI, styles, and logic live in `index.html`. This keeps deployment simple and works well in Termux, but it also means the file is large and there is no component boundary. Changes must preserve the existing page IDs and function names used by inline handlers.

### Direct browser-to-Supabase access

The browser uses the public publishable key and the student's session to query Supabase directly. RLS is the security boundary. This avoids a custom API server for CRUD, but every table and storage bucket must have correct policies.

### Edge Function only for AI

AI needs a server-held provider key and streaming, so it goes through one Supabase Edge Function. The function does not proxy normal CRUD; it only handles AI chat.

### Public storage for class material

Notes PDFs, test-paper PDFs, and case photos are in public buckets so links work without signed URLs. This is convenient for class sharing but means anyone with a URL can open the file. The community media bucket is private but unused by the UI.

### Client-side PDF extraction and OCR

Text extraction and OCR run in the student's browser rather than on a server. This avoids a paid processing backend and keeps setup simple, but large books are slow, OCR quality varies, and the device does work. Extracted text is stored in `pdfs.content_text`, with page markers for search results.

### Hard-coded subject taxonomy

The five note subjects and their subcategories are hard-coded in the front end. Changing them requires editing the `noteSubjects` array and, if needed, existing data. There is no subject-management UI.

### Hard-coded CR identity

The class representative is a fixed user UUID in the front end and SQL policies. This is simple for one class but fragile: changing the CR requires code and policy changes, and the identity is not managed through a role screen.

### Separate AI tables

AI conversations and messages have their own tables and owner-only RLS, separate from community/chat data. This keeps private study chats isolated from the public class feed.

### Groq with GPT-OSS

The AI uses Groq because it provides fast OpenAI-compatible streaming at low cost. The default model is `openai/gpt-oss-120b`. For GPT-OSS models the request hides reasoning and uses low reasoning effort. The provider and model are configurable through Edge Function secrets.

### Lexical RAG instead of embeddings

The ClassHub knowledge layer uses a small BM25-style lexical retriever over generated Markdown chunks. It needs no embedding model, vector database, extra secret, or extra API cost. The trade-off is that retrieval depends on wording and synonyms rather than semantic embeddings, so the knowledge documents and keyword metadata must be maintained carefully.

## Known limitations

- The app needs network access; there is no offline mode.
- CDN outages can break PDF.js, OCR, Supabase JS, or fonts.
- Public storage buckets expose files to anyone with a URL.
- Some database tables and columns are legacy or unused.
- Some write policies are more permissive than the UI suggests.
- Large PDFs and OCR can be slow and memory-heavy on phones.
- Realtime depends on the Supabase Realtime connection.
- Browser notifications require permission and only work while the page is open.
- The AI has no access to class PDFs, marks, attendance, or private student records.

## Planned features

The repository does not contain a maintained roadmap, TODO list, or issue tracker that verifies future features. Therefore no feature should be described as "planned" unless a maintainer adds it to this knowledge base with evidence. Unknown or unverified ideas should be labelled as such.

## Environment notes

Development is done on Android with Termux and OpenCode. The Supabase CLI is not fully supported on Android, so Edge Function deployment may need the Supabase dashboard, Management API, or another environment. Supabase MCP access used for inspection is read-only, so schema changes must be applied through the dashboard or CLI elsewhere.
