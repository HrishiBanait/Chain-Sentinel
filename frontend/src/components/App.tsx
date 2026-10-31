"use client";

import { useCallback, useState } from "react";
import { getAddress } from "viem";
import AlertsPanel from "@/components/AlertsPanel";
import StatusBar from "@/components/StatusBar";
import TargetsPanel from "@/components/TargetsPanel";
import TxList, { type TxRecord } from "@/components/TxList";
import WalletPanel from "@/components/WalletPanel";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/usePoll";
import { useWallet, waitForReceipt } from "@/lib/wallet";

export default function App() {
  const cfg = usePoll(api.config, 60_000);
  const health = usePoll(api.health, 8_000);
  const targets = usePoll(api.targets, 10_000);

  const [minSeverity, setMinSeverity] = useState(0);
  const [targetFilter, setTargetFilter] = useState<number | null>(null);
  const [includeOrphaned, setIncludeOrphaned] = useState(false);
  const alertsFn = useCallback(
    () =>
      api.alerts({
        minSeverity: minSeverity > 0 ? minSeverity : undefined,
        targetId: targetFilter ?? undefined,
        includeOrphaned,
        limit: 50,
      }),
    [minSeverity, targetFilter, includeOrphaned]
  );
  const alerts = usePoll(alertsFn, 10_000);

  const wallet = useWallet();
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const c = cfg.data;

  let blockedReason: string | null = null;
  if (!c) blockedReason = "Waiting for the API configuration.";
  else if (!wallet.account) blockedReason = "Connect your wallet to send transactions.";
  else if (wallet.chainId !== c.chainId) blockedReason = `Switch your wallet to ${c.chainName}.`;

  const refreshTargets = targets.refresh;
  const sendTx = useCallback(
    async (label: string, data: `0x${string}`) => {
      const provider = wallet.provider;
      if (!c || !provider || !wallet.account) throw new Error("Connect a wallet first.");
      if (wallet.chainId !== c.chainId) throw new Error(`Switch your wallet to ${c.chainName} first.`);
      // No fee fields: the wallet chooses them (verified with BridgeKey on MST Testnet).
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: getAddress(wallet.account), to: c.registryAddress, data, value: "0x0" }],
      })) as string;
      setTxs((prev) => [{ hash, label, status: "pending" as const }, ...prev]);
      void waitForReceipt(provider, hash).then((status) => {
        setTxs((prev) => prev.map((t) => (t.hash === hash ? { ...t, status } : t)));
        if (status === "success") refreshTargets();
      });
    },
    [c, wallet.provider, wallet.account, wallet.chainId, refreshTargets]
  );

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <StatusBar cfg={c} health={health.data} apiError={cfg.error ?? health.error} />

      {c && !c.isTestnet && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <strong>MAINNET.</strong> Transactions from this page use real MSTC.
        </div>
      )}

      <WalletPanel wallet={wallet} cfg={c} />

      <TargetsPanel cfg={c} targets={targets.data} error={targets.error} account={wallet.account} blockedReason={blockedReason} onSend={sendTx} />

      <TxList txs={txs} explorerUrl={c?.explorerUrl ?? ""} confirmations={c?.confirmations ?? null} />

      <AlertsPanel
        cfg={c}
        alerts={alerts.data?.alerts ?? null}
        total={alerts.data?.total ?? 0}
        error={alerts.error}
        targets={targets.data}
        minSeverity={minSeverity}
        onMinSeverity={setMinSeverity}
        targetFilter={targetFilter}
        onTargetFilter={setTargetFilter}
        includeOrphaned={includeOrphaned}
        onIncludeOrphaned={setIncludeOrphaned}
        walletRead={{ provider: wallet.provider, chainId: wallet.chainId }}
        publisher={health.data?.publisher?.status ?? "unknown"}
      />

      <footer className="rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
        <p className="font-semibold text-slate-700">How to read this page</p>
        <p>
          &quot;Observed&quot; is a fact read from the chain. &quot;Assessment&quot; is a rule-based judgement, not a verdict: ownership changes, pauses and large transfers are often routine.
          Coverage is limited to the registered addresses, the supported event signatures and the monitored tokens, and monitoring starts when an address is registered.
          An on-chain audit record proves only that a record was submitted and included on-chain, not that the alert is correct.
        </p>
      </footer>
    </main>
  );
}
