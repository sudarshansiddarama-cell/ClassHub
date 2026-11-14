---
id: community
title: Class Community
status: verified
keywords: community, post, posts, feed, anonymous, like, likes, comment, comments, CR, author, delete, realtime, community_posts, post_likes, post_comments, community_get_feed, moderation, media
---

## What the Class Community does

The Community page is a signed-in feed for class posts. Students can publish text posts, optionally anonymously, like posts, and add anonymous comments. The CR can see who wrote anonymous posts and can delete any post.

## Loading the feed

The page calls the `community_get_feed` RPC. That security-definer function checks that the caller is authenticated and returns, for each post:

- Post id, content, anonymity flag, and creation time.
- Author id, but only for non-anonymous posts; it is null for anonymous posts.
- Media URL and media type.
- Like count and whether the current user liked the post.
- A JSON array of comments.
- Flags for whether the post belongs to the current user and whether the current user can delete it.

The front end also loads display names for non-anonymous authors from `profiles`. If the caller is the CR, it calls `cr_get_post_authors` to get the author names of anonymous posts.

## Publishing posts

A signed-in student writes up to 3,000 characters and can tick "Post anonymously". Publishing inserts `{ author_id, content, is_anonymous }` into `community_posts`. The database requires the author to be the current user.

The UI does not support media uploads, even though `community_posts` has `media_url` and `media_type` columns and a private `community-media` bucket exists. The feed can display media if a row already has a media URL, but there is no post composer path to create one.

There is no post editing UI.

## Likes

Each post has a like button. The UI updates optimistically, then inserts or deletes a row in `post_likes` for the current user. On failure it reverts the button and shows "Like failed".

The database has a `community_toggle_like` RPC, but the UI does not call it; it writes `post_likes` directly. The unique primary key on `(post_id, user_id)` prevents duplicate likes.

Likes update in realtime through a Supabase subscription on `post_likes`; the page reloads the feed after a short debounce.

## Comments

Comments are anonymous in the UI: every comment is labelled "Anonymous", regardless of the commenter. A signed-in student can add a comment up to 500 characters. The app inserts `{ post_id, user_id, content }` into `post_comments`.

The feed RPC returns comments, and the UI shows them under each post. Comments update in realtime through a subscription on `post_comments`.

There is no comment editing or deletion UI, even though a delete-own-comment policy exists.

## Deleting posts

The delete button appears when the RPC says the current user can delete the post. The author and the CR have that ability. Deleting removes the `community_posts` row; likes and comments are removed by `ON DELETE CASCADE`.

## Anonymity and privacy

- Anonymous posts return a null author id from the feed RPC.
- The front end does not subscribe to `community_posts` row payloads, because those payloads can contain `author_id`.
- Only the CR's author-lookup RPC reveals anonymous authors.
- However, comments are stored with `user_id` even though the UI labels them anonymous. RLS allows authenticated users to read comments, so the database row still links a comment to its author; the UI simply does not display it.

## Unused or schema-only pieces

- `community_comments`: legacy table, no UI use.
- `community_reactions`: table and policies exist, no UI use.
- `community-media` storage bucket: private, authenticated upload/read policies, no UI upload flow.
- `community_feed` view: exists, but the UI uses the `community_get_feed` RPC instead.
- `community_toggle_like` RPC: exists, but the UI writes `post_likes` directly.

Status: verified for posts, anonymity, likes, comments, CR moderation, and realtime updates. Partial for media, comment identity/privacy, and management.

## Common errors

- "Join the community" gate means the user is signed out.
- "Please write something first." The post is empty.
- "Could not publish post" usually means a validation, network, or RLS problem.
- "Like failed" means the like write failed and was reverted.
- "Could not post comment" means the comment write failed.
- "Could not load posts" usually means the feed RPC or network failed.
- "You do not have permission to delete this post" means the row was not deleted by RLS.
