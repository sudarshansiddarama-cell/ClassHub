---
id: database
title: Database structure and relationships
status: verified
keywords: database, supabase, postgres, schema, tables, columns, relationships, foreign keys, indexes, triggers, functions, RPC, view, profiles, pdfs, notes, notices, photos, chat_messages, community_posts, post_likes, post_comments, ai_conversations, ai_messages, storage buckets, RLS
---

## Overview

The Supabase project uses the `public` schema for app data and `auth.users` for accounts. Storage has three buckets: `pdfs`, `photos`, and `community-media`.

The live schema was inspected directly. This document describes the tables that exist, not just the tables the UI uses.

## profiles table

- `id` uuid primary key, references `auth.users(id)` on delete cascade.
- `display_name` text not null, default `Student`.
- `avatar_url` text nullable.
- `bio` text not null, default empty string.
- `status` text not null, default empty string.
- `created_at` timestamptz not null, default now.
- `role` text not null, default `student`.

Used by the profile page, accounts directory, community author names, and the auth trigger.

## pdfs

- `id` bigint identity primary key.
- `file_name` text not null.
- `file_url` text not null.
- `created_at` timestamptz default now.
- `subject` text nullable.
- `subcategory` text nullable.
- `collection_type` text nullable.
- `folder_id` bigint nullable, references `test_paper_folders(id)` on delete set null.
- `content_text` text nullable.
- `search_vector` tsvector generated always as `to_tsvector('english', coalesce(content_text, ''))`.
- `rescanned` boolean not null, default true.

Used by both Notes and Test Papers. A GIN index `pdfs_search_idx` supports full-text search.

## test_paper_folders

- `id` bigint identity primary key.
- `category` text not null, checked to `pyqs` or `current_year`.
- `folder_name` text not null, 1–100 characters.
- `created_at` timestamptz not null, default now.

## case_folders

- `id` uuid primary key, default gen_random_uuid.
- `folder_name` text not null.
- `created_at` timestamptz nullable, default now.

## photos

- `id` bigint identity primary key.
- `file_name` text not null.
- `file_url` text not null.
- `created_at` timestamptz default now.
- `folder_id` uuid nullable.

`folder_id` is logically a case folder id, but the live schema has no foreign key from `photos.folder_id` to `case_folders.id`. The UI relies on matching ids only.

## notices

- `id` bigint identity primary key.
- `title` text not null.
- `content` text nullable.
- `created_at` timestamptz default now.

## chat_messages

- `id` bigint identity primary key.
- `sender_name` text not null.
- `message` text nullable.
- `created_at` timestamptz not null, default now.
- `message_type` text not null, default `text`.
- `media_url` text nullable.
- `reply_to_id` bigint nullable, references `chat_messages(id)` on delete set null.

Only `sender_name`, `message`, `created_at`, and `id` are used by the current chat UI. `message_type`, `media_url`, and `reply_to_id` are schema-only from the UI's perspective.

## community_posts

- `id` uuid primary key, default gen_random_uuid.
- `author_id` uuid not null, references `auth.users(id)` on delete cascade.
- `content` text not null.
- `is_anonymous` boolean not null, default true.
- `created_at` timestamptz not null, default now.
- `media_url` text nullable.
- `media_type` text nullable.

Media columns exist, but the UI has no media upload flow.

## post_likes

- `post_id` uuid, references `community_posts(id)` on delete cascade.
- `user_id` uuid, references `auth.users(id)` on delete cascade.
- `created_at` timestamptz not null, default now.
- Primary key is `(post_id, user_id)`, so one like per student per post.

## post_comments

- `id` uuid primary key, default gen_random_uuid.
- `post_id` uuid not null, references `community_posts(id)` on delete cascade.
- `user_id` uuid not null, references `auth.users(id)` on delete cascade.
- `content` text not null.
- `created_at` timestamptz not null, default now.

The UI displays every comment as "Anonymous", but the row still stores `user_id`.

## ai_conversations

- `id` uuid primary key, default gen_random_uuid.
- `user_id` uuid not null, references `auth.users(id)` on delete cascade.
- `title` text not null, default `New chat`, 1–120 characters.
- `last_interaction_id` text nullable. Legacy column; not read or written by the current function.
- `created_at` timestamptz not null, default now.
- `updated_at` timestamptz not null, default now.

Index: `(user_id, updated_at desc)`.

## ai_messages

- `id` uuid primary key, default gen_random_uuid.
- `conversation_id` uuid not null, references `ai_conversations(id)` on delete cascade.
- `user_id` uuid not null, references `auth.users(id)` on delete cascade.
- `role` text not null, checked to `user` or `assistant`.
- `content` text not null, 1–20,000 characters.
- `created_at` timestamptz not null, default now.

Indexes: `(conversation_id, created_at)` and `(user_id, created_at desc)`.

## Legacy, unused, or schema-only objects

- `notes`: `id`, `title`, `content`, `created_at`. No active UI and no rows. Notes uses `pdfs` instead.
- `community_comments`: older comment table with `post_id`, `parent_id`, `author_id`, `content`, `media_type`, `media_url`, `created_at`. The UI uses `post_comments`.
- `community_reactions`: `post_id`, `user_id`, `kind`, `value`, `created_at`. No UI use.
- `chat_reactions`: `message_id`, `reactor_name`, `emoji`, `created_at`. No UI use.
- `community_feed` view: joins `community_posts` and `profiles` to show a display name/avatar while hiding anonymous authors. The UI uses the `community_get_feed` RPC instead.
- `community_posts.media_url` and `media_type`: displayed if present, but no composer upload path.
- `community-media` bucket: private, authenticated upload/read policies, but no UI flow.

## Database functions

- `community_get_feed()`: security-definer RPC used by the community page. Requires authentication, returns posts with safe author fields, like state, comments, and delete permission.
- `community_toggle_like(p_post_id uuid)`: security-definer RPC that toggles a like. Exists, but the UI writes `post_likes` directly.
- `cr_get_account_emails()`: security-definer RPC that returns user ids and emails only when the caller is the CR.
- `cr_get_post_authors()`: security-definer RPC that returns anonymous-post authors only when the caller is the CR.
- `create_classhub_profile()`: trigger function on `auth.users` insert; creates a profile with a display name.
- `prevent_self_role_change()`, `protect_profile_role()`, `protect_profile_role_insert()`: trigger functions protecting `profiles.role`.

## Triggers

- `auth.users` after insert: `on_classhub_student_created` calls `create_classhub_profile()`.
- `profiles` before update: `protect_profile_role` calls `prevent_self_role_change()`. This blocks a user from changing their own role.
- `profiles` before update of role: `protect_profile_role_trigger` calls `protect_profile_role()`. Only the CR can change a role.
- `profiles` before insert: `protect_profile_role_insert_trigger` requires new profiles to start as `student`.

## Storage buckets

- `pdfs`: public. Holds notes at `notes/...` and test papers at `test-papers/<category>/<folderId>/...`.
- `photos`: public. Holds case photos at `case-studies/<folderId or unfiled>/...`.
- `community-media`: private. Authenticated users can upload into a folder named after their user id and read community media. No UI uses it.

## RLS summary

- `profiles`: authenticated read; own insert/update; role protected by triggers.
- `pdfs`: public read; anonymous and authenticated insert; update allowed for re-scan; CR-only delete.
- `test_paper_folders`: public read and insert with category/name checks; no update/delete policy.
- `case_folders`: public read, insert, and delete policies; no update policy.
- `photos`: public read and insert; no delete policy.
- `notices`: public read; CR-only insert/delete.
- `chat_messages`: public read; anonymous and authenticated insert with length checks; no update/delete policy.
- `chat_reactions`: public read; anonymous and authenticated insert/delete.
- `community_posts`: authenticated read; own insert; author or CR delete.
- `post_likes`: authenticated read/write of own likes.
- `post_comments`: authenticated read; own insert/delete.
- `community_comments` and `community_reactions`: authenticated policies exist but the UI does not use them.
- `ai_conversations` and `ai_messages`: authenticated only; each row owned by `auth.uid()`, with insert checks linking messages to an owned conversation.
- `notes`: anonymous read/insert/delete policies exist on the legacy table.

Status: verified against the live project schema. The schema may change over time; this document should be updated with the code.
