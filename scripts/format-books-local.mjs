#!/usr/bin/env node
/**
 * Local ClassHub book formatter (fallback while Edge Function deploys hang).
 *
 * Calls Groq directly with the same cleanup prompt and validation rules as
 * supabase/functions/format-pdf, then saves each page through the
 * classhub_set_formatted_page RPC with the service-role key.
 *
 * Usage:
 *   node scripts/format-books-local.mjs
 *   node scripts/format-books-local.mjs --id 17 --page 1
 *   node scripts/format-books-local.mjs --id 17 --limit 5
 *   node scripts/format-books-local.mjs --concurrency 2
 *   node scripts/format-books-local.mjs --force        reformat cached pages
 *   node scripts/format-books-local.mjs --dry-run
 *
 * Secrets:
 *   GROQ_API_KEY (env, or read from the Supabase project secrets)
 *   SUPABASE_ACCESS_TOKEN (env, or ~/.supabase_access_token)
 *
 * Nothing is written to disk except this script: the keys stay in memory.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const REF = "oekunhqzhwwjfrcaiuit";
const API = "https://api.supabase.com/v1";
const PROJECT_URL = `https://${REF}.supabase.co`;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MAX_PAGE_CHARS = 14_000;
const MIN_PAGE_CHARS = 20;
const AI_TIMEOUT_MS = 90_000;
const PROVIDER = process.env.FORMAT_PROVIDER
  || (process.env.GROQ_API_KEY ? "groq" : "gemini");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
const onlyId = argValue("--id") ? Number(argValue("--id")) : null;
const onlyPage = argValue("--page") ? Number(argValue("--page")) : null;
const perBookLimit = argValue("--limit") ? Number(argValue("--limit")) : 0;
const concurrency = Math.max(1, Number(argValue("--concurrency")) || 2);

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const file = `${homedir()}/.supabase_access_token`;
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  return "";
}
const token = readToken();
if (!token) {
  console.error("No Supabase access token found. Save one to ~/.supabase_access_token.");
  process.exit(1);
}

async function api(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${data?.message || text}`);
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- Groq ---------- */

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

function splitForAi(text) {
  if (text.length <= MAX_PAGE_CHARS) return [text];
  const parts = [];
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

async function callGroq(raw, apiKey) {
  const request = {
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
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Groq ${response.status}: ${detail.slice(0, 300)}`);
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

async function callGroqWithRetry(raw, apiKey) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await callGroq(raw, apiKey);
    } catch (error) {
      lastError = error;
      const retryable = error.status === 429 || error.status === 408 || (error.status >= 500 && error.status < 600);
      if (retryable && attempt < 4) {
        const fromHeader = Number(error.retryAfter);
        const wait = Number.isFinite(fromHeader) && fromHeader > 0
          ? Math.min(60, fromHeader) * 1000
          : 5000 * (attempt + 1);
        console.warn(`   Groq ${error.status}, retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Groq failed.");
}

function geminiContent(raw) {
  return {
    contents: [{ parts: [{ text: `You are a precise OCR cleanup and formatting engine for one page of a ClassHub textbook.\n` +
      `Rules:\n- Fix only obvious OCR mistakes, broken words, hyphenation at line breaks, stray characters, and spacing.\n` +
      `- Preserve every fact, number, Sanskrit term, list item, and sentence. Never summarise, shorten, add, or remove content.\n` +
      `- Do not invent missing text. If a word or number is unreadable, keep it as it is.\n` +
      `- Keep Devanagari text exactly as written; do not transliterate or translate it.\n` +
      `- Remove repeated page headers, footers, and standalone page numbers only when they are clearly not part of the content.\n` +
      `- Format the result as clean Markdown: use #, ##, or ### for headings; separate paragraphs with a blank line; use "- " for bullet lists and "1. " for numbered lists.\n` +
      `- Do not use bold or italic markers, tables, links, or code fences.\n` +
      `- Return only the cleaned page text. Do not add commentary, notes, or explanations.\n\n` +
      `Clean and format this page text:\n\n${raw}` }] }],
    generationConfig: { temperature: 0, maxOutputTokens: Math.min(8192, Math.max(1024, Math.ceil(raw.length / 2))) },
  };
}

async function callGemini(raw, apiKey) {
  const modelId = GEMINI_MODEL.replace(/^models\//, "");
  const response = await fetch(`${GEMINI_URL}/${modelId}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(geminiContent(raw)),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`);
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return String(text).trim();
}

async function callAIWithRetry(raw, provider, groqKey, geminiKey) {
  let lastError = null;
  const apiKey = provider === "groq" ? groqKey : geminiKey;
  if (!apiKey) throw new Error(`No API key for provider "${provider}".`);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (provider === "groq") return await callGroq(raw, apiKey);
      return await callGemini(raw, apiKey);
    } catch (error) {
      lastError = error;
      const retryable = error.status === 429 || error.status === 408 || (error.status >= 500 && error.status < 600);
      if (retryable && attempt < 4) {
        const fromHeader = Number(error.retryAfter);
        const wait = Number.isFinite(fromHeader) && fromHeader > 0
          ? Math.min(120, fromHeader) * 1000
          : 5000 * (attempt + 1);
        console.warn(`   ${provider} ${error.status}, retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI provider failed.");
}

function cleanOutput(text) {
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

function wordSet(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9\u0900-\u097F]{3,}/g) || []);
}

function acceptable(raw, output) {
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

function devanagariRatio(text) {
  let dev = 0, total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    total++;
    if (/[\u0900-\u097F]/.test(ch)) dev++;
  }
  return total > 40 ? dev / total : 0;
}

async function formatPageText(raw, provider, groqKey, geminiKey) {
  const parts = [];
  for (const piece of splitForAi(raw)) {
    let output = cleanOutput(await callAIWithRetry(piece, provider, groqKey, geminiKey));
    if (!acceptable(piece, output)) {
      output = cleanOutput(await callAIWithRetry(piece, provider, groqKey, geminiKey));
    }
    if (!acceptable(piece, output)) return null;
    parts.push(output);
  }
  return parts.join("\n\n").trim();
}

/* ---------- PDF pages ---------- */

function extractPage(contentText, page) {
  const marker = `[[PAGE ${page}]]`;
  const start = contentText.indexOf(marker);
  if (start === -1) return "";
  const bodyStart = start + marker.length;
  const next = contentText.indexOf("[[PAGE ", bodyStart);
  return contentText.slice(bodyStart, next === -1 ? contentText.length : next).trim();
}

function pageCount(text) {
  const matches = String(text || "").match(/\[\[PAGE (\d+)\]\]/g) || [];
  let max = 0;
  for (const marker of matches) {
    const n = parseInt(marker.replace(/[^0-9]/g, ""), 10);
    if (n > max) max = n;
  }
  return max;
}

async function savePage(serviceRole, pdfId, page, text) {
  const res = await fetch(`${PROJECT_URL}/rest/v1/rpc/classhub_set_formatted_page`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRole}`,
      apikey: serviceRole,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_pdf_id: pdfId, p_page: page, p_text: text }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`save pdf ${pdfId} page ${page} -> ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/* ---------- main ---------- */

const keys = await api(`/projects/${REF}/api-keys?reveal=true`);
const serviceRole = (keys || []).find((k) => k.name === "service_role")?.api_key || "";
if (!serviceRole) {
  console.error("Could not read the service_role API key.");
  process.exit(1);
}

let groqKey = process.env.GROQ_API_KEY || "";
let geminiKey = process.env.GEMINI_API_KEY || "";
if (groqKey || geminiKey) {
  // keys already present from env; nothing to fetch
} else {
  const secrets = await api(`/projects/${REF}/secrets`);
  groqKey = groqKey || ((secrets || []).find((s) => s.name === "GROQ_API_KEY")?.value || "");
  geminiKey = geminiKey || ((secrets || []).find((s) => s.name === "GEMINI_API_KEY")?.value || "");
}
if (!groqKey && !geminiKey) {
  console.error("Neither GROQ_API_KEY nor GEMINI_API_KEY is set in the environment or project secrets.");
  process.exit(1);
}
if (PROVIDER === "groq" && !groqKey) {
  console.error("PROVIDER=groq but GROQ_API_KEY is missing. Use FORMAT_PROVIDER=gemini or set GROQ_API_KEY.");
  process.exit(1);
}
if (PROVIDER === "gemini" && !geminiKey) {
  console.error("PROVIDER=gemini but GEMINI_API_KEY is missing. Use FORMAT_PROVIDER=groq or set GEMINI_API_KEY.");
  process.exit(1);
}

const where = onlyId ? `&id=eq.${onlyId}` : "";
const rowsRes = await fetch(
  `${PROJECT_URL}/rest/v1/pdfs?select=id,file_name,content_text,formatted_pages&content_text=not.is.null${where}&order=id.asc`,
  { headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole } },
);
if (!rowsRes.ok) {
  console.error(`Could not read books: HTTP ${rowsRes.status} ${await rowsRes.text()}`);
  process.exit(1);
}
const rows = await rowsRes.json();

const queue = [];
let already = 0, noText = 0, devanagari = 0;
for (const row of rows || []) {
  const total = pageCount(row.content_text);
  if (!total) continue;
  const cached = row.formatted_pages && typeof row.formatted_pages === "object" ? row.formatted_pages : {};
  let added = 0;
  const pages = onlyPage ? [onlyPage] : Array.from({ length: total }, (_, i) => i + 1);
  for (const page of pages) {
    if (page < 1 || page > total) continue;
    if (!force && cached[String(page)]) { already++; continue; }
    const raw = extractPage(row.content_text, page);
    if (raw.length < MIN_PAGE_CHARS) { noText++; continue; }
    if (devanagariRatio(raw) >= 0.3) { devanagari++; continue; }
    if (perBookLimit && added >= perBookLimit) break;
    queue.push({ pdfId: row.id, fileName: row.file_name, page, raw });
    added++;
  }
  console.log(`${row.id} ${row.file_name}: ${total} pages, ${added} to format`);
}

console.log(`\n${queue.length} page(s) to format, ${already} already cached, ${noText} blank, ${devanagari} Sanskrit-only (kept raw), ${concurrency} at a time.`);
if (dryRun || !queue.length) process.exit(0);

const started = Date.now();
let done = 0, saved = 0, rejected = 0, failed = 0;

async function worker() {
  while (queue.length) {
    const job = queue.shift();
    try {
      const text = await formatPageText(job.raw, PROVIDER, groqKey, geminiKey);
      done++;
      if (!text) {
        rejected++;
        console.warn(`rejected pdf ${job.pdfId} page ${job.page} (AI output failed validation; kept raw)`);
        continue;
      }
      await savePage(serviceRole, job.pdfId, job.page, text);
      saved++;
      if (done % 5 === 0 || queue.length === 0) {
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`progress: ${done} done, ${saved} saved, ${rejected} rejected, ${failed} failed, ${queue.length} left (${mins} min)`);
      }
    } catch (error) {
      done++;
      failed++;
      console.error(`failed pdf ${job.pdfId} page ${job.page}: ${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
const mins = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\nFinished in ${mins} min: ${saved} saved, ${rejected} rejected, ${failed} failed.`);
