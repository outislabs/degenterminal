// QuickSwap: in-terminal token-for-token swap on the active chain.
// Production version handles bridges, MEV protection, and trigger orders.
// Sanitized for review.

import { useEffect, useState } from "react";
import { useActiveChain } from "@/hooks/useActiveChain"; // not included
import { useEmbeddedWallet } from "@/hooks/useEmbeddedWallet"; // not included
import { fetchQuote, executeSwap } from "@/lib/swap"; // internal

interface QuickSwapProps {
  defaultInput?: string;
  defaultOutput?: string;
}

export function QuickSwap({ defaultInput, defaultOutput }: QuickSwapProps) {
  const { chain } = useActiveChain();
  const { wallet, ensureUnlocked } = useEmbeddedWallet();

  const [inputToken, setInputToken] = useState(defaultInput ?? "");
  const [outputToken, setOutputToken] = useState(defaultOutput ?? "");
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(100); // 1%
  const [quote, setQuote] = useState<{ outAmount: string; priceImpact: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "quoting" | "executing" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Refresh quote when inputs change
  useEffect(() => {
    if (!inputToken || !outputToken || !amountIn) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setStatus("quoting");

    (async () => {
      try {
        const q = await fetchQuote({
          chain,
          inputToken,
          outputToken,
          amountIn,
          slippageBps,
        });
        if (!cancelled) {
          setQuote(q);
          setStatus("idle");
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chain, inputToken, outputToken, amountIn, slippageBps]);

  const onSwap = async () => {
    if (!quote) return;
    setError(null);
    setStatus("executing");
    try {
      await ensureUnlocked();
      await executeSwap({
        chain,
        wallet,
        inputToken,
        outputToken,
        amountIn,
        slippageBps,
        quote,
      });
      setStatus("success");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };

  const blocked = status === "executing";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Quick Swap</h3>
        <span className="text-xs text-zinc-500">{chain.toUpperCase()}</span>
      </div>

      <TokenRow
        label="From"
        token={inputToken}
        amount={amountIn}
        onTokenChange={setInputToken}
        onAmountChange={setAmountIn}
      />

      <TokenRow
        label="To"
        token={outputToken}
        amount={quote?.outAmount ?? ""}
        onTokenChange={setOutputToken}
        readOnlyAmount
      />

      {quote && (
        <div className="text-xs text-zinc-500">
          Price impact: {(quote.priceImpact * 100).toFixed(2)}% · Slippage:{" "}
          {(slippageBps / 100).toFixed(2)}%
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}

      <button
        onClick={onSwap}
        disabled={!quote || blocked}
        className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-medium text-black disabled:opacity-40"
      >
        {status === "executing" ? "Swapping..." : "Swap"}
      </button>
    </div>
  );
}

function TokenRow(props: {
  label: string;
  token: string;
  amount: string;
  onTokenChange: (v: string) => void;
  onAmountChange?: (v: string) => void;
  readOnlyAmount?: boolean;
}) {
  return (
    <div className="rounded-xl bg-zinc-900 p-3 space-y-1">
      <div className="text-xs text-zinc-500">{props.label}</div>
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-transparent text-lg outline-none"
          placeholder="0.0"
          value={props.amount}
          readOnly={props.readOnlyAmount}
          onChange={(e) => props.onAmountChange?.(e.target.value)}
        />
        <input
          className="w-32 rounded-md bg-zinc-800 px-2 py-1 text-sm outline-none"
          placeholder="Token"
          value={props.token}
          onChange={(e) => props.onTokenChange(e.target.value)}
        />
      </div>
    </div>
  );
}
