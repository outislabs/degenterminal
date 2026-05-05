// Supabase Edge Function: top-holders
// Fetches top-holder breakdown for a token. Used on token detail pages
// to surface concentration risk.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BIRDEYE_KEY = Deno.env.get("BIRDEYE_API_KEY")!;

const HOLDER_LIMIT = 20;
const CACHE_SECONDS = 120;

serve(async (req) => {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { tokenAddress, chain } = await req.json();

  try {
    const cached = await readCache(supabase, tokenAddress);
    if (cached) return json({ ...cached, cached: true });

    const holders = await fetchHolders(tokenAddress, chain);

    const top = holders.slice(0, HOLDER_LIMIT);
    const totalSupply = holders.reduce((acc, h) => acc + h.balance, 0);
    const concentration = top.reduce((acc, h) => acc + h.balance, 0) /
      totalSupply;

    const result = {
      tokenAddress,
      holders: top,
      concentrationTop20: concentration,
      fetchedAt: new Date().toISOString(),
    };

    await writeCache(supabase, tokenAddress, result);
    return json(result);
  } catch (err) {
    console.error("top-holders:", err);
    return json({ error: "fetch_failed", message: String(err) }, 500);
  }
});

async function fetchHolders(
  tokenAddress: string,
  chain: "sol" | "bnb",
): Promise<Array<{ address: string; balance: number; pct: number }>> {
  // Solana via Birdeye, BNB via 1inch / explorer fallback.
  // Production logic withheld — this is a representative shape.
  if (chain === "sol") {
    const res = await fetch(
      `https://public-api.birdeye.so/defi/token_holder?address=${tokenAddress}`,
      { headers: { "X-API-KEY": BIRDEYE_KEY } },
    );
    const data = await res.json();
    return data.data?.items ?? [];
  }
  // BNB path withheld
  return [];
}

async function readCache(
  supabase: ReturnType<typeof createClient>,
  address: string,
) {
  const { data } = await supabase
    .from("holder_cache")
    .select("payload, fetched_at")
    .eq("token_address", address)
    .single();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at).getTime()) / 1000;
  if (age > CACHE_SECONDS) return null;
  return data.payload;
}

async function writeCache(
  supabase: ReturnType<typeof createClient>,
  address: string,
  payload: unknown,
) {
  await supabase.from("holder_cache").upsert({
    token_address: address,
    payload,
    fetched_at: new Date().toISOString(),
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
