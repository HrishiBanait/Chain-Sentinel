"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, toHex } from "viem";
import { api } from "@/lib/api";
import { addressUrl, fmtTime, short, txUrl } from "@/lib/format";
import type { ApiAlert, ApiAlertDetail, ApiConfig, ApiTarget } from "@/lib/types";

const SEV = [
  { label: "Info", cls: "bg-slate-100 text-slate-700" },
  { label: "Low", cls: "bg-sky-100 text-sky-800" },
  { label: "Medium", cls: "bg-amber-100 text-amber-800" },
  { label: "High", cls: "bg-orange-100 text-orange-800" },
  { label: "Critical", cls: "bg-red-100 text-red-800" },
];

function AlertCard({ a, cfg, targetAddress }: { a: ApiAlert; cfg: ApiConfig; targetAddress: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ApiAlertDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || detail) return;
    let alive = true;
    api
      .alert(a.alertId)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [open, detail, a.alertId]);

  // Recomputed in the browser from the exact evidence text, independent of the API's own flag.
  const recomputed = useMemo(() => (detail ? keccak256(toHex(detail.evidenceJson)) : null), [detail]);
  const matches =
    recomputed !== null &&
    recomputed.toLowerCase() === a.evidenceHash.toLowerCase();

  const sev = SEV[a.severity] ?? SEV[0];

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

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <a className="text-blue-700 underline" href={txUrl(cfg.explorerUrl, a.sourceTxHash)} target="_blank" rel="noreferrer">
          Source transaction {short(a.sourceTxHash, 8, 6)}
        </a>
        {a.publishTxHash ? (
          <a className="text-blue-700 underline" href={txUrl(cfg.explorerUrl, a.publishTxHash)} target="_blank" rel="noreferrer">
            Audit record on MST {short(a.publishTxHash, 8, 6)}
          </a>
        ) : (
          <span className="text-slate-500">Audit record: not published on-chain yet</span>
        )}
        <span className="text-slate-500">Rule {a.ruleId} v{a.ruleVersion}</span>
      </div>

      <details className="mt-2 text-xs" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-slate-700">Evidence and verification</summary>
        <div className="mt-2 space-y-2">
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
              <p className="text-slate-500">This is the exact text that was hashed. The same check works with <span className="font-mono">cast keccak</span>.</p>
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
}) {
  const addrById = new Map(
    (targets ?? []).map((t) => [t.targetId, t.address])
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Alerts ({total})
        </h2>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            Minimum severity
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
              value={minSeverity}
              onChange={(e) => onMinSeverity(Number(e.target.value))}
            >
              {SEV.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1">
            Target
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
              value={targetFilter ?? ""}
              onChange={(e) =>
                onTargetFilter(
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
            >
              <option value="">All</option>
              {(targets ?? []).map((t) => (
                <option key={t.targetId} value={t.targetId}>
                  #{t.targetId}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <p className="mb-2 text-sm text-red-700">{error}</p>
      )}

      {alerts && alerts.length === 0 && (
        <p className="text-sm text-slate-600">
          No alerts match these filters.
        </p>
      )}

      {cfg && alerts && (
        <ul className="space-y-3">
          {alerts.map((a) => (
            <AlertCard
              key={a.alertId}
              a={a}
              cfg={cfg}
              targetAddress={addrById.get(a.targetId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
