// AlphaScanFeed: realtime feed of new launches, top gainers, whale moves,
// and graduating tokens. Subscribes to Supabase Realtime channels for
// the active chain.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase"; // not included

interface FeedItem {
  address: string;
  chain: "sol" | "bnb";
  name: string;
  symbol: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  priceChange24h: number;
  discoveredAt: string;
  category: "new" | "trending" | "graduating" | "whale";
}

interface AlphaScanFeedProps {
  chain: "sol" | "bnb" | "all";
  category?: FeedItem["category"];
}

export function AlphaScanFeed({
  chain,
  category = "new",
}: AlphaScanFeedProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const query = supabase
      .from("alpha_feed")
      .select("*")
      .eq("category", category)
      .order("discovered_at", { ascending: false })
      .limit(50);

    if (chain !== "all") query.eq("chain", chain);

    query.then(({ data }) => {
      if (!cancelled) {
        setItems(data ?? []);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [chain, category]);

  // Realtime subscription
  useEffect(() => {
    const channelName = chain === "all"
      ? `alpha_feed:${category}`
      : `alpha_feed:${chain}:${category}`;

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "alpha_feed",
        filter: `category=eq.${category}`,
      }, (payload) => {
        const row = payload.new as FeedItem;
        if (chain !== "all" && row.chain !== chain) return;
        setItems((prev) => [row, ...prev].slice(0, 100));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chain, category]);

  if (loading) return <FeedSkeleton />;
  if (items.length === 0) return <EmptyState />;

  return (
    <ul className="divide-y divide-zinc-900">
      {items.map((item) => (
        <FeedRow key={`${item.chain}-${item.address}`} item={item} />
      ))}
    </ul>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const change = item.priceChange24h;
  const changeTone = change >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-[10px] uppercase text-zinc-400">
        {item.chain}
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm text-zinc-100">
          {item.name} <span className="text-zinc-500">${item.symbol}</span>
        </div>
        <div className="text-xs text-zinc-500">
          Liq: ${formatCompact(item.liquidityUsd)} · Vol:{" "}
          ${formatCompact(item.volume24h)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm text-zinc-200">
          ${item.priceUsd.toPrecision(4)}
        </div>
        <div className={`text-xs ${changeTone}`}>
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}%
        </div>
      </div>
    </li>
  );
}

function formatCompact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function FeedSkeleton() {
  return (
    <div className="space-y-3 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 rounded-md bg-zinc-900 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="p-6 text-center text-sm text-zinc-500">
      No tokens in this feed yet. Check back in a moment.
    </div>
  );
}
