"use client";

import { CHAINS } from "@/lib/chains";
import { short } from "@/lib/format";
import type { ApiConfig } from "@/lib/types";
import { BRIDGEKEY_RDNS, type WalletApi } from "@/lib/wallet";
import { getAddress } from "viem";

export default function WalletPanel({ wallet, cfg }: { wallet: WalletApi; cfg: ApiConfig | null }) {
  const hasBridgeKey = wallet.wallets.some((w) => w.info.rdns === BRIDGEKEY_RDNS);
  const chainName = wallet.chainId === null ? "unknown" : (CHAINS[wallet.chainId]?.name ?? `chain ${wallet.chainId}`);
  const wrongChain = !!cfg && !!wallet.account && wallet.chainId !== null && wallet.chainId !== cfg.chainId;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Wallet</h2>

      {wallet.wallets.length === 0 ? (
        <p className="text-sm text-slate-700">
          No wallet detected. Install{" "}
          <a className="text-blue-700 underline" href="https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg" target="_blank" rel="noreferrer">
            BridgeKey
          </a>{" "}
          (<a className="text-blue-700 underline" href="https://bridgekey.io" target="_blank" rel="noreferrer">bridgekey.io</a>) and reload this page.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-600">Wallet</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
              value={wallet.activeRdns ?? ""}
              onChange={(e) => wallet.selectWallet(e.target.value || null)}
            >
              {!wallet.activeRdns && <option value="">Choose…</option>}
              {wallet.wallets.map((w) => (
                <option key={w.info.rdns} value={w.info.rdns}>
                  {w.info.name}
                  {w.info.rdns === BRIDGEKEY_RDNS ? " (recommended)" : ""}
                </option>
              ))}
            </select>
          </label>

          {!hasBridgeKey && <span className="text-amber-700">BridgeKey was not detected; another wallet is selected.</span>}

          {wallet.account ? (
            <>
              <span className="font-mono text-xs" title={getAddress(wallet.account)}>
                {short(getAddress(wallet.account), 8, 6)}
              </span>
              <span className="text-slate-600">on {chainName}</span>
            </>
          ) : (
            <button
              className="rounded-md bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50"
              disabled={!wallet.provider || wallet.busy}
              onClick={() => void wallet.connect()}
            >
              {wallet.busy ? "Waiting for wallet…" : "Connect"}
            </button>
          )}
        </div>
      )}

      {wrongChain && cfg && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            Your wallet is on {chainName}, but this dashboard monitors {cfg.chainName}.
          </span>
          <button
            className="rounded-md bg-amber-600 px-3 py-1 text-white disabled:opacity-50"
            disabled={wallet.busy}
            onClick={() => void wallet.switchChain(cfg.chainId)}
          >
            Switch to {cfg.chainName}
          </button>
        </div>
      )}

      {wallet.error && <p className="mt-3 text-sm text-red-700">{wallet.error}</p>}
    </section>
  );
}
