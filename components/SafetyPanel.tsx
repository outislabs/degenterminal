// SafetyPanel: gates trade execution behind a safety scan.
// Renders both the structured flag grid and the AI-generated explainer.
// AI failure falls through to flags-only — safety is never blocked on the LLM.

import { useEffect, useState } from "react";
import { runSafetyScan } from "@/lib/safety"; // calls safety-explain edge fn

interface SafetyPanelProps {
  tokenAddress: string;
  chain: "sol" | "bnb";
  onBlockingChange?: (blocking: boolean) => void;
}

interface ScanResult {
  flags: {
    isHoneypot: boolean | null;
    mintAuthorityActive: boolean | null;
    freezeAuthorityActive: boolean | null;
    lpLocked: boolean | null;
    buyTax: number | null;
    sellTax: number | null;
    blocking: boolean;
    blockingReasons: string[];
  };
  aiSummary: string | null;
  scannedAt: string;
}

export function SafetyPanel({
  tokenAddress,
  chain,
  onBlockingChange,
}: SafetyPanelProps) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    runSafetyScan({ tokenAddress, chain })
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          onBlockingChange?.(r.flags.blocking);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tokenAddress, chain, onBlockingChange]);

  if (loading) {
    return <div className="text-xs text-zinc-500">Scanning…</div>;
  }

  if (error || !result) {
    return (
      <div className="rounded-xl border border-amber-900 bg-amber-950/40 p-3 text-xs text-amber-300">
        Safety scan unavailable. Trade with caution.
      </div>
    );
  }

  const f = result.flags;

  return (
    <div className="space-y-3">
      {f.blocking && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-3">
          <div className="text-sm font-medium text-red-300">Trade blocked</div>
          <div className="text-xs text-red-400 mt-1">
            {f.blockingReasons.join(" · ")}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Flag label="Honeypot" value={f.isHoneypot} dangerous={true} />
        <Flag label="LP locked" value={f.lpLocked} dangerous={false} />
        {chain === "sol" && (
          <>
            <Flag
              label="Mint authority"
              value={f.mintAuthorityActive}
              dangerous={true}
            />
            <Flag
              label="Freeze authority"
              value={f.freezeAuthorityActive}
              dangerous={true}
            />
          </>
        )}
        <NumericFlag
          label="Buy tax"
          value={f.buyTax}
          warnAt={5}
          dangerAt={15}
        />
        <NumericFlag
          label="Sell tax"
          value={f.sellTax}
          warnAt={5}
          dangerAt={15}
        />
      </div>

      {result.aiSummary && (
        <div className="rounded-xl bg-zinc-900 p-3 text-xs text-zinc-300 leading-relaxed">
          {result.aiSummary}
        </div>
      )}
    </div>
  );
}

function Flag(props: {
  label: string;
  value: boolean | null;
  dangerous: boolean;
}) {
  // dangerous=true means a `true` value is bad (e.g., honeypot).
  // dangerous=false means a `true` value is good (e.g., LP locked).
  const tone = props.value === null
    ? "text-zinc-500"
    : (props.value === props.dangerous ? "text-red-400" : "text-emerald-400");

  return (
    <div className="rounded-md bg-zinc-900 px-3 py-2">
      <div className="text-[10px] text-zinc-500">{props.label}</div>
      <div className={`text-sm ${tone}`}>
        {props.value === null ? "—" : props.value ? "Yes" : "No"}
      </div>
    </div>
  );
}

function NumericFlag(props: {
  label: string;
  value: number | null;
  warnAt: number;
  dangerAt: number;
}) {
  const tone = props.value === null
    ? "text-zinc-500"
    : props.value >= props.dangerAt
    ? "text-red-400"
    : props.value >= props.warnAt
    ? "text-amber-400"
    : "text-emerald-400";

  return (
    <div className="rounded-md bg-zinc-900 px-3 py-2">
      <div className="text-[10px] text-zinc-500">{props.label}</div>
      <div className={`text-sm ${tone}`}>
        {props.value === null ? "—" : `${props.value.toFixed(1)}%`}
      </div>
    </div>
  );
}
