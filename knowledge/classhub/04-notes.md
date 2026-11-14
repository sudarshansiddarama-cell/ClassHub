---
id: notes
title: Notes section
status: verified
keywords: notes, subject, subcategory, pdf, upload, library, book, file, 50 MB, storage, content_text, text extraction, OCR, re-scan, rescan, searchable text, Sanskrit, Padarth Vijnana, Samhita Adhyayan, Rachana Sharira, Kriya Sharira
---

## What the Notes section does

Notes is a subject-wise PDF library. Students choose a subject, optionally choose a subcategory, then browse, search by filename, open, or upload PDFs. Uploaded books are also made searchable by Topic Search.

The Notes UI does not use the legacy `notes` table. It reads and writes the `pdfs` table. The `notes` table exists but has no rows and no active UI.

## Subjects and subcategories

The subject list is hard-coded in the front end:

- Sanskrit (no subcategories)
- Padarth Vijnana (no subcategories)
- Samhita Adhyayan-1 (subcategories: AstangaHrudai, Charak Samhita)
- Rachana Sharira (subcategories: Modern, Ayurveda)
- Kriya Sharira (subcategories: Modern, Ayurveda)

For subjects without subcategories, the app opens the PDF library directly with `subcategory = null`. For subjects with subcategories, it shows a category chooser first.

## Browsing PDFs

The list is loaded from `pdfs` where:

- `subject` equals the selected subject, and
- `subcategory` equals the selected subcategory, or is null when the subject has no subcategory.

Files are ordered by `created_at` descending. The search box above the list filters by filename on the client. Each item shows the filename and upload date and has an "Open" link that opens the public file URL in a new tab.

If a file has not been re-scanned, a "Re-scan" button appears.

## Uploading a notes PDF
<!-- keywords: upload notes pdf, notes section, subject pdf, pdf upload -->

Upload is limited to one PDF at a time, maximum 50 MB. The workflow is:

1. Validate that the file is a PDF and is not over 50 MB.
2. Upload it to the public `pdfs` storage bucket at a path like `notes/<timestamp>_<uuid>_<sanitized-name>`.
3. Get the public URL with `getPublicUrl`.
4. Extract searchable text from the whole PDF in the browser.
5. Insert a row into `pdfs` with `file_name`, `file_url`, `subject`, `subcategory`, `collection_type = null`, `folder_id = null`, and `content_text`.
6. Refresh the current subject's list.

If the database insert fails after the storage upload, the app tries to remove the uploaded storage object so no orphan file is left. If extraction finds no useful text, the PDF is still saved but the student is warned that Topic Search cannot find anything inside it.

Only one heavy PDF job can run at a time. A progress bar shows upload and extraction progress, and the job can be cancelled. Leaving the page while a job is running triggers a browser warning.

## Text extraction and OCR

The app reads PDF text with PDF.js, page by page, up to 2,000 pages and about 9 million characters per book. It inserts page markers in the form `[[PAGE n]]` so Topic Search can report page numbers later.

If a page has little or no text layer, the app falls back to OCR with Tesseract.js. OCR is configured for English by default (`OCR_LANGS = "eng"`); the code comments note that `eng+hin` or `eng+san` could be used for Devanagari books but would be slower. OCR can be slow and can produce imperfect text.

The upload flow waits for extraction before inserting the database row, so large scanned books can take minutes.

## Re-scanning older PDFs

A re-scan downloads the existing public PDF, extracts its text again with the current reader, and updates `content_text` plus `rescanned = true`. If no readable text is found, the old text is kept and the student is told. Re-scans are available only for files where `rescanned` is false.

## Permissions and limits

- The `pdfs` bucket is public, so anyone with the file URL can read a PDF.
- Reading PDFs is allowed to anonymous and authenticated users.
- Inserting PDFs and uploading to the `pdfs` storage bucket is currently allowed to anonymous and authenticated users by RLS.
- Updating PDFs (used by Re-scan) is allowed by the "anyone can rescan pdfs" policy.
- CR-only delete policies exist for the table and storage bucket, but the Notes UI has no delete button.

Status: verified for browsing, uploading, extracting, opening, and re-scanning. Partial for lifecycle management: there is no delete, rename, move, or edit-subject flow in the UI.

## Common errors

- "Please select a PDF file." The chosen file is not a PDF.
- "This file is over 50 MB." Choose a smaller file.
- "PDF uploaded, but no readable text was found..." The file is saved but not searchable until a better scan or OCR result is available.
- "Upload failed" or "Could not load PDFs" usually means a storage, network, or RLS problem.
- "No readable text found — old text kept" means a re-scan did not improve the file.
