---
id: test-papers
title: Test Papers section
status: verified
keywords: test papers, papers, pyq, pyqs, previous year, current year, exam, question paper, folder, upload, pdf, storage, test_paper_folders, collection_type, folder_id
---

## What the Test Papers section does

Test Papers stores exam papers in two collections:

- `pyqs`: previous-year question papers.
- `current_year`: papers from the current year.

Inside each collection, students create folders and upload PDFs into them. The page ID is `pdfs`, even though the visible name is Test Papers.

## Data model used by the UI

Folders live in `test_paper_folders`:

- `id` bigint identity primary key
- `category` text, restricted to `pyqs` or `current_year`
- `folder_name` text, 1 to 100 characters
- `created_at` timestamptz

Papers live in the same `pdfs` table used by Notes, with:

- `subject = null` and `subcategory = null`
- `collection_type = category`
- `folder_id = folder.id`
- `content_text` for Topic Search

## Creating a folder

The student types a name and taps Create Folder. The app inserts `{ category, folder_name }` into `test_paper_folders`. The database check restricts the category and name length. The folder list refreshes.

There is no rename, delete, reorder, or sharing control in the UI. RLS currently allows anonymous and authenticated inserts and selects, but no update or delete policies are defined for this table.

## Uploading a test-paper PDF

The workflow matches Notes:

1. Validate PDF and 50 MB limit.
2. Upload to the public `pdfs` bucket at `test-papers/<category>/<folderId>/<timestamp>_<uuid>_<sanitized-name>`.
3. Get the public URL.
4. Extract searchable text in the browser with PDF.js and OCR fallback.
5. Insert a `pdfs` row with `subject = null`, `subcategory = null`, `collection_type = category`, `folder_id = folder.id`, and `content_text`.
6. Refresh the open folder.

The same one-job-at-a-time progress bar, cancel button, and orphan-storage cleanup apply.

## Browsing papers

The folder list is loaded by category, newest first. Inside a folder, papers are ordered by `created_at` descending. A client-side search box filters by filename. Each paper shows its filename and date, with an Open link to the public PDF URL and, when applicable, a Re-scan button.

## Permissions and limits

- `pdfs` and the `pdfs` storage bucket are public for reading.
- Paper inserts and uploads are currently allowed to anonymous and authenticated users by RLS.
- Re-scanning is allowed by the "anyone can rescan pdfs" policy.
- CR-only delete policies exist, but there is no delete UI.
- The 50 MB, PDF-only, text-extraction, OCR, and searchability limits are the same as Notes.

Status: verified for folders and uploads. Partial for management: no rename, delete, move, or sharing controls.

## Common errors

- "Enter a folder name first." The name field is empty.
- "Could not create folder" usually means a network, validation, or RLS rejection.
- "Could not load folders" or "Could not load PDFs" usually means a network or permission problem.
- "Upload failed" covers storage or insert failures; the app attempts to clean up a partially uploaded file.
- "Uploaded, but not searchable" means the PDF was saved but extraction found too little text.
