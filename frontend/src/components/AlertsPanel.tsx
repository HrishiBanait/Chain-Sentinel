"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, toHex } from "viem";
import { api } from "@/lib/api";
import { makeReader, type WalletRead } from "@/lib/chainRead";
import { addressUrl, fmtTime, short, txUrl } from "@/lib/format";
import type { ApiAlert, ApiAlertDetail, ApiConfig, ApiTarget } from "@/lib/types";
import { castCommands, verifyOnChain, type VerifyResult } from "@/lib/verify";

const SEV_LABEL = ["Info", "Low", "Medium", "High", "Critical"];
const SEV_FILTERS = [
  { value: 0, label: "All" },
  { value: 1, label: "Low and up" },
  { value: 2, label: "Medium and up" },
  { value: 3, label: "High and up" },
  { value: 4, label: "Critical" },
];

type Tone = "ok" | "wait" | "warn" | "bad" | "muted";
const TONE_CLASS: Record<Tone, string> = { ok: "cs-tone-ok", wait: "cs-tone-note", warn: "cs-tone-warn", bad: "cs-tone-bad", muted: "cs-tone-muted" };
const TONE_MARK: Record<Tone, string> = { ok: "✓", wait: "…", warn: "!", bad: "!", muted: "–" };

function auditState(a: ApiAlert, publisher: string): { tone: Tone; text: string } {
  switch (a.status) {
    case "published":
      return a.verifiedAt
        ? { tone: "ok", text: `Evidence hash recorded on MST${a.publishBlock ? ` in block ${a.publishBlock}` : ""} and re-checked on-chain by the publisher.` }
        : { tone: "wait", text: "Evidence hash recorded on MST. The publisher has not yet re-checked it after the required confirmations." };
    case "failed":
      return { tone: "bad", text: `No record was published: publishing failed. ${a.publishNote ?? ""}` };
    case "skipped":
      return { tone: "warn", text: `No record was published: ${a.publishNote ?? "skipped"}.` };
    case "orphaned":
      return { tone: "muted", text: "Orphaned: a chain reorganization removed the source event, so this alert is no longer valid. A record that was already published stays on-chain." };
    default:
      if (a.publishNote) return { tone: "warn", text: `Last publish problem: ${a.publishNote}. It will be retried.` };
      if (publisher !== "ok") return { tone: "warn", text: "Waiting to be published, and no publisher has reported in recently." };
      return { tone: "wait", text: "Waiting to be published (the publisher polls periodically and ignores alerts below its minimum severity)." };
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="cs-btn cs-btn-quiet cs-btn-small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy commands"}
    </button>
  );
}

function AlertCard({
  a,
  cfg,
  targetAddress,
  walletRead,
  publisher,
}: {
  a: ApiAlert;
  cfg: ApiConfig;
  targetAddress: string | undefined;
  walletRead: WalletRead;
  publisher: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ApiAlertDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [vr, setVr] = useState<VerifyResult | null>(null);
  const [vBusy, setVBusy] = useState(false);
  const [vErr, setVErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || detail) return;
    let alive = true;
    api
      .alert(a.alertId)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [open, detail, a.alertId]);

  // Recomputed in the browser from the exact evidence text, independent of the API's own flag.
  const recomputed = useMemo(() => (detail ? keccak256(toHex(detail.evidenceJson)) : null), [detail]);
  const matches = recomputed !== null && recomputed.toLowerCase() === a.evidenceHash.toLowerCase();
  const audit = auditState(a, publisher);

  const runVerify = async () => {
    if (!detail) return;
    setVBusy(true);
    setVErr(null);
    setVr(null);
    try {
      setVr(await verifyOnChain(makeReader(cfg.chainId, walletRead), cfg, a, detail.evidenceJson));
    } catch (e) {
      setVErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVBusy(false);
    }
  };

  const commands = castCommands(cfg, a, detail?.evidenceJson);

  return (
    <li className="cs-entry" data-sev={a.severity}>
      <div className="cs-entry-head">
        <span className="cs-sev" data-sev={a.severity}>
          {SEV_LABEL[a.severity] ?? "Info"}
        </span>      
        <h3 className="cs-entry-title">{a.title}</h3>
      </div>
      <div className="cs-entry-meta">
        <span>
          Address #{a.targetId}
          {targetAddress && (
            <>
              {" "}
              <a className="cs-mono" href={addressUrl(cfg.explorerUrl, targetAddress)} target="_blank" rel="noreferrer">
                {short(targetAddress, 6, 4)}
              </a>
            </>
          )}
        </span>
        <span>Block {a.blockNumber}</span>
        <span>{fmtTime(a.sourceBlockTimestamp)}</span>
      </div>

      <dl className="cs-reading">
        <div className="cs-row">
          <dt>What happened</dt>
          <dd>{a.observed}</dd>
        </div>
        <div className="cs-row">
          <dt>Why it was flagged</dt>
          <dd>
            {a.assessment} <span className="cs-soft">This is a rule&apos;s reading, not a verdict.</span>
          </dd>
        </div>
        <div className="cs-row">
          <dt>What this doesn&apos;t show</dt>
          <dd className="cs-soft">{a.caveat}</dd>
        </div>
      </dl>

      <div className={`cs-seal ${TONE_CLASS[audit.tone]}`}>
        <span className="cs-seal-mark" aria-hidden="true">
          {TONE_MARK[audit.tone]}
        </span>
        <p>
          <strong>Audit record.</strong> {audit.text}
          {a.publishTxHash && (
            <>
              {" "}
              <a href={txUrl(cfg.explorerUrl, a.publishTxHash)} target="_blank" rel="noreferrer">
                View transaction {short(a.publishTxHash, 8, 6)}
              </a>
            </>
          )}
        </p>
      </div>

      <p className="cs-links">
        <a href={txUrl(cfg.explorerUrl, a.sourceTxHash)} target="_blank" rel="noreferrer">
          Source transaction {short(a.sourceTxHash, 8, 6)}
        </a>
        <span>
          Rule {a.ruleId}, version {a.ruleVersion}
        </span>
      </p>

      <details className="cs-details" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Evidence and verification</summary>
        <div className="cs-evidence">
          <p>
            Evidence hash (keccak256): <span className="cs-mono cs-break">{a.evidenceHash}</span>
          </p>
          {err && <p className="cs-error">{err}</p>}
          {!detail && !err && <p className="cs-soft">Loading evidence…</p>}

          {detail && (
            <>
              <p className={matches ? "cs-verdict cs-verdict-ok" : "cs-verdict cs-verdict-bad"}>
                {matches
                  ? "✓ The hash was recomputed in your browser and matches the evidence below."
                  : "✗ The recomputed hash does NOT match. Do not trust this evidence."}
              </p>
              <pre className="cs-pre">{detail.evidenceJson}</pre>

              <div className="cs-verify">
                <div className="cs-actions">
                  <button className="cs-btn cs-btn-small" disabled={vBusy || a.status !== "published"} onClick={() => void runVerify()}>
                    {vBusy ? "Reading the chain…" : "Verify on MST"}
                  </button>
                  {a.status !== "published" && <span className="cs-soft">Available once an audit record has been published.</span>}
                </div>
                {vErr && <p className="cs-error">{vErr}</p>}
                {vr && (
                  <div className="cs-evidence">
                    <p className={`cs-verdict ${vr.verdict === "verified" ? "cs-verdict-ok" : "cs-verdict-bad"}`}>
                      {vr.verdict === "verified"
                ? "✓ The on-chain record matches this alert's evidence."
                        : vr.verdict === "not-found"
                          ? "✗ No record with this alert id exists on-chain."
                          : "✗ At least one check failed. Do not rely on this record."}
                    </p>
                    <ul className="cs-checks">
                      {vr.checks.map((c) => (
                        <li key={c.label}>
                          <span className={`cs-check-icon ${c.ok ? "cs-check-ok" : "cs-check-bad"}`} aria-hidden="true">
                            {c.ok ? "✓" : "✗"}
                          </span>
                          <span className="cs-sr">{c.ok ? "Passed: " : "Failed: "}</span>
                          <span>
                            {c.label}: <span className="cs-mono cs-break">{c.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="cs-soft">Read via {vr.source}.</p>
                    <p className="cs-soft">
                      A matching record proves that it was submitted and included on-chain with this evidence hash. It does not prove that the alert itself is correct or that an attack occurred.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <div className="cs-copyrow">
                  <span>Check it without this page</span>
                  <CopyButton text={commands} />
                </div>
                <pre className="cs-pre cs-pre-light">{commands}</pre>
              </div>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

export default function AlertsPanel({
  cfg,
  alerts,
  total,
  error,
  targets,
  minSeverity,
  onMinSeverity,
  targetFilter,
  onTargetFilter,
  includeOrphaned,
  onIncludeOrphaned,
  walletRead,
  publisher,
}: {
  cfg: ApiConfig | null;
  alerts: ApiAlert[] | null;
  total: number;
  error: string | null;
  targets: ApiTarget[] | null;
  minSeverity: number;
  onMinSeverity: (n: number) => void;
  targetFilter: number | null;
  onTargetFilter: (n: number | null) => void;
  includeOrphaned: boolean;
  onIncludeOrphaned: (v: boolean) => void;
  walletRead: WalletRead;
  publisher: string;
}) {
  const addrById = new Map((targets ?? []).map((t) => [t.targetId, t.address]));
  return (
    <section aria-labelledby="alerts-heading">
      <div className="cs-section-head">
        <div>
          <h2 id="alerts-heading" className="cs-h2">
            Alerts<span className="cs-count">{total}</span>
          </h2>
          <p className="cs-lede">Each alert separates what happened on-chain from the rule that flagged it, and links to evidence you can check yourself.</p>
        </div>
        <div className="cs-filters">
          <div className="cs-seg" role="group" aria-label="Severity filter">
            {SEV_FILTERS.map((f) => (
              <button key={f.value} aria-pressed={minSeverity === f.value} onClick={() => onMinSeverity(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="cs-inline-label">
            Address
            <select className="cs-select" value={targetFilter ?? ""} onChange={(e) => onTargetFilter(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">All addresses</option>
              {(targets ?? []).map((t) => (
                <option key={t.targetId} value={t.targetId}>
                  #{t.targetId}
                </option>
              ))}
            </select>
          </label>
          <label className="cs-check">
            <input type="checkbox" checked={includeOrphaned} onChange={(e) => onIncludeOrphaned(e.target.checked)} />
            Include orphaned
          </label>
        </div>
      </div>

      {error && (
        <p className="cs-error" role="alert">
          {error}
        </p>
      )}
      {!alerts && !error && <p className="cs-soft">Loading alerts…</p>}
      {alerts && alerts.length === 0 && <p className="cs-soft">No alerts match these filters. Lower the severity filter or choose all addresses.</p>}
      {cfg && alerts && alerts.length > 0 && (
        <ul className="cs-log">
          {alerts.map((a) => (
            <AlertCard key={a.alertId} a={a} cfg={cfg} targetAddress={addrById.get(a.targetId)} walletRead={walletRead} publisher={publisher} />
          ))}
        </ul>
      )}
    </section>
  );
}
