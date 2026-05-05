// Supabase Edge Function: safety-explain
// Aggregates safety scanner output across providers and generates
// an AI-powered plain-English risk summary via Gemini.
//
// Called from the SafetyPanel before every trade.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOPLUS_BASE = Deno.env.get("GOPLUS_BASE")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const CACHE_SECONDS = 60;

interface SafetyFlags {
  isHoneypot: boolean | null;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  lpLocked: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  blocking: boolean;
  blockingReasons: string[];
}

serve(async (req) => {
  // Auth: require user JWT
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: { tokenAddress: string; chain: "sol" | "bnb" };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  try {
    // Cache check
    const cached = await readCache(supabase, body.tokenAddress);
    if (cached) return json({ ...cached, cached: true });

    // Aggregate flags from providers
    const flags = await aggregateFlags(body.tokenAddress, body.chain);

    // AI summary (best-effort)
    const aiSummary = await generateSummary(flags, body.tokenAddress).catch(
      (e) => {
        console.warn("Gemini call failed; falling back to flags only", e);
        return null;
      },
    );

    const result = {
      tokenAddress: body.tokenAddress,
      chain: body.chain,
      flags,
      aiSummary,
      scannedAt: new Date().toISOString(),
    };

    await writeCache(supabase, body.tokenAddress, result);
    return json(result);
  } catch (err) {
    console.error("safety-explain:", err);
    return json({ error: "scan_failed", message: String(err) }, 500);
  }
});

async function aggregateFlags(
  address: string,
  chain: "sol" | "bnb",
): Promise<SafetyFlags> {
  // Production aggregation logic withheld. Real implementation calls:
  //  - GoPlus Security (token security API)
  //  - DexScreener (LP info)
  //  - Alchemy / chain RPC (mint authority on SOL, ownership on BNB)
  // and merges results into a single flag set with a `blocking` decision.

  const goplus = await fetch(`${GOPLUS_BASE}/${chain}/${address}`).then((r) =>
    r.json()
  );

  const flags: SafetyFlags = {
    isHoneypot: goplus.is_honeypot ?? null,
    mintAuthorityActive: chain === "sol" ? goplus.mintable ?? null : null,
    freezeAuthorityActive: chain === "sol" ? goplus.freezable ?? null : null,
    lpLocked: goplus.lp_locked ?? null,
    buyTax: goplus.buy_tax ?? null,
    sellTax: goplus.sell_tax ?? null,
    blocking: false,
    blockingReasons: [],
  };

  if (flags.isHoneypot === true) {
    flags.blocking = true;
    flags.blockingReasons.push("honeypot_detected");
  }
  if ((flags.sellTax ?? 0) > 30) {
    flags.blocking = true;
    flags.blockingReasons.push("sell_tax_excessive");
  }

  return flags;
}

async function generateSummary(
  flags: SafetyFlags,
  address: string,
): Promise<string> {
  const prompt =
    `You are a crypto safety assistant. Given these scanner flags for ` +
    `token ${address}, write a 2-3 sentence plain-English summary of the ` +
    `risk. Be concrete, no hype. Flags:\n${JSON.stringify(flags, null, 2)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function readCache(
  supabase: ReturnType<typeof createClient>,
  address: string,
) {
  const { data } = await supabase
    .from("safety_scan_cache")
    .select("payload, scanned_at")
    .eq("token_address", address)
    .single();

  if (!data) return null;
  const ageSec = (Date.now() - new Date(data.scanned_at).getTime()) / 1000;
  if (ageSec > CACHE_SECONDS) return null;
  return data.payload;
}

async function writeCache(
  supabase: ReturnType<typeof createClient>,
  address: string,
  payload: unknown,
) {
  await supabase.from("safety_scan_cache").upsert({
    token_address: address,
    payload,
    scanned_at: new Date().toISOString(),
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
