/**
 * ClassHub send-push Edge Function.
 *
 * Sends a Web Push notification to all (or a targeted) push subscriptions.
 * Intended to be called by the ClassHub backend (e.g. a notices insert
 * trigger or an admin action), NOT directly from the browser.
 *
 * Required secrets:
 *   VAPID_PRIVATE_KEY   -- base64url EC private key matching VAPID_PUBLIC_KEY
 *   VAPID_PUBLIC_KEY    -- base64url EC public key (must match index.html)
 *   VAPID_EMAIL         -- mailto contact for VAPID
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -- provided by Edge Runtime
 *
 * Request body: { title, body, tag?, url?, user_id?, limit? }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_EMAIL = Deno.env.get("VAPID_EMAIL") ?? "mailto:classhub@example.com";

if (VAPID_PRIVATE_KEY && VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(
    VAPID_EMAIL,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...(init?.headers || {}) },
  });
}

function verifyServiceRole(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return !!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return json(204, {});
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }
  if (!verifyServiceRole(req)) {
    return json(401, { error: "Service-role authentication required." });
  }
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
    return json(500, { error: "Push is not configured on the server." });
  }

  let body: { title?: string; body?: string; tag?: string; url?: string; user_id?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const title = String(body.title || "ClassHub").slice(0, 200);
  const message = String(body.body || "").slice(0, 1000);
  const tag = String(body.tag || "classhub-push").slice(0, 100);
  const url = String(body.url || "/").slice(0, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let query = supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .order("created_at", { ascending: false });
  if (body.user_id) query = query.eq("user_id", body.user_id);
  if (typeof body.limit === "number" && body.limit > 0) query = query.limit(body.limit);

  const { data: rows, error } = await query;
  if (error) {
    console.error("send-push: fetch subscriptions failed", error.message);
    return json(500, { error: "Could not load subscriptions." });
  }

  const subscriptions = (rows || []) as Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;

  let sent = 0;
  let failed = 0;
  const removed: string[] = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({ title, body: message, tag, url })
      );
      sent += 1;
    } catch (err: any) {
      const statusCode = err?.statusCode;
      // 410 Gone / 404 Not Found = subscription invalid; prune it.
      if (statusCode === 410 || statusCode === 404) {
        removed.push(sub.endpoint);
      }
      failed += 1;
      console.warn("send-push: delivery failed", sub.endpoint, statusCode, err?.message);
    }
  }

  for (const endpoint of removed) {
    try {
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    } catch {}
  }

  return json(200, { sent, failed, total: subscriptions.length, pruned: removed.length });
}
