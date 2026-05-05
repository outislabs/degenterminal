// Supabase Edge Function: alpha-scan
// Polls DEX APIs across BNB and Solana for new launches, top gainers,
// and graduating tokens. Writes results to the tokens table.
//
// Triggered by cron-job.org on a fixed interval.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEXSCREENER_BASE = Deno.env.get("DEXSCREENER_BASE")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

interface RawPair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  liquidity?: { usd: number };
  volume?: { h24: number };
  priceUsd?: string;
  priceChange?: { h24: number };
  pairCreatedAt: number;
}

serve(async (req) => {
  if (req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const [solPairs, bnbPairs] = await Promise.all([
      fetchChainPairs("solana"),
      fetchChainPairs("bsc"),
    ]);

    const all = [...solPairs, ...bnbPairs].filter(isLikelyLegitimate);
    const fresh = await dedupe(supabase, all);

    if (fresh.length === 0) {
      return json({ status: "ok", new_tokens: 0 });
    }

    const rows = fresh.map(toRow);
    const { error } = await supabase
      .from("tokens")
      .upsert(rows, { onConflict: "address,chain" });
    if (error) throw error;

    return json({ status: "ok", new_tokens: rows.length });
  } catch (err) {
    console.error("alpha-scan:", err);
    return json({ status: "error", message: String(err) }, 500);
  }
});

async function fetchChainPairs(chain: string): Promise<RawPair[]> {
  const res = await fetch(`${DEXSCREENER_BASE}/pairs/${chain}/new`);
  if (!res.ok) throw new Error(`DexScreener ${chain} ${res.status}`);
  const data = await res.json();
  return data.pairs ?? [];
}

function isLikelyLegitimate(pair: RawPair): boolean {
  // Lightweight heuristics. Production filters withheld.
  if ((pair.liquidity?.usd ?? 0) < 500) return false;
  if (!pair.baseToken.symbol || pair.baseToken.symbol.length > 16) return false;
  return true;
}

async function dedupe(
  supabase: ReturnType<typeof createClient>,
  pairs: RawPair[],
): Promise<RawPair[]> {
  const addresses = pairs.map((p) => p.baseToken.address);
  const { data } = await supabase
    .from("tokens")
    .select("address")
    .in("address", addresses);
  const known = new Set((data ?? []).map((r) => r.address));
  return pairs.filter((p) => !known.has(p.baseToken.address));
}

function toRow(pair: RawPair) {
  return {
    address: pair.baseToken.address,
    chain: normalizeChain(pair.chainId),
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    pair_address: pair.pairAddress,
    initial_liquidity_usd: pair.liquidity?.usd ?? 0,
    price_usd: parseFloat(pair.priceUsd ?? "0"),
    volume_24h: pair.volume?.h24 ?? 0,
    price_change_24h: pair.priceChange?.h24 ?? 0,
    discovered_at: new Date(pair.pairCreatedAt).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function normalizeChain(chainId: string): string {
  if (chainId === "bsc") return "bnb";
  if (chainId === "solana") return "sol";
  return chainId;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
