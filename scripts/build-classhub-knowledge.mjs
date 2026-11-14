#!/usr/bin/env node
/**
 * Build the ClassHub AI knowledge bundle from knowledge/classhub/*.md.
 *
 * Usage:
 *   node scripts/build-classhub-knowledge.mjs
 *   node scripts/build-classhub-knowledge.mjs --check
 *
 * The generated file is imported by the ai-chat Edge Function. Keep this
 * script dependency-free so it works in Termux with a stock Node install.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "knowledge", "classhub");
const OUTPUT_FILE = join(
  ROOT,
  "supabase",
  "functions",
  "_shared",
  "classhub-knowledge.generated.ts",
);

const VALID_STATUSES = new Set([
  "verified",
  "partial",
  "schema-only",
  "planned",
  "unknown",
]);

const META_RE = /^<!--\s*(keywords|status):\s*(.*?)\s*-->\s*$/i;
const HEADING_RE = /^##\s+(.+?)\s*$/;

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function splitKeywords(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseFrontMatter(source, file) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error(`${file}: missing front matter (expected --- on the first line)`);
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new Error(`${file}: front matter is not closed with ---`);
  }

  const meta = {};
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      throw new Error(`${file}: invalid front matter line: ${trimmed}`);
    }
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    meta[key] = value;
  }
  for (const key of ["id", "title", "status"]) {
    if (!meta[key]) throw new Error(`${file}: front matter is missing "${key}"`);
  }
  if (!VALID_STATUSES.has(meta.status)) {
    throw new Error(
      `${file}: invalid status "${meta.status}" (expected one of ${[...VALID_STATUSES].join(", ")})`,
    );
  }
  return {
    meta: {
      ...meta,
      keywords: splitKeywords(meta.keywords),
    },
    body: lines.slice(end + 1).join("\n"),
  };
}

function parseSections(body, file, fallbackStatus) {
  const sections = [];
  let current = null;
  const intro = [];

  const finish = () => {
    if (!current) return;
    const lines = current.lines;
    let status = fallbackStatus;
    const keywords = [];
    const textLines = [];

    for (const line of lines) {
      const match = line.match(META_RE);
      if (match) {
        const key = match[1].toLowerCase();
        const value = match[2];
        if (key === "status") {
          const next = value.trim().toLowerCase();
          if (!VALID_STATUSES.has(next)) {
            throw new Error(`${file}: invalid section status "${value}" in "${current.heading}"`);
          }
          status = next;
        } else {
          keywords.push(...splitKeywords(value));
        }
        continue;
      }
      textLines.push(line);
    }

    const text = textLines.join("\n").trim();
    if (!text && !current.heading) return;
    sections.push({
      heading: current.heading,
      status,
      keywords,
      text: current.heading ? `${current.heading}\n\n${text}`.trim() : text,
    });
  };

  for (const line of body.split("\n")) {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      finish();
      current = { heading: headingMatch[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else intro.push(line);
  }
  finish();

  const introText = intro.join("\n").trim();
  if (introText) {
    sections.unshift({
      heading: "",
      status: fallbackStatus,
      keywords: [],
      text: introText,
    });
  }

  if (!sections.length) {
    throw new Error(`${file}: no content found`);
  }
  return sections;
}

export async function buildKnowledge() {
  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();

  if (!files.length) throw new Error(`No knowledge documents found in ${SOURCE_DIR}`);

  const chunks = [];
  const usedIds = new Set();

  for (const file of files) {
    const source = await readFile(join(SOURCE_DIR, file), "utf8");
    const { meta, body } = parseFrontMatter(source, file);
    const sections = parseSections(body, file, meta.status);

    sections.forEach((section, index) => {
      const slug = slugify(section.heading || meta.id || `section-${index + 1}`);
      let id = `${meta.id}#${slug || "intro"}`;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${meta.id}#${slug || "intro"}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);

      // File-level keywords are intentionally not copied into every chunk:
      // a long document would otherwise make all its sections match broad
      // terms. Section-level metadata is the precise signal.
      const keywords = [...new Set(section.keywords)];
      chunks.push({
        id,
        docId: meta.id,
        docTitle: meta.title,
        title: section.heading || meta.title,
        status: section.status,
        keywords,
        text: section.text,
        source: relative(ROOT, join(SOURCE_DIR, file)).replace(/\\/g, "/"),
      });
    });
  }

  if (!chunks.length) throw new Error("Knowledge build produced no chunks");

  const version = createHash("sha256")
    .update(JSON.stringify(chunks))
    .digest("hex")
    .slice(0, 12);

  return { chunks, version, files };
}

function renderModule({ chunks, version, files }) {
  const header = `// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Source: knowledge/classhub/*.md
// Regenerate: node scripts/build-classhub-knowledge.mjs
// Check freshness: node scripts/build-classhub-knowledge.mjs --check
// Files: ${files.join(", ")}

export interface KnowledgeChunk {
  id: string;
  docId: string;
  docTitle: string;
  title: string;
  status: "verified" | "partial" | "schema-only" | "planned" | "unknown";
  keywords: string[];
  text: string;
  source: string;
}

export const KNOWLEDGE_VERSION = ${JSON.stringify(version)};
export const KNOWLEDGE_CHUNK_COUNT = ${chunks.length};

export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = ${JSON.stringify(chunks, null, 2)};
`;

  return header;
}

async function main() {
  const check = process.argv.includes("--check");
  const result = await buildKnowledge();
  const output = renderModule(result);

  if (check) {
    let current = "";
    try {
      current = await readFile(OUTPUT_FILE, "utf8");
    } catch {
      current = "";
    }
    if (current !== output) {
      console.error(
        "Knowledge bundle is stale. Run: node scripts/build-classhub-knowledge.mjs",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Knowledge bundle is fresh (${result.chunks.length} chunks, version ${result.version}).`,
    );
    return;
  }

  await writeFile(OUTPUT_FILE, output, "utf8");
  console.log(
    `Wrote ${relative(ROOT, OUTPUT_FILE)} (${result.chunks.length} chunks, version ${result.version}).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
