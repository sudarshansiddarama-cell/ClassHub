---
id: class-chat
title: Class Chat
status: verified
keywords: class chat, chat, messages, message, room, classmates, sender, realtime, latest 100, chat_messages, sign in, anonymous, reactions, attachments
---

## What Class Chat does

Class Chat is one shared chat room for the class. Signed-in students see the latest 100 messages and new messages appear in realtime. There are no separate rooms, direct messages, or threads.

## Reading messages

The page loads `chat_messages` ordered by `created_at` descending, limited to 100 rows, then reverses them so the oldest appears first. Each message shows the sender name, the message text, and the time.

If the student is signed out, the page shows a sign-in gate instead of messages. The database policy itself allows anonymous reads, but the UI does not show the room to signed-out visitors.

The app remembers the IDs of messages sent from this device in local storage (`classhub_my_chat_ids_<user id>`). This is used to align the student's own messages to the right, because the table has no `user_id` column. If a `user_id` is present on a row, it is used instead.

## Sending messages

The composer is visible only when signed in. The sender name comes from the Google profile metadata (`full_name`, `name`, or email), with the hidden `chatName` field and local storage as fallbacks. Messages are limited to 2,000 characters by the input and by the database check.

Sending inserts `{ sender_name, message }` into `chat_messages`, remembers the new row ID, clears the input, and reloads the latest messages.

The database policy allows both anonymous and authenticated inserts, with checks on sender-name length (1–60) and message length (1–2,000). The UI gate is stricter than the database policy.

## Realtime

The app subscribes to `INSERT` events on `chat_messages`. If the student is on the chat page and the message list is ready, the new message is appended; otherwise the list reloads. Messages from other students arrive without a page refresh.

## What is not implemented
<!-- keywords: direct messages, message a classmate, send message, attachments, threads, reactions -->

- No direct messages between two students.
- No chat rooms or channels.
- No message editing or deletion.
- No attachments, images, voice notes, or links previews.
- No reply threading, mentions, or typing indicators.
- No reaction UI. The `chat_reactions` table and its permissive policies exist, but no front-end code reads or writes it.
- No moderation tools beyond the general database policies.

Status: verified for the shared room, sign-in gate, latest 100 messages, sending, and realtime inserts. Partial for chat features and privacy: sender names are display names, the table has no `user_id`, and the database permits anonymous inserts.

## Common errors

- "Sign in with Google to join the chat." The user is signed out.
- "Message failed" usually means a network, validation, or RLS problem.
- "Could not load chat" usually means a network or permission problem.
- If realtime stops, the connection pill changes to "Reconnecting…" and the page may need a refresh.
