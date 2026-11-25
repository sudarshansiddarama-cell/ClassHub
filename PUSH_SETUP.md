# ClassHub — Push Notifications setup

The frontend and service worker are done. Background push needs one backend
deployment: a table, the `send-push` Edge Function, and VAPID secrets.

The Supabase CLI cannot run on Android, so use the Management API script:

```bash
# 1. Create a personal access token at
#    https://supabase.com/dashboard/account/tokens
echo 'sbp_...' > ~/.supabase_access_token
chmod 600 ~/.supabase_access_token

# 2. Deploy everything (migration + secrets + function + trigger)
node scripts/deploy-supabase.mjs
```

The script:

1. verifies the token and project `oekunhqzhwwjfrcaiuit`;
2. applies `supabase/migrations/20261124000000_add_push_subscriptions.sql`;
3. sets `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_EMAIL` secrets;
4. deploys `supabase/functions/send-push/index.ts`;
5. creates a `notices` INSERT trigger that calls `send-push` through `pg_net`,
   keeping the service-role key in Supabase Vault.

Useful flags: `--dry-run`, `--skip-sql`, `--skip-secrets`,
`--skip-function`, `--skip-webhook`.

## Manual alternative

If the script is unavailable, do the same steps in the dashboard:

1. Run the migration in the SQL Editor.
2. `supabase functions deploy send-push` (from a machine where the CLI works).
3. Add the three VAPID secrets under Project Settings → Edge Functions.
4. Add a Database Webhook on `notices` INSERT pointing to
   `/functions/v1/send-push` with an `Authorization: Bearer <service-role key>`
   header and body `{ "title": "{{ record.title }}", "body": "{{ record.content }}" }`.

`VAPID_PUBLIC_KEY` is already embedded in `index.html`. The matching private
key lives only in `~/.classhub_vapid_private` and in Supabase secrets — never
commit it.

## Verify

1. Open ClassHub, sign in, go to Notices, click
   "Enable background push notifications" and allow notifications.
2. Close the tab.
3. Publish a notice as CR (or insert a row into `notices`).
4. The service worker (`sw.js`) shows the notification; tapping it opens ClassHub.

Until deployment, the push button stores the subscription locally and shows
"setup not deployed"; in-app notice toasts and sounds still work.
