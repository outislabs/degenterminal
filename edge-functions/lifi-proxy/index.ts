// ─────────────────────────────────────────────────────────────────────────
// Sanitized snapshot of supabase/functions/lifi-proxy/index.ts for
// hackathon review. This is the production file — no secrets are present
// in the source (LIFI_API_KEY, LIFI_INTEGRATOR, LIFI_FEE/LIFI_FEE_BPS are
// read from environment at runtime).
// ─────────────────────────────────────────────────────────────────────────

// LI.FI proxy: injects integrator + fee + API key server-side so they never
// leak to the browser. Forwards GET and POST requests to li.quest.

const LIFI_BASE = "https://li.quest/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept, x-lifi-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// HARDENED (Phase B #2): strict subPath allowlist. Previously this proxy
// forwarded ANY path under li.quest/v1, which meant a third party could use
// our Supabase edge as a free authenticated LI.FI gateway (and burn our
// API quota / partner reputation). Lock to the exact endpoints the app
// actually calls.
function isAllowedLifiPath(subPath: string, method: string): boolean {
  if (!subPath.startsWith("/")) return false;
  // Reject path traversal / odd encodings.
  if (subPath.includes("..") || subPath.includes("//")) return false;

  if (method === "GET") {
    if (subPath === "/chains" || subPath.startsWith("/chains?")) return true;
    if (subPath === "/tokens" || subPath.startsWith("/tokens?")) return true;
    if (subPath === "/quote" || subPath.startsWith("/quote?")) return true;
    if (subPath === "/status" || subPath.startsWith("/status?")) return true;
    // Admin: GET /integrators/{id}/withdraw/{chainId}
    if (/^\/integrators\/[A-Za-z0-9_.\-]{1,64}\/withdraw\/\d{1,7}$/.test(subPath)) return true;
    return false;
  }
  if (method === "POST") {
    if (subPath === "/advanced/routes") return true;
    if (subPath === "/advanced/stepTransaction") return true;
    if (subPath === "/quote") return true;
    return false;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const integrator = Deno.env.get("LIFI_INTEGRATOR") || "";
  const apiKey = Deno.env.get("LIFI_API_KEY") || "";
  const feeFractionEnv = Number(Deno.env.get("LIFI_FEE") || "");
  const feeBps = Number(Deno.env.get("LIFI_FEE_BPS") || "0");
  const feeMode = Number.isFinite(feeFractionEnv) && feeFractionEnv > 0
    ? "fraction"
    : feeBps > 0 && feeBps <= 0.03
      ? "bps_fraction_compat"
      : "bps";
  const cappedFeeBps = Math.max(0, Math.min(feeBps, 300));
  const feeFraction = feeMode === "fraction"
    ? Math.min(feeFractionEnv, 0.03)
    : feeMode === "bps_fraction_compat"
      ? Math.min(feeBps, 0.03)
      : cappedFeeBps / 10000; // LI.FI supports up to 3%

  const url = new URL(req.url);
  // strip the function name prefix; everything after becomes the LI.FI path
  // e.g. /lifi-proxy/chains -> /chains
  const subPath = url.pathname.replace(/^.*?\/lifi-proxy/, "") || "/";

  // Enforce strict allowlist before doing any upstream work.
  if (!isAllowedLifiPath(subPath, req.method)) {
    return new Response(
      JSON.stringify({ error: "Path not allowed", path: subPath }),
      { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (apiKey) headers["x-lifi-api-key"] = apiKey;

  try {
    if (req.method === "GET") {
      const params = new URLSearchParams(url.search);
      const clientIntegrator = params.get("integrator");
      const clientFee = params.get("fee");
      let injectedIntegrator = false;
      let injectedFee = false;
      // Inject integrator + fee for /quote — ALWAYS overwrite the client
      // values so the Supabase env is the single source of truth.
      if (subPath.startsWith("/quote")) {
        if (integrator) {
          params.set("integrator", integrator);
          injectedIntegrator = true;
        }
        if (feeFraction > 0) {
          params.set("fee", String(feeFraction));
          injectedFee = true;
        }
      }
      const target = `${LIFI_BASE}${subPath}${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(target, { headers });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          ...corsHeaders,
          "content-type": res.headers.get("content-type") || "application/json",
          "Access-Control-Expose-Headers": "x-dgn-lifi-fee-debug",
          "x-dgn-lifi-fee-debug": encodeURIComponent(JSON.stringify({
            path: subPath,
            method: req.method,
            env: { integrator, feeBps, cappedFeeBps, feeFraction, feeMode, capped: feeMode === "bps" && feeBps !== cappedFeeBps },
            client: { integrator: clientIntegrator, fee: clientFee },
            injected: { integrator: injectedIntegrator, fee: injectedFee },
            sent: { integrator: params.get("integrator"), fee: params.get("fee") },
          })),
        },
      });
    }

    // POST
    const incoming = await req.json().catch(() => ({} as any));
    const originalOptions = { ...(incoming.options || {}) };
    let injectedIntegrator = false;
    let injectedFee = false;
    if (
      subPath.startsWith("/advanced/routes") ||
      subPath.startsWith("/advanced/stepTransaction") ||
      subPath.startsWith("/quote")
    ) {
      incoming.options = incoming.options || {};
      // ALWAYS overwrite integrator + fee with the server env values so the
      // Supabase secrets are the single source of truth. Previously the proxy
      // skipped injection when the client had already set integrator, which
      // meant the fee silently dropped to 0 (client sends integrator but no
      // fee → proxy leaves both alone → LI.FI takes no fee).
      if (integrator) {
        incoming.options.integrator = integrator;
        injectedIntegrator = true;
      }
      if (feeFraction > 0) {
        incoming.options.fee = feeFraction;
        injectedFee = true;
      }
      // For /advanced/stepTransaction the integrator/fee can also live at the
      // top level (LI.FI accepts both shapes). Mirror them so the re-priced
      // signable transaction is guaranteed to carry the partner fee.
      if (subPath.startsWith("/advanced/stepTransaction")) {
        if (integrator) incoming.integrator = integrator;
        if (feeFraction > 0) incoming.fee = feeFraction;
      }
    }
    const target = `${LIFI_BASE}${subPath}`;
    const res = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(incoming),
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders,
        "content-type": res.headers.get("content-type") || "application/json",
        "Access-Control-Expose-Headers": "x-dgn-lifi-fee-debug",
        "x-dgn-lifi-fee-debug": encodeURIComponent(JSON.stringify({
          path: subPath,
          method: req.method,
          env: { integrator, feeBps, cappedFeeBps, feeFraction, feeMode, capped: feeMode === "bps" && feeBps !== cappedFeeBps },
          client: { integrator: originalOptions.integrator, fee: originalOptions.fee },
          injected: { integrator: injectedIntegrator, fee: injectedFee },
          sent: { integrator: incoming.options?.integrator, fee: incoming.options?.fee },
        })),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
