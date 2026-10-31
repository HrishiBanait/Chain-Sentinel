import { addressUrl, fmtTime, short } from "@/lib/format";
import type { ApiConfig, ApiHealth } from "@/lib/types";

export default function StatusBar({
  cfg,
  health,
  apiError,
}: {
  cfg: ApiConfig | null;
  health: ApiHealth | null;
  apiError: string | null;
}) {
  const m = health?.monitor;
  const snapshot = m?.status === "snapshot";
  const status = m?.status ?? "unknown";
  const pill = snapshot
    ? "bg-sky-100 text-sky-800"
    : status === "ok"
      ? "bg-emerald-100 text-emerald-800"
      : status === "stale"
        ? "bg-red-100 text-red-800"
        : "bg-slate-200 text-slate-700";
  const label = snapshot
    ? `Demo snapshot · ${fmtTime(m?.snapshotAt)}`
    : status === "ok"
      ? "Monitor running"
      : status === "stale"
        ? "Monitor stale"
        : "Monitor status unknown";

  const pub = snapshot ? undefined : health?.publisher;
  const pubPill =
    pub?.status === "ok" ? "bg-emerald-100 text-emerald-800" : pub?.status === "stale" ? "bg-red-100 text-red-800" : "bg-slate-200 text-slate-700";
  const pubLabel = pub?.status === "ok" ? "Publisher running" : pub?.status === "stale" ? "Publisher stale" : "Publisher not seen";

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ChainSentinel</h1>
          <p className="text-sm text-slate-600">Explainable, verifiable on-chain risk monitoring on MST Blockchain</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cfg && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                cfg.isTestnet ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"              }`}
            >
              {cfg.isTestnet ? "TESTNET" : "MAINNET"} · {cfg.chainName}
            </span>
          )}
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pill}`}>{label}</span>
          {pub && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pubPill}`}>
              {pubLabel}
              {pub.backlog > 0 ? ` · ${pub.backlog} waiting` : ""}
            </span>
          )}
        </div>
      </div>

      {apiError && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{apiError}</div>}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
        {cfg && (
          <span>
            Registry:{" "}
            <a className="font-mono text-blue-700 underline" href={addressUrl(cfg.explorerUrl, cfg.registryAddress)} target="_blank" rel="noreferrer">
              {short(cfg.registryAddress, 8, 6)}
            </a>
          </span>
        )}
        {!snapshot && m?.headBlock != null && <span>Chain head: {m.headBlock}</span>}
        {m?.checkpointBlock != null && (
          <span>
            {snapshot ? "Snapshot taken at monitor checkpoint " : "Monitor checkpoint: "}
            {m.checkpointBlock}
            {!snapshot && m.blocksBehindHead != null && ` (${m.blocksBehindHead} blocks behind head; about ${m.confirmations ?? "N"} is normal)`}
          </span>
        )}
        {health?.counts && (
          <span>
            {health.counts.targets} targets · {health.counts.alerts} alerts · {health.counts.events} events observed
          </span>
        )}
      </div>
    </header>
  );
}
