---
id: overview
title: ClassHub overview
status: verified
keywords: classhub, app, application, purpose, users, students, Ayurveda, class space, overview, what is classhub, technology, architecture, static site, supabase, groq
---

## What is ClassHub

ClassHub is a single-page class space for one Ayurveda student class. It brings shared study material, class communication, and an AI study assistant into one web app.

Its main purposes are:

- Share subject-wise notes as PDFs and search inside every uploaded book.
- Organise previous-year and current-year test papers in folders.
- Keep case-study photos in folders.
- Publish class notices.
- Let classmates talk in a class chat and a community feed.
- Give students a private AI study assistant.
- Show a simple directory of classmates' profiles.

ClassHub is not a multi-school platform, a learning-management system with courses and grades, or a public social network. It is a class-scoped tool built around one Supabase project.

Status: the app is implemented and usable. Some database tables and columns are legacy or unused; they are documented separately so the AI does not describe them as working features.

## Who uses it

- Students of the class use the study material, notices, chat, community, accounts directory, and AI assistant.
- The class representative (CR) is one designated student account with extra powers: publishing notices, deleting any community post, seeing who wrote anonymous community posts, and seeing account email addresses.
- There is no separate teacher, admin, or principal role in the UI. The only roles in the profile table are `student` and the CR's elevated role, and no role-management screen exists.

## Technology and architecture

ClassHub is deliberately simple and has no build step:

- `index.html` contains the complete front end: HTML, CSS, and JavaScript.
- Supabase provides Google authentication, Postgres database access, file storage, and realtime updates.
- The browser talks to Supabase directly with the public publishable key and the signed-in user's session.
- AI chat goes through one Supabase Edge Function, `ai-chat`, which holds the AI provider key and streams the reply back.
- The AI provider is Groq using an OpenAI-compatible chat-completions API. The default model is `openai/gpt-oss-120b`.
- PDF.js is loaded from a CDN for reading and displaying PDFs. Tesseract.js is loaded on demand for OCR of scanned pages.
- Supabase JS and the Geist font are also loaded from CDNs.

The important security boundary is that the AI provider key exists only as an Edge Function secret. The browser never receives it.

## Main sections

The app has these pages: Home, Topic Search, Notes, Test Papers, Case Studies, Notices, Class Community, Student Profile, Accounts, Class Chat, and ClassHub AI. Home is a launcher; the rest are described in the sections document.

## Deployment model

The repository is a static site: `index.html` is the entry point, and there is no `package.json` or bundler. It can be served by any static host. The backend pieces are the Supabase project and the deployed `ai-chat` Edge Function. Database setup for AI chat is in `supabase/migrations/20261113000000_add_ai_chat.sql`.

Status: the source implements the app. Whether a particular deployment is live, up to date, and has the Edge Function deployed cannot be verified from the repository alone.

## What the AI should not claim

Do not claim that ClassHub has these unless the knowledge base says they exist:

- Teacher or admin dashboards, attendance, marks, fees, timetables, or assignments.
- Password or email login. Sign-in is Google OAuth only.
- Push notifications when the app is closed. Browser notifications work only while the page is open and permission is granted.
- In-app direct messages between individual students. Class Chat is one shared room.
- PDF deletion, photo deletion, or community media upload in the UI.
- AI access to notes, PDFs, student records, or the internet. The AI receives the student's message, recent chat history, and, for app questions, retrieved ClassHub documentation.
