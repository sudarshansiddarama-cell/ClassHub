/**
 * ClassHub MCQ Practice backend.
 *
 * Generates multiple-choice questions from an uploaded PDF's extracted text
 * or from a typed chapter/topic name, using the same Groq provider as the
 * ClassHub AI assistant. Validates student answers server-side so scores and
 * answer keys are never trusted to the browser.
 *
 * Actions:
 *   { action: "generate", pdf_id, count? }
 *   { action: "generateFromTopic", topic, count? }
 *   { action: "validate", attempt_id, responses: [{ question_id, selected_option_index }], finalize? }
 *   { action: "feedback", attempt_id }
 *
 * Required secrets:
 *   GROQ_API_KEY                 (same provider as ai-chat)
 *   SUPABASE_SERVICE_ROLE_KEY    (provided by the Edge Runtime)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
const GROQ_TIMEOUT_MS = 45_000;
const MAX_QUESTIONS = 50;
const MIN_TEXT_CHARS = 200;
const ALLOWED_COUNTS = [10, 20, 30, 50];
const DEFAULT_COUNT = 10;
const BASE_CONTEXT_CHARS = 14_000;
const MAX_CONTEXT_CHARS = 80_000;
const MAX_GENERATIONS_PER_HOUR = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isTimeoutError(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : "";
  return name === "TimeoutError" || name === "AbortError" ||
    /timed? ?out|aborted/i.test(String(error ?? ""));
}

/* ------------------------------------------------------------------ */
/* Groq                                                               */
/* ------------------------------------------------------------------ */

class AiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGroq(prompt: string, temperature = 0.2, jsonMode = true): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a careful academic question writer. Return only valid JSON matching the requested schema. No markdown fences, no extra prose.",
          },
          { role: "user", content: prompt },
        ],
        stream: false,
        max_completion_tokens: 3000,
        temperature,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new AiError(504, "AI_TIMEOUT", "The AI took too long to respond. Please try again.");
    }
    throw new AiError(502, "AI_NETWORK_ERROR", "Could not reach the AI service. Check your connection and try again.");
  }

  if (!response.ok) {
    try { await response.text(); } catch { /* ignore */ }
    if (response.status === 401 || response.status === 403) {
      throw new AiError(503, "AI_AUTH_ERROR", "The AI service is not configured correctly.");
    }
    if (response.status === 429) {
      throw new AiError(503, "AI_BUSY", "The AI is busy right now. Please wait a few seconds and try again.");
    }
    if (response.status === 413) {
      throw new AiError(413, "AI_CONTEXT_TOO_LARGE", "The content is too large for the AI. Try a shorter document.");
    }
    if (response.status >= 500) {
      throw new AiError(503, "AI_UNAVAILABLE", "The AI service is temporarily unavailable. Please try again shortly.");
    }
    throw new AiError(502, "AI_ERROR", "The AI could not process that request. Please try again.");
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new AiError(502, "AI_BAD_FORMAT", "The AI returned an unreadable response. Please try again.");
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiError(502, "AI_EMPTY", "The AI returned an empty response. Please try again.");
  }
  return content.trim();
}

/* ------------------------------------------------------------------ */
/* Question validation                                                */
/* ------------------------------------------------------------------ */

type McqQuestion = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  subject_topic: string | null;
  source_page: string | null;
  difficulty: "easy" | "medium" | "hard";
};

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\[\[PAGE\s+\d+\]\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normaliseQuestion(raw: unknown, seen: Set<string>): McqQuestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const question = cleanText(r.question, 1200);
  if (question.length < 12) return null;

  const badShape =
    /\b(what are|list|enumerate|name the|select all|choose all|which of the following are|except|not one of|is not|are not|which is false|which is incorrect|true or false)\b/i;
  if (badShape.test(question)) return null;

  if (!Array.isArray(r.options) || r.options.length !== 4) return null;
  const options = r.options.map((o) => cleanText(o, 500));
  if (options.some((o) => !o)) return null;
  if (options.some((o) => /^(all|none)\s+of\s+(the\s+)?(above|these)$|^both\s+[a-d]\s+and\s+[a-d]$/i.test(o))) return null;
  const distinct = new Set(options.map((o) => o.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()));
  if (distinct.size !== 4) return null;

  if (typeof r.correct_index !== "number" || !Number.isInteger(r.correct_index) ||
    r.correct_index < 0 || r.correct_index > 3) return null;

  const explanation = cleanText(r.explanation, 900);
  if (explanation.length < 8) return null;

  const sourceAttribution = /\b(as per|according to|based on|per the|from the|per|per this|from this)\s+(source|material|pdf|document|text|content|extract)\b/i;
  if (sourceAttribution.test(question)) return null;
  if (options.some((o) => sourceAttribution.test(o))) return null;
  if (sourceAttribution.test(explanation)) return null;

  const difficulty = r.difficulty === "easy" || r.difficulty === "hard" ? r.difficulty : "medium";

  const key = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (seen.has(key)) return null;
  seen.add(key);

  return {
    question,
    options,
    correct_index: r.correct_index,
    explanation,
    subject_topic: cleanText(r.subject_topic, 120) || null,
    source_page: cleanText(r.source_page, 40) || null,
    difficulty,
  };
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return parseJsonSafe(text.slice(start, end + 1));
}

function parseGeneratedQuestions(content: string): McqQuestion[] {
  const parsed = extractJsonObject(content);
  if (!parsed || typeof parsed !== "object") return [];
  const list = Array.isArray((parsed as any).questions) ? (parsed as any).questions : [];
  const seen = new Set<string>();
  const questions: McqQuestion[] = [];
  for (const raw of list) {
    const q = normaliseQuestion(raw, seen);
    if (q) questions.push(q);
  }
  return questions;
}

/* ------------------------------------------------------------------ */
/* Text format parser                                                 */
/* ------------------------------------------------------------------ */

/**
 * Parses pasted text-format MCQs.
 *
 * Expected block format (blank line separates questions):
 *   Q: What is the capital of India?
 *   A) Delhi
 *   B) Mumbai
 *   C) Kolkata
 *   D) Chennai
 *   Ans: A
 *   Explanation: Delhi is the capital city of India.
 */
function parseTextQuestions(rawText: string, topic: string): McqQuestion[] {
  const blocks = rawText
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const questions: McqQuestion[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

    let questionText = "";
    const options: string[] = [];
    let correctIndex = -1;
    let explanation = "";

    for (const line of lines) {
      const qMatch = line.match(/^Q[:.]?\s*(.+)$/i);
      if (qMatch) { questionText = qMatch[1].trim(); continue; }

      const optMatch = line.match(/^([A-D])[\).:]\s*(.+)$/i);
      if (optMatch) {
        const idx = "ABCD".indexOf(optMatch[1].toUpperCase());
        options[idx] = optMatch[2].trim();
        continue;
      }

      const ansMatch = line.match(/^Ans?[:.]?\s*([A-D])$/i);
      if (ansMatch) { correctIndex = "ABCD".indexOf(ansMatch[1].toUpperCase()); continue; }

      const explMatch = line.match(/^Explanation[:.]?\s*(.+)$/i);
      if (explMatch) { explanation = explMatch[1].trim(); continue; }
    }

    if (!questionText || options.length !== 4 || correctIndex < 0) continue;
    if (options.some((o) => !o)) continue;

    const key = questionText.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);

    questions.push({
      question: questionText,
      options,
      correct_index: correctIndex,
      explanation: explanation || "Answer verified against your uploaded key.",
      subject_topic: topic || null,
      source_page: null,
      difficulty: "medium",
    });
  }

  return questions;
}

function buildGenerationPrompt(pdfTitle: string, text: string, count: number): string {
  return `You are an expert academic question writer for ClassHub (Ayurveda students).

TASK
Read the source material below (extracted from a PDF titled "${pdfTitle}") and write up to ${count} single-correct multiple-choice questions grounded ONLY in that material.

OUTPUT FORMAT
Return ONLY a single JSON object with this shape and nothing else:
{
  "questions": [
    {
      "question": "<question text>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "correct_index": <0|1|2|3>,
      "explanation": "<one or two short sentences explaining why the correct option is correct, based on the source>",
      "subject_topic": "<topic or subject, or null>",
      "source_page": "<page number from the [[PAGE n]] marker, or null>",
      "difficulty": "<easy|medium|hard>"
    }
  ]
}

QUALITY RULES (mandatory)
1. Every question and answer must be answerable from the source material. Do not invent facts. Do not write "as per source", "according to the source", "based on the source", "per the material", or any similar source-attribution phrase in the question text, options, or explanation.
2. Exactly one correct option. All four options must be present and distinct.
3. Every distractor must be clearly wrong to an expert. Never use an option that is also correct.
4. Never ask the student to list, name, enumerate, or pick multiple items.
   BAD: "What are the four types of Ayu?" with Hitayu / Ahitayu / Sukhayu / Duhkhayu as options — all four are correct.
   GOOD: "According to the source, what does Ayu mean?" with one correct definition and three wrong definitions.
5. Avoid negative or tricky wording: no NOT, EXCEPT, FALSE, "which is incorrect", or double negatives.
6. Never use "All of the above", "None of the above", or "Both A and B" as an option.
7. No ambiguous questions and no duplicate or near-duplicate questions.
8. correct_index must match the explanation and the source material.
9. The source contains [[PAGE n]] markers. When a question comes from a specific page, set source_page to that number as a string.
10. If the source contains too little usable material for ${count} good questions, return fewer (at least 1) instead of padding.

SOURCE MATERIAL:
---
${text}
---`;
}

function buildTopicGenerationPrompt(topic: string, count: number): string {
  return `You are an expert academic question writer for ClassHub (Ayurveda students).

TASK
Write exactly ${count} single-correct multiple-choice questions about "${topic}", grounded in general academic knowledge of that subject.

OUTPUT FORMAT
Return ONLY a single JSON object with this shape and nothing else:
{
  "questions": [
    {
      "question": "<question text>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "correct_index": <0|1|2|3>,
      "explanation": "<one or two short sentences explaining why the correct option is correct>",
      "subject_topic": "<topic or subject, or null>",
      "source_page": null,
      "difficulty": "<easy|medium|hard>"
    }
  ]
}

QUALITY RULES (mandatory)
1. Every question must have exactly one correct option. All four options must be present and distinct.
2. Do not ask to list, name, enumerate, or pick multiple items.
3. Avoid negative or tricky wording: no NOT, EXCEPT, FALSE, "which is incorrect", or double negatives.
4. Never use "All of the above", "None of the above", or "Both A and B" as an option.
5. No ambiguous questions and no duplicates.
6. Do NOT write "as per source", "according to the source", "based on the source", "per the material", or any similar source-attribution phrase in the question text, options, or explanation.
7. correct_index must match the explanation.
8. Keep explanations to 1-2 sentences.

QUESTIONS TO WRITE: ${count} questions about "${topic}".

SOURCE MATERIAL: None - write from general academic knowledge of "${topic}".`;
}

function buildReviewPrompt(pdfTitle: string, text: string, questions: McqQuestion[]): string {
  const payload = questions.map((q, index) => ({
    index,
    question: q.question,
    options: q.options,
    correct_index: q.correct_index,
    explanation: q.explanation,
  }));
  return `You are auditing multiple-choice questions for a study app. Use ONLY the source material below (from the PDF "${pdfTitle}") to decide which questions are safe to show students.

A question is VALID unless it has a clear violation:
- Two or more options are correct according to the source.
- The question asks for a list of items instead of one item.
- correct_index clearly contradicts the explanation or the source.
- The question uses NOT / EXCEPT / FALSE / "all of the above" tricks.

Do not reject a question merely because its explanation is short or paraphrased.
When you are unsure, keep the question.

OUTPUT FORMAT (JSON only):
{"valid_indices":[0,2,3],"rejected":[{"index":1,"reason":"short reason"}]}

QUESTIONS:
${JSON.stringify(payload)}

SOURCE MATERIAL:
---
${text}
---`;
}

async function auditQuestions(
  pdfTitle: string,
  text: string,
  questions: McqQuestion[],
): Promise<McqQuestion[] | null> {
  try {
    let content: string;
    try {
      content = await callGroq(buildReviewPrompt(pdfTitle, text, questions), 0);
    } catch (error) {
      if (error instanceof AiError && error.code === "AI_BUSY") {
        await sleep(2500);
        content = await callGroq(buildReviewPrompt(pdfTitle, text, questions), 0);
      } else {
        throw error;
      }
    }
    const parsed = extractJsonObject(content) as any;
    if (!parsed || !Array.isArray(parsed.valid_indices)) {
      return null;
    }
    const valid = new Set<number>();
    for (const value of parsed.valid_indices) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < questions.length) {
        valid.add(value);
      }
    }
    return questions.filter((_, index) => valid.has(index));
  } catch (error) {
    console.warn("mcq: audit skipped", String(error).slice(0, 200));
    return null;
  }
}

function resolveMcqCount(body: any): number {
  const raw = body?.count;
  if (raw == null) return DEFAULT_COUNT;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(parsed) && ALLOWED_COUNTS.includes(parsed)) return parsed;
  return DEFAULT_COUNT;
}

/* ------------------------------------------------------------------ */
/* Generate from PDF                                                  */
/* ------------------------------------------------------------------ */

async function handleGenerate(supabase: any, admin: any, user: any, body: any): Promise<Response> {
  const rawId = body?.pdf_id;
  const pdfId = typeof rawId === "number" ? String(rawId)
    : typeof rawId === "string" ? rawId.trim()
    : "";
  if (!/^\d+$/.test(pdfId)) {
    return json(400, { error: "A PDF is required.", code: "MISSING_PDF" });
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const { count } = await supabase
      .from("mcq_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", hourAgo)
      .not("title", "ilike", `${UPLOAD_TITLE_PREFIX}%`);
    if (typeof count === "number" && count >= MAX_GENERATIONS_PER_HOUR) {
      return json(429, {
        error: `You have generated ${MAX_GENERATIONS_PER_HOUR} quizzes this hour. Please try again later.`,
        code: "RATE_LIMITED",
      });
    }
  } catch (error) {
    console.warn("mcq: rate-limit check skipped", String(error));
  }

  const { data: pdf, error: pdfError } = await supabase
    .from("pdfs")
    .select("id, file_name, subject, subcategory, content_text")
    .eq("id", pdfId)
    .maybeSingle();

  if (pdfError) {
    console.error("mcq: pdf lookup failed", pdfError.message);
    return json(500, { error: "Could not access the selected PDF.", code: "PDF_LOOKUP_FAILED" });
  }
  if (!pdf) {
    return json(404, { error: "PDF not found or you do not have access to it.", code: "PDF_NOT_FOUND" });
  }

  const contentText = String(pdf.content_text || "").trim();
  if (contentText.length < MIN_TEXT_CHARS) {
    return json(422, {
      error: "This PDF has no extractable text yet (it may be a scanned image). ClassHub can try to read it with OCR first.",
      code: "NO_EXTRACTABLE_TEXT",
    });
  }

  const count = resolveMcqCount(body);
  const contextChars = Math.min(MAX_CONTEXT_CHARS, BASE_CONTEXT_CHARS + (count - 10) * 4_000);
  const fullContext = contentText.slice(0, contextChars);

  const collected = new Map<string, McqQuestion>();
  let lastError: unknown = null;
  const numWindows = count <= 10 ? 1 : count <= 30 ? 2 : 3;

  for (let w = 0; w < numWindows && collected.size < count; w++) {
    const windowChars = Math.min(MAX_CONTEXT_CHARS, Math.max(BASE_CONTEXT_CHARS, Math.floor(fullContext.length / numWindows)));
    const maxStart = Math.max(0, fullContext.length - windowChars);
    const start = numWindows > 1 ? Math.floor((w / (numWindows - 1)) * maxStart) : 0;
    const windowContext = fullContext.slice(start, start + windowChars);
    const prompt = buildGenerationPrompt(pdf.file_name || "PDF", windowContext, count);

    for (let attempt = 0; attempt < 2 && collected.size < count; attempt++) {
      try {
        const content = await callGroq(prompt);
        for (const question of parseGeneratedQuestions(content)) {
          const key = question.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
          if (!collected.has(key) && collected.size < count) collected.set(key, question);
        }
        if (!collected.size) {
          console.warn(`mcq: window ${w + 1}, attempt ${attempt + 1}: AI produced no valid questions`);
        }
      } catch (error) {
        lastError = error;
        if (error instanceof AiError && error.code === "AI_AUTH_ERROR") break;
        if (error instanceof AiError && error.code === "AI_BUSY") await sleep(1500);
      }
    }
  }

  const drafted = [...collected.values()].slice(0, count);

  if (!drafted.length) {
    if (lastError instanceof AiError) {
      return json(lastError.status, { error: lastError.message, code: lastError.code });
    }
    return json(422, {
      error: "The AI could not generate usable questions from this PDF. The content may be too short, scanned, or unstructured. Try another PDF.",
      code: "NO_QUESTIONS_GENERATED",
    });
  }

  const audited = await auditQuestions(pdf.file_name || "PDF", fullContext, drafted);
  if (audited && audited.length === 0) {
    return json(422, {
      error: "The AI's draft questions did not pass the quality check. Please try again, or choose a PDF with clearer academic text.",
      code: "NO_VALID_QUESTIONS",
    });
  }
  const questions = audited && audited.length ? audited : drafted;

  const title = `${String(pdf.file_name || "PDF").slice(0, 170)} · MCQ Practice`.slice(0, 200);
  const { data: session, error: sessionError } = await admin
    .from("mcq_sessions")
    .insert({
      user_id: user.id,
      source_pdf_id: pdfId,
      title,
      status: "ready",
      total_questions: questions.length,
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    console.error("mcq: session insert failed", sessionError?.message);
    return json(500, { error: "Could not save the quiz session.", code: "SESSION_SAVE_FAILED" });
  }

  const questionRows = questions.map((q, index) => ({
    session_id: session.id,
    question_text: q.question,
    options: q.options.map((text, idx) => ({ index: idx, text })),
    subject_topic: q.subject_topic,
    source_page: q.source_page,
    difficulty: q.difficulty,
    order_index: index,
  }));

  const { data: inserted, error: questionsError } = await admin
    .from("mcq_questions")
    .insert(questionRows)
    .select("id, order_index");

  if (questionsError || !inserted) {
    console.error("mcq: questions insert failed", questionsError?.message);
    await admin.from("mcq_sessions").delete().eq("id", session.id);
    return json(500, { error: "Could not save the generated questions.", code: "QUESTIONS_SAVE_FAILED" });
  }

  const insertedByOrder = new Map((inserted as any[]).map((row) => [row.order_index, row.id]));
  const keyRows = questions
    .map((q, index) => ({
      question_id: insertedByOrder.get(index),
      correct_option_index: q.correct_index,
      explanation: q.explanation,
    }))
    .filter((row) => row.question_id);

  const { error: keysError } = await admin.from("mcq_answer_keys").insert(keyRows);
  if (keysError) {
    console.error("mcq: answer keys insert failed", keysError.message);
    await admin.from("mcq_sessions").delete().eq("id", session.id);
    return json(500, { error: "Could not save the answer keys.", code: "KEYS_SAVE_FAILED" });
  }

  const sanitised = questions.map((q, index) => ({
    id: insertedByOrder.get(index),
    order_index: index,
    question_text: q.question,
    options: q.options.map((text, idx) => ({ index: idx, text })),
    subject_topic: q.subject_topic,
    source_page: q.source_page,
    difficulty: q.difficulty,
  }));

  return json(200, {
    session_id: session.id,
    title,
    total_questions: questions.length,
    questions: sanitised,
  });
}

/* ------------------------------------------------------------------ */
/* Generate from topic                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Shared session storage                                             */
/* ------------------------------------------------------------------ */

const UPLOAD_TITLE_PREFIX = "Uploaded MCQs · ";

/** Topic/upload sessions need a source_pdf_id, so they share one hidden row. */
async function getOrCreatePlaceholderPdf(admin: any): Promise<number | null> {
  const { data: placeholder } = await admin
    .from("pdfs")
    .select("id")
    .eq("file_name", "__TOPIC_BASED_MCQS__")
    .maybeSingle();
  if (placeholder?.id) return placeholder.id as number;

  const { data: created, error: createError } = await admin
    .from("pdfs")
    .insert({
      file_name: "__TOPIC_BASED_MCQS__",
      file_url: "",
      subject: "Topic-Based MCQs",
      content_text: "",
    })
    .select("id")
    .single();
  if (createError || !created) {
    console.error("mcq: placeholder pdf create failed", createError?.message);
    return null;
  }
  return created.id as number;
}

/** Saves a ready session with its questions and server-only answer keys. */
async function saveSessionWithQuestions(
  admin: any,
  userId: string,
  pdfId: number,
  title: string,
  questions: McqQuestion[],
): Promise<Response | { sessionId: string; sanitised: any[] }> {
  const { data: session, error: sessionError } = await admin
    .from("mcq_sessions")
    .insert({
      user_id: userId,
      source_pdf_id: pdfId,
      title: title.slice(0, 200),
      status: "ready",
      total_questions: questions.length,
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    console.error("mcq: session insert failed", sessionError?.message);
    return json(500, { error: "Could not save the quiz session.", code: "SESSION_SAVE_FAILED" });
  }

  const questionRows = questions.map((q, index) => ({
    session_id: session.id,
    question_text: q.question,
    options: q.options.map((text, idx) => ({ index: idx, text })),
    subject_topic: q.subject_topic,
    source_page: q.source_page,
    difficulty: q.difficulty,
    order_index: index,
  }));

  const { data: inserted, error: questionsError } = await admin
    .from("mcq_questions")
    .insert(questionRows)
    .select("id, order_index");

  if (questionsError || !inserted) {
    console.error("mcq: questions insert failed", questionsError?.message);
    await admin.from("mcq_sessions").delete().eq("id", session.id);
    return json(500, { error: "Could not save the questions.", code: "QUESTIONS_SAVE_FAILED" });
  }

  const insertedByOrder = new Map((inserted as any[]).map((row) => [row.order_index, row.id]));
  const keyRows = questions
    .map((q, index) => ({
      question_id: insertedByOrder.get(index),
      correct_option_index: q.correct_index,
      explanation: q.explanation,
    }))
    .filter((row) => row.question_id);

  const { error: keysError } = await admin.from("mcq_answer_keys").insert(keyRows);
  if (keysError) {
    console.error("mcq: answer keys insert failed", keysError.message);
    await admin.from("mcq_sessions").delete().eq("id", session.id);
    return json(500, { error: "Could not save the answer keys.", code: "KEYS_SAVE_FAILED" });
  }

  return {
    sessionId: session.id,
    sanitised: questions.map((q, index) => ({
      id: insertedByOrder.get(index),
      order_index: index,
      question_text: q.question,
      options: q.options.map((text, idx) => ({ index: idx, text })),
      subject_topic: q.subject_topic,
      source_page: q.source_page,
      difficulty: q.difficulty,
    })),
  };
}

/** The student's own uploaded questions for a topic, newest uploads first. */
async function loadUploadedQuestions(
  admin: any,
  userId: string,
  topic: string,
  limit: number,
): Promise<McqQuestion[]> {
  const title = (UPLOAD_TITLE_PREFIX + topic).slice(0, 200);
  const { data: sessions, error } = await admin
    .from("mcq_sessions")
    .select("id")
    .eq("user_id", userId)
    .ilike("title", title)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !sessions?.length) return [];

  const out: McqQuestion[] = [];
  const seen = new Set<string>();

  for (const session of sessions as any[]) {
    if (out.length >= limit) break;

    const { data: rows, error: rowsError } = await admin
      .from("mcq_questions")
      .select("id, question_text, options, subject_topic, source_page, difficulty, order_index")
      .eq("session_id", session.id)
      .order("order_index", { ascending: true });
    if (rowsError || !rows?.length) continue;

    const ids = (rows as any[]).map((r) => r.id);
    const { data: keys } = await admin
      .from("mcq_answer_keys")
      .select("question_id, correct_option_index, explanation")
      .in("question_id", ids);
    const keyByQuestion = new Map((keys || []).map((k: any) => [k.question_id, k]));

    for (const row of rows as any[]) {
      if (out.length >= limit) break;
      const text = String(row.question_text ?? "").trim();
      if (!text) continue;
      const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const answer = keyByQuestion.get(row.id);
      if (!answer || seen.has(key)) continue;
      seen.add(key);
      out.push({
        question: text,
        options: (row.options || []).map((o: any) => o.text),
        correct_index: answer.correct_option_index,
        explanation: answer.explanation || "",
        subject_topic: row.subject_topic || topic,
        source_page: row.source_page,
        difficulty: row.difficulty || "medium",
      });
    }
  }

  return out;
}

async function handleGenerateTopic(supabase: any, admin: any, user: any, body: any): Promise<Response> {
  const rawTopic = body?.topic;
  const topic = typeof rawTopic === "string" ? rawTopic.trim() : "";
  if (!topic || topic.length < 3) {
    return json(400, { error: "Please enter a chapter or topic name.", code: "MISSING_TOPIC" });
  }
  if (topic.length > 120) {
    return json(400, { error: "Topic name is too long. Keep it under 120 characters.", code: "TOPIC_TOO_LONG" });
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const { count } = await supabase
      .from("mcq_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", hourAgo)
      .not("title", "ilike", `${UPLOAD_TITLE_PREFIX}%`);
    if (typeof count === "number" && count >= MAX_GENERATIONS_PER_HOUR) {
      return json(429, {
        error: `You have generated ${MAX_GENERATIONS_PER_HOUR} quizzes this hour. Please try again later.`,
        code: "RATE_LIMITED",
      });
    }
  } catch (error) {
    console.warn("mcq: rate-limit check skipped", String(error));
  }

  const count = resolveMcqCount(body);

  // --- 1. Use the student's own uploaded questions for this topic first ---
  const uploaded = await loadUploadedQuestions(admin, user.id, topic, count);

  const collected = new Map<string, McqQuestion>();
  for (const q of uploaded) {
    const key = q.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!collected.has(key) && collected.size < count) collected.set(key, q);
  }

  let lastError: unknown = null;
  let aiNeeded = count - collected.size;

  // --- 2. Supplement with AI generation if needed ---
  if (aiNeeded > 0) {
    const numWindows = aiNeeded <= 10 ? 1 : aiNeeded <= 30 ? 2 : 3;

    for (let w = 0; w < numWindows && collected.size < count; w++) {
      const prompt = buildTopicGenerationPrompt(topic, aiNeeded);
      for (let attempt = 0; attempt < 2 && collected.size < count; attempt++) {
        try {
          const content = await callGroq(prompt);
          for (const question of parseGeneratedQuestions(content)) {
            const key = question.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
            if (!collected.has(key) && collected.size < count) collected.set(key, question);
          }
        } catch (error) {
          lastError = error;
          if (error instanceof AiError && error.code === "AI_AUTH_ERROR") break;
          if (error instanceof AiError && error.code === "AI_BUSY") await sleep(1500);
        }
      }
    }
  }

  const drafted = [...collected.values()].slice(0, count);

  if (!drafted.length) {
    if (lastError instanceof AiError) {
      return json(lastError.status, { error: lastError.message, code: lastError.code });
    }
    return json(422, {
      error: "No questions found for this topic. Upload some or try a different chapter name.",
      code: "NO_QUESTIONS_GENERATED",
    });
  }

  const questions = drafted;

  // Topic-based sessions need a source_pdf_id. Use a shared placeholder PDF.
  const pdfId = await getOrCreatePlaceholderPdf(admin);
  if (!pdfId) {
    return json(500, { error: "Could not prepare topic storage.", code: "PDF_CREATE_FAILED" });
  }

  const title = `MCQ Practice · ${topic}`.slice(0, 200);
  const saved = await saveSessionWithQuestions(admin, user.id, pdfId, title, questions);
  if (saved instanceof Response) return saved;

  return json(200, {
    session_id: saved.sessionId,
    title,
    total_questions: questions.length,
    questions: saved.sanitised,
  });
}

/* ------------------------------------------------------------------ */
/* Upload MCQs from text                                              */
/* ------------------------------------------------------------------ */

async function handleUploadFromText(supabase: any, admin: any, user: any, body: any): Promise<Response> {
  const rawTopic = body?.topic;
  const topic = typeof rawTopic === "string" ? rawTopic.trim() : "";
  if (!topic || topic.length < 3) {
    return json(400, { error: "Please enter a chapter or topic name.", code: "MISSING_TOPIC" });
  }
  if (topic.length > 120) {
    return json(400, { error: "Topic name is too long. Keep it under 120 characters.", code: "TOPIC_TOO_LONG" });
  }

  const rawText = typeof body?.text === "string" ? body.text.trim() : "";
  if (!rawText) {
    return json(400, { error: "Please paste your questions in text format.", code: "MISSING_TEXT" });
  }

  const questions = parseTextQuestions(rawText, topic);
  if (!questions.length) {
    return json(422, {
      error: "Could not parse any questions. Use the format: Q: ... / A) ... / B) ... / C) ... / D) ... / Ans: X / Explanation: ...",
      code: "PARSE_FAILED",
    });
  }

  const pdfId = await getOrCreatePlaceholderPdf(admin);
  if (!pdfId) {
    return json(500, { error: "Could not prepare your upload.", code: "PDF_CREATE_FAILED" });
  }

  const title = (UPLOAD_TITLE_PREFIX + topic).slice(0, 200);
  const saved = await saveSessionWithQuestions(admin, user.id, pdfId, title, questions);
  if (saved instanceof Response) return saved;

  return json(200, {
    topic,
    session_id: saved.sessionId,
    uploaded: questions.length,
    total: questions.length,
    message: `Saved ${questions.length} MCQs under "${topic}". Type that chapter name in MCQ Practice to practise them.`,
  });
}

/* ------------------------------------------------------------------ */
/* AI-generated explanation for a single MCQ answer                   */
/* ------------------------------------------------------------------ */

async function handleExplain(supabase: any, admin: any, user: any, body: any): Promise<Response> {
  const questionText = typeof body?.question_text === "string" ? body.question_text.trim() : "";
  const options = Array.isArray(body?.options) ? body.options.map(String).slice(0, 4) : [];
  const correctIndex = typeof body?.correct_index === "number" ? body.correct_index : -1;

  if (!questionText) {
    return json(400, { error: "Question is required.", code: "MISSING_QUESTION" });
  }
  if (options.length !== 4) {
    return json(400, { error: "Four options are required.", code: "BAD_OPTIONS" });
  }
  if (correctIndex < 0 || correctIndex > 3) {
    return json(400, { error: "Invalid correct answer.", code: "BAD_ANSWER" });
  }

  const correctLetter = "ABCD"[correctIndex];
  const correctText = options[correctIndex];

  const prompt = `You are an Ayurveda academic tutor. Explain why option ${correctLetter} is the correct answer to this MCQ. Write exactly 3-5 short, simple lines. Do NOT say "as per source", "according to the source", "based on the source", or any source-attribution phrase. Just explain the answer directly in plain language.

Question: ${questionText}
A) ${options[0]}
B) ${options[1]}
C) ${options[2]}
D) ${options[3]}
Correct answer: ${correctLetter} — ${correctText}

Return only the explanation text, no labels, no markdown, no JSON.`;

  try {
    const explanation = await callGroq(prompt, 0.3, false);
    return json(200, { explanation: explanation.trim() });
  } catch (error) {
    if (error instanceof AiError) {
      return json(error.status, { error: error.message, code: error.code });
    }
    return json(500, { error: "Could not generate explanation.", code: "EXPLAIN_FAILED" });
  }
}

/* ------------------------------------------------------------------ */
/* Delete a practice session                                          */
/* ------------------------------------------------------------------ */

async function handleDeleteSession(supabase: any, admin: any, user: any, body: any): Promise<Response> {
  const sessionId = typeof body?.session_id === "string" ? body.session_id.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return json(400, { error: "Invalid practice session.", code: "BAD_SESSION" });
  }

  const { data: row } = await admin
    .from("mcq_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) {
    return json(404, { error: "That practice session was not found.", code: "NOT_FOUND" });
  }

  const { error } = await admin
    .from("mcq_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (error) {
    console.error("mcq: delete session failed", error.message);
    return json(500, { error: "Could not delete this session.", code: "DELETE_FAILED" });
  }
  return json(200, { deleted: true, session_id: sessionId });
}

/* ------------------------------------------------------------------ */
/* Validate / feedback                                                */
/* ------------------------------------------------------------------ */

type KeyRow = { question_id: string; correct_option_index: number; explanation: string };
type QuestionRow = { id: string; order_index: number; question_text: string; options: any };

function selectionOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 0 && value <= 3 ? value : null;
}

function feedbackFor(
  questionId: string,
  selected: number,
  key: KeyRow,
  revealCorrect: boolean,
  locked: boolean,
) {
  const isCorrect = selected >= 0 && key.correct_option_index === selected;
  return {
    question_id: questionId,
    selected_option_index: selected,
    is_correct: isCorrect,
    ...(revealCorrect || !isCorrect ? { correct_option_index: key.correct_option_index } : {}),
    explanation: key.explanation,
    locked,
  };
}

function summaryFrom(params: {
  attemptId: string;
  questions: QuestionRow[];
  keys: Map<string, KeyRow>;
  selections: Map<string, number>;
  startedAt: string | null;
  completedAt: string | null;
}) {
  const { attemptId, questions, keys, selections, startedAt, completedAt } = params;
  const results = questions.map((q) => {
    const selected = selections.has(q.id) ? (selections.get(q.id) as number) : -1;
    const key = keys.get(q.id) ?? { question_id: q.id, correct_option_index: -1, explanation: "" };
    const isCorrect = selected >= 0 && key.correct_option_index === selected;
    return {
      question_id: q.id,
      selected_option_index: selected,
      is_correct: isCorrect,
      correct_option_index: key.correct_option_index,
      explanation: key.explanation,
      locked: true,
    };
  });

  const correct = results.filter((r) => r.is_correct).length;
  const unanswered = results.filter((r) => r.selected_option_index < 0).length;
  const total = results.length;
  const incorrect = total - correct - unanswered;
  const ended = completedAt ? new Date(completedAt).getTime() : Date.now();
  const started = startedAt ? new Date(startedAt).getTime() : ended;
  const timeTaken = Math.max(0, Math.round((ended - started) / 1000));

  return {
    attempt_id: attemptId,
    score: correct,
    total,
    correct,
    incorrect,
    unanswered,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    time_taken_seconds: timeTaken,
    results,
  };
}

async function loadAttemptData(admin: any, attemptId: string, sessionId: string) {
  const { data: questions, error: questionsError } = await admin
    .from("mcq_questions")
    .select("id, order_index, question_text, options")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  if (questionsError || !questions) {
    throw new Error("Could not load the questions.");
  }

  const ids = (questions as QuestionRow[]).map((q) => q.id);
  const { data: keyRows, error: keysError } = await admin
    .from("mcq_answer_keys")
    .select("question_id, correct_option_index, explanation")
    .in("question_id", ids);

  if (keysError) throw new Error("Could not load the answer keys.");

  const { data: responseRows } = await admin
    .from("mcq_responses")
    .select("question_id, selected_option_index, is_correct")
    .eq("attempt_id", attemptId);

  const keys = new Map<string, KeyRow>();
  for (const row of (keyRows as KeyRow[]) || []) keys.set(row.question_id, row);

  const selections = new Map<string, number>();
  for (const row of (responseRows as any[]) || []) {
    selections.set(row.question_id, row.selected_option_index);
  }

  return { questions: questions as QuestionRow[], keys, selections };
}

async function handleValidate(supabase: any, admin: any, user: any, body: any): Promise<Response> {
  const attemptId = typeof body?.attempt_id === "string" ? body.attempt_id : null;
  const responses = Array.isArray(body?.responses) ? body.responses : [];
  const finalize = body?.finalize === true;
  if (!attemptId) {
    return json(400, { error: "Attempt is required.", code: "MISSING_INPUT" });
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("mcq_attempts")
    .select("id, session_id, started_at, completed_at")
    .eq("id", attemptId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (attemptError) {
    console.error("mcq: attempt lookup failed", attemptError.message);
    return json(500, { error: "Could not load the attempt.", code: "ATTEMPT_LOOKUP_FAILED" });
  }
  if (!attempt) {
    return json(404, { error: "Attempt not found.", code: "ATTEMPT_NOT_FOUND" });
  }

  let data;
  try {
    data = await loadAttemptData(admin, attemptId, attempt.session_id);
  } catch (error) {
    console.error("mcq:", error);
    return json(500, { error: "Could not validate answers.", code: "VALIDATION_FAILED" });
  }
  const { questions, keys, selections } = data;
  const questionIds = new Set(questions.map((q) => q.id));

  if (attempt.completed_at) {
    const summary = summaryFrom({
      attemptId,
      questions,
      keys,
      selections,
      startedAt: attempt.started_at,
      completedAt: attempt.completed_at,
    });
    return json(200, { ...summary, already_completed: true });
  }

  if (!finalize) {
    if (!responses.length) {
      return json(400, { error: "Select an answer first.", code: "MISSING_INPUT" });
    }

    const results = [];
    const rowsToInsert = [];

    for (const raw of responses) {
      const questionId = typeof raw?.question_id === "string" ? raw.question_id : "";
      if (!questionIds.has(questionId)) {
        return json(400, { error: "That question does not belong to this practice session.", code: "INVALID_QUESTION" });
      }
      const key = keys.get(questionId);
      if (!key) {
        return json(500, { error: "The answer key for this question is missing.", code: "KEY_MISSING" });
      }

      if (selections.has(questionId)) {
        results.push(feedbackFor(questionId, selections.get(questionId) as number, key, false, true));
        continue;
      }

      const selected = selectionOrNull(raw?.selected_option_index);
      if (selected === null) {
        return json(400, { error: "Choose one of the four options.", code: "INVALID_OPTION" });
      }

      const isCorrect = key.correct_option_index === selected;
      rowsToInsert.push({
        attempt_id: attemptId,
        question_id: questionId,
        selected_option_index: selected,
        is_correct: isCorrect,
      });
      results.push(feedbackFor(questionId, selected, key, false, false));
    }

    if (rowsToInsert.length) {
      const { error: insertError } = await admin.from("mcq_responses").insert(rowsToInsert);
      if (insertError) {
        console.error("mcq: responses insert failed", insertError.message);
        return json(500, { error: "Could not save your answer.", code: "RESPONSES_SAVE_FAILED" });
      }
    }

    return json(200, { attempt_id: attemptId, results });
  }

  const pending = new Map<string, number>();
  for (const raw of responses) {
    const questionId = typeof raw?.question_id === "string" ? raw.question_id : "";
    if (!questionIds.has(questionId) || selections.has(questionId) || pending.has(questionId)) continue;
    const selected = selectionOrNull(raw?.selected_option_index);
    pending.set(questionId, selected === null ? -1 : selected);
  }

  const rowsToInsert = [];
  for (const q of questions) {
    if (selections.has(q.id)) continue;
    const selected = pending.has(q.id) ? (pending.get(q.id) as number) : -1;
    const key = keys.get(q.id);
    rowsToInsert.push({
      attempt_id: attemptId,
      question_id: q.id,
      selected_option_index: selected,
      is_correct: !!key && selected >= 0 && key.correct_option_index === selected,
    });
    selections.set(q.id, selected);
  }

  if (rowsToInsert.length) {
    const { error: insertError } = await admin.from("mcq_responses").insert(rowsToInsert);
    if (insertError) {
      console.error("mcq: final responses insert failed", insertError.message);
      return json(500, { error: "Could not save your answers.", code: "RESPONSES_SAVE_FAILED" });
    }
  }

  const summary = summaryFrom({
    attemptId,
    questions,
    keys,
    selections,
    startedAt: attempt.started_at,
    completedAt: null,
  });

  const { error: updateError } = await admin
    .from("mcq_attempts")
    .update({
      score: summary.correct,
      total: summary.total,
      completed_at: new Date().toISOString(),
      time_taken_seconds: summary.time_taken_seconds,
    })
    .eq("id", attemptId);

  if (updateError) {
    console.error("mcq: attempt update failed", updateError.message);
    return json(500, { error: "Could not finalise the attempt.", code: "ATTEMPT_FINALISE_FAILED" });
  }

  return json(200, summary);
}

async function handleFeedback(supabase: any, admin: any, user: any, body: any): Promise<Response> {
  const attemptId = typeof body?.attempt_id === "string" ? body.attempt_id : null;
  if (!attemptId) {
    return json(400, { error: "Attempt is required.", code: "MISSING_INPUT" });
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("mcq_attempts")
    .select("id, session_id, started_at, completed_at")
    .eq("id", attemptId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (attemptError) {
    return json(500, { error: "Could not load the attempt.", code: "ATTEMPT_LOOKUP_FAILED" });
  }
  if (!attempt) {
    return json(404, { error: "Attempt not found.", code: "ATTEMPT_NOT_FOUND" });
  }

  let data;
  try {
    data = await loadAttemptData(admin, attemptId, attempt.session_id);
  } catch (error) {
    console.error("mcq:", error);
    return json(500, { error: "Could not load feedback.", code: "FEEDBACK_FAILED" });
  }

  const results = [];
  for (const q of data.questions) {
    if (!data.selections.has(q.id)) continue;
    const key = data.keys.get(q.id);
    if (!key) continue;
    const selected = data.selections.get(q.id) as number;
    results.push(feedbackFor(q.id, selected, key, false, true));
  }

  return json(200, { attempt_id: attemptId, results, completed: !!attempt.completed_at });
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }
  if (!GROQ_API_KEY) {
    return json(503, { error: "The MCQ service is not configured yet.", code: "NOT_CONFIGURED" });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "The MCQ service is not configured yet.", code: "NOT_CONFIGURED" });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "Please sign in to use MCQ practice.", code: "UNAUTHENTICATED" });
  }

  const supabase = createClient(
    SUPABASE_URL,
    request.headers.get("apikey") || SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user;
  if (authError || !user) {
    return json(401, { error: "Please sign in again.", code: "UNAUTHENTICATED" });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request.", code: "BAD_REQUEST" });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = typeof body?.action === "string" ? body.action : "";
  if (action === "generate") return handleGenerate(supabase, admin, user, body);
  if (action === "generateFromTopic") return handleGenerateTopic(supabase, admin, user, body);
  if (action === "uploadFromText") return handleUploadFromText(supabase, admin, user, body);
  if (action === "explain") return handleExplain(supabase, admin, user, body);
  if (action === "deleteSession") return handleDeleteSession(supabase, admin, user, body);
  if (action === "validate") return handleValidate(supabase, admin, user, body);
  if (action === "feedback") return handleFeedback(supabase, admin, user, body);
  return json(400, { error: "Unknown action.", code: "UNKNOWN_ACTION" });
});
