/**
 * ClassHub format-pdf Edge Function.
 *
 * Cleans one PDF page at a time with Groq and caches the result in
 * public.pdfs.formatted_pages. The reader uses the cache, so pressing Read
 * never waits for AI. Formatting runs once per page (on upload, on first
 * read, or from the backfill script).
 *
 * Request:  POST { pdfId: number, page: number }
 * Auth:     a signed-in user's Supabase access token, or the service-role key.
 * Secrets:  GROQ_API_KEY (required), GROQ_MODEL (optional)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY")
  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
const GROQ_TIMEOUT_MS = 60_000;
const MAX_PAGE_CHARS = 14_000;
const MIN_PAGE_CHARS = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

async function verifyCaller(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) return true;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data?.user;
}

function extractPage(contentText: string, page: number): string {
  const marker = `[[PAGE ${page}]]`;
  const start = contentText.indexOf(marker);
  if (start === -1) return "";
  const bodyStart = start + marker.length;
  const next = contentText.indexOf("[[PAGE ", bodyStart);
  return contentText.slice(bodyStart, next === -1 ? contentText.length : next).trim();
}

function splitForAi(text: string): string[] {
  if (text.length <= MAX_PAGE_CHARS) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_PAGE_CHARS) {
    let cut = rest.lastIndexOf("\n", MAX_PAGE_CHARS);
    if (cut < MAX_PAGE_CHARS * 0.5) cut = rest.lastIndexOf(". ", MAX_PAGE_CHARS);
    if (cut < MAX_PAGE_CHARS * 0.5) cut = MAX_PAGE_CHARS;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}

const SYSTEM_PROMPT = `You are a precise OCR cleanup and formatting engine for one page of a ClassHub textbook.
Rules:
- Fix only obvious OCR mistakes, broken words, hyphenation at line breaks, stray characters, and spacing.
- Preserve every fact, number, Sanskrit term, list item, and sentence. Never summarise, shorten, add, or remove content.
- Do not invent missing text. If a word or number is unreadable, keep it as it is.
- Keep Devanagari text exactly as written; do not transliterate or translate it.
- Remove repeated page headers, footers, and standalone page numbers only when they are clearly not part of the content.
- Format the result as clean Markdown: use #, ##, or ### for headings; separate paragraphs with a blank line; use "- " for bullet lists and "1. " for numbered lists.
- Do not use bold or italic markers, tables, links, or code fences.
- Return only the cleaned page text. Do not add commentary, notes, or explanations.`;

async function callGroq(raw: string): Promise<string> {
  const request: Record<string, unknown> = {
    model: GROQ_MODEL,
    temperature: 0,
    max_completion_tokens: Math.min(8192, Math.max(1024, Math.ceil(raw.length / 2))),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Clean and format this page text:\n\n${raw}` },
    ],
  };
  if (GROQ_MODEL.startsWith("openai/gpt-oss-")) {
    request.reasoning_effort = "low";
    request.include_reasoning = false;
  }
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Groq ${response.status}: ${detail.slice(0, 300)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

async function callGroqWithRetry(raw: string): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callGroq(raw);
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      if (status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Groq failed.");
}

function cleanOutput(text: string): string {
  return text
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/^\s*(here is|here's)[^\n]*\n/i, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](\s|$)/g, "$1$2$3")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9\u0900-\u097F]{3,}/g) || []);
}

function acceptable(raw: string, output: string): boolean {
  if (!output) return false;
  if (output.length < Math.min(MIN_PAGE_CHARS, raw.length * 0.4)) return false;
  if (output.includes("[[PAGE")) return false;
  const ratio = output.length / Math.max(1, raw.length);
  if (ratio < 0.6 || ratio > 1.5) return false;
  const rawWords = wordSet(raw);
  if (rawWords.size >= 20) {
    const outWords = wordSet(output);
    let found = 0;
    for (const word of rawWords) if (outWords.has(word)) found++;
    if (found / rawWords.size < 0.45) return false;
  }
  return true;
}

async function formatPageText(raw: string): Promise<string> {
  const parts: string[] = [];
  for (const piece of splitForAi(raw)) {
    let output = cleanOutput(await callGroqWithRetry(piece));
    if (!acceptable(piece, output)) {
      output = cleanOutput(await callGroqWithRetry(piece));
    }
    parts.push(acceptable(piece, output) ? output : piece.trim());
  }
  return parts.join("\n\n").trim();
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return json(204, {});
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  if (!(await verifyCaller(req))) {
    return json(401, { error: "Please sign in again." });
  }
  if (!GROQ_API_KEY) {
    return json(500, { error: "AI formatting is not configured." });
  }

  let body: { pdfId?: unknown; page?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const pdfId = Number(body.pdfId);
  const page = Number(body.page);
  if (!Number.isInteger(pdfId) || pdfId <= 0) {
    return json(400, { error: "A valid PDF is required." });
  }
  if (!Number.isInteger(page) || page <= 0) {
    return json(400, { error: "A valid page is required." });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: pdf, error } = await supabase
    .from("pdfs")
    .select("id,content_text,formatted_pages")
    .eq("id", pdfId)
    .maybeSingle();
  if (error) {
    console.error("format-pdf: read failed", error.message);
    return json(500, { error: "Could not read this book." });
  }
  if (!pdf) return json(404, { error: "Book not found." });

  const cached = pdf.formatted_pages?.[String(page)];
  if (typeof cached === "string" && cached.trim()) {
    return json(200, { page, text: cached, cached: true });
  }

  const raw = extractPage(String(pdf.content_text || ""), page);
  if (raw.length < MIN_PAGE_CHARS) {
    return json(200, { page, text: "", cached: false, skipped: true });
  }

  const started = Date.now();
  let text: string;
  try {
    text = await formatPageText(raw);
  } catch (error) {
    console.error("format-pdf: AI failed", page, error);
    return json(502, { error: "The AI could not format this page. Please try again." });
  }
  if (!text) {
    return json(200, { page, text: "", cached: false, skipped: true });
  }

  const { error: saveError } = await supabase.rpc("classhub_set_formatted_page", {
    p_pdf_id: pdfId,
    p_page: page,
    p_text: text,
  });
  if (saveError) {
    console.error("format-pdf: save failed", saveError.message);
    return json(500, { error: "Could not save the formatted page." });
  }

  return json(200, {
    page,
    text,
    cached: false,
    ms: Date.now() - started,
  });
}
