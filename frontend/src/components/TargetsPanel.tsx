"use client";

import { useState } from "react";
import { getAddress } from "viem";
import { addressUrl, short, thresholdLabel, txUrl } from "@/lib/format";
import { enabledData, parseThreshold, registerData, thresholdData, validateTarget } from "@/lib/registry";
import type { ApiConfig, ApiTarget } from "@/lib/types";
import { describeError } from "@/lib/wallet";

type Hex = `0x${string}`;
type Send = (label: string, data: Hex) => Promise<void>;

function ThresholdEditor({ disabled, onSave }: { disabled: boolean; onSave: (raw: bigint) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [decimals, setDecimals] = useState("18");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="text-blue-700 underline disabled:opacity-50" disabled={disabled} onClick={() => setOpen(true)}>
        Change threshold
      </button>
    );
  }
  const save = async () => {
    const p = parseThreshold(amount, decimals);
    if (!p.ok) return setError(p.error);
    setError(null);
    try {
      await onSave(p.raw);
      setOpen(false);
      setAmount("");
    } catch (e) {
      setError(describeError(e));
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <input className="w-24 rounded border border-slate-300 px-1 py-0.5" placeholder="tokens" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="w-12 rounded border border-slate-300 px-1 py-0.5" title="token decimals" value={decimals} onChange={(e) => setDecimals(e.target.value)} />
        <button className="rounded bg-slate-900 px-2 py-0.5 text-white" onClick={() => void save()}></button>
        <button className="px-1 text-slate-600 underline" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

function RegisterForm({ blockedReason, onSubmit }: { blockedReason: string | null; onSubmit: (target: Hex, raw: bigint) => Promise<void> }) {
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("0");
  const [decimals, setDecimals] = useState("18");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseThreshold(amount, decimals);

  const submit = async () => {
    setError(null);
    const tErr = validateTarget(target);
    if (tErr) return setError(tErr);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    try {
      await onSubmit(getAddress(target.trim().toLowerCase()) as Hex, parsed.raw);
      setTarget("");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  
return (
  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <h3 className="mb-2 text-sm font-semibold">
      Register a monitored address
    </h3>

    <div className="grid gap-2 md:grid-cols-[2fr_1fr_5rem]">
      <input
        className="rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
        placeholder="Contract or treasury address (0x…)"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />

      <input
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="Large-transfer threshold (tokens)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <input
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        title="Token decimals"
        value={decimals}
        onChange={(e) => setDecimals(e.target.value)}
      />
    </div>

    <p className="mt-1 text-xs text-slate-600">
      {parsed.ok
        ? parsed.raw === BigInt(0)
          ? "Threshold 0 turns the large-transfer rule off for this address."
          : `Stored on-chain as ${parsed.raw.toString()} raw units.`
        : parsed.error}{" "}
      The threshold is a raw-unit number applied to the monitored tokens only;
      the decimals field is just for conversion.
    </p>

    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        disabled={busy || blockedReason !== null}
        onClick={() => void submit()}
      >
        {busy ? "Waiting for wallet…" : "Register with wallet"}
      </button>

      {blockedReason && (
        <span className="text-xs text-slate-600">{blockedReason}</span>
      )}
    </div>

    {error && (
      <p className="mt-2 text-sm text-red-700">{error}</p>
    )}
  </div>
);

}

export default function TargetsPanel({
  cfg,
  targets,
  error,
  account,
  blockedReason,
  onSend,
}: {
  cfg: ApiConfig | null;
  targets: ApiTarget[] | null;
  error: string | null;
  account: string | null;
  blockedReason: string | null;
  onSend: Send;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const run = async (key: string, label: string, data: Hex) => {
    setActionError(null);
    setPendingKey(key);
    try {
      await onSend(label, data);
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Monitored targets</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {targets && targets.length === 0 && <p className="text-sm text-slate-600">No targets registered yet.</p>}

      {targets && targets.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-3">ID</th>
                <th className="pr-3">Address</th>
                <th className="pr-3">Owner</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Transfer threshold</th>
                <th className="pr-3">Alerts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => {
                const mine = !!account && t.owner.toLowerCase() === account.toLowerCase();
                const th = thresholdLabel(t.transferThresholdRaw);
                const busy = pendingKey !== null;
                return (
                  <tr key={t.targetId} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3">#{t.targetId}</td>
                    <td className="pr-3 font-mono text-xs">
                      {cfg ? (
                        <a className="text-blue-700 underline" href={addressUrl(cfg.explorerUrl, t.address)} target="_blank" rel="noreferrer">
                          {short(getAddress(t.address), 8, 6)}
                        </a>
                      ) : (
                        short(t.address, 8, 6)
                      )}
                    </td>
                    <td className="pr-3 font-mono text-xs">
                      {short(getAddress(t.owner), 6, 4)}
                      {mine && <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-blue-800">YOU</span>}
                    </td>
                    <td className="pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                        {t.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="pr-3">
                      <div>{th.main}</div>
                      <div className="text-xs text-slate-500">{th.sub}</div>
                    </td>
                    <td className="pr-3">{t.alertCount}</td>
                    <td className="space-y-1">
                      {mine ? (
                        <>
                          <div>
                            <button
                              className="text-blue-700 underline disabled:opacity-50"
                              disabled={busy || blockedReason !== null}
                              onClick={() => void run(`en-${t.targetId}`, `${t.enabled ? "Disable" : "Enable"} target #${t.targetId}`, enabledData(t.targetId, !t.enabled))}
                            >
                              {pendingKey === `en-${t.targetId}` ? "Waiting for wallet…" : t.enabled ? "Disable" : "Enable"}
                            </button>
                          </div>
                          <ThresholdEditor
                            disabled={busy || blockedReason !== null}
                            onSave={(raw) => onSend(`Set threshold of target #${t.targetId}`, thresholdData(t.targetId, raw))}
                          />
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">owner only</span>
                      )}
                      {cfg && t.registrationTx && (
                        <div>
                          <a className="text-xs text-blue-700 underline" href={txUrl(cfg.explorerUrl, t.registrationTx)} target="_blank" rel="noreferrer">
                            registration tx
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {actionError && <p className="mt-2 text-sm text-red-700">{actionError}</p>}

      <RegisterForm
        blockedReason={blockedReason}
        onSubmit={(target, raw) => onSend(`Register ${short(target, 8, 6)}`, registerData(target, raw))}
      />
    </section>
  );
}
