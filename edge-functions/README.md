# Edge Functions

Sanitized snapshots of seven production Supabase Edge Functions from Degen Terminal. Together these illustrate the security posture, validation patterns, and external-API boundary management of the live app.

## What's included

| Function | What it shows |
|---|---|
| `_shared/privy.ts` | Privy access-token verifier (JWKS), shared by privilege-sensitive endpoints |
| `connect-telegram` | Telegram account linking, hardened against userId privilege escalation |
| `dev-access` | Service-role pattern for sensitive table reads, replacing open-RLS access |
| `safety-explain` | AI-powered safety analysis with chain-aware prompt engineering and structured tool-call output |
| `top-holders` | On-chain holder analysis (SOL via RPC, BNB via GoPlus), with PDA detection and soft-failure 200s |
| `lifi-proxy` | Server-side fee/integrator injection with strict subPath allowlist |
| `cleanup-dead-tokens` | Cron-secret-gated sweep job for stale market data |

## Production set is larger

The full production set includes additional functions (Helius WebSocket URL signing, etc.) that are withheld for scope. The seven above represent the most security- and product-relevant work. Judges who want full code review can request access to the private repo via @legalalien0x or hackathon@colosseum.org.

## Conventions across all functions

- TypeScript on Deno, deployed to Supabase Edge
- Zod for request validation on every public endpoint
- CORS handling on every endpoint
- Errors logged via `console.error`, surfaced to clients with safe messages
- Service-role Supabase client only used inside protected paths

## Security hardening notes

Every function in this set went through a security audit ("Phase B") that added:

1. CRON secret enforcement on scheduled functions (`cleanup-dead-tokens`)
2. Zod input validation everywhere
3. Privy JWT verification on privilege-sensitive endpoints (`connect-telegram`, `dev-access`)
4. Strict path allowlists on proxies (`lifi-proxy`)

Each file's `HARDENED (Phase B #N)` comment documents the specific vulnerability that fix addresses.
