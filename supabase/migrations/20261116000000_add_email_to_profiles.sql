-- Add email column to profiles table so accounts directory can show Gmail names.
-- Run this once in the Supabase SQL Editor, or apply it with:
--   supabase db push

alter table public.profiles
  add column if not exists email text;

-- Backfill email from auth.users for existing profiles.
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and (p.email is null or p.email = '');

-- Allow authenticated users to read the email column (for accounts directory).
grant select (email) on public.profiles to authenticated;

comment on column public.profiles.email is 'Student Gmail address from Google OAuth. Shown in accounts directory.';
