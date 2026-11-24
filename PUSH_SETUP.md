# ClassHub — Push Notifications (manual backend steps)

Frontend code is complete and committed. True Web Push (alerts when ClassHub is
closed) cannot be activated on this device because:

- the saved Supabase access token is invalid (`401 Invalid access token`);
- the Supabase CLI binary fails on Android (`unexpected e_type: 2`);
- there is no `psql`, `proot`, service-role key, or DB URL available.

To make push work, apply the following manually on a machine with a valid
Supabase token / access to the Supabase Dashboard.

## 1. Database migration

Run `supabase/migrations/20261124000000_add_push_subscriptions.sql` in the
Supabase SQL Editor (or via `supabase db push` once the CLI works).

This creates `public.push_subscriptions` with RLS so each user manages only
their own subscription.

## 2. Edge Function

Deploy `supabase/functions/send-push/index.ts`:

```
supabase functions deploy send-push
```

Set these secrets in the Supabase project:

| Secret | Value |
|--------|-------|
| `VAPID_PRIVATE_KEY` | base64url EC private key matching `VAPID_PUBLIC_KEY` |
| `VAPID_PUBLIC_KEY`  | `BDJoCM67OzoUyviLXZ5TqL62sJ4FfAXQ-ocjyylaUQKTWBuZF-8RrZcxTZRSSdApFMzPqEu6h-TQxdetmENzvrs` |
| `VAPID_EMAIL`       | `mailto:classhub@example.com` (or your address) |

The `VAPID_PUBLIC_KEY` is already embedded in `index.html`; keep the private key
server-side only — never commit it.

## 3. Trigger push on new notice/assignment (optional)

The frontend stores subscriptions locally and (once the table exists) writes them
to `push_subscriptions`. To actually send pushes, call the `send-push` function
from a trusted backend after inserting a notice/assignment, e.g.:

```
POST /functions/v1/send-push
Authorization: Bearer <service-role key>
{ "title": "New assignment", "body": "Padarth Vijnana — Chapter 3 notes", "tag": "classhub-push", "url": "/assignments" }
```

## 4. Verify

- Open ClassHub, sign in, go to Notices, click "Enable background push notifications".
- Grant notification permission.
- Close the tab / browser and send a push via the send-push function; the
  service worker (`sw.js`) shows the notification and clicking it opens ClassHub.

Until steps 1–3 are done, the push button stores the subscription locally and
shows "setup not deployed"; in-app notice toasts and sounds still work.
