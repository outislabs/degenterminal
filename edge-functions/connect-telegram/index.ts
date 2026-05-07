// ─────────────────────────────────────────────────────────────────────────
// Sanitized snapshot of supabase/functions/connect-telegram/index.ts for
// hackathon review. This is the production file — no secrets are present
// in the source (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRIVY_APP_ID
// are read from environment at runtime).
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import {
  PrivyAuthError,
  userIdMatchesPrivy,
  verifyPrivyRequest,
} from "../_shared/privy.ts";

// HARDENED (Phase B #3 — CRITICAL):
// Previously this function trusted `body.userId` without authentication, so
// any visitor could POST a victim's Privy userId, receive a Telegram link
// code, redeem it from their own Telegram account, and bind the attacker's
// chat to the victim's wallet (= remote control of trades / withdrawals).
// We now (a) require a verified Privy access token via Authorization
// header, (b) reject if the body's userId does not match the token's
// subject, and (c) Zod-validate the request shape.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  userId: z.string().min(3).max(200),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Verify Privy bearer token against Privy's JWKS
    const verified = await verifyPrivyRequest(req);

    // 2. Validate body shape with Zod
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid body", detail: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { userId } = parsed.data;

    // 3. Enforce that body.userId matches the authenticated subject —
    //    blocks privilege-escalation attempts.
    if (!userIdMatchesPrivy(userId, verified)) {
      return new Response(
        JSON.stringify({ error: "userId does not match authenticated user" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Generate random 8-character link code (no ambiguous chars)
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const linkCode = Array.from(
      { length: 8 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("terminal_telegram_tokens")
      .insert({
        user_id: userId,
        token: linkCode,
        expires_at: expiresAt,
        used: false,
      });

    if (error) throw error;

    return new Response(
      JSON.stringify({
        success: true,
        code: linkCode,
        botUrl: `https://t.me/dgnterminalbot?start=${linkCode}`,
        expiresIn: 600,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof PrivyAuthError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
