---
id: sections
title: ClassHub sections and navigation
status: verified
keywords: sections, pages, navigation, home, topic search, notes, test papers, case studies, notices, community, profile, accounts, class chat, ai assistant, menu, more sheet, bottom nav
---

## Available sections
<!-- keywords: what sections are available, list of sections, pages, navigation, features -->

ClassHub has eleven sections: Home, Topic Search, Notes, Test Papers, Case Studies, Notices, Class Community, Student Profile, Accounts, Class Chat, and ClassHub AI. The main navigation also includes a More sheet on mobile and a top bar with notices, theme, and account controls.

The page IDs are `home`, `search`, `notes`, `pdfs`, `photos`, `notices`, `community`, `profile`, `accounts`, `chat`, and `ai`. The `pdfs` page is Test Papers; the `photos` page is Case Studies.

## Home

Home is the launcher. It shows a personalised greeting when signed in, a large search button that opens Topic Search, featured actions for Topic Search and AI Assistant, and a numbered action list for Notes, Test Papers, Notices, Class Chat, Community, Case Studies, and Accounts.

Home does not show a dashboard of recent content or unread counts beyond the notices bell badge in the top bar.

## Top bar and navigation
<!-- keywords: dark mode, light mode, theme toggle, notices bell, avatar button, bottom navigation -->

The top bar contains the ClassHub brand, a connection status pill, a notices bell with an unread badge, a light/dark theme toggle, and an avatar button. The avatar opens the profile when signed in, or starts Google sign-in when signed out.

On mobile, a bottom navigation bar has Home, Notes, Search, Chat, and More. The More sheet links to Test Papers, Case Studies, Notices, AI Assistant, Community, Accounts, and My Profile.

Navigation is client-side: all pages are sections of the same `index.html`, and `openSection(pageId)` shows one page at a time. The page IDs are `home`, `search`, `notes`, `pdfs`, `photos`, `notices`, `community`, `profile`, `accounts`, `chat`, and `ai`.

Two IDs are easy to confuse:

- The `pdfs` page is the Test Papers section.
- The `photos` page is the Case Studies section.

## Topic Search

Searches the extracted text of every notes PDF and test-paper PDF, lists matches by book and page number, and opens an in-app PDF viewer at the matching page. It is not a search of notices, chat, community posts, or the AI history. Status: verified, with limits around OCR quality and extracted-text size.

## Notes

A subject-wise PDF library. Five subjects are hard-coded, two of them have subcategories. Students can upload PDFs, open them, and re-scan older files to improve searchable text. Status: verified. There is no PDF delete, rename, or move UI.

## Test Papers

A folder-based library with two collections: PYQs and Current Year. Students create folders and upload PDFs into them. Status: verified. There is no rename, delete, or reorder UI.

## Case Studies

A folder-based photo library. Students create case folders, upload multiple images, and view them through their public URLs. There is also an "Unfiled photos" pseudo-folder for photos with no folder. Status: verified but partial: there is no rename or delete UI, no captions, and no in-app gallery/lightbox.

## Notices

A list of class announcements, newest first. The CR can publish notices; everyone can read them. New notices arrive through Supabase Realtime while the page is open, with an in-app toast, a sound, and an optional browser notification. Status: verified. There is no notice editing, deleting, scheduling, rich text, or attachment support in the UI.

## Class Community

A signed-in feed where students publish text posts, optionally anonymously, like posts, and add anonymous comments. The CR can see anonymous authors and delete any post. Status: verified for posts, likes, and comments. Media columns exist but no community media upload UI is implemented.

## Student Profile

Lets a signed-in student edit display name, bio, and status. The avatar comes from the Google account; there is no avatar upload. Status: verified.

## Accounts

A signed-in directory of class profiles with search by name, status, and bio. The CR also sees account emails. Status: verified. There is no individual profile detail page and no follow/message action.

## Class Chat

One shared chat room for signed-in students. It shows the latest 100 messages and receives new messages in realtime. Status: verified. It has no direct messages, threads, attachments, editing, or reaction UI, even though a reaction table exists.

## ClassHub AI

A private study assistant with saved conversations. Each student has their own conversation history. Replies stream into the page, can be stopped, and are saved. Status: verified. It is study help; it is not connected to class PDFs, notes, marks, or student records.

## Authentication banner

A sign-in panel explains that Google sign-in is needed to join the class space. It displays the signed-in student's name and email, a sign-out button, and a dismiss control. Students can hide the banner; the avatar button remains available.

## Status labels used in this knowledge base

- `verified`: implemented in the source and used by the UI.
- `partial`: implemented but with important limits or missing related actions.
- `schema-only`: a table, column, or policy exists, but no active UI feature uses it.
- `planned`: described as future work but not implemented.
- `unknown`: not verified from the repository or live project.
