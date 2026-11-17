-- Fix: ClassHub notes PDF upload fails because the "pdfs" storage bucket is missing.
--
-- The public.pdfs TABLE exists and accepts inserts, but the pdfs STORAGE BUCKET
-- does not, so db.storage.from("pdfs").upload(...) returns "Bucket not found".
--
-- Run this once in the Supabase SQL Editor, or apply with:  supabase db push

-- Create the public pdfs bucket (used by notes + test-paper uploads).
insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', true)
on conflict (id) do nothing;

-- Allow signed-in users to upload PDF files into the pdfs bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated users can upload PDFs'
  ) then
    create policy "Authenticated users can upload PDFs"
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'pdfs');
  end if;
end $$;

-- Allow signed-in users to read objects in the pdfs bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated users can read PDFs'
  ) then
    create policy "Authenticated users can read PDFs"
      on storage.objects
      for select
      to authenticated
      using (bucket_id = 'pdfs');
  end if;
end $$;

-- Allow public read so getPublicUrl() links work for anyone.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read access for pdfs bucket'
  ) then
    create policy "Public read access for pdfs bucket"
      on storage.objects
      for select
      to public
      using (bucket_id = 'pdfs');
  end if;
end $$;

comment on table storage.buckets is 'ClassHub: pdfs bucket for notes and test-paper PDF uploads.';
