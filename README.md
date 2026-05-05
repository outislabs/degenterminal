# Degen Terminal

> A multi-chain memecoin trading terminal with embedded wallets, AI safety scanning, real-time alpha discovery, and a Telegram bot — all in one interface.

🔗 **Live:** [terminal.degentools.co](https://terminal.degentools.co)
🤖 **Telegram Bot:** [@dgnterminalbot](https://t.me/dgnterminalbot)
🎥 **Walkthrough:** _[Loom link]_
🐦 **Twitter:** [@degentoolshq](https://x.com/degentoolshq)

---

## What It Does

Degen Terminal collapses the memecoin trading stack into one interface. Traders typically juggle a wallet extension, a DEX screener, a Telegram alpha channel, a safety scanner, and an aggregator UI. The Terminal puts all of that — discovery, analysis, safety, execution, and rewards — behind a single login, with no browser extension required.

It runs natively on **BNB Chain** and **Solana** side by side, with bridging built in.

## Feature Highlights

### 🔄 Trading & Execution
- **Quick Swap** for instant in-terminal swaps on the active chain
- **Buy/Sell Panel** with size presets and slippage controls
- **Contract Sniper** — paste a CA, one-tap buy with pre-funded amounts
- **Bridge Panel** — cross-chain BNB ↔ Solana via Li.Fi
- **Trigger Orders** — limit / conditional orders (Jupiter triggers on SOL)
- **Trade History** — server-persisted, with explorer links

### 👛 Embedded Wallet
- Privy-backed wallet — no Phantom or MetaMask required
- Password-protected creation and unlock flow
- Aggregated **Portfolio** with PnL across BNB + SOL
- Native send/receive/on-ramp for both chains

### 🔭 Alpha Scan (Discovery)
- Real-time feed of fresh launches, top gainers, whale moves, graduating tokens
- **Graduation Radar** — Pump.fun / Four.meme bonding curves nearing migration
- **Trending Bar** by volume
- **⌘K Search** for global token/contract lookup

### 🛡️ AI Safety
- Honeypot detection, mint authority checks, LP lock verification, tax checks — run **before every trade**
- **AI Safety Explain** — Gemini-generated plain-English risk summary
- Security grid on every token detail page

### 🏆 Rewards System
- Daily/weekly quests with server-side point computation (no client spoofing)
- Streak tracking and leaderboard
- Referrals: +500 points per qualified referral (referee must complete a trade)

### 💬 Telegram Bot
Once linked from Settings, the bot supports:
- `/wallet`, `/portfolio` — balances and holdings
- `/buy <ca> <amt>`, `/sell <ca> <amt|%>` — execute trades
- `/scan <ca>` — AI safety scan
- `/trending`, `/new` — discovery feeds
- `/alert <ca> above|below <price>` — price alerts with background monitoring
- `/alert list`, `/alert delete <id>`

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Backend | Supabase (Postgres + Edge Functions + Realtime) |
| Hosting | Vercel |
| Wallets | Privy (embedded) |
| Solana routing | Jupiter (swaps + triggers) |
| BNB routing | 1inch |
| Cross-chain | Li.Fi |
| Live pool data | Helius WebSocket (SOL) |
| Market data | DexScreener, Birdeye, Pump.fun, Bags, Four.meme |
| AI | Gemini 2.5 Flash (safety explain, bot intent parsing) |
| Bot framework | grammY |
| Polling | cron-job.org |

---

## What's In This Repo

This is a **curated submission repo**. The full production codebase is private. What's here is enough to evaluate engineering quality, architecture decisions, and product depth — without exposing internals that would aid fork attempts.

