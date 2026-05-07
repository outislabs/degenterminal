// ─────────────────────────────────────────────────────────────────────────
// Sanitized snapshot of supabase/functions/dev-access/index.ts for
// hackathon review. This is the production file — no secrets are present
// in the source (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRIVY_APP_ID
// are read from environment at runtime).
// ─────────────────────────────────────────────────────────────────────────

// HARDENED (Phase B #4): the developer_access_requests table previously had
// `SELECT USING (true)` and a public INSERT policy. Anyone could (a) list
// every applicant's email/company/use case, and (b) submit a request
// claiming to be any privy_user_id. This edge function replaces direct table
// access from the client: it verifies the caller's Privy access token and
// scopes reads + writes to the authenticated user's privy_user_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { PrivyAuthError, verifyPrivyRequest } from "../_shared/privy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get") }),
  z.object({
    action: z.literal("submit"),
    email: z.string().trim().email().max(320),
    company: z.string().trim().max(200).optional().nullable(),
    use_case: z.string().trim().min(10).max(2000),
    expected_volume: z.string().trim().max(200).optional().nullable(),
    wants_mcp: z.boolean(),
    wants_rest: z.boolean(),
  }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const verified = await verifyPrivyRequest(req);
    const raw = await req.json().catch(() => ({}));
    const parsed = ActionSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Invalid body", detail: parsed.error.flatten() }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Match either the "did:privy:..." form or the raw sub. The legacy code
    // wrote whichever the Privy SDK returned, so we read both shapes.
    const idVariants = Array.from(new Set([verified.privyUserId, verified.rawSub]));

    if (parsed.data.action === "get") {
      const { data, error } = await supabase
        .from("developer_access_requests")
        .select("*")
        .in("privy_user_id", idVariants)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return json({ request: data?.[0] ?? null });
    }

    // submit
    const { email, company, use_case, expected_volume, wants_mcp, wants_rest } = parsed.data;
    const { data, error } = await supabase
      .from("developer_access_requests")
      .insert({
        privy_user_id: verified.privyUserId, // ← server-stamped, never trust client
        email,
        company: company || null,
        use_case,
        expected_volume: expected_volume || null,
        wants_mcp,
        wants_rest,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;
    return json({ request: data });
  } catch (err) {
    if (err instanceof PrivyAuthError) return json({ error: err.message }, err.status);
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
