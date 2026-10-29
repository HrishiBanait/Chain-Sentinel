"use client";

import { useCallback, useEffect, useState } from "react";
import { CHAINS, hexChainId } from "./chains";

export const BRIDGEKEY_RDNS = "io.bridgekey.wallet";

type Listener = (...args: unknown[]) => void;

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: Listener): unknown;
  removeListener?(event: string, listener: Listener): unknown;
}

export interface DiscoveredWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

export function describeError(e: unknown): string {
  const err = e as { code?: number; message?: string } | null;
  if (err?.code === 4001) return "You rejected the request in the wallet.";
  if (err?.code === -32002) return "The wallet already has a pending request. Open the wallet popup to continue.";
  return err?.message ?? String(e);
}

function parseChain(c: unknown): number | null {
  if (typeof c === "number") return c;
  if (typeof c === "string") {
    const n = parseInt(c, c.startsWith("0x") ? 16 : 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}


export async function waitForReceipt(
  p: Eip1193Provider,
  hash: string,
  tries = 60,
  delayMs = 3000
): Promise<"success" | "failed" | "unknown"> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = (await p.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as { status?: string } | null;

      if (r) {
        return r.status === "0x1" ? "success" : "failed";
      }
    } catch {
      // Keep polling
    }

    await new Promise((res) => setTimeout(res, delayMs));
  }

  return "unknown";
}


export function useWallet() {
  const [wallets, setWallets] = useState<Record<string, DiscoveredWallet>>({});
  const [selectedRdns, setSelectedRdns] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Discover wallets via EIP-6963. The first provider seen per rdns wins, so BridgeKey's
  // repeated announcements never cause state churn. window.ethereum is deliberately not used.
  useEffect(() => {
    const onAnnounce = (ev: Event) => {
      const d = (ev as CustomEvent<DiscoveredWallet>).detail;
      if (!d?.info?.rdns || !d.provider) return;
      setWallets((prev) => (prev[d.info.rdns] ? prev : { ...prev, [d.info.rdns]: d }));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  const activeRdns = selectedRdns ?? (wallets[BRIDGEKEY_RDNS] ? BRIDGEKEY_RDNS : null);
  const provider: Eip1193Provider | null = activeRdns ? (wallets[activeRdns]?.provider ?? null) : null;

  // Subscribe to the selected wallet and restore an existing session without a popup.
  useEffect(() => {
    if (!provider) {
      setAccount(null);
      setChainId(null);
      return;
    }
    let cancelled = false;
    const onAccounts = (a: unknown) => {
      const list = Array.isArray(a) ? (a as string[]) : [];
      setAccount(list[0] ? list[0].toLowerCase() : null);
    };
    const onChain = (c: unknown) => setChainId(parseChain(c));

    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    provider.request({ method: "eth_accounts" }).then((a) => { if (!cancelled) onAccounts(a); }).catch(() => {});
    provider.request({ method: "eth_chainId" }).then((c) => { if (!cancelled) onChain(c); }).catch(() => {});

    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const a = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(a[0] ? a[0].toLowerCase() : null);
      setChainId(parseChain(await provider.request({ method: "eth_chainId" })));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [provider]);

  const switchChain = useCallback(
    async (target: number) => {
      if (!provider) return;
      const chain = CHAINS[target];
      if (!chain) {
        setError(`Unknown chain ${target}`);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId(target) }] });
        } catch (e) {
          if ((e as { code?: number })?.code === 4001) throw e;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexChainId(target),
                chainName: chain.name,
                nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
                rpcUrls: [chain.rpcUrl],
                blockExplorerUrls: [chain.explorerUrl],
              },
            ],
          });
        }
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [provider]
  );

  return {
    wallets: Object.values(wallets),
    activeRdns,
    selectWallet: setSelectedRdns,
    provider,
    account,
    chainId,
    busy,
    error,
    connect,
    switchChain,
  };
}

export type WalletApi = ReturnType<typeof useWallet>;
