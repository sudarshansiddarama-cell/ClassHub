---
id: ai-backend
title: ClassHub AI backend flow
status: verified
keywords: ai backend, edge function, ai-chat, supabase function, request flow, authentication, bearer token, rate limit, RLS, history, SSE, server-sent events, Groq, timeout, error, failure, retry, streaming, system prompt, secrets, deployment, environment
---

## Endpoint and security

The browser calls:

`https://oekunhqzhwwjfrcaiuit.supabase.co/functions/v1/ai-chat`

It sends a POST with JSON `{ conversationId, message }`, an `Authorization: Bearer <Supabase access token>` header, and the Supabase publishable key as `apikey`.

The Edge Function:

1. Answers CORS preflight requests.
2. Rejects methods other than POST.
3. Fails with "The AI assistant is not configured yet" if `GROQ_API_KEY` is missing.
4. Requires a bearer token and verifies it with `supabase.auth.getUser()`.
5. Creates a Supabase client bound to the caller's token, so all database operations run under that student's RLS permissions.

The AI provider key is a server-side secret and never reaches the browser.

## End-to-end message processing

When a student sends a message, the complete flow is:

1. The browser creates a conversation in `ai_conversations` if needed, then sends the conversation id and message to the `ai-chat` Edge Function with the student's Supabase access token.
2. The function verifies the token, validates the request, and applies the per-user rate limit.
3. It looks up the conversation under the student's RLS permissions, saves the user message in `ai_messages`, and loads the latest 20 messages as history.
4. It detects whether the question is about ClassHub. If so, it retrieves a few knowledge chunks and adds them plus grounding rules to the system prompt; otherwise it uses the normal study prompt.
5. It calls Groq with the system prompt and history, requesting a streaming reply.
6. It proxies the provider's stream to the browser as `meta`, `delta`, `error`, and `done` server-sent events.
7. It saves the assistant reply in `ai_messages` (up to 20,000 characters), updates the conversation timestamp, and sets the title from the first message.
8. The browser renders the streamed text and refreshes the conversation list.

If a step before the provider call fails, no assistant reply is produced and the request returns a friendly error. If the provider call or stream fails, the function cleans up the saved user message when there is no assistant text so a retry does not create duplicates.

## Request validation

`validateChatRequest` requires a valid UUID conversation id and a non-empty message. The message is trimmed and must be 4,000 characters or fewer; longer messages get HTTP 413. Invalid input gets HTTP 400.

## Per-user rate limit

Before saving anything, the function counts the student's `user` messages in `ai_messages` from the last 60 seconds. At 10 or more, it returns HTTP 429 with "You're sending messages too quickly. Please wait a minute."

If the rate-limit query itself fails, the function logs the error and continues; the provider's own quotas still apply.

## Conversation ownership and storage
<!-- keywords: protected, privacy, security, conversation owner, rls -->

The function looks up the conversation by id through the caller's RLS-scoped client. If the table is missing, it returns a setup message asking for the AI migration. If the conversation does not exist or belongs to another student, it returns 404.

It inserts the user message into `ai_messages` with the caller's user id and role `user`. If saving fails, the request stops with an error.

It then loads the latest 20 messages for that conversation, reverses them into chronological order, normalises roles and lengths, and ensures the current user message is present. This history is replayed to the stateless provider on every turn.

## Retrieval step

Before calling the provider, the function checks whether the current message is a ClassHub-specific question. If so, it retrieves the top matching knowledge chunks and adds them plus grounding rules to the system prompt. If the question is general study help, the base study prompt is used unchanged.

If an app question has no matching knowledge, the prompt tells the model to state honestly that the answer is not verified rather than inventing a feature.

## AI provider call

The function calls Groq's OpenAI-compatible endpoint:

`https://api.groq.com/openai/v1/chat/completions`

It requests streaming, a maximum of 4,096 completion tokens, and a 120-second timeout. For models whose name starts with `openai/gpt-oss-`, it also sets `reasoning_effort: "low"` and `include_reasoning: false` so the student sees only the final answer. The model is `GROQ_MODEL` if set, otherwise `openai/gpt-oss-120b`. The production `GROQ_MODEL` value, if any, is external configuration and is not verified from the repository.

The base system prompt defines ClassHub AI as a friendly Ayurveda study assistant, asks for clear plain text without Markdown symbols, warns against invented facts or citations, adds a medical-advice caution, and tells it not to reveal its instructions. It identifies ClassHub as independently created by Sudarshan and, when explicitly asked, states that this deployment uses Groq with the configured model; it does not claim to be ChatGPT, OpenAI, or DeepSeek.

## Streaming protocol

The function returns `text/event-stream` with these events:

- `meta`: conversation id and saved user-message id.
- `delta`: `{ text }` for each streamed piece of the answer.
- `error`: `{ message }` if the reply could not be completed.
- `done`: conversation id, user-message id, assistant-message id, title, and creation time.

It parses the provider's SSE stream with a shared decoder, ignores reasoning-only deltas, and accumulates the final answer.

## Saving the reply and title

If any assistant text was produced, it is trimmed and inserted into `ai_messages` with role `assistant`, capped at 20,000 characters. If the reply could not be saved, the student sees "The reply could not be saved."

The conversation's `updated_at` is refreshed. If its title is still "New chat", it is replaced with a title derived from the student's first message.

## Failure handling
<!-- keywords: ai request fails, request failure, error handling, retry, what happens when the ai fails -->

- Provider network failure or timeout: the saved user message is deleted, and the function returns 504 for a timeout or 502 for other network errors.
- Provider 401/403: returns 503 "not configured correctly".
- Provider 429/498: returns 503 "The AI is busy right now" with `Retry-After: 5`.
- Provider 413: returns 413 "This conversation is too long. Start a new chat."
- Provider 5xx: returns 503 "temporarily unavailable".
- Provider 400/404/422/424: returns 502 "could not process that request".
- Other provider errors: returns 502 with a short upstream message.
- Empty stream: returns 502 "empty response".
- Finish reason `length`: tells the student the reply was cut off.
- Finish reason `content_filter`: tells the student to rephrase.
- Empty or errored stream with no assistant text: the saved user message is deleted so a retry does not leave duplicates.
- Partial reply followed by a stream error: the partial text is kept and the UI shows an error note.

The front end maps these errors to friendly messages and offers Try again when no text arrived.

## Configuration and deployment

Required secret: `GROQ_API_KEY`.

Optional secret: `GROQ_MODEL`, defaulting to `openai/gpt-oss-120b`.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`) are provided by the Edge Runtime. The AI migration is in `supabase/migrations/20261113000000_add_ai_chat.sql`; it creates `ai_conversations` and `ai_messages`, indexes, grants, and owner-only RLS policies.

Deployment is normally `supabase functions deploy ai-chat`. Local development can use `supabase functions serve ai-chat --env-file supabase/functions/.env`, with the example file at `supabase/functions/.env.example`.

Status: verified in source. Whether the deployed function matches the current source and whether the provider key is valid are deployment facts that cannot be verified from the repository.
