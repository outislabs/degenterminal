# Edge Functions

Four representative Supabase Edge Functions are included in this submission repo. The full set is private.

| Function | Purpose |
|---|---|
| `alpha-scan` | Polls DEX APIs for new launches + status changes; writes to `tokens` |
| `safety-explain` | Aggregates safety scanner results and generates AI summary |
| `top-holders` | Computes top-holder breakdown for token detail pages |
| `connect-telegram` | One-time code generation/verification for bot account linking |

## Conventions

All functions:
- Are written in TypeScript on Deno
- Authenticate cron callers via a `Bearer ${CRON_SECRET}` header where applicable
- Authenticate user callers via Supabase JWT verification
- Return structured JSON with `status: "ok" | "error"`
- Log to Supabase function logs on error
- Are idempotent where invoked by cron

## Withheld

- `pool-watcher` (Helius WS handler — runs in bot service)
- `quest-recompute`, `referral-qualify` (rewards system internals)
- `bridge-quote`, `trigger-order-*` (execution-path functions)
- `admin-*` (treasury and fee management)
