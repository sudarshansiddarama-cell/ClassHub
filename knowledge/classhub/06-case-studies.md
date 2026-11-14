---
id: case-studies
title: Case Studies section
status: verified
keywords: case studies, case, patient, photos, images, photo, picture, folder, upload, unfiled, case_folders, photos table, storage, gallery
---

## What the Case Studies section does

Case Studies is a folder-based photo library for patient case photos. Students create a folder per case, upload one or more images into it, and open images through their public storage URLs. The page ID is `photos`, while the visible title is Case Studies.

## Data model used by the UI

Folders live in `case_folders`:

- `id` uuid primary key
- `folder_name` text
- `created_at` timestamptz

Photos live in `photos`:

- `id` bigint identity primary key
- `file_name` text
- `file_url` text
- `created_at` timestamptz
- `folder_id` uuid, nullable

A null `folder_id` means the photo is "unfiled".

## Folder list and unfiled photos

The folder list is ordered by creation date, newest first. If any photos have `folder_id = null`, the page also shows an "Unfiled photos" card with the count. Selecting it opens a pseudo-folder that lists those photos.

There is no rename, delete, reorder, cover image, or description UI for case folders.

## Creating a folder and uploading photos

The student creates a folder with a name. The app inserts `{ folder_name }` into `case_folders`.

Upload accepts multiple image files at once. For each image:

1. Skip anything whose MIME type does not start with `image/`.
2. Upload to the public `photos` bucket at `case-studies/<folderId or "unfiled">/<timestamp>_<uuid>_<sanitized-name>`.
3. Get the public URL.
4. Insert `{ file_name, file_url }` into `photos`, adding `folder_id` only when the folder is a real folder.
5. Count success or failure for each file.

If the database insert fails after a storage upload, the app tries to remove that storage object. The final status reports how many photos were uploaded, failed, or skipped.

## Viewing photos

Each photo row shows the filename, upload date, and a View link that opens the public URL in a new browser tab. There is no in-app lightbox, swipe viewer, zoom, download button, caption, or tag.

## Permissions and limits

- The `photos` bucket is public for reads.
- RLS currently allows anonymous and authenticated photo inserts and reads.
- Storage policies also allow anonymous and signed-in uploads to the `photos` bucket.
- There is no delete policy or delete UI for photos.
- Folder deletion is technically possible through a permissive `case_folders` delete policy, but the UI never calls it.
- Uploads are not gated behind sign-in in the UI.

Status: verified for folders, multi-image uploads, unfiled photos, and viewing. Partial for management and presentation: no delete, rename, captions, or gallery experience.

## Common errors

- "Choose at least one photo." No file was selected.
- "Choose a folder first." The upload ran without an open folder.
- The final message can include "N failed" or "N skipped (not images)".
- "Could not load folders" or "Could not load photos" usually means a network or permission problem.
