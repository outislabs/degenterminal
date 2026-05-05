# Data Flow

This document traces the most important user journeys through the system.

## Journey 1: Live Alpha Discovery

**Goal:** User sees newly launched tokens within seconds of pool creation.

                    ┌─────────────────────┐
                    │  External Sources   │
                    ├─────────────────────┤
                    │ • Helius WebSocket  │ (sub-second SOL pools)
                    │ • DexScreener API   │ (BNB + SOL polling)
                    │ • Pump.fun / Bags / │
                    │   Four.meme APIs    │ (bonding curves)
                    └──────────┬──────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │                                     │
            ▼                                     ▼
┌───────────────────────┐            ┌────────────────────────┐
│  alpha-scan edge fn   │            │   Helius WS consumer   │
│  (cron-driven, BNB +  │            │   (in bot service,     │
│  SOL polling)         │            │   pushes to Postgres)  │
└───────────┬───────────┘            └───────────┬────────────┘
│                                    │
└──────────────┬─────────────────────┘
▼
┌─────────────────────────────┐
│  Postgres: tokens table     │
│  (INSERT/UPSERT)            │
└──────────────┬──────────────┘
│
│  Realtime channel
▼
┌─────────────────────────────┐
│  Frontend: AlphaScanFeed    │
│  + Telegram /trending /new  │
└─────────────────────────────┘


**Latency budget:** Helius events surface in 1-3s. DexScreener-polled tokens surface in 5-15s depending on cadence.

## Journey 2: Pre-Trade Safety Check

**Goal:** Before any trade, the user sees honeypot, mint authority, LP lock, and tax flags — plus an AI summary.

User clicks Buy on token X
│
▼
SafetyPanel.tsx mounts
│
│  1. Check cache: was this token scanned in last 60s?
│  2. If stale → request fresh scan
│
▼
safety-explain edge function
│
│  Aggregates from:
│   • GoPlus Security
│   • DexScreener metadata
│   • Alchemy (on-chain checks)
│   • Chain-specific helpers (mint authority on SOL, etc.)
│
▼
Raw scanner result → Gemini 2.5 Flash
│
│  Prompt: produce plain-English risk summary
│
▼
Combined response: { rawFlags, aiSummary, scannedAt }
│
▼
SafetyPanel renders:
• Security grid (raw flags)
• AI explainer
• Block trade button if critical flag fires

User clicks Buy on token X
│
▼
SafetyPanel.tsx mounts
│
│  1. Check cache: was this token scanned in last 60s?
│  2. If stale → request fresh scan
│
▼
safety-explain edge function
│
│  Aggregates from:
│   • GoPlus Security
│   • DexScreener metadata
│   • Alchemy (on-chain checks)
│   • Chain-specific helpers (mint authority on SOL, etc.)
│
▼
Raw scanner result → Gemini 2.5 Flash
│
│  Prompt: produce plain-English risk summary
│
▼
Combined response: { rawFlags, aiSummary, scannedAt }
│
▼
SafetyPanel renders:
• Security grid (raw flags)
• AI explainer
• Block trade button if critical flag fires

User confirms Buy/Sell
│
▼
Frontend (or Telegram bot)
│
│  1. Re-verify safety scan is fresh + non-blocking
│  2. Unlock embedded wallet (Privy session check)
│  3. Build quote
│     ├─ Solana: Jupiter v6 quote API
│     └─ BNB:    1inch quote API
│  4. Show quote + price impact + fees to user
│
▼
User confirms quote
│
▼
Build + sign transaction (Privy embedded signer)
│
▼
Broadcast to RPC
│
├──> On success: write user_trades row (server is source of truth)
│     │
│     ├─ Powers trade history page
│     ├─ Triggers quest progress recompute
│     ├─ Triggers referral qualification check
│     └─ Updates leaderboard standings
│
└──> On failure: surface error, no partial state written


**Why server-side trade persistence:** Points, quests, leaderboards, and referrals all derive from `user_trades`. If trades were only in localStorage, users could spoof them by editing browser storage. Server-side computation closes that hole.

## Journey 4: Telegram Bot Linking

User clicks “Connect Telegram” in Settings
│
▼
connect-telegram edge function
│
│  Generates one-time link code with TTL
│  Returns deep link: https://t.me/dgnterminalbot?start=<code>
│
▼
User opens deep link → bot receives /start <code>
│
▼
Bot calls connect-telegram (verify mode)
│
│  Validates code, looks up user_id, writes telegram_links row
│  Marks code consumed
│
▼
Bot replies: “Linked. Try /portfolio.”
│
▼
Subsequent bot commands authenticate via telegram_links lookup


**Why one-time codes:** Username/email auth in a bot DM is hostile UX and security-fragile. Codes are short-lived, single-use, and tied to a logged-in web session. They're never sent over an untrusted channel.

## Journey 5: Alert Dispatch

cron-job.org (every N seconds)
│
▼
Bot service: alert monitor (in-process)
│
│  1. Load active user_alerts
│  2. For each, fetch latest price snapshot
│  3. Skip if cooldown not elapsed
│  4. Evaluate condition (price above/below)
│  5. On match → Telegram sendMessage
│  6. Update last_fired_at
│
▼
User receives alert in Telegram
│
│  Inline keyboard: [Buy] [Mute] [Delete]
▼
Tap [Buy] → drops into trade execution flow (Journey 3)


## Cross-Cutting: Realtime Channels

Frontend subscribes selectively, never to the full firehose:

| Channel | Subscribed by | Purpose |
|---|---|---|
| `alpha_feed:{chain}` | Alpha Scan page | New token + status changes |
| `tokens:{address}` | Token detail page | Per-token price + metric updates |
| `user_trades:{user_id}` | Portfolio + history | Live trade confirmation |
| `user_alerts:{user_id}` | Settings page | Alert state changes |

This keeps WebSocket fanout cheap and predictable.

## Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| Edge function timeout | Supabase logs | Next cron tick retries; idempotent inserts |
| DEX API 5xx | Response status | Circuit-break, fall through to alternate source |
| Helius WS disconnect | Heartbeat miss | Auto-reconnect with exponential backoff |
| RPC failure on trade | Tx not landed | Surface error to user; no DB write |
| Gemini AI down | Timeout | Render raw scanner data without prose summary |
| Telegram delivery fails | API error | Retry 3x with backoff; mark alert pending |
| Privy session expired | Auth check | Prompt re-unlock; never sign with stale session |
