-- Core schema for Degen Terminal
-- DDL only. RLS policies, triggers, and stored procedures live in the
-- private repo and are not included here.

-- ─────────────────────────────────────────────
-- Tokens & market data
-- ─────────────────────────────────────────────

create table tokens (
  address text not null,
  chain text not null check (chain in ('sol', 'bnb')),
  name text not null,
  symbol text not null,
  pair_address text not null,
  initial_liquidity_usd numeric not null default 0,
  price_usd numeric not null default 0,
  volume_24h numeric not null default 0,
  price_change_24h numeric not null default 0,
  is_watchlisted boolean not null default false,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, chain)
);

create index idx_tokens_discovered_at on tokens (discovered_at desc);
create index idx_tokens_chain on tokens (chain);

create table price_snapshots (
  id bigserial primary key,
  token_address text not null,
  chain text not null,
  price_usd numeric not null,
  liquidity_usd numeric not null,
  volume_24h numeric not null,
  captured_at timestamptz not null default now(),
  foreign key (token_address, chain) references tokens (address, chain)
    on delete cascade
);

create index idx_snapshots_token_time
  on price_snapshots (token_address, chain, captured_at desc);

create table alpha_feed (
  id bigserial primary key,
  token_address text not null,
  chain text not null,
  category text not null check (
    category in ('new', 'trending', 'graduating', 'whale')
  ),
  discovered_at timestamptz not null default now()
);

create index idx_alpha_feed_lookup
  on alpha_feed (category, chain, discovered_at desc);

-- ─────────────────────────────────────────────
-- User trading state (server source of truth)
-- ─────────────────────────────────────────────

create table user_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  chain text not null,
  token_address text not null,
  side text not null check (side in ('buy', 'sell')),
  amount_in numeric not null,
  amount_out numeric not null,
  price_usd numeric not null,
  tx_hash text not null,
  status text not null check (status in ('confirmed', 'failed')),
  executed_at timestamptz not null default now()
);

create index idx_trades_user_time on user_trades (user_id, executed_at desc);
create index idx_trades_token on user_trades (token_address, chain);

create table user_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token_address text not null,
  chain text not null,
  condition jsonb not null,
  active boolean not null default true,
  last_fired_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_alerts_user on user_alerts (user_id);
create index idx_alerts_active on user_alerts (active) where active = true;

-- ─────────────────────────────────────────────
-- Rewards system
-- ─────────────────────────────────────────────

create table user_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  quest_key text not null,
  progress jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  period_start date not null,
  unique (user_id, quest_key, period_start)
);

create table user_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null,
  referee_id uuid not null,
  status text not null check (status in ('pending', 'qualified', 'rejected')),
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (referee_id),
  check (referrer_id <> referee_id)
);

-- ─────────────────────────────────────────────
-- Telegram integration
-- ─────────────────────────────────────────────

create table telegram_link_codes (
  code text primary key,
  user_id uuid not null,
  expires_at timestamptz not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create table telegram_links (
  user_id uuid primary key,
  telegram_chat_id text not null unique,
  linked_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Roles & admin
-- ─────────────────────────────────────────────

create table user_roles (
  user_id uuid not null,
  role text not null check (role in ('admin', 'mod')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- has_role(uid, role) helper lives in the private repo
-- and is referenced by RLS policies on admin tables.

-- ─────────────────────────────────────────────
-- Caches (short-lived, non-canonical)
-- ─────────────────────────────────────────────

create table safety_scan_cache (
  token_address text primary key,
  payload jsonb not null,
  scanned_at timestamptz not null default now()
);

create table holder_cache (
  token_address text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
