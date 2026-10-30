"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, toHex } from "viem";
import { api } from "@/lib/api";
import { makeReader, type WalletRead } from "@/lib/chainRead";
import { addressUrl, fmtTime, short, txUrl } from "@/lib/format";
import type { ApiAlert, ApiAlertDetail, ApiConfig, ApiTarget } from "@/lib/types";
import { castCommands, verifyOnChain, type VerifyResult } from "@/lib/verify";

const SEV = [
  { label: "Info", cls: "bg-slate-100 text-slate-700" },
  { label: "Low", cls: "bg-sky-100 text-sky-800" },
  { label: "Medium", cls: "bg-amber-100 text-amber-800" },
  { label: "High", cls: "bg-orange-100 text-orange-800" },
  { label: "Critical", cls: "bg-red-100 text-red-800" },
];

type Tone = "ok" | "wait" | "warn" | "bad" | "muted";
const TONE: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  wait: "border-sky-200 bg-sky-50 text-sky-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  bad: "border-red-200 bg-red-50 text-red-800",
  muted: "border-slate-200 bg-slate-50 text-slate-600",
};

function auditState(a: ApiAlert, publisher: string): { tone: Tone; text: string } {
  switch (a.status) {
    case "published":
      return a.verifiedAt
        ? { tone: "ok", text: `Audit record published${a.publishBlock ? ` in block ${a.publishBlock}` : ""} and re-checked on-chain by the publisher.` }
        : { tone: "wait", text: "Audit record published. The publisher has not yet re-checked it after the required confirmations." };
    case "failed":
      return { tone: "bad", text: `No audit record: publishing failed. ${a.publishNote ?? ""}` };
    case "skipped":
      return { tone: "warn", text: `No audit record: ${a.publishNote ?? "skipped"}.` };
    case "orphaned":
      return { tone: "muted", text: "Orphaned: a chain reorganization removed the source event, so this alert is no longer valid. An audit record that was already published stays on-chain." };
    default:
      if (a.publishNote) return { tone: "warn", text: `Publish attempt ${a.publishAttempts ?? 1} failed (${a.publishNote}); it will be retried.` };
      if (publisher !== "ok") return { tone: "warn", text: "Waiting to be published, and no publisher has reported in recently." };
      return { tone: "wait", text: "Waiting to be published (the publisher polls periodically and ignores alerts below its minimum severity)." };
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="rounded border border-slate-300 px-2 py-0.5 text-[11px]"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function AlertCard({
  a, cfg, targetAddress, walletRead, publisher,
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
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { 
      alive = false; 
    };
}, [open, detail, a.alertId]);
  // Recomputed in the browser from the exact evidence text, independent of the API's own flag.
  const recomputed = useMemo(() => (detail ? keccak256(toHex(detail.evidenceJson)) : null), [detail]);
  const matches = recomputed !== null && recomputed.toLowerCase() === a.evidenceHash.toLowerCase();
  const sev = SEV[a.severity] ?? SEV[0];
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
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sev.cls}`}>{sev.label}</span>
        <span className="font-semibold">{a.title}</span>
        <span className="text-xs text-slate-500">
          target #{a.targetId}
          {targetAddress && (
            <>
              {" "}
              (<a className="font-mono text-blue-700 underline" href={addressUrl(cfg.explorerUrl, targetAddress)} target="_blank" rel="noreferrer">{short(targetAddress, 6, 4)}</a>)
            </>
          )}{" "}
          · block {a.blockNumber} · {fmtTime(a.sourceBlockTimestamp)}
        </span>
      </div>

      <dl className="mt-2 space-y-2 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">Observed on-chain (fact)</dt>
          <dd className="break-words">{a.observed}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">Why it was flagged (rule-based assessment)</dt>
          <dd>{a.assessment}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">What this does not show</dt>
          <dd className="text-slate-600">{a.caveat}</dd>
        </div>
      </dl>

      <div className={`mt-2 rounded-md border px-2 py-1.5 text-xs ${TONE[audit.tone]}`}>
        <span className="font-semibold">Audit record: </span>
        {audit.text}{" "}
        {a.publishTxHash && (
          <a className="underline" href={txUrl(cfg.explorerUrl, a.publishTxHash)} target="_blank" rel="noreferrer">
            transaction {short(a.publishTxHash, 8, 6)}
          </a>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <a className="text-blue-700 underline" href={txUrl(cfg.explorerUrl, a.sourceTxHash)} target="_blank" rel="noreferrer">
          Source transaction {short(a.sourceTxHash, 8, 6)}
        </a>
        <span>Rule {a.ruleId} v{a.ruleVersion}</span>
      </div>

      <details className="mt-2 text-xs" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-slate-700">Evidence and verification</summary>
        <div className="mt-2 space-y-3">
          <p>
            Evidence hash (keccak256): <span className="break-all font-mono">{a.evidenceHash}</span>
          </p>
          {err && <p className="text-red-700">{err}</p>}
          {!detail && !err && <p className="text-slate-500">Loading evidence…</p>}

          {detail && (
            <>
              <p className={matches ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                {matches ? "✓ The hash was recomputed in your browser and matches the evidence below." : "✗ The recomputed hash does NOT match. Do not trust this evidence."}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-[11px] text-slate-100">{detail.evidenceJson}</pre>

              <div className="space-y-2 rounded-md border border-slate-200 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-md bg-slate-900 px-3 py-1 text-white disabled:opacity-50"
                    disabled={vBusy || a.status !== "published"}
                    onClick={() => void runVerify()}
                  >
                    {vBusy ? "Reading the chain…" : "Verify on MST"}
                  </button>
                  {a.status !== "published" && <span className="text-slate-500">Only available once an audit record has been published.</span>}
                </div>
                {vErr && <p className="text-red-700">{vErr}</p>}
                {vr && (
                <div className="space-y-1">
                  <p
                    className={`font-semibold ${
                    vr.verdict === "verified" ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                  {vr.verdict === "verified"
                  ? "✓ The on-chain record matches this alert's evidence."
                  : vr.verdict === "not-found"
                  ? "✗ No record with this alert id exists on-chain."
                  : "✗ At least one check failed. Do not rely on this record."}
                  </p>
                  <ul className="space-y-0.5">
                  {vr.checks.map((c) => (
                  <li key={c.label} className={c.ok ? "text-slate-700" : "text-red-700"}>
                    {c.ok ? "✓" : "✗"} {c.label}: <span className="break-all font-mono text-[11px]">{c.detail}</span>
                  </li>
                ))}
                </ul>
                <p className="text-slate-500">Read via {vr.source}.</p>
                <p className="text-slate-500">
                  A matching record proves that it was submitted and included on-chain with this evidence hash. It does not prove that the alert itself is correct or that an attack occurred.
                </p>
              </div>
            )}
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Check it without this page</span>
                  <CopyButton text={commands} />
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 text-[11px] text-slate-800">{commands}</pre>
              </div>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

export default function AlertsPanel({
  cfg, alerts, total, error, targets, minSeverity, onMinSeverity, targetFilter, onTargetFilter,
  includeOrphaned, onIncludeOrphaned, walletRead, publisher,
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Alerts ({total})</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            Minimum severity
            <select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={minSeverity} onChange={(e) => onMinSeverity(Number(e.target.value))}>
              {SEV.map((s, i) => (
                <option key={s.label} value={i}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Target
            <select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={targetFilter ?? ""} onChange={(e) => onTargetFilter(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">All</option>
              {(targets ?? []).map((t) => (
                <option key={t.targetId} value={t.targetId}>#{t.targetId}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={includeOrphaned} onChange={(e) => onIncludeOrphaned(e.target.checked)} />
            Include orphaned
          </label>
        </div>
      </div>

      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {alerts && alerts.length === 0 && <p className="text-sm text-slate-600">No alerts match these filters.</p>}
      {cfg && alerts && (
        <ul className="space-y-3">
          {alerts.map((a) => (
            <AlertCard key={a.alertId} a={a} cfg={cfg} targetAddress={addrById.get(a.targetId)} walletRead={walletRead} publisher={publisher} />
          ))}
        </ul>
      )}
    </section>
  );
}
