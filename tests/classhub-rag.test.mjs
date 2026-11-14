import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  KNOWLEDGE_CHUNKS,
  KNOWLEDGE_CHUNK_COUNT,
  KNOWLEDGE_VERSION,
} from "../supabase/functions/_shared/classhub-knowledge.generated.ts";
import {
  MAX_RETRIEVED_CHUNKS,
  MAX_RETRIEVED_CONTEXT_CHARS,
  buildClassHubSystemPrompt,
  isClassHubQuestion,
  retrieveClassHubKnowledge,
} from "../supabase/functions/_shared/classhub-rag.ts";

const ACCEPTANCE_QUESTIONS = [
  {
    question: "What is ClassHub?",
    expected: ["overview#what-is-classhub"],
  },
  {
    question: "What sections are available?",
    expected: ["sections#available-sections"],
  },
  {
    question: "How does the Notes section work?",
    expected: ["notes#what-the-notes-section-does"],
  },
  {
    question: "How does ClassHub AI process a student's message?",
    expected: [
      "ai-assistant#sending-a-message",
      "ai-backend#end-to-end-message-processing",
    ],
  },
  {
    question: "Where are conversations stored?",
    expected: [
      "ai-assistant#saved-conversations",
      "ai-backend#conversation-ownership-and-storage",
    ],
  },
  {
    question: "How does authentication work?",
    expected: ["auth#how-sign-in-works", "security#authentication"],
  },
  {
    question: "What happens when an AI request fails?",
    expected: ["ai-backend#failure-handling"],
  },
  {
    question: "Which features are implemented and which are incomplete?",
    expected: ["feature-status#feature-status-overview"],
  },
];

test("knowledge bundle has valid chunks and unique ids", () => {
  assert.ok(KNOWLEDGE_CHUNK_COUNT >= 100, "knowledge bundle is unexpectedly small");
  assert.equal(KNOWLEDGE_CHUNKS.length, KNOWLEDGE_CHUNK_COUNT);
  assert.match(KNOWLEDGE_VERSION, /^[0-9a-f]{12}$/);

  const ids = new Set();
  const statuses = new Set(["verified", "partial", "schema-only", "planned", "unknown"]);
  for (const chunk of KNOWLEDGE_CHUNKS) {
    assert.ok(chunk.id, "chunk id is required");
    assert.ok(!ids.has(chunk.id), `duplicate chunk id: ${chunk.id}`);
    ids.add(chunk.id);
    assert.ok(statuses.has(chunk.status), `bad status for ${chunk.id}`);
    assert.ok(chunk.text.trim().length > 0, `empty chunk: ${chunk.id}`);
    assert.match(chunk.source, /^knowledge\/classhub\/.+\.md$/);
  }
});

test("the generated bundle is fresh", () => {
  const script = fileURLToPath(
    new URL("../scripts/build-classhub-knowledge.mjs", import.meta.url),
  );
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const output = execFileSync(process.execPath, [script, "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.match(output, /Knowledge bundle is fresh/);
});

test("the knowledge base contains no secrets or private student data", () => {
  const all = JSON.stringify(KNOWLEDGE_CHUNKS);
  assert.doesNotMatch(
    all,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    "a user or row identifier leaked",
  );
  assert.doesNotMatch(all, /sb_publishable_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(all, /service_role/i);
  assert.doesNotMatch(all, /\bgsk_[A-Za-z0-9]+/);
  assert.doesNotMatch(all, /\beyJ[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(all, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, "email address leaked");
});

test("the eight acceptance questions retrieve the expected chunks", () => {
  for (const { question, expected } of ACCEPTANCE_QUESTIONS) {
    const retrieval = retrieveClassHubKnowledge(question);
    assert.equal(retrieval.isAppQuestion, true, `not detected as app question: ${question}`);
    assert.ok(retrieval.chunks.length > 0, `no chunks for: ${question}`);
    assert.ok(retrieval.chunks.length <= MAX_RETRIEVED_CHUNKS);
    assert.ok(
      retrieval.context.length <= MAX_RETRIEVED_CONTEXT_CHARS,
      `context too large for: ${question}`,
    );

    const topIds = retrieval.chunks.map((chunk) => chunk.id);
    assert.ok(
      expected.some((id) => topIds.includes(id)),
      `expected one of ${expected.join(", ")} in top ${topIds.length}, got ${topIds.join(", ")} for: ${question}`,
    );
  }
});

test("the first acceptance question ranks the overview first", () => {
  const retrieval = retrieveClassHubKnowledge("What is ClassHub?");
  assert.equal(retrieval.chunks[0]?.id, "overview#what-is-classhub");
});

test("app overview variants also reach the overview", () => {
  for (const question of [
    "What is this app?",
    "Explain the app",
    "How does this app work?",
    "Tell me about ClassHub",
    "How do I use ClassHub?",
  ]) {
    const retrieval = retrieveClassHubKnowledge(question);
    assert.equal(retrieval.isAppQuestion, true, `not detected: ${question}`);
    assert.equal(
      retrieval.chunks[0]?.id,
      "overview#what-is-classhub",
      `wrong top chunk for: ${question}`,
    );
  }
});

test("general study questions are not treated as ClassHub questions", () => {
  const questions = [
    "Explain tridosha in simple terms",
    "Make a 7-day revision plan for Rachana Sharira",
    "Quiz me on Samhita Adhyayan",
    "Compare Vata, Pitta and Kapha",
    "What is Ayurveda?",
    "Explain the role of Agni in digestion",
    "What are the symptoms of Jvara?",
    "Describe the three doshas",
    "Give me mnemonics for the eight branches of Ayurveda",
    "What is the difference between Vata and Pitta?",
    "Explain the concept of Ojas",
    "How should I revise Padarth Vijnana?",
    "Summarize the Charak Samhita chapters on digestion",
    "What is the treatment for Amavata?",
    "Define Dhatu and explain its types",
    "Explain the notes of Charak Samhita on digestion",
    "What are the marks of a healthy pulse?",
    "Explain the assignment of the three doshas",
    "Explain the application of lepa in skin diseases",
    "List the types of Dhatu",
  ];

  for (const question of questions) {
    const retrieval = retrieveClassHubKnowledge(question);
    assert.equal(retrieval.isAppQuestion, false, `false positive: ${question}`);
    assert.equal(retrieval.chunks.length, 0);
    assert.equal(retrieval.context, "");
  }
});

test("common app questions are detected but unsupported features stay unverified", () => {
  const supported = [
    "Does ClassHub have attendance?",
    "Who can publish notices?",
    "Can I send a direct message to a classmate?",
    "Is there a dark mode?",
    "How do I change my password?",
    "Can students delete a notes PDF?",
    "How do I upload a test paper?",
    "How does Topic Search find page numbers?",
    "Can I delete my account?",
    "Who is the class representative?",
  ];
  for (const question of supported) {
    const retrieval = retrieveClassHubKnowledge(question);
    assert.equal(retrieval.isAppQuestion, true, `not detected: ${question}`);
    assert.ok(retrieval.chunks.length > 0, `no knowledge found: ${question}`);
  }

  const unsupported = [
    "Does ClassHub support video calls?",
    "What is the marking scheme?",
    "Is there a calendar?",
  ];
  for (const question of unsupported) {
    const retrieval = retrieveClassHubKnowledge(question);
    assert.equal(retrieval.isAppQuestion, true, `not detected: ${question}`);
    assert.equal(retrieval.chunks.length, 0, `unexpected knowledge: ${question}`);
    const prompt = buildClassHubSystemPrompt("BASE", retrieval);
    assert.match(prompt, /no relevant verified knowledge/i);
    assert.match(prompt, /not verified/i);
  }
});

test("short follow-ups reuse the previous ClassHub question", () => {
  const prior = ["Where are conversations stored?"];
  const retrieval = retrieveClassHubKnowledge("How is it protected?", prior);
  assert.equal(retrieval.isAppQuestion, true);
  assert.equal(retrieval.isFollowUp, true);
  assert.ok(
    retrieval.chunks.some((chunk) => chunk.id === "ai-backend#conversation-ownership-and-storage"),
  );

  const notices = retrieveClassHubKnowledge("What about notices?", [
    "What sections are available?",
  ]);
  assert.equal(notices.isFollowUp, true);
  assert.equal(notices.chunks[0]?.id, "notices#what-notices-does");
});

test("follow-ups are not invented without a prior app question", () => {
  const retrieval = retrieveClassHubKnowledge("How does it work?", [
    "Explain the role of Agni in digestion",
  ]);
  assert.equal(retrieval.isAppQuestion, false);
});

test("prompt builders keep the base prompt for study questions", () => {
  const base = "BASE STUDY PROMPT";
  const study = retrieveClassHubKnowledge("Explain the three doshas");
  assert.equal(buildClassHubSystemPrompt(base, study), base);

  const app = retrieveClassHubKnowledge("How does authentication work?");
  const prompt = buildClassHubSystemPrompt(base, app);
  assert.ok(prompt.startsWith(base));
  assert.match(prompt, /CLASSHUB KNOWLEDGE/);
  assert.match(prompt, /Rules for answering this ClassHub question/);
  assert.match(prompt, /Do not invent features/);
  assert.ok(prompt.length > base.length + 500);
});

test("retrieval honours its context and chunk limits", () => {
  const retrieval = retrieveClassHubKnowledge("How does ClassHub AI process a message?", [], {
    topK: 1,
    maxChars: 900,
  });
  assert.equal(retrieval.chunks.length, 1);
  assert.ok(retrieval.context.length <= 900);

  const capped = retrieveClassHubKnowledge("Which features are implemented?", [], {
    topK: 99,
  });
  assert.ok(capped.chunks.length <= 8);

  const byDefault = retrieveClassHubKnowledge("Which features are implemented?");
  assert.ok(byDefault.chunks.length <= MAX_RETRIEVED_CHUNKS);
});

test("question detection does not depend on the answer text", () => {
  assert.deepEqual(isClassHubQuestion("What is ClassHub?"), {
    isAppQuestion: true,
    isFollowUp: false,
  });
  assert.deepEqual(isClassHubQuestion("Explain Vata dosha"), {
    isAppQuestion: false,
    isFollowUp: false,
  });
});
