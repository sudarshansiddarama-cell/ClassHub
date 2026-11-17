/**
 * ClassHub MCQ Practice backend.
 *
 * Generates multiple-choice questions from an uploaded PDF's extracted text
 * using the same Groq provider as the ClassHub AI assistant, and validates
 * student answers server-side so scores and answer keys are never trusted to
 * the browser.
 *
 * The browser never sees GROQ_API_KEY or SUPABASE_SERVICE_ROLE_KEY. It calls
 * this function with the student's Supabase access token; the function verifies
 * the user, checks PDF access, and performs privileged writes with the service
 * role so answer keys stay server-side.
 *
 * Required secrets:
 *   GROQ_API_KEY          (same provider as ai-chat)
 *   SUPABASE_SERVICE_ROLE_KEY
 * Optional:
 *   GROQ_MODEL (defaults to openai/gpt-oss-120b)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
const GROQ_TIMEOUT_MS = 120_000;
const GROQ_MAX_COMPLETION_TOKENS = 4096;

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

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    try {
      return await response.clone().text();
    } catch {
      return null;
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return /timed? ?out/i.test(String(error ?? ""));
  }
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  return name === "TimeoutError" || name === "AbortError" ||
    /timed? ?out/i.test(String(error));
}

async function callGroq(messages: { role: string; content: string }[]): Promise<Response> {
  return await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      stream: false,
      max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
  });
}

function groqErrorResponse(status: number, detail: unknown): Response {
  if (status === 401 || status === 403) {
    return json(503, { error: "The AI assistant is not configured correctly.", code: "AI_AUTH_ERROR" });
  }
  if (status === 429 || status === 498) {
    return json(503, { error: "The AI is busy right now. Please wait a few seconds and try again.", code: "AI_BUSY" }, { "Retry-After": "5" });
  }
  if (status === 413) {
    return json(413, { error: "The AI request was too large. Try a shorter document.", code: "AI_CONTEXT_TOO_LARGE" });
  }
  if (status >= 500) {
    return json(503, { error: "The AI service is temporarily unavailable. Please try again shortly.", code: "AI_UNAVAILABLE" });
  }
  return json(502, { error: "The AI could not process that request. Please try again.", code: "AI_ERROR" });
}

/* ------------------------------------------------------------------ */
/* Question-shape validation                                          */
/* ------------------------------------------------------------------ */

type McqQuestion = {
  question: string;
  options: string[];        // exactly 4
  correct_index: number;    // 0-3
  explanation: string;
  subject_topic?: string;
  source_page?: string;
  difficulty?: "easy" | "medium" | "hard";
};

function validateQuestionShape(value: unknown): value is McqQuestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.question !== "string" || !r.question.trim()) return false;
  if (!Array.isArray(r.options) || r.options.length !== 4) return false;
  if (!r.options.every((o) => typeof o === "string" && o.trim())) return false;
  if (typeof r.correct_index !== "number" || !Number.isInteger(r.correct_index) ||
    r.correct_index < 0 || r.correct_index > 3) return false;
  if (typeof r.explanation !== "string" || !r.explanation.trim()) return false;
  if (r.subject_topic !== undefined && typeof r.subject_topic !== "string") return false;
  if (r.source_page !== undefined && typeof r.source_page !== "string") return false;
  if (r.difficulty !== undefined && !["easy","medium","hard"].includes(r.difficulty)) return false;
  return true;
}

/* Build a strict prompt that asks Groq for JSON-only output. */
function buildGenerationPrompt(pdfTitle: string, text: string, count: number): string {
  const excerpt = text.slice(0, 12000);   // bound the prompt size
  return `You are an expert academic question writer for ClassHub (Ayurveda students).

TASK
Read the source material below (extracted from a PDF titled "${pdfTitle}") and write exactly ${count} single-correct multiple-choice questions grounded ONLY in that material.

OUTPUT FORMAT
Return ONLY a single JSON object with this shape and nothing else:
{
  "questions": [
    {
      "question": "<question text>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "correct_index": <0|1|2|3>,
      "explanation": "<one or two sentences explaining why the correct option is correct, based on the source>",
      "subject_topic": "<topic or subject, or null>",
      "source_page": "<page reference or null>",
      "difficulty": "<easy|medium|hard>"
    }
  ]
}

QUALITY RULES (mandatory)
1. Every question and answer must be answerable from the source material. Do not invent facts.
2. Exactly one correct option. All four options must be present and distinct.
3. No ambiguous or double-negative questions.
4. No duplicate questions.
5. The correct_index must match the explanation and the source material.
6. difficulty is one of: easy, medium, hard.
7. If the source contains too little usable text to write ${count} good questions, write as many as possible (minimum 1) rather than padding.

SOURCE MATERIAL:
---
${excerpt}
---`;
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return parseJsonSafe(text.slice(start, end + 1));
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

async function handleGenerate(supabase: any, user: any, body: any): Promise<Response> {
  const pdfId = body && typeof body.pdf_id === "string" ? body.pdf_id : null;
  if (!pdfId) {
    return json(400, { error: "A PDF is required.", code: "MISSING_PDF" });
  }

  // Verify the student can read this PDF and that it has extractable text.
  const { data: pdf, error: pdfError } = await supabase
    .from("pdfs")
    .select("id, file_name, subject, content_text")
    .eq("id", pdfId)
    .maybeSingle();

  if (pdfError) {
    console.error("mcq: pdf lookup failed", pdfError.message);
    return json(500, { error: "Could not access the selected PDF.", code: "PDF_LOOKUP_FAILED" });
  }
  if (!pdf) {
    return json(404, { error: "PDF not found or you do not have access to it.", code: "PDF_NOT_FOUND" });
  }
  const contentText = (pdf.content_text || "").trim();
  if (!contentText || contentText.length < 200) {
    return json(400, {
      error: "This PDF has no extractable text (it may be a scanned image without OCR). Upload a text-based PDF or re-scan it so ClassHub can read it.",
      code: "NO_EXTRACTABLE_TEXT",
    });
  }

  // Ask the AI to generate questions.
  let groqResponse: Response;
  try {
    groqResponse = await callGroq([
      {
        role: "system",
        content: "You are a careful academic question writer. Return only valid JSON matching the requested schema. Do not include markdown fences or extra prose.",
      },
      { role: "user", content: buildGenerationPrompt(pdf.file_name || "PDF", contentText, 10) },
    ]);
  } catch (error) {
    console.error("mcq: Groq fetch failed", error);
    const timedOut = isTimeoutError(error);
    return json(timedOut ? 504 : 502, {
      error: timedOut ? "The AI took too long to generate questions. Please try again." : "Could not reach the AI service.",
      code: "AI_NETWORK_ERROR",
    });
  }

  if (!groqResponse.ok) {
    const detail = await readErrorBody(groqResponse);
    return groqErrorResponse(groqResponse.status, detail);
  }

  let bodyText = "";
  try { bodyText = await groqResponse.text(); } catch {
    return json(502, { error: "The AI returned an empty response.", code: "AI_EMPTY" });
  }

  const parsed = extractJsonObject(bodyText);
  if (!parsed || typeof parsed !== "object") {
    console.error("mcq: AI did not return JSON", bodyText.slice(0, 500));
    return json(502, { error: "The AI returned an unreadable response. Please try again.", code: "AI_BAD_FORMAT" });
  }

  const rawQuestions = Array.isArray((parsed as any).questions) ? (parsed as any).questions : [];
  const questions: McqQuestion[] = [];
  for (const q of rawQuestions) {
    if (validateQuestionShape(q)) questions.push(q);
    if (questions.length >= 10) break;
  }

  if (questions.length === 0) {
    return json(400, {
      error: "The AI could not generate usable questions from this PDF. The content may be too short or unstructured.",
      code: "NO_QUESTIONS_GENERATED",
    });
  }

  // Persist server-side with the service role (answer keys never touch the client).
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const title = `${pdf.file_name || "PDF"} · MCQ Practice`;
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

  const questionRows = questions.map((q, i) => ({
    session_id: session.id,
    question_text: q.question,
    options: q.options.map((t, idx) => ({ index: idx, text: t })),
    subject_topic: q.subject_topic || null,
    source_page: q.source_page || null,
    difficulty: q.difficulty || "medium",
    order_index: i,
  }));

  const { data: insertedQuestions, error: questionsError } = await admin
    .from("mcq_questions")
    .insert(questionRows)
    .select("id, order_index");

  if (questionsError) {
    console.error("mcq: questions insert failed", questionsError.message);
    return json(500, { error: "Could not save the generated questions.", code: "QUESTIONS_SAVE_FAILED" });
  }

  const insertedByOrder = new Map((insertedQuestions || []).map((iq: any) => [iq.order_index, iq.id]));
  const finalKeyRows = questions.map((q, i) => ({
    question_id: insertedByOrder.get(i),
    correct_option_index: q.correct_index,
    explanation: q.explanation,
  })).filter((r) => r.question_id != null);

  const { error: keysError } = await admin
    .from("mcq_answer_keys")
    .insert(finalKeyRows);

  if (keysError) {
    console.error("mcq: answer keys insert failed", keysError.message);
    return json(500, { error: "Could not save the answer keys.", code: "KEYS_SAVE_FAILED" });
  }

  // Sanitised questions for the client: no correct_index, no explanation.
  const sanitised = (insertedQuestions || []).map((iq: any, i: number) => ({
    id: iq.id,
    order_index: iq.order_index,
    question_text: questions[i]?.question,
    options: questions[i]?.options.map((t, idx) => ({ index: idx, text: t })),
    subject_topic: questions[i]?.subject_topic || null,
    source_page: questions[i]?.source_page || null,
    difficulty: questions[i]?.difficulty || "medium",
  }));

  return json(200, {
    session_id: session.id,
    title,
    total_questions: questions.length,
    questions: sanitised,
  });
}

async function handleValidate(supabase: any, user: any, admin: any, body: any): Promise<Response> {
  const attemptId = body && typeof body.attempt_id === "string" ? body.attempt_id : null;
  const responses = Array.isArray(body?.responses) ? body.responses : [];
  const finalize = body && body.finalize === true;
  if (!attemptId || !responses.length) {
    return json(400, { error: "Attempt and responses are required.", code: "MISSING_INPUT" });
  }

  // Verify the attempt belongs to this student and is not already completed.
  const { data: attempt, error: attemptError } = await supabase
    .from("mcq_attempts")
    .select("id, session_id, score, total, started_at, completed_at")
    .eq("id", attemptId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (attemptError) {
    return json(500, { error: "Could not load the attempt.", code: "ATTEMPT_LOOKUP_FAILED" });
  }
  if (!attempt) {
    return json(404, { error: "Attempt not found.", code: "ATTEMPT_NOT_FOUND" });
  }
  if (attempt.completed_at) {
    return json(400, { error: "This attempt has already been submitted.", code: "ALREADY_COMPLETED" });
  }

  // Fetch the answer keys server-side (service role bypasses RLS; client can never read them).
  const questionIds = [...new Set(responses.map((r: any) => r.question_id).filter(Boolean))];
  const { data: keys, error: keysError } = await admin
    .from("mcq_answer_keys")
    .select("question_id, correct_option_index, explanation")
    .in("question_id", questionIds);

  if (keysError) {
    console.error("mcq: answer key lookup failed", keysError.message);
    return json(500, { error: "Could not validate answers.", code: "VALIDATION_FAILED" });
  }
  const keyMap = new Map((keys || []).map((k: any) => [k.question_id, k]));

  const results: Array<{
    question_id: string;
    selected_option_index: number;
    is_correct: boolean;
    correct_option_index?: number;   // only when wrong
    explanation: string;
  }> = [];

  for (const r of responses) {
    const key = keyMap.get(r.question_id);
    const selected = typeof r.selected_option_index === "number" ? r.selected_option_index : -1;
    const isCorrect = key ? key.correct_option_index === selected : false;
    results.push({
      question_id: r.question_id,
      selected_option_index: selected,
      is_correct: isCorrect,
      ...(isCorrect ? {} : { correct_option_index: key ? key.correct_option_index : -1 }),
      explanation: key ? key.explanation : "No explanation available.",
    });
  }

  // Persist responses server-side (upsert: re-checking the same question is idempotent).
  const responseRows = results.map((r) => ({
    attempt_id: attemptId,
    question_id: r.question_id,
    selected_option_index: r.selected_option_index,
    is_correct: r.is_correct,
  }));

  const { error: responsesError } = await admin
    .from("mcq_responses")
    .upsert(responseRows, { onConflict: "attempt_id, question_id" });

  if (responsesError) {
    console.error("mcq: responses upsert failed", responsesError.message);
    return json(500, { error: "Could not save your answers.", code: "RESPONSES_SAVE_FAILED" });
  }

  // Mid-quiz check: return feedback only, do not complete the attempt.
  if (!finalize) {
    return json(200, {
      attempt_id: attemptId,
      results,
    });
  }

  // Final submission: compute score from answer keys, mark attempt complete.
  let score = 0;
  for (const r of results) {
    if (r.is_correct) score += 1;
  }
  const total = results.length;
  const startedAt = attempt.started_at ? new Date(attempt.started_at).getTime() : Date.now();
  const timeTaken = Math.max(0, Math.round((Date.now() - startedAt) / 1000));

  const { error: attemptError2 } = await admin
    .from("mcq_attempts")
    .update({ score, total, completed_at: new Date().toISOString(), time_taken_seconds: timeTaken })
    .eq("id", attemptId);

  if (attemptError2) {
    console.error("mcq: attempt update failed", attemptError2.message);
    return json(500, { error: "Could not finalise the attempt.", code: "ATTEMPT_FINALISE_FAILED" });
  }

  const accuracy = total ? Math.round((score / total) * 100) : 0;
  return json(200, {
    attempt_id: attemptId,
    score,
    total,
    correct: score,
    incorrect: total - score,
    accuracy,
    time_taken_seconds: timeTaken,
    results,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }
  if (!GROQ_API_KEY) {
    return json(503, { error: "The MCQ service is not configured yet." });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "The MCQ service is not configured yet." });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "Please sign in to use MCQ practice." });
  }

  const supabase = createClient(SUPABASE_URL, request.headers.get("apikey") || SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user;
  if (authError || !user) {
    return json(401, { error: "Please sign in again." });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const action = body && typeof body.action === "string" ? body.action : null;
  if (action === "generate") {
    return handleGenerate(supabase, user, body);
  }
  if (action === "validate") {
    return handleValidate(supabase, user, admin, body);
  }
  return json(400, { error: "Unknown action.", code: "UNKNOWN_ACTION" });
});
