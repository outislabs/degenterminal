# Degen Terminal

> Solana-native memecoin trading terminal. Embedded wallets, real-time alpha discovery, AI-powered safety scanning, and a full Telegram bot — in one interface.

🔗 **Live:** [terminal.degentools.co](https://terminal.degentools.co)
🤖 **Telegram Bot:** [@dgnterminalbot](https://t.me/dgnterminalbot) NOT LIVE
🐦 **Twitter:** [@dgnterminal](https://x.com/dgnterminal)

> **For Colosseum judges:** Full private repo access has been pre-provisioned for the Colosseum review team. If you need additional collaborator access, reach out to @legalalien0x on X.


---

## What It Does

Degen Terminal collapses the memecoin trading stack into one interface: real-time discovery, AI safety analysis, embedded wallets, and execution. Built Solana-first with Jupiter v6 for swaps and triggers, Helius WebSocket for sub-second pool detection, and Pump.fun + Bags + Four.meme integration for live launch coverage. BNB Chain is also supported as a secondary chain.

## What's In This Repo

This repo is a curated snapshot containing architecture docs, representative edge functions, and the database schema. The full production codebase (web app, bot service, full edge function set, RLS policies, migrations, admin tools) is in a private repo. **Colosseum judges have already been added as collaborators** — no request needed.


The full production codebase additionally includes the React frontend, the Telegram bot service, additional edge functions, RLS policies and migrations, and the admin treasury surface.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Backend | Supabase (Postgres, Edge Functions, Realtime, Auth, RLS) |
| Hosting | Vercel |
| Wallets | Privy (auth) + custom embedded wallets (scrypt-encrypted private keys) |
| Solana | Jupiter v6 (swaps + triggers), Helius (WebSocket + RPC) |
| BNB | 1inch (swaps), Alchemy (RPC) |
| Cross-chain | Li.Fi |
| Market data | Jupiter, DexScreener, Birdeye, Pump.fun, Bags, Four.meme, GoPlus |
| AI | Gemini 2.5 Flash via internal AI gateway |
| Bot | Node.js, TypeScript, grammY |

## Security Posture

The codebase went through a documented security audit ("Phase B") that addressed:

1. **Cron secret enforcement** on scheduled functions
2. **Zod input validation** on every public endpoint
3. **Privy JWT verification** on privilege-sensitive endpoints (Telegram linking, developer access)
4. **Strict path allowlists** on third-party API proxies (Li.Fi)
5. **Wallet KDF migration** from broken SHA-512 to scrypt with per-record salt

See `docs/safety-system.md` and the `HARDENED (Phase B)` comments in each edge function for details on each fix.

## Demo

🌐 **Live app:** [terminal.degentools.co](https://terminal.degentools.co)
🤖 **Bot:** [@dgnterminalbot](https://t.me/dgnterminalbot)

## About

Built as Part of the [DegenTools Ecosystem](https://degentools.co) suite.

**Contact:** [@legalalien0x](https://x.com/legalalien0x) · [degentools.co](https://degentools.co)

## License

Code in this repository is provided for hackathon evaluation only. Not licensed for redistribution or commercial use without written permission. See `LICENSE`.

