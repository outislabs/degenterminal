// ─────────────────────────────────────────────────────────────────────────
// Sanitized snapshot of supabase/functions/cleanup-dead-tokens/index.ts for
// hackathon review. This is the production file — no secrets are present
// in the source (CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are
// read from environment at runtime).
// ─────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Sweeps the market_tokens table:
 *  1. Marks tokens as dead if they haven't been refreshed in 24h+
 *  2. Permanently deletes tokens that have been dead for 7+ days
 *
 * Designed to be called hourly by pg_cron, but also safe to invoke manually.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // HARDENED (Phase B #1): require a shared secret so unauthenticated
  // visitors cannot trigger cleanup work on demand. pg_cron schedules the
  // call with `x-cron-secret: <CRON_SECRET>` (sourced from Supabase Vault
  // entry `app_cron_secret`). The header is now strictly required — a
  // missing or mismatched value returns 401, no exceptions, no fallback.
  try {
    const expected = Deno.env.get("CRON_SECRET");
    if (!expected) {
      console.error("[cleanup-dead-tokens] CRON_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server misconfigured: CRON_SECRET missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const provided = req.headers.get("x-cron-secret") || "";
    if (provided !== expected) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: markedRaw, error: markErr } = await admin.rpc(
      "mark_dead_market_tokens",
    );
    if (markErr) throw markErr;

    const { data: purgedRaw, error: purgeErr } = await admin.rpc(
      "purge_dead_market_tokens",
    );
    if (purgeErr) throw purgeErr;

    const marked = Number(markedRaw ?? 0);
    const purged = Number(purgedRaw ?? 0);

    console.log(
      `[cleanup-dead-tokens] marked=${marked} purged=${purged} at=${new Date().toISOString()}`,
    );

    return new Response(
      JSON.stringify({ success: true, marked, purged }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[cleanup-dead-tokens] failed:", e);
    return new Response(
      JSON.stringify({ success: false, error: String((e as Error).message || e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
