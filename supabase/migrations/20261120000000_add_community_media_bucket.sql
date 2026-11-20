-- Fix: Community posts with images fail because the "community-media" storage bucket is missing.
--
-- The community_posts table has media_url/media_type columns, but the community-media
-- STORAGE BUCKET does not exist, so db.storage.from("community-media").upload(...) returns "Bucket not found".

-- Create the community-media bucket for post images/stickers.
insert into storage.buckets (id, name, public)
values ('community-media', 'community-media', true)
on conflict (id) do nothing;

-- Allow signed-in users to upload images into the community-media bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated users can upload community media'
  ) then
    create policy "Authenticated users can upload community media"
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'community-media');
  end if;
end $$;

-- Allow signed-in users to read their own objects in the community-media bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated users can read community media'
  ) then
    create policy "Authenticated users can read community media"
      on storage.objects
      for select
      to authenticated
      using (bucket_id = 'community-media');
  end if;
end $$;

-- Allow public read so getPublicUrl() links work for anyone (posts are public).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read access for community-media bucket'
  ) then
    create policy "Public read access for community-media bucket"
      on storage.objects
      for select
      to public
      using (bucket_id = 'community-media');
  end if;
end $$;

comment on table storage.buckets is 'ClassHub: community-media bucket for post images/stickers.';