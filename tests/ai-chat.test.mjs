import assert from "node:assert/strict";
import test from "node:test";

import {
  historyToInteractionInput,
  normaliseHistory,
  readInteractionEvent,
  SseDecoder,
  titleFromMessage,
  upstreamErrorMessage,
  validateChatRequest,
} from "../supabase/functions/_shared/gemini.ts";

const CONVERSATION_ID = "5d1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6a7b";

test("validateChatRequest accepts a normal message", () => {
  const result = validateChatRequest({ conversationId: CONVERSATION_ID, message: "  Explain rasa  " });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.message, "Explain rasa");
    assert.equal(result.value.conversationId, CONVERSATION_ID);
  }
});

test("validateChatRequest rejects bad input", () => {
  assert.equal(validateChatRequest(null).ok, false);
  assert.equal(validateChatRequest({}).ok, false);
  assert.equal(validateChatRequest({ conversationId: "nope", message: "hi" }).ok, false);
  assert.equal(validateChatRequest({ conversationId: CONVERSATION_ID, message: "   " }).ok, false);
  const tooLong = validateChatRequest({
    conversationId: CONVERSATION_ID,
    message: "x".repeat(4001),
  });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.status, 413);
});

test("titleFromMessage collapses whitespace and truncates", () => {
  assert.equal(titleFromMessage("  What   is\nPitta?  "), "What is Pitta?");
  const long = titleFromMessage("a".repeat(100), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});

test("SseDecoder handles arbitrary chunk boundaries and CRLF", () => {
  const decoder = new SseDecoder();
  const raw = [
    "event: interaction.created",
    'data: {"event_type":"interaction.created","interaction":{"id":"v1_abc","status":"in_progress"}}',
    "",
    "event: step.delta",
    'data: {"event_type":"step.delta","delta":{"type":"text","text":"Hello"}}',
    "",
    "",
  ].join("\r\n");

  const events = [];
  for (let i = 0; i < raw.length; i += 7) {
    events.push(...decoder.push(raw.slice(i, i + 7)));
  }
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "interaction.created");
  assert.equal(JSON.parse(events[0].data).interaction.id, "v1_abc");
  assert.equal(events[1].event, "step.delta");
  assert.equal(JSON.parse(events[1].data).delta.text, "Hello");
});

test("readInteractionEvent collects step.start and step.delta text only", () => {
  const start = readInteractionEvent({
    event_type: "step.start",
    step: {
      type: "model_output",
      content: [{ type: "text", text: "First chunk " }],
    },
  });
  assert.equal(start.text, "First chunk ");

  const delta = readInteractionEvent({
    event_type: "step.delta",
    delta: { type: "text", text: "second chunk" },
  });
  assert.equal(delta.text, "second chunk");

  const thought = readInteractionEvent({
    event_type: "step.delta",
    delta: { type: "thought_summary", content: { type: "text", text: "secret" } },
  });
  assert.equal(thought.text, "");

  const created = readInteractionEvent({
    event_type: "interaction.created",
    interaction: { id: "v1_123", status: "in_progress" },
  });
  assert.equal(created.interactionId, "v1_123");

  const error = readInteractionEvent({
    event_type: "error",
    error: { message: "quota exceeded" },
  });
  assert.equal(error.error, "quota exceeded");

  const completed = readInteractionEvent({
    event_type: "interaction.completed",
    interaction: { id: "v1_456", status: "completed" },
  });
  assert.equal(completed.interactionId, "v1_456");
  assert.equal(completed.status, "completed");
  assert.equal(completed.text, "");
});

test("a realistic SSE stream produces the full answer", () => {
  const decoder = new SseDecoder();
  const stream = [
    'event: interaction.created\ndata: {"event_type":"interaction.created","interaction":{"id":"v1_x","status":"in_progress"}}\n\n',
    'event: step.start\ndata: {"event_type":"step.start","step":{"type":"model_output","content":[{"type":"text","text":"Rasa "}]}}\n\n',
    'event: step.delta\ndata: {"event_type":"step.delta","delta":{"type":"text","text":"is the "}}\n\n',
    'event: step.delta\ndata: {"event_type":"step.delta","delta":{"type":"text","text":"essence of taste."}}\n\n',
    'event: interaction.completed\ndata: {"event_type":"interaction.completed","interaction":{"id":"v1_x","status":"completed"}}\n\n',
    "event: done\ndata: [DONE]\n\n",
  ].join("");

  let text = "";
  let interactionId = "";
  for (let i = 0; i < stream.length; i += 11) {
    for (const event of decoder.push(stream.slice(i, i + 11))) {
      if (event.data === "[DONE]") continue;
      const result = readInteractionEvent(JSON.parse(event.data));
      text += result.text;
      if (result.interactionId) interactionId = result.interactionId;
    }
  }
  for (const event of decoder.flush()) {
    if (event.data === "[DONE]") continue;
    const result = readInteractionEvent(JSON.parse(event.data));
    text += result.text;
    if (result.interactionId) interactionId = result.interactionId;
  }

  assert.equal(text, "Rasa is the essence of taste.");
  assert.equal(interactionId, "v1_x");
});

test("normaliseHistory trims, merges consecutive roles, and respects the limit", () => {
  const history = normaliseHistory([
    { role: "user", content: "one" },
    { role: "user", content: "two" },
    { role: "assistant", content: "three" },
    { role: "system", content: "ignored" },
    { role: "assistant", content: "  " },
  ]);
  assert.deepEqual(history, [
    { role: "user", content: "one\n\ntwo" },
    { role: "assistant", content: "three" },
  ]);
  const limited = normaliseHistory(
    Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) })),
    4,
  );
  assert.equal(limited.length, 4);
  assert.deepEqual(limited.map((row) => row.content), ["26", "27", "28", "29"]);
});

test("upstreamErrorMessage prefers Google's message and caps it", () => {
  assert.equal(
    upstreamErrorMessage({ error: { message: "model not found" } }, 404),
    "model not found",
  );
  assert.equal(upstreamErrorMessage({}, 502), "The AI service returned 502.");
  assert.equal(upstreamErrorMessage({ error: { message: "x".repeat(999) } }, 500).length, 300);
});

test("historyToInteractionInput uses Interactions API step shapes", () => {
  const input = historyToInteractionInput([
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
  ]);
  assert.deepEqual(input, [
    { type: "user_input", content: [{ type: "text", text: "Hello" }] },
    { type: "model_output", content: [{ type: "text", text: "Hi" }] },
  ]);
});
