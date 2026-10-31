"use client";

import { getAddress } from "viem";
import { CHAINS } from "@/lib/chains";
import { short } from "@/lib/format";
import type { ApiConfig } from "@/lib/types";
import { BRIDGEKEY_RDNS, type WalletApi } from "@/lib/wallet";

export default function WalletPanel({ wallet, cfg }: { wallet: WalletApi; cfg: ApiConfig | null }) {
  const hasBridgeKey = wallet.wallets.some((w) => w.info.rdns === BRIDGEKEY_RDNS);
  const activeName = wallet.wallets.find((w) => w.info.rdns === wallet.activeRdns)?.info.name;
  const chainName = wallet.chainId === null ? "unknown network" : (CHAINS[wallet.chainId]?.name ?? `chain ${wallet.chainId}`);
  const wrongChain = !!cfg && !!wallet.account && wallet.chainId !== null && wallet.chainId !== cfg.chainId;

  return (
    <section className="cs-walletbar" aria-label="Wallet">
      {wallet.wallets.length === 0 ? (
        <p className="cs-soft">
          No wallet found. Install{" "}
          <a href="https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg" target="_blank" rel="noreferrer">
            BridgeKey
          </a>{" "}
          (<a href="https://bridgekey.io" target="_blank" rel="noreferrer">bridgekey.io</a>) and reload this page to watch addresses and sign transactions.
        </p>
      ) : (
        <>
          <label className="cs-inline-label">
            Wallet
            <select className="cs-select" value={wallet.activeRdns ?? ""} onChange={(e) => wallet.selectWallet(e.target.value || null)}>
              {!wallet.activeRdns && <option value="">Choose a wallet</option>}
              {wallet.wallets.map((w) => (
                <option key={w.info.rdns} value={w.info.rdns}>
                  {w.info.name}
                  {w.info.rdns === BRIDGEKEY_RDNS ? " (recommended)" : ""}
                </option>
              ))}
            </select>
          </label>

          {!hasBridgeKey && <span className="cs-warn-text">BridgeKey was not detected, so another wallet is selected.</span>}

          {wallet.account ? (
            <span className="cs-account">
              <span className="cs-mono" title={getAddress(wallet.account)}>
                {short(getAddress(wallet.account), 8, 6)}
              </span>
              <span className="cs-soft">on {chainName}</span>
            </span>
          ) : (
            <button className="cs-btn" disabled={!wallet.provider || wallet.busy} onClick={() => void wallet.connect()}>
              {wallet.busy ? "Waiting for wallet…" : `Connect ${activeName ?? "wallet"}`}
            </button>
          )}
        </>
      )}

      {wrongChain && cfg && (
        <div className="cs-notice cs-notice-warn">
          <span>
            Your wallet is on {chainName}, but this dashboard watches {cfg.chainName}.
          </span>
          <button className="cs-btn cs-btn-small cs-btn-warn" disabled={wallet.busy} onClick={() => void wallet.switchChain(cfg.chainId)}>
            Switch to {cfg.chainName}
          </button>
        </div>
      )}

      {wallet.error && (
        <p className="cs-error" role="alert">
          {wallet.error}
        </p>
      )}
    </section>
  );
}
