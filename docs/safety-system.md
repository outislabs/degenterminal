# Safety System

Every trade in Degen Terminal passes through a safety scan before the user can confirm. This document explains why and how.

## Why Pre-Trade Safety Is Non-Negotiable

Memecoin tokens deploy at a rate of thousands per day across Solana and BNB. A meaningful fraction are designed to extract value: honeypots that block selling, tokens with high transfer taxes, mintable supplies that get diluted, and rugs where the dev pulls liquidity post-launch.

Most existing terminals show price and chart data without surfacing these risks until after a user is already in a bad position. We invert that: **safety is the gate, not the warning.**

## What's Checked

Each scan evaluates a token across four categories. The exact source per check is chain-dependent.

### 1. Honeypot detection
Can the token actually be sold? Honeypot contracts simulate buys cleanly but reject sells. We test with a simulated sell transaction (read-only) and surface the result.

### 2. Mint / supply authority
- **Solana:** Is mint authority renounced? Is freeze authority renounced?
- **BNB:** Is the contract ownership renounced? Are there pause/blacklist functions?

### 3. Liquidity locks
Is the LP locked? For how long? Locked LP doesn't guarantee the token is safe, but unlocked LP is a near-guarantee that the dev can rug.

### 4. Tax / fee analysis
What's the buy tax, sell tax, and transfer tax? Tokens with asymmetric or rising taxes are flagged.

## How the Scan Runs

SafetyPanel renders
│
▼
safety-explain edge function
│
│  Parallel calls:
│   • GoPlus Security (token security API)
│   • DexScreener (LP info, token metadata)
│   • Alchemy / chain RPC (on-chain checks)
│
▼
Aggregate raw flags → Gemini 2.5 Flash
│
│  Generate plain-English summary with severity rating
│
▼
Combined output:
• Raw flag grid (always shown)
• AI explainer (shown if Gemini responded)
• Block flag (if any critical risk fires)


## AI Layer: What It Adds and Doesn't

Gemini doesn't decide if a token is safe. The structured scanner output does that. What Gemini adds is **interpretation**: turning "mintAuthority: present, lpLockDuration: 0, sellTax: 35%" into "This token can be diluted by the dev, has no liquidity lock, and a 35% sell tax. Trading is high-risk."

The deterministic flag grid is always visible. If the AI call fails or times out, the user still gets the structured truth.

## Caching

Scans are cached for 60 seconds per token. Two users opening the same token within that window share one scan. Beyond that window, fresh scan triggers automatically.

## Block vs. Warn

Critical flags (e.g., honeypot detected) **block** the trade button. The user sees why and cannot proceed.

Non-critical flags (e.g., 15% sell tax) **warn** but allow the trade with explicit acknowledgment.

The block list is conservative — false positives cost users a missed trade, false negatives cost them money. We err toward conservatism.
