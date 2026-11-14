---
id: auth
title: Authentication and profiles
status: verified
keywords: authentication, auth, sign in, signin, sign-in, login, log in, logout, sign out, Google, OAuth, session, token, Supabase Auth, profile, display name, bio, status, avatar, accounts, directory, classmates, CR, class representative, role, permission
---

## How sign-in works
<!-- keywords: how authentication works, google oauth, sign in flow, login flow, session, password login, change password, email login -->

ClassHub uses Supabase Auth with Google as the only OAuth provider. The front end calls:

`db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } })`

Supabase redirects the browser to Google, then back to the same ClassHub URL with a session. The Supabase JS client stores and refreshes the session in the browser.

There is no email/password form, no magic-link flow, no phone login, and no account-creation form. A student must already have a Google account.

## Session handling

On startup, `initialiseGoogleAuth()` registers `db.auth.onAuthStateChange(...)` before calling `db.auth.getSession()`. This avoids missing the OAuth callback event. The signed-in user is kept in the global `currentUser` variable and the UI is updated by `updateAuthUI(user)`.

When the user signs out, `db.auth.signOut()` clears the session and the UI resets: profile fields, accounts directory, community feed, chat, and AI state are cleared or reloaded.

If a session expires, protected Supabase requests fail; the AI function returns a 401-style "Please sign in again" message and the page asks the student to sign in again.

## Profile creation

Two mechanisms create profile rows:

1. A database trigger on `auth.users` named `on_classhub_student_created` runs after a new auth user is inserted. It calls `create_classhub_profile()`, which inserts into `public.profiles` with a display name taken from `raw_user_meta_data.display_name` or the fallback `Student`.
2. After sign-in, the front end also upserts `{ id, display_name, avatar_url }` with `ignoreDuplicates: true`, so an existing profile is not overwritten.

A student's Google name and photo are read from `user.user_metadata.full_name`, `name`, `avatar_url`, or `picture`.

## Profile page

The Student Profile page lets a signed-in student edit:

- Display name, up to 80 characters.
- Bio, up to 300 characters.
- Status, up to 120 characters.

Saving uses an upsert into `profiles` keyed by `id`. The page also shows the student's Google email as read-only text. Avatar changes are not supported; the Google avatar URL is used when present, with initials as a fallback.

The profile page is not available to signed-out visitors; it asks them to sign in.

## Accounts directory

The Accounts page is available only to signed-in students. It selects `id`, `display_name`, `avatar_url`, `bio`, and `status` from `profiles` and lets the student filter by name, status, or bio.

If the signed-in user is the CR, the page also calls the `cr_get_account_emails` RPC to show account email addresses. That RPC is security-definer and checks the caller's user ID against the hard-coded CR user ID; it returns nothing to other users.

There is no separate profile-detail page. Each card shows the avatar, display name, status, bio, email (CR only), and an "Edit my profile" button for the student's own card.

## Roles and the CR
<!-- keywords: who is the cr, class representative, cr role, cr powers -->

`profiles.role` defaults to `student`. The UI never exposes role editing. Database triggers protect the role:

- `protect_profile_role_insert` requires new profiles to start as `student`.
- `prevent_self_role_change` stops a student from changing their own role.
- `protect_profile_role` only allows the designated CR user ID to change a role.

The CR is identified by a hard-coded UUID in both the front end and SQL policies, not by a role value that the UI manages. CR-only abilities are:

- Publish and delete notices.
- Delete any community post.
- See the author of anonymous community posts.
- See account email addresses in the Accounts directory.

The CR is not a general administrator: there is no user management, no role assignment screen, no database browser, and no moderation dashboard.

## Sign-in gating in the UI

The UI gates these sections behind sign-in:

- Class Chat
- Class Community
- Accounts
- Student Profile
- ClassHub AI

Notes, Test Papers, Case Studies, Topic Search, and Notices are readable without signing in. Their upload/create controls are also not explicitly disabled for signed-out visitors, and the database currently permits some anonymous inserts. This is a security weakness documented in the security file, not an intended "guest mode".

## Error handling

Sign-in errors are shown in the auth panel with a friendly message. The Google button is re-enabled on failure and when the page is restored with the Back button. Profile loading and saving errors are shown in the profile status area.

Status: verified. The live Supabase Auth provider configuration (Google client ID, redirect allow-list) is external to the repository and cannot be verified from the code.
