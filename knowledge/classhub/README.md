# ClassHub knowledge base

This folder is the single source of truth for ClassHub AI's knowledge about the ClassHub application.

## Files

- `01-overview.md` — what ClassHub is, who uses it, and its architecture.
- `02-sections.md` — every page and navigation path.
- `03-authentication-and-profiles.md` — Google auth, sessions, profiles, roles, CR, accounts.
- `04-notes.md` — Notes subject library, uploads, extraction, OCR, re-scan.
- `05-test-papers.md` — Test Papers folders and uploads.
- `06-case-studies.md` — Case Studies folders and photo uploads.
- `07-topic-search.md` — search pipeline, page hits, PDF viewer.
- `08-notices.md` — notices, CR publishing, realtime alerts.
- `09-class-chat.md` — shared class chat.
- `10-community.md` — posts, anonymity, likes, comments.
- `11-classhub-ai.md` — user-facing AI behaviour and RAG.
- `12-ai-backend.md` — Edge Function request flow, streaming, errors.
- `13-database.md` — tables, relationships, triggers, functions, buckets, RLS.
- `14-security.md` — security model, secrets, privacy, known weaknesses.
- `15-troubleshooting.md` — error messages and fixes.
- `16-dependencies-and-decisions.md` — stack, CDNs, design decisions, limits.
- `17-feature-status.md` — implemented, partial, schema-only, planned, unknown.
- `18-knowledge-base.md` — how retrieval and maintenance work.

## Format

Each document starts with:

```md
---
id: notes
title: Notes section
status: verified
keywords: notes, pdf, upload, subject
---
```

Each `##` heading becomes one retrieval chunk. Optional metadata under a heading:

```md
## Uploading a PDF
<!-- keywords: 50 MB, storage, extraction -->
<!-- status: verified -->
```

Front-matter `keywords` are documentation metadata only. They are not copied
into every section, because that would make all sections of a long document
match broad terms. Add retrieval keywords to the specific section instead.

Statuses: `verified`, `partial`, `schema-only`, `planned`, `unknown`.

## Regenerate and test

```bash
node scripts/build-classhub-knowledge.mjs
node --test tests/classhub-rag.test.mjs
node --test tests/*.test.mjs
```

The generated file is `supabase/functions/_shared/classhub-knowledge.generated.ts`. Do not edit it by hand.

## Rules

- Verify claims against the source code, migrations, or live schema.
- Do not describe a schema-only feature as working.
- Never include secrets, tokens, passwords, private student data, emails, or CR user IDs.
- Keep chunks concise; only the top few are sent to the model.
- Update `17-feature-status.md` whenever a feature's status changes.
