"use client";

import { useState } from "react";
import { getAddress } from "viem";
import { addressUrl, short, thresholdLabel, txUrl } from "@/lib/format";
import { enabledData, parseThreshold, registerData, thresholdData, validateTarget } from "@/lib/registry";
import type { ApiConfig, ApiTarget } from "@/lib/types";
import { describeError } from "@/lib/wallet";

type Hex = `0x${string}`;
type Send = (label: string, data: Hex) => Promise<void>;

const REASONS: Record<string, string> = {
  owner_cap: "this owner has reached the per-owner limit",
  total_cap: "the monitor's total address limit was reached",
  owner_not_allowed: "this owner is not on the operator's allowlist",
};
const reasonText = (r: string | null | undefined): string => (r ? (REASONS[r] ?? r) : "unknown reason");

function ThresholdEditor({ disabled, onSave }: { disabled: boolean; onSave: (raw: bigint) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [decimals, setDecimals] = useState("18");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="cs-textbtn" disabled={disabled} onClick={() => setOpen(true)}>
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
    <div className="cs-inline-form">
      <div className="cs-inline-fields">
        <input className="cs-input cs-input-sm" aria-label="New threshold in tokens" placeholder="Tokens" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="cs-input cs-input-xs" aria-label="Token decimals" value={decimals} onChange={(e) => setDecimals(e.target.value)} />
      </div>
      <div className="cs-inline-actions">
        <button className="cs-btn cs-btn-small" onClick={() => void save()}>
          Save threshold
        </button>
        <button className="cs-textbtn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="cs-error" role="alert">
          {error}
        </p>
      )}
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
    <div className="cs-register">
      <h3 className="cs-h3">Watch an address</h3>
      <label className="cs-field">
        <span>Contract or treasury address</span>
        <input className="cs-input cs-mono" placeholder="0x…" spellCheck={false} autoComplete="off" value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <div className="cs-field-row">
        <label className="cs-field cs-grow">
          <span>Alert on transfers of at least</span>
          <input className="cs-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="cs-field">
          <span>Token decimals</span>
          <input className="cs-input cs-input-xs" value={decimals} onChange={(e) => setDecimals(e.target.value)} />
        </label>
      </div>
      <p className="cs-help">
        {parsed.ok
          ? parsed.raw === 0n
            ? "0 turns large-transfer alerts off for this address. Ownership and pause events are still watched."
            : `Stored on-chain as ${parsed.raw.toString()} raw units.`
          : parsed.error}{" "}
        The threshold counts raw token units for the monitored tokens only. Decimals are used just to convert your number.
      </p>
      <div className="cs-actions">
        <button className="cs-btn" disabled={busy || blockedReason !== null} onClick={() => void submit()}>
          {busy ? "Waiting for wallet…" : "Watch this address"}
        </button>
        {blockedReason && <span className="cs-help">{blockedReason}</span>}
      </div>
      {error && (
        <p className="cs-error" role="alert">
          {error}
        </p>
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
      setActionError(describeError);
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section className="cs-aside" aria-labelledby="watch-heading">
      <div>
        <h2 id="watch-heading" className="cs-h2">
          Watched addresses
        </h2>
        <p className="cs-lede">Contracts and treasuries registered in the on-chain registry. Alerts are raised only for addresses listed here.</p>
      </div>

      {error && (
        <p className="cs-error" role="alert">
          {error}
        </p>
      )}
      {!targets && !error && <p className="cs-soft">Loading…</p>}
      {targets && targets.length === 0 && <p className="cs-soft">Nothing is watched yet. Add an address below to start.</p>}

      {targets && targets.length > 0 && (
        <ul className="cs-watchlist">
          {targets.map((t) => {
            const mine = !!account && t.owner.toLowerCase() === account.toLowerCase();
            const th = thresholdLabel(t.transferThresholdRaw);
            const busy = pendingKey !== null;
            const notMonitored = t.monitored === false;
            return (
              <li key={t.targetId} className="cs-watch">
                <div className="cs-watch-head">
                  <span className="cs-watch-id">#{t.targetId}</span>
                  {cfg ? (
                    <a className="cs-mono" href={addressUrl(cfg.explorerUrl, t.address)} target="_blank" rel="noreferrer">
                      {short(getAddress(t.address), 8, 6)}
                    </a>
                  ) : (
                    <span className="cs-mono">{short(t.address, 8, 6)}</span>
                  )}
                  {notMonitored ? (
                    <span className="cs-chip cs-chip-warn">Not monitored</span>
                  ) : (
                    <span className={`cs-chip ${t.enabled ? "cs-chip-ok" : "cs-chip-muted"}`}>{t.enabled ? "Watching" : "Stopped"}</span>
                  )}
                </div>
                {notMonitored && <p className="cs-help cs-warn-text">Not monitored: {reasonText(t.notMonitoredReason)}.</p>}
                <dl className="cs-facts">
                  <div>
                    <dt>Owner</dt>
                    <dd>
                      <span className="cs-mono">{short(getAddress(t.owner), 6, 4)}</span>
                      {mine && <span className="cs-chip cs-chip-you">You</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Large transfers</dt>
                    <dd>{th.main}</dd>
                  </div>
                  <div>
                    <dt>Alerts</dt>
                    <dd>{t.alertCount}</dd>
                  </div>
                </dl>
                <p className="cs-help">{th.sub}</p>
                <div className="cs-watch-actions">
                  {mine && !notMonitored ? (
                    <>
                      <button
                        className="cs-textbtn"
                        disabled={busy || blockedReason !== null}
                        onClick={() =>
                          void run(`en-${t.targetId}`, `${t.enabled ? "Stop watching" : "Resume watching"} #${t.targetId}`, enabledData(t.targetId, !t.enabled))
                        }
                      >
                        {pendingKey === `en-${t.targetId}` ? "Waiting for wallet…" : t.enabled ? "Stop watching" : "Resume watching"}
                      </button>
                      <ThresholdEditor
                        disabled={busy || blockedReason !== null}
                        onSave={(raw) => onSend(`Chathreshold of #${t.targetId}`, thresholdData(t.targetId, raw))}
                      />
                    </>
                  ) : (
                    <span className="cs-help">{mine ? "Not monitored, so there is nothing to change." : "Only the owner can change this address."}</span>
                  )}
                  {cfg && t.registrationTx && (
                    <a className="cs-help" href={txUrl(cfg.explorerUrl, t.registrationTx)} target="_blank" rel="noreferrer">
                      Registration transaction
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {actionError && (
        <p className="cs-error" role="alert">
          {actionError}
        </p>
      )}

      <RegisterForm blockedReason={blockedReason} onSubmit={(target, raw) => onSend(`Watch ${short(target, 8, 6)}`, registerData(target, raw))} />
    </section>
  );
}
