# Rewards System

Trade-driven points, quests, streaks, and referrals — all computed server-side from the canonical `user_trades` table.

## Why Server-Side Computation

The naive design is to track points in localStorage and sync occasionally. That design is broken: any user can edit localStorage, fake a streak, and climb the leaderboard without trading.

Our design treats `user_trades` as the source of truth. Every reward signal — points, streak, quest progress, referral qualification — derives from queries against that table. Clients display state but cannot author it.

## Components

### Points
Computed from trade volume and frequency. Specific weighting withheld; the relevant invariant is that **a user cannot earn points without a confirmed trade row**.

### Quests
Daily and weekly goals defined in the `quests` table. Progress is computed by joining `user_trades` against the quest's predicate (e.g., "execute 5 trades today on Solana"). When the predicate matches, the quest is marked complete and points are awarded.

### Streaks
A streak is the count of consecutive days with at least one qualifying trade. Computed by walking back through `user_trades` from the user's most recent trading day.

### Leaderboard
Top users by total points over a rolling window. Materialized via a scheduled job; reads come from the materialized view, not the live aggregation, to keep the page fast.

### Referrals
Each user has a unique referral code. When a referee signs up via that code AND completes their first qualifying trade, the referrer earns +500 points. The qualifying-trade gate prevents farm-and-burn referral spam.

New user signs up with referral code R
│
▼
user_referrals row written (status: pending)
│
│  … time passes …
│
▼
New user executes first qualifying trade
│
│  Trade insert trigger checks user_referrals
│  for any pending row keyed to this user
│
▼
If pending row exists:
│
├─ Mark status: qualified
├─ Credit referrer +500 points
└─ Surface “Referral qualified!” notification

## Anti-Spoof Posture

| Vector | Mitigation |
|---|---|
| Editing localStorage | Display-only; server recomputes from user_trades on every read |
| Fake trade history | All trade rows are written by the trade execution flow, gated by Privy signing + RPC confirmation |
| Self-referral | Referrer ≠ referee enforced at the database level |
| Wash trading for points | Volume-weighted scoring caps repetitive same-token cycling (heuristic withheld) |
| Quest gaming | Quest predicates require diversity (different tokens, different days, etc.) |

## Why This Matters for the Product

A leaderboard you can spoof is worthless. A referral system you can farm is worse than none. Building the rewards layer on top of `user_trades` rather than client state means leaderboard rank is **earned**, and referral payouts go to people who actually grew the user base.
