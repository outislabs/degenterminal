// ─────────────────────────────────────────────────────────────────────────
// Sanitized snapshot of supabase/functions/top-holders/index.ts for
// hackathon review. This is the production file — no secrets are present
// in the source (HELIUS_API_KEY is read from environment at runtime).
// ─────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  chain: "bnb" | "sol";
  tokenAddress: string;
}

interface Holder {
  wallet: string;
  pct: number;
  balance: number;
  isContract: boolean;
  isLocked: boolean;
  tag: string;
}

interface Resp {
  total: number;
  top: Holder[];
  error: string | null;
}

const PUBLIC_SOL_RPC = "https://api.mainnet-beta.solana.com";

function solRpcUrl(): string {
  const key = Deno.env.get("HELIUS_API_KEY");
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : PUBLIC_SOL_RPC;
}

async function rpc<T = unknown>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result as T;
}

async function fetchGoPlus(
  chain: "bnb" | "sol",
  tokenAddress: string
): Promise<{
  holderCount: number;
  rawHolders: Array<Record<string, unknown>>;
}> {
  const url =
    chain === "sol"
      ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${tokenAddress}`
      : `https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${tokenAddress.toLowerCase()}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { holderCount: 0, rawHolders: [] };
    const json = await res.json();
    const result = json.result || {};
    const key = Object.keys(result)[0];
    if (!key) return { holderCount: 0, rawHolders: [] };
    const t = result[key];
    const holderCount = t.holder_count ? parseInt(t.holder_count, 10) : 0;
    const rawHolders: Array<Record<string, unknown>> = Array.isArray(t.holders)
      ? t.holders
      : [];
    return { holderCount, rawHolders };
  } catch {
    return { holderCount: 0, rawHolders: [] };
  }
}

/**
 * Solana — query the on-chain top 20 token accounts via RPC, resolve each
 * token-account to its owning wallet, then return the top 10 by share. We
 * deliberately query 20 because well-known tokens may have several pool /
 * vault accounts at the top that should still be surfaced individually.
 * GoPlus is then merged in to enrich tags / locked flags.
 */
async function topHoldersSol(tokenAddress: string): Promise<Resp> {
  const url = solRpcUrl();

  // 1. Largest token accounts (top 20 — RPC max).
  type LargestAccountsResult = {
    value: Array<{ address: string; amount: string; uiAmount: number; decimals: number }>;
  };
  const largest = await rpc<LargestAccountsResult>(
    url,
    "getTokenLargestAccounts",
    [tokenAddress]
  );
  const accounts = largest.value || [];
  if (!accounts.length) {
    return { total: 0, top: [], error: "No on-chain holder data" };
  }

  // 2. Total supply for percentage math.
  type SupplyResult = { value: { amount: string; decimals: number; uiAmount: number } };
  const supply = await rpc<SupplyResult>(url, "getTokenSupply", [tokenAddress]);
  const totalUi = supply.value.uiAmount || 0;

  // 3. Resolve each token-account to its owning wallet via getMultipleAccounts.
  // The Token program account data, when parsed via jsonParsed, exposes
  // `parsed.info.owner` — the actual wallet address.
  const tokenAccountAddrs = accounts.map((a) => a.address);
  type MultipleAccountsResult = {
    value: Array<{
      data?: { parsed?: { info?: { owner?: string } } };
      owner?: string;
    } | null>;
  };
  let owners: Array<string | null> = tokenAccountAddrs.map(() => null);
  try {
    const multi = await rpc<MultipleAccountsResult>(url, "getMultipleAccounts", [
      tokenAccountAddrs,
      { encoding: "jsonParsed" },
    ]);
    owners = (multi.value || []).map((acc) => {
      const o = acc?.data?.parsed?.info?.owner;
      return typeof o === "string" ? o : null;
    });
  } catch {
    /* leave owners null — we'll fall back to token-account address */
  }

  // 4. GoPlus enrichment (tags, isLocked) keyed by token_account.
  const { holderCount, rawHolders } = await fetchGoPlus("sol", tokenAddress);
  const enrichByTokenAcc = new Map<
    string,
    { tag: string; isLocked: boolean; isContract: boolean }
  >();
  for (const h of rawHolders) {
    const ta = (h.token_account as string) || "";
    if (!ta) continue;
    enrichByTokenAcc.set(ta, {
      tag: typeof h.tag === "string" ? (h.tag as string) : "",
      isLocked: h.is_locked === 1 || h.is_locked === "1",
      isContract: h.is_contract === 1 || h.is_contract === "1",
    });
  }

  const top: Holder[] = accounts.slice(0, 10).map((acc, i) => {
    const owner = owners[i];
    const wallet = owner || acc.address; // fall back to token-account
    const balance = acc.uiAmount || 0;
    const pct = totalUi > 0 ? (balance / totalUi) * 100 : 0;
    const enrich = enrichByTokenAcc.get(acc.address);
    const looksLikePool = !owner; // unresolved owner — likely a PDA / pool vault
    return {
      wallet,
      pct,
      balance,
      isContract: enrich?.isContract ?? false,
      isLocked: enrich?.isLocked ?? false,
      tag: enrich?.tag || (looksLikePool ? "Pool" : ""),
    };
  });

  return { total: holderCount, top, error: null };
}

/** BNB — GoPlus is the only practical free source. Convert + return top 10. */
async function topHoldersBnb(tokenAddress: string): Promise<Resp> {
  const { holderCount, rawHolders } = await fetchGoPlus("bnb", tokenAddress);
  if (!rawHolders.length) {
    return { total: holderCount, top: [], error: "No holder data" };
  }
  const top: Holder[] = rawHolders.slice(0, 10).map((h) => ({
    wallet: typeof h.address === "string" ? (h.address as string) : "",
    pct: parseFloat((h.percent as string) || "0") * 100,
    balance: parseFloat((h.balance as string) || "0"),
    isContract: h.is_contract === 1 || h.is_contract === "1",
    isLocked: h.is_locked === 1 || h.is_locked === "1",
    tag: typeof h.tag === "string" ? (h.tag as string) : "",
  }));
  return { total: holderCount, top, error: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    // HARDENED (Phase B #2): Zod-validate request shape. tokenAddress is
    // forwarded into RPC calls / external API URLs so we constrain it to a
    // safe character set and a sensible length range.
    const raw = await req.json().catch(() => ({}));
    const parsed = z
      .object({
        chain: z.enum(["bnb", "sol"]),
        tokenAddress: z
          .string()
          .trim()
          .min(8)
          .max(80)
          // EVM 0x… or base58 SPL — both fit this charset.
          .regex(/^(0x)?[A-Za-z0-9]+$/, "tokenAddress has invalid characters"),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ total: 0, top: [], error: "Invalid input", detail: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }
    const body: ReqBody = parsed.data;
    const result =
      body.chain === "sol"
        ? await topHoldersSol(body.tokenAddress)
        : await topHoldersBnb(body.tokenAddress);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("top-holders error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(
      JSON.stringify({
        total: 0,
        top: [],
        error: message,
        fallback: true,
      }),
      {
        // Return 200 so the client treats this as a soft failure (empty
        // holders list) instead of a hard error/blank screen. The RPC
        // upstream (Helius) is occasionally overloaded and recovers on retry.
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }
});
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
