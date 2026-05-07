// ─────────────────────────────────────────────────────────────────────────
// Sanitized snapshot of supabase/functions/_shared/privy.ts for hackathon
// review. This is the production file — no secrets are present in the
// source (PRIVY_APP_ID is read from environment at runtime).
// ─────────────────────────────────────────────────────────────────────────
//
// Shared Privy access-token verifier for Supabase edge functions.
//
// HARDENED (Phase B #3): connect-telegram and dev-access previously trusted
// the `userId` field in the request body. Anyone could POST an arbitrary
// userId and (a) generate a Telegram link code that, once redeemed, would
// bind the attacker's Telegram chat to the victim's wallet, or (b) read /
// write developer access requests for arbitrary users. We now require a
// `Authorization: Bearer <privy_access_token>` header on every protected
// call and verify the token against Privy's JWKS. The body's userId must
// match the token's `sub` claim or the request is rejected.

// `jose` ships an ESM build that runs on Deno (Web Crypto only, no Node deps).
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "https://esm.sh/jose@5.9.6";

const PRIVY_ISSUER = "privy.io";
const PRIVY_JWKS_URL = "https://auth.privy.io/api/v1/apps/{appId}/jwks.json";

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let _jwksAppId: string | null = null;

function getJwks(appId: string) {
  if (!_jwks || _jwksAppId !== appId) {
    _jwks = createRemoteJWKSet(new URL(PRIVY_JWKS_URL.replace("{appId}", appId)));
    _jwksAppId = appId;
  }
  return _jwks;
}

export type VerifiedPrivyUser = {
  /** Normalized Privy DID, e.g. "did:privy:xxxxxxxxxx" */
  privyUserId: string;
  /** Same value without the "did:privy:" prefix, for legacy comparisons */
  rawSub: string;
  payload: JWTPayload;
};

export class PrivyAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * Verify the bearer token on `req` against Privy's JWKS.
 * Throws PrivyAuthError on any failure (missing/invalid token, bad signature,
 * expired, audience mismatch).
 */
export async function verifyPrivyRequest(req: Request): Promise<VerifiedPrivyUser> {
  const appId = Deno.env.get("PRIVY_APP_ID");
  if (!appId) {
    throw new PrivyAuthError("PRIVY_APP_ID not configured on server", 500);
  }

  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    throw new PrivyAuthError("Missing Authorization: Bearer <privy_access_token>", 401);
  }
  const token = m[1].trim();
  if (!token) throw new PrivyAuthError("Empty bearer token", 401);

  let result;
  try {
    result = await jwtVerify(token, getJwks(appId), {
      issuer: PRIVY_ISSUER,
      audience: appId,
    });
  } catch (e) {
    throw new PrivyAuthError(`Invalid Privy token: ${(e as Error).message}`, 401);
  }

  const sub = typeof result.payload.sub === "string" ? result.payload.sub : "";
  if (!sub) throw new PrivyAuthError("Privy token missing sub", 401);

  // Privy's `sub` is the Privy DID, sometimes presented with or without the
  // "did:privy:" prefix depending on the SDK version. Normalize to both forms
  // so callers can match either shape.
  const privyUserId = sub.startsWith("did:privy:") ? sub : `did:privy:${sub}`;
  const rawSub = sub.replace(/^did:privy:/, "");

  return { privyUserId, rawSub, payload: result.payload };
}

/** Returns true if the supplied userId matches the verified Privy subject. */
export function userIdMatchesPrivy(userId: string, verified: VerifiedPrivyUser): boolean {
  if (!userId) return false;
  const normalized = userId.replace(/^did:privy:/, "");
  return normalized === verified.rawSub;
}
