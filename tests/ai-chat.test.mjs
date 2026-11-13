import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_BUSY_MESSAGE,
  buildDeepSeekMessages,
  buildDeepSeekRequest,
  isBusyMessage,
  normaliseHistory,
  readDeepSeekEvent,
  SseDecoder,
  titleFromMessage,
  upstreamErrorMessage,
  validateChatRequest,
} from "../supabase/functions/_shared/deepseek.ts";

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
  const stream = 'event: message\r\ndata: {"choices":[]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const events = [];
  for (let i = 0; i < stream.length; i += 3) {
    events.push(...decoder.push(stream.slice(i, i + 3)));
  }
  events.push(...decoder.flush());
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "message");
  assert.equal(events[0].data, '{"choices":[]}');
  assert.equal(events[1].data, "[DONE]");
});

test("readDeepSeekEvent extracts delta text, finish reason, and errors", () => {
  const chunk = readDeepSeekEvent({
    id: "chatcmpl-1",
    choices: [{
      index: 0,
      delta: { role: "assistant", content: "Rasa is " },
      finish_reason: null,
    }],
  });
  assert.equal(chunk.text, "Rasa is ");
  assert.equal(chunk.finishReason, undefined);

  const finished = readDeepSeekEvent({
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  assert.equal(finished.text, "");
  assert.equal(finished.finishReason, "stop");

  const reasoningOnly = readDeepSeekEvent({
    choices: [{ delta: { reasoning_content: "hidden chain of thought" } }],
  });
  assert.equal(reasoningOnly.text, "");

  const failed = readDeepSeekEvent({
    error: { message: "upstream overloaded", type: "server_error" },
  });
  assert.equal(failed.text, "");
  assert.equal(failed.error, "upstream overloaded");
});

test("a realistic DeepSeek SSE stream produces the full answer", () => {
  const decoder = new SseDecoder();
  const stream = [
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"content":"Rasa "},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"content":"is the "},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"content":"essence of taste."},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");

  let text = "";
  let finishReason = "";
  let sawDone = false;
  for (let i = 0; i < stream.length; i += 11) {
    for (const event of decoder.push(stream.slice(i, i + 11))) {
      if (event.data === "[DONE]") {
        sawDone = true;
        continue;
      }
      const result = readDeepSeekEvent(JSON.parse(event.data));
      text += result.text;
      if (result.finishReason) finishReason = result.finishReason;
    }
  }
  for (const event of decoder.flush()) {
    if (event.data === "[DONE]") {
      sawDone = true;
      continue;
    }
    const result = readDeepSeekEvent(JSON.parse(event.data));
    text += result.text;
    if (result.finishReason) finishReason = result.finishReason;
  }

  assert.equal(text, "Rasa is the essence of taste.");
  assert.equal(finishReason, "stop");
  assert.equal(sawDone, true);
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

test("buildDeepSeekMessages prepends the system prompt and keeps roles", () => {
  const messages = buildDeepSeekMessages("Be helpful.", [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Explain rasa" },
  ]);
  assert.deepEqual(messages, [
    { role: "system", content: "Be helpful." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Explain rasa" },
  ]);
});

test("buildDeepSeekRequest enables streaming and disables thinking", () => {
  const request = buildDeepSeekRequest(
    "deepseek-flash",
    buildDeepSeekMessages("Be helpful.", [{ role: "user", content: "Hello" }]),
  );
  assert.equal(request.model, "deepseek-flash");
  assert.equal(request.stream, true);
  assert.deepEqual(request.thinking, { type: "disabled" });
  assert.equal(request.max_tokens, 4096);
  assert.deepEqual(request.messages[0], { role: "system", content: "Be helpful." });
  assert.deepEqual(request.messages[1], { role: "user", content: "Hello" });
});

test("upstreamErrorMessage prefers DeepSeek's message and caps it", () => {
  assert.equal(
    upstreamErrorMessage({ error: { message: "model not found" } }, 404),
    "model not found",
  );
  assert.equal(upstreamErrorMessage({ error: "bad request" }, 400), "bad request");
  assert.equal(upstreamErrorMessage({}, 502), "The AI service returned 502.");
  assert.equal(upstreamErrorMessage({ error: { message: "x".repeat(999) } }, 500).length, 300);
});

test("isBusyMessage recognises throttling and overload text", () => {
  assert.equal(isBusyMessage("Rate limit reached. Please try again later."), true);
  assert.equal(isBusyMessage("The server is overloaded"), true);
  assert.equal(isBusyMessage(AI_BUSY_MESSAGE), true);
  assert.equal(isBusyMessage("The request was invalid."), false);
});
