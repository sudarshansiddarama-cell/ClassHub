/**
 * Pure helpers shared by the ai-chat Edge Function and the Node test suite.
 * Keep this file free of Deno/Node-specific APIs.
 */

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_STORED_MESSAGE_CHARS = 20000;
export const DEFAULT_MODEL = "openai/gpt-oss-120b";
export const AI_BUSY_MESSAGE =
  "The AI is busy right now. Please wait a few seconds and try again.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GroqMessage {
  role: "system" | ChatRole;
  content: string;
}

export interface ChatRequest {
  conversationId: string;
  message: string;
}

export type ChatRequestValidation =
  | { ok: true; value: ChatRequest }
  | { ok: false; status: number; error: string };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function titleFromMessage(message: string, maxLength = 60): string {
  const clean = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  if (clean.length <= maxLength) return clean;
  const cut = Math.max(1, maxLength - 1);
  return `${clean.slice(0, cut).trimEnd()}…`;
}

export function validateChatRequest(body: unknown): ChatRequestValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid request." };
  }
  const record = body as Record<string, unknown>;
  if (!isUuid(record.conversationId)) {
    return { ok: false, status: 400, error: "A valid conversation is required." };
  }
  if (typeof record.message !== "string") {
    return { ok: false, status: 400, error: "Write a message first." };
  }
  const message = record.message.trim();
  if (!message) {
    return { ok: false, status: 400, error: "Write a message first." };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      status: 413,
      error: `Messages must be ${MAX_MESSAGE_CHARS.toLocaleString()} characters or fewer.`,
    };
  }
  return {
    ok: true,
    value: { conversationId: record.conversationId, message },
  };
}

/** Trim and normalise history before it is sent to Groq. */
export function normaliseHistory(history: unknown[], maxMessages = MAX_HISTORY_MESSAGES): ChatMessage[] {
  const output: ChatMessage[] = [];
  const rows = Array.isArray(history) ? history.slice(-maxMessages) : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.content !== "string") continue;
    const content = record.content.trim().slice(0, MAX_STORED_MESSAGE_CHARS);
    if (!content) continue;
    const previous = output[output.length - 1];
    if (previous && previous.role === record.role) {
      previous.content = `${previous.content}\n\n${content}`.slice(0, MAX_STORED_MESSAGE_CHARS);
    } else {
      output.push({ role: record.role, content });
    }
  }
  return output;
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Incremental parser for the SSE framing used by Groq and by our proxy. */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += String(chunk ?? "");
    // Normalise after appending so a CRLF split across two network chunks
    // is still treated as one line break.
    this.buffer = this.buffer.replace(/\r\n/g, "\n");
    return this.drain(false);
  }

  flush(): SseEvent[] {
    this.buffer += "\n\n";
    return this.drain(true);
  }

  private drain(_final: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    let index = this.buffer.indexOf("\n\n");
    while (index !== -1) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const event = parseEventBlock(raw);
      if (event) events.push(event);
      index = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}

function parseEventBlock(raw: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (!data.length) return null;
  return { event, data: data.join("\n") };
}

export interface GroqEvent {
  text: string;
  finishReason?: string;
  error?: string;
}

/** Read one OpenAI-compatible streaming chunk from Groq. */
export function readGroqEvent(payload: unknown): GroqEvent {
  if (!payload || typeof payload !== "object") return { text: "" };
  const record = payload as Record<string, any>;

  if (record.error) {
    let message = "The AI service returned an error.";
    if (typeof record.error === "string" && record.error.trim()) {
      message = record.error.trim();
    } else if (
      typeof record.error === "object" &&
      typeof record.error.message === "string" &&
      record.error.message.trim()
    ) {
      message = record.error.message.trim();
    }
    return { text: "", error: message };
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = choices[0];
  if (!choice || typeof choice !== "object") return { text: "" };

  const delta = choice.delta && typeof choice.delta === "object" ? choice.delta : {};
  // Groq may stream a separate `reasoning` field for GPT-OSS. ClassHub only
  // displays the final answer, so that field is intentionally ignored.
  return {
    text: typeof delta.content === "string" ? delta.content : "",
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined,
  };
}

/** Build the OpenAI-style message list expected by Groq. */
export function buildGroqMessages(
  systemPrompt: string,
  history: ChatMessage[],
): GroqMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...history.map((message) => ({ role: message.role, content: message.content })),
  ];
}

export interface GroqRequest {
  model: string;
  messages: GroqMessage[];
  stream: true;
  max_completion_tokens: number;
  reasoning_effort?: "low";
  include_reasoning?: boolean;
}

/**
 * Build the streaming request body for Groq. GPT-OSS models support reasoning
 * controls; hiding reasoning keeps the ClassHub reply clean and low effort
 * keeps latency down. Other GROQ_MODEL values omit those parameters.
 */
export function buildGroqRequest(
  model: string,
  messages: GroqMessage[],
  maxCompletionTokens = 4096,
): GroqRequest {
  const request: GroqRequest = {
    model,
    messages,
    stream: true,
    max_completion_tokens: maxCompletionTokens,
  };
  if (model.startsWith("openai/gpt-oss-")) {
    request.reasoning_effort = "low";
    request.include_reasoning = false;
  }
  return request;
}

export function upstreamErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, any>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim().slice(0, 300);
    }
    const message = record.error && record.error.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 300);
    }
  }
  return `The AI service returned ${status}.`;
}

/** Groq reports throttling and overload in a few different ways. */
export function isBusyMessage(message: string): boolean {
  return /rate limit|too many requests|overloaded|busy|temporarily unavailable|quota|capacity/i
    .test(String(message ?? ""));
}
