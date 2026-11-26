#!/usr/bin/env node
/**
 * Backfill AI-formatted book pages.
 *
 * Calls the format-pdf Edge Function for every page of every PDF that has
 * extracted text. The function caches each page in public.pdfs.formatted_pages,
 * so running this again only formats pages that are still missing.
 *
 * Usage:
 *   node scripts/backfill-formatted-pages.mjs
 *   node scripts/backfill-formatted-pages.mjs --id 12 --limit 5
 *   node scripts/backfill-formatted-pages.mjs --concurrency 3
 *   node scripts/backfill-formatted-pages.mjs --dry-run
 *
 * Options:
 *   --id <number>         only this PDF
 *   --limit <number>      at most this many pages per PDF
 *   --concurrency <n>     parallel requests (default 2)
 *   --dry-run             print the plan, call nothing
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const REF = "oekunhqzhwwjfrcaiuit";
const API = "https://api.supabase.com/v1";
const PROJECT_URL = `https://${REF}.supabase.co`;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
const onlyId = argValue("--id") ? Number(argValue("--id")) : null;
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

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = data?.message || data?.error || text || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status}: ${message}`);
  }
  return data;
}

async function sql(query) {
  return api(`/projects/${REF}/database/query`, { method: "POST", body: { query } });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let serviceRole = "";
async function formatPage(pdfId, page) {
  const res = await fetch(`${PROJECT_URL}/functions/v1/format-pdf`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pdfId, page }),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) {
    const error = new Error(data.error || text.slice(0, 200) || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function formatPageWithRetry(pdfId, page) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await formatPage(pdfId, page);
    } catch (error) {
      lastError = error;
      if ((error.status === 429 || error.status >= 500) && attempt < 3) {
        await sleep(2500 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

const keys = await api(`/projects/${REF}/api-keys?reveal=true`);
serviceRole = (keys || []).find((k) => k.name === "service_role")?.api_key || "";
if (!serviceRole) {
  console.error("Could not read the service_role API key.");
  process.exit(1);
}

const where = onlyId ? `and id = ${onlyId}` : "";
const rows = await sql(`
  select id, file_name, content_text, formatted_pages
  from public.pdfs
  where content_text is not null ${where}
  order by id;
`);

const queue = [];
let already = 0;
for (const row of rows || []) {
  const total = pageCount(row.content_text);
  if (!total) continue;
  const cached = row.formatted_pages && typeof row.formatted_pages === "object"
    ? row.formatted_pages
    : {};
  let added = 0;
  for (let page = 1; page <= total; page++) {
    if (cached[String(page)]) { already++; continue; }
    if (perBookLimit && added >= perBookLimit) break;
    queue.push({ pdfId: row.id, page });
    added++;
  }
  console.log(`${row.id} ${row.file_name}: ${total} pages, ${added} to format`);
}

console.log(`\n${queue.length} page(s) to format, ${already} already cached, ${concurrency} at a time.`);
if (dryRun || !queue.length) process.exit(0);

let done = 0, formatted = 0, skipped = 0, failed = 0;
async function worker() {
  while (queue.length) {
    const job = queue.shift();
    try {
      const data = await formatPageWithRetry(job.pdfId, job.page);
      done++;
      if (data.skipped || data.cached) skipped++;
      else if (data.text) formatted++;
      if (done % 10 === 0 || queue.length === 0) {
        console.log(`progress: ${done} done, ${formatted} formatted, ${skipped} cached/skipped, ${failed} failed, ${queue.length} left`);
      }
    } catch (error) {
      done++;
      failed++;
      console.error(`failed pdf ${job.pdfId} page ${job.page}: ${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
console.log(`\nFinished: ${formatted} formatted, ${skipped} cached/skipped, ${failed} failed.`);
