#!/usr/bin/env node
/**
 * ClassHub Supabase deployment (works on Android/Termux).
 *
 * The official Supabase CLI is a glibc binary and cannot run here, so this
 * script uses the Supabase Management API directly:
 *
 *   1. verify the personal access token
 *   2. apply supabase/migrations/*.sql
 *   3. push VAPID secrets
 *   4. deploy the send-push Edge Function
 *   5. create the notices -> send-push webhook trigger (pg_net + Vault)
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/deploy-supabase.mjs
 *   # or save the token to ~/.supabase_access_token first
 *
 * Options:
 *   --skip-sql       skip migrations
 *   --skip-secrets   skip VAPID secrets
 *   --skip-function  skip Edge Function deploy
 *   --skip-webhook   skip the notices trigger
 *   --dry-run        print what would happen, change nothing
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REF = "oekunhqzhwwjfrcaiuit";
const API = "https://api.supabase.com/v1";
const PROJECT_URL = `https://${REF}.supabase.co`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const MIGRATIONS = [
  "supabase/migrations/20261124000000_add_push_subscriptions.sql",
];

function log(step, message) {
  console.log(`\n[${step}] ${message}`);
}

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const file = join(homedir(), ".supabase_access_token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  return "";
}

function readVapidKeys() {
  const privateFile = join(homedir(), ".classhub_vapid_private");
  if (!existsSync(privateFile)) {
    throw new Error(
      `Missing ${privateFile}. Generate VAPID keys first (see PUSH_SETUP.md).`
    );
  }
  const privateKey = readFileSync(privateFile, "utf8").trim();
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const match = html.match(/const VAPID_PUBLIC_KEY\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("Could not find VAPID_PUBLIC_KEY in index.html.");
  return { privateKey, publicKey: match[1] };
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
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

async function stepVerify() {
  log("1/5", "Verifying access token");
  const projects = await api("/projects");
  const project = (projects || []).find((p) => p.ref === REF || p.id === REF);
  if (!project) {
    throw new Error(`Token works, but project ${REF} was not found. Check the project ref.`);
  }
  console.log(`   OK: ${project.name} (${project.ref}, ${project.status})`);
}

async function stepSql() {
  log("2/5", "Applying migrations");
  for (const relative of MIGRATIONS) {
    const file = join(ROOT, relative);
    const sql = readFileSync(file, "utf8");
    if (dryRun) {
      console.log(`   would apply ${relative} (${sql.length} bytes)`);
      continue;
    }
    await api(`/projects/${REF}/database/query`, {
      method: "POST",
      body: { query: sql },
    });
    console.log(`   applied ${relative}`);
  }
}

async function stepSecrets() {
  log("3/5", "Setting VAPID secrets");
  const { privateKey, publicKey } = readVapidKeys();
  const desired = [
    { name: "VAPID_PRIVATE_KEY", value: privateKey },
    { name: "VAPID_PUBLIC_KEY", value: publicKey },
    { name: "VAPID_EMAIL", value: "https://sudarshansiddarama-cell.github.io/ClassHub/" },
  ];
  if (dryRun) {
    for (const secret of desired) console.log(`   would set ${secret.name}`);
    return;
  }
  const existing = await api(`/projects/${REF}/secrets`);
  const existingNames = new Set((existing || []).map((s) => s.name));
  const create = desired.filter((s) => !existingNames.has(s.name));
  const update = desired.filter((s) => existingNames.has(s.name));
  if (create.length) {
    await api(`/projects/${REF}/secrets`, { method: "POST", body: create });
  }
  for (const secret of update) {
    await api(`/projects/${REF}/secrets`, {
      method: "PATCH",
      body: [{ name: secret.name, value: secret.value }],
    });
  }
  console.log(`   set ${desired.map((s) => s.name).join(", ")}`);
}

async function stepFunction() {
  log("4/5", "Deploying send-push Edge Function");
  const dir = join(ROOT, "supabase/functions/send-push");
  const source = readFileSync(join(dir, "index.ts"));
  if (dryRun) {
    console.log(`   would deploy ${source.length} bytes as send-push`);
    return;
  }
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      name: "send-push",
      entrypoint_path: "index.ts",
      verify_jwt: false,
    })
  );
  form.append("file", new Blob([source], { type: "text/typescript" }), "index.ts");
  const result = await api(`/projects/${REF}/functions/deploy?slug=send-push`, {
    method: "POST",
    body: form,
  });
  console.log(`   deployed send-push v${result?.version ?? "?"} (${result?.status ?? "ok"})`);
}

async function stepWebhook() {
  log("5/5", "Creating notices -> push webhook");
  const keys = await api(`/projects/${REF}/api-keys?reveal=true`);
  const serviceRole = (keys || []).find((k) => k.name === "service_role")?.api_key;
  if (!serviceRole) throw new Error("Could not read the service_role API key.");

  // Store the key in Vault instead of hard-coding it in the trigger.
  const sql = `
create extension if not exists pg_net;

do $$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.secrets where name = 'classhub_service_role' limit 1;
  if existing_id is null then
    perform vault.create_secret($key$${serviceRole}$key$, 'classhub_service_role', 'ClassHub send-push auth');
  else
    perform vault.update_secret(existing_id, $key$${serviceRole}$key$, 'classhub_service_role', 'ClassHub send-push auth');
  end if;
end $$;

create or replace function public.classhub_push_on_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'classhub_service_role'
  limit 1;
  if service_key is null then
    return new;
  end if;
  perform net.http_post(
    url := '${PROJECT_URL}/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'title', new.title,
      'body', left(coalesce(new.content, ''), 400),
      'tag', 'classhub-notice',
      'url', '/'
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists classhub_push_on_notice on public.notices;
create trigger classhub_push_on_notice
after insert on public.notices
for each row execute function public.classhub_push_on_notice();
`;

  if (dryRun) {
    console.log("   would enable pg_net, store the service key in Vault, and create the notices trigger");
    return;
  }
  try {
    await api(`/projects/${REF}/database/query`, {
      method: "POST",
      body: { query: sql },
    });
    console.log("   notices INSERT will now send push notifications");
  } catch (error) {
    console.warn(`   WARNING: webhook not created: ${error.message}`);
    console.warn("   Push still works if you call send-push manually.");
  }
}

const token = readToken();
if (!token) {
  console.error("No Supabase access token found.");
  console.error("Create one at https://supabase.com/dashboard/account/tokens and run:");
  console.error("  echo 'sbp_...' > ~/.supabase_access_token && chmod 600 ~/.supabase_access_token");
  process.exit(1);
}

try {
  await stepVerify();
  if (!args.has("--skip-sql")) await stepSql();
  if (!args.has("--skip-secrets")) await stepSecrets();
  if (!args.has("--skip-function")) await stepFunction();
  if (!args.has("--skip-webhook")) await stepWebhook();
  console.log(`\nDone${dryRun ? " (dry run)" : ""}.`);
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
}
