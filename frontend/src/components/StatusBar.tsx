import { addressUrl, fmtTime, short } from "@/lib/format";
import type { ApiConfig, ApiHealth } from "@/lib/types";

function BeaconMark() {
  return (
    <svg className="cs-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 3.5v2.4M7.4 7.2l1.7 1.6M24.6 7.2l-1.7 1.6" stroke="#f2b33d" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="12.6" y="9" width="6.8" height="6" rx="1.4" fill="#f2b33d" />
      <path
         d="M13.9 15.6 12.6 27h6.8l-1.3-11.4M10.4 27h11.2"
         stroke="#eef1ed"
         strokeWidth="1.8"
         strokeLinecap="round"
          strokeLinejoin="round"
        />
    </svg>
  );
}

type Tone = "ok" | "bad" | "idle";

function StatusPill({ tone, live, children }: { tone: Tone; live?: boolean; children: React.ReactNode }) {
  return (
    <span className="cs-pill cs-pill-dark">
      <span className={`cs-dot${tone === "ok" ? " cs-dot-ok" : tone === "bad" ? " cs-dot-bad" : ""}${live ? " cs-dot-live" : ""}`} aria-hidden="true" />
      {children}
    </span>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
  const monitorTone: Tone = status === "ok" ? "ok" : status === "stale" ? "bad" : "idle";
  const monitorLabel = snapshot
    ? `Demo snapshot from ${fmtTime(m?.snapshotAt)}`
    : status === "ok"
      ? "Monitor running"
      : status === "stale"
        ? "Monitor not reporting"
        : "Monitor status unknown";

  const pub = snapshot ? undefined : health?.publisher;
  const pubTone: Tone = pub?.status === "ok" ? "ok" : pub?.status === "stale" ? "bad" : "idle";
  const pubLabel =
    (pub?.status === "ok" ? "Publisher running" : pub?.status === "stale" ? "Publisher not reporting" : "Publisher not seen") +
    (pub && pub.backlog > 0 ? `, ${pub.backlog} waiting` : "");

  return (
    <header className="cs-masthead cs-on-dark">
      <div className="cs-wrap">
        <div className="cs-masthead-top">
          <div className="cs-brand">
            <BeaconMark />
            <h1 className="cs-wordmark">ChainSentinel</h1>
          </div>
          <div className="cs-badges">
            {cfg && <span className={`cs-pill ${cfg.isTestnet ? "cs-pill-lantern" : "cs-pill-danger"}`}>{cfg.chainName}</span>}
            <StatusPill tone={monitorTone} live={status === "ok"}>
              {monitorLabel}
            </StatusPill>
            {pub && <StatusPill tone={pubTone}>{pubLabel}</StatusPill>}
          </div>
        </div>

        <p className="cs-tagline">Watch contracts and treasuries on MST. Every alert explains itself and links to evidence that anyone can verify.</p>

        {apiError && <div className="cs-notice cs-notice-bad">{apiError}</div>}

        <div className="cs-statusline">
          {cfg && (
            <span>
              Registry{" "}
              <a className="cs-mono" href={addressUrl(cfg.explorerUrl, cfg.registryAddress)} target="_blank" rel="noreferrer">
                {short(cfg.registryAddress, 8, 6)}
              </a>
            </span>
          )}
          {!snapshot && m?.headBlock != null && <span>Chain at block {m.headBlock}</span>}
          {m?.checkpointBlock != null && (
            <span>
              {snapshot
                ? `Snapshot taken at block ${m.checkpointBlock}`
                : `Monitor at block ${m.checkpointBlock}${
                    m.blocksBehindHead != null ? `, ${m.blocksBehindHead} behind the chain (about ${m.confirmations ?? "N"} is normal)` : ""
                  }`}
            </span>
          )}
          {health?.counts && (
            <span>
              Watching {plural(health.counts.targets, "address", "addresses")}. {plural(health.counts.alerts, "alert", "alerts")} from{" "}
              {plural(health.counts.events, "event", "events")}.
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
