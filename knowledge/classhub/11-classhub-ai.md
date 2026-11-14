---
id: ai-assistant
title: ClassHub AI
status: verified
keywords: classhub ai, ai, assistant, study assistant, chat, chatbot, conversation, conversations, chat history, saved, private, streaming, stop, retry, new chat, delete chat, title, Groq, model, gpt-oss-120b, RAG, knowledge base, retrieval
---

## What ClassHub AI is

ClassHub AI is a study assistant inside the AI Assistant section. It helps students understand concepts, revise topics, make study plans, and practise questions. It is not a medical service and the UI warns students to check important answers.

## Creator and AI identity
<!-- keywords: who created ClassHub, creator, Sudarshan, who made you, model, provider, Groq, OpenAI, ChatGPT, DeepSeek -->

ClassHub was independently created by Sudarshan. ClassHub AI is the assistant inside ClassHub, not a separate company or founding team. Sudarshan created the ClassHub AI integration; Groq provides the underlying model.

The default model is `openai/gpt-oss-120b`, and the optional `GROQ_MODEL` environment variable can override it. The `openai/` prefix is part of the model ID, not the provider of this chat. Do not claim to be ChatGPT, OpenAI, or DeepSeek, and do not confuse the tools used during development with the model currently powering the assistant.

Each signed-in student has private saved conversations. The UI shows a welcome screen with example prompts, a conversation history drawer, a streaming message area, a composer, a Stop button, and a New chat button.

## What the AI receives

For every message, the AI receives:

- A fixed system prompt describing its role and style.
- The latest stored conversation turns, up to 20 messages, replayed because the AI provider is stateless.
- For ClassHub-specific questions only, a small set of retrieved ClassHub knowledge chunks.

The AI is not given the student's PDFs, notes, marks, profile, email, class chat, community posts, or other students' data. It does not browse the internet.

## Sending a message
<!-- keywords: process a student message, message flow, student sends message, request processing -->

When a signed-in student sends a message:

1. If there is no active conversation, the browser creates one in `ai_conversations` with the title "New chat".
2. The browser immediately shows the student's message and a typing indicator.
3. It gets the current Supabase access token and POSTs `{ conversationId, message }` to the `ai-chat` Edge Function with the token and publishable key.
4. The function verifies the user, checks that the conversation belongs to that user through RLS, saves the user message, loads recent history, optionally retrieves ClassHub knowledge, and calls the AI provider.
5. The provider's streamed text is proxied back as server-sent events.
6. The page appends each delta to the assistant bubble as it arrives.
7. When the stream finishes, the page reloads the conversation list and shows the saved timestamp.

## Streaming, Stop, and retry

Replies stream word by word. While a reply is streaming, the composer and send button are disabled and a Stop button appears. Stop aborts the browser request and asks the server to cancel the upstream stream.

If a request fails before any text arrives, the page removes the optimistic user bubble, shows a friendly error in the assistant bubble, and offers a "Try again" button that resends the same message. If some text already arrived, the error is shown as a note under the partial reply instead.

## Saved conversations

Conversations are stored in `ai_conversations`; messages are stored in `ai_messages`. A conversation has a title, owner, timestamps, and messages. The row-level security policies make each conversation and message readable and writable only by its owner.

The conversation list is loaded newest-first, limited to 40 conversations. Opening a conversation loads up to 200 messages, oldest-first. Deleting a conversation asks for confirmation and deletes it; its messages are removed by `ON DELETE CASCADE`.

The first message becomes the conversation title, trimmed to about 60 characters by the Edge Function. The title is updated when the first reply finishes. A chat can be deleted but not renamed by the student.

## ClassHub knowledge retrieval (RAG)

ClassHub AI has a documentation-based knowledge layer so it can answer questions about the app itself:

- Maintainable Markdown documents live in `knowledge/classhub/`.
- A zero-dependency generator turns them into typed chunks in `supabase/functions/_shared/classhub-knowledge.generated.ts`.
- A pure TypeScript retriever in `supabase/functions/_shared/classhub-rag.ts` detects app-specific questions and ranks chunks with a BM25-style lexical score, keyword and synonym expansion, small title/phrase boosts, and weighted coverage checks.
- Only the top few chunks are inserted into the system prompt, capped by a character budget, so the prompt does not contain the whole documentation.
- For app questions, the prompt tells the model to answer only from the retrieved knowledge and conversation, to state the implementation status when relevant, and to say honestly when something is not verified.
- If no relevant chunk is found, the model is told not to guess and to say the answer is not verified in the current knowledge base.
- General study questions do not trigger retrieval and keep the normal study-assistant behaviour.

The knowledge base distinguishes verified, partial, schema-only, planned, and unknown information. It never contains provider keys or private student data. Retrieval uses no embeddings, no vector database, and no extra API provider.

## Limits

- Messages are capped at 4,000 characters; stored replies at 20,000 characters.
- A student can send at most 10 AI messages per minute.
- The AI provider request times out after 120 seconds.
- Replies are capped at 4,096 output tokens.
- The latest 20 stored messages are replayed; older messages are not sent.
- If the AI reply is cut off for length, the student is asked to send a shorter question or start a new chat.
- The AI is study help, not medical advice.

Status: verified. The live deployment, provider account status, and exact model availability are external and cannot be verified from the repository.
