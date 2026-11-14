---
id: notices
title: Notices
status: verified
keywords: notices, notice, announcement, alerts, bell, unread, badge, CR, class representative, publish, realtime, toast, sound, browser notification, permission, Notification API
---

## What Notices does

Notices is the class announcement board. Notices are shown newest first with a title, date, and message. A bell in the top bar shows an unread badge when new notices arrive.

Everyone can read notices, including signed-out visitors. Only the CR can publish notices.

## Reading notices

`loadNotices()` selects all rows from `notices`, ordered by `created_at` descending. The app compares each notice's timestamp with `classhub_last_seen_notice` in local storage to decide whether to show a "NEW" label and how many unread notices exist.

Opening the Notices page clears the unread badge and updates the stored last-seen time.

## Publishing a notice
<!-- keywords: who can publish notices, publish notice, cr notice, notice publishing -->

The publish form is visible only to the CR. It has a title (maximum 150 characters) and an announcement (maximum 5,000 characters). Publishing inserts `{ title, content }` into `notices`; the database sets the timestamp.

The database enforces CR-only inserts and deletes with RLS policies that compare `auth.uid()` to the CR's hard-coded user ID. The front end also checks the user ID before calling the insert.

There is no edit, delete, schedule, pin, rich-text, image, or file-attachment UI for notices. A CR-only delete policy exists in the database, but the UI does not expose deletion.

## Realtime alerts

The app subscribes to Supabase Realtime `INSERT` events on `notices`. When a new notice arrives and the student is not currently viewing the Notices page (or the document is hidden):

- The unread badge increases.
- An in-page toast shows the title and content.
- A short synthesized beep plays unless the student turned sound off.
- If the page is hidden and browser notification permission is granted, a browser notification is created.

The sound setting is stored in local storage as `classhub_notice_sound`. Browser notification permission is requested when the student enables sound or taps the test button. Notifications only work while the ClassHub page is open; this is not a push-notification service.

The Notices page has a "Test notification & sound" button that shows a sample toast and requests or checks browser notification permission.

## Permissions and security

- `notices` is readable by anonymous and authenticated users.
- Insert and delete are restricted to the CR by RLS.
- The realtime subscription receives new notice rows; the content is intended to be public to the class.
- There is no server-side notification scheduler.

Status: verified for reading, CR publishing, realtime toast/sound, unread badge, and browser notifications while the page is open. Partial for management: no edit/delete/attachments in the UI.

## Common errors

- "Only the class representative can publish notices." The signed-in user is not the CR.
- "Enter both a title and notice." One field is empty.
- "Could not publish notice" usually means a validation, network, or RLS rejection.
- "Could not load notices" usually means a network or permission problem.
- "This browser doesn't support notifications" means the in-page toast and sound still work, but browser notifications do not.
- If notifications are blocked, the browser's site settings must be changed manually.
