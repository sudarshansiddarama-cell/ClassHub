-- Add email column to profiles table so accounts directory can show Gmail names.
-- Run this once in the Supabase SQL editor, or apply it with:
--   supabase db push

alter table public.profiles
  add column if not exists email text;

-- Allow authenticated users to read the email column (for accounts directory).
-- Existing RLS policies on profiles already restrict row access to the owner
-- or to public visibility; this grant ensures the column is readable.
grant select (email) on public.profiles to authenticated;

-- Refresh the realtime publication if profiles is replicated.
-- (Supabase handles this automatically for new columns on replicated tables.)

comment on column public.profiles.email is 'Student Gmail address from Google OAuth. Shown in accounts directory.';
