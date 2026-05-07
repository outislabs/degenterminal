// ─────────────────────────────────────────────────────────────────────────
// Sanitized snapshot of supabase/functions/safety-explain/index.ts for
// hackathon review. Production calls a Gemini model via an internal AI
// gateway; the gateway URL and API key are read from environment at
// runtime and not present in source. This file documents the request
// shape and prompt engineering, with the gateway transport abstracted.
// ─────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SafetyInput {
  chain: "bnb" | "sol";
  tokenAddress: string;
  ticker?: string;
  safety: {
    isHoneypot: boolean | null;
    buyTax: number | null;
    sellTax: number | null;
    lpLockedPct: number | null;
    canTakeBackOwnership: boolean | null;
    ownerAddress: string | null;
    isMintable: boolean | null;
    hiddenOwner: boolean | null;
    isOpenSource: boolean | null;
    topHolderPct: number | null;
    holderCount: number | null;
    riskScore: number;
  };
}

/**
 * Build a chain-appropriate, null-pruned payload for the AI.
 * EVM (BNB) and Solana expose different security primitives — sending the full
 * EVM struct for a Solana token causes the model to invent "unknown" rows for
 * fields that simply don't exist on that chain (e.g. buy/sell tax, LP lock,
 * open source, honeypot). We strip those out per chain.
 */
function buildAiSafetyView(input: SafetyInput): Record<string, unknown> {
  const s = input.safety;
  const view: Record<string, unknown> = {
    riskScore: s.riskScore,
  };
  const put = (k: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") view[k] = v;
  };

  // Universally meaningful fields
  // This value is the COMBINED share of the top 10 holders (see
  // enrichWithOnChainHolders in src/lib/safety.functions.ts). Name it
  // unambiguously so the AI doesn't describe it as "one wallet holds X%".
  if (s.topHolderPct !== null && s.topHolderPct !== undefined) {
    view["top10HoldersCombinedPct"] = Math.round(s.topHolderPct * 100) / 100;
  }
  put("holderCount", s.holderCount);
  put("isMintable", s.isMintable);
  put("ownerAddress", s.ownerAddress);

  if (input.chain === "bnb") {
    // EVM-only fields
    put("isHoneypot", s.isHoneypot);
    put("buyTax", s.buyTax);
    put("sellTax", s.sellTax);
    put("lpLockedPct", s.lpLockedPct);
    put("canTakeBackOwnership", s.canTakeBackOwnership);
    put("hiddenOwner", s.hiddenOwner);
    put("isOpenSource", s.isOpenSource);
  } else {
    // Solana — `hiddenOwner` field carries freezeAuthority active flag (see safety.functions.ts)
    if (s.hiddenOwner !== null) view["freezeAuthorityActive"] = s.hiddenOwner;
    // Transfer fee maps to buyTax/sellTax on Solana
    if (s.buyTax !== null) view["transferFeePct"] = s.buyTax;
  }
  return view;
}

// HARDENED (Phase B #2): Zod-validate input shape before invoking the AI
// gateway. Previously any body shape was accepted and passed straight
// through, which let a malformed request burn AI credits and emit
// confusing model output.
const SafetyInputSchema = z.object({
  chain: z.enum(["bnb", "sol"]),
  tokenAddress: z.string().min(8).max(80),
  ticker: z.string().max(40).optional(),
  safety: z.object({
    isHoneypot: z.boolean().nullable(),
    buyTax: z.number().nullable(),
    sellTax: z.number().nullable(),
    lpLockedPct: z.number().nullable(),
    canTakeBackOwnership: z.boolean().nullable(),
    ownerAddress: z.string().nullable(),
    isMintable: z.boolean().nullable(),
    hiddenOwner: z.boolean().nullable(),
    isOpenSource: z.boolean().nullable(),
    topHolderPct: z.number().nullable(),
    holderCount: z.number().nullable(),
    riskScore: z.number(),
  }),
});

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = SafetyInputSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", detail: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const input = parsed.data as SafetyInput;

    // AI gateway configuration — endpoint + key sourced from environment.
    const AI_GATEWAY_URL = Deno.env.get("AI_GATEWAY_URL");
    const AI_GATEWAY_KEY = Deno.env.get("AI_GATEWAY_KEY");
    if (!AI_GATEWAY_URL || !AI_GATEWAY_KEY) {
      throw new Error("AI gateway not configured");
    }

    const aiView = buildAiSafetyView(input);

    const chainContext =
      input.chain === "sol"
        ? `This is a SOLANA SPL token. Solana does NOT have buy/sell taxes, honeypots, LP-locking, or "verified source code" in the EVM sense. Only analyze fields actually provided. Do NOT invent or include checks for concepts that don't apply on Solana.`
        : `This is a BNB Smart Chain (EVM) token. Only analyze fields actually provided in the source data. Do NOT invent checks for missing fields.`;

    const systemPrompt = `You are a crypto-security analyst. You receive on-chain safety data and produce a structured breakdown.

RULES:
- Only produce a check for a field that is ACTUALLY present in the provided data. Never fabricate fields.
- Each check must use the EXACT source field key from the input as "sourceField".
- "rawValue" must be a stringified version of the actual value present in the data.
- "verdict" is one of "safe" | "warn" | "danger" | "unknown".
- "explanation": ONE short sentence (<=18 words) in plain English explaining what the value means and why it matters.
- Do NOT include "unknown" rows for fields that are not in the data — simply omit them.
- Be factual. Do not speculate beyond the data.

FIELD SEMANTICS (critical — do not misinterpret):
- "top10HoldersCombinedPct": the COMBINED percentage of supply held by the TOP 10 wallets together (NOT a single wallet). Name this check "Top 10 Holders Concentration". Never phrase it as "one wallet holds X%". Verdict guidance: <30% safe, 30-60% warn, >60% danger.
- "holderCount": total unique holders. More holders = more decentralized.
- "isMintable": true means new tokens can be minted (supply inflation risk).
- "freezeAuthorityActive" (Solana): true means an authority can freeze user balances.
- "transferFeePct" (Solana): % fee on transfers.`;

    const userPrompt = `Token: ${input.ticker || "?"} on ${input.chain.toUpperCase()} (${input.tokenAddress})

${chainContext}

Source data (only these fields exist — analyze ONLY these):
${JSON.stringify(aiView, null, 2)}

Produce one check per field above (skip riskScore — it's a derived summary number) and a short overall summary (<=30 words).`;

    const response = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "safety_breakdown",
              description: "Structured per-check safety breakdown",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                  checks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        sourceField: { type: "string" },
                        rawValue: { type: "string" },
                        verdict: {
                          type: "string",
                          enum: ["safe", "warn", "danger", "unknown"],
                        },
                        explanation: { type: "string" },
                      },
                      required: [
                        "name",
                        "sourceField",
                        "rawValue",
                        "verdict",
                        "explanation",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["summary", "checks"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "safety_breakdown" },
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 429)
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      if (response.status === 402)
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured output returned");
    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("safety-explain error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
