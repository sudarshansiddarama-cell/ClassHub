/**
 * Pure helpers shared by the ai-chat Edge Function and the Node test suite.
 * Keep this file free of Deno/Node-specific APIs.
 */

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_STORED_MESSAGE_CHARS = 20000;
export const DEFAULT_MODEL = "gemini-3.8-flash";
export const AI_BUSY_MESSAGE =
  "The AI is busy right now. Please wait a few seconds and try again.";

/** Transient upstream failures worth retrying (demand spikes, quota, gateway). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** Exponential backoff with jitter, capped so a retry never stalls the chat. */
export function retryDelayMs(
  attempt: number,
  baseMs = 600,
  capMs = 4000,
  random: () => number = Math.random,
): number {
  const base = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  const jitter = 0.75 + Math.min(1, Math.max(0, random())) * 0.5;
  return Math.min(capMs, Math.round(base * jitter));
}

/** Google sometimes reports overload inside the streamed events too. */
export function isBusyMessage(message: string): boolean {
  return /high demand|overloaded|busy right now|resource_exhausted|quota|temporarily unavailable|rate limit|too many requests/i
    .test(String(message ?? ""));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
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

/** Trim and normalise history before it is sent back to Gemini. */
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

/** Incremental parser for the SSE framing used by Gemini and by our proxy. */
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

export interface InteractionEvent {
  text: string;
  interactionId?: string;
  status?: string;
  error?: string;
}

/**
 * Read one Interactions API SSE payload.
 * Text arrives both in step.start.content (first chunk) and step.delta.text.
 */
export function readInteractionEvent(payload: unknown): InteractionEvent {
  if (!payload || typeof payload !== "object") return { text: "" };
  const record = payload as Record<string, any>;

  if (record.event_type === "error") {
    const message = record.error && typeof record.error.message === "string"
      ? record.error.message
      : "The AI service returned an error.";
    return { text: "", error: message };
  }

  if (record.event_type === "interaction.created" || record.event_type === "interaction.completed") {
    const interaction = record.interaction && typeof record.interaction === "object"
      ? record.interaction
      : {};
    return {
      text: "",
      interactionId: typeof interaction.id === "string" ? interaction.id : undefined,
      status: typeof interaction.status === "string" ? interaction.status : undefined,
    };
  }

  if (record.event_type === "step.start") {
    const step = record.step;
    if (!step || step.type !== "model_output" || !Array.isArray(step.content)) {
      return { text: "" };
    }
    return { text: textFromParts(step.content) };
  }

  if (record.event_type === "step.delta") {
    const delta = record.delta;
    if (delta && delta.type === "text" && typeof delta.text === "string") {
      return { text: delta.text };
    }
  }

  return { text: "" };
}

function textFromParts(parts: unknown[]): string {
  let text = "";
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      text += record.text;
    }
  }
  return text;
}

export function upstreamErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, any>;
    const message = record.error && record.error.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 300);
    }
  }
  return `The AI service returned ${status}.`;
}

/** Convert stored messages into Interactions API input steps. */
export function historyToInteractionInput(history: ChatMessage[]): Array<Record<string, unknown>> {
  return history.map((message) => ({
    type: message.role === "assistant" ? "model_output" : "user_input",
    content: [{ type: "text", text: message.content }],
  }));
}
