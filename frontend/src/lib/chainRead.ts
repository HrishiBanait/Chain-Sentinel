import { CHAINS } from "./chains";
import type { Eip1193Provider } from "./wallet";

export interface WalletRead {
  provider: Eip1193Provider | null;
  chainId: number | null;
}

export class ReadUnavailable extends Error {}

export interface Reader {
  call(method: string, params: unknown[]): Promise<unknown>;
  /** Which path answered the last call, for display. */
  source(): string | null;
}

// Remember per RPC URL that the browser cannot call it directly (e.g. CORS), so we do not retry every call.
const directBlocked = new Set<string>();

async function rpcFetch(url: string, method: string, params: unknown[]): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
  } catch {
    throw new ReadUnavailable("the browser could not call the MST RPC directly (probably blocked by CORS)");
  }
  if (!res.ok) throw new Error(`RPC returned HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}

export function makeReader(chainId: number, wallet: WalletRead): Reader {
  const chain = CHAINS[chainId];
  let used: string | null = null;
  return {
    source: () => used,
    async call(method, params) {
      if (chain && !directBlocked.has(chain.rpcUrl)) {
        try {
          const r = await rpcFetch(chain.rpcUrl, method, params);
          used = "the public MST RPC, called directly from your browser";
          return r;
        } catch (e) {
          if (!(e instanceof ReadUnavailable)) throw e;
          directBlocked.add(chain.rpcUrl);
        }
      }
      if (wallet.provider && wallet.chainId === chainId) {
        const r = await wallet.provider.request({ method, params });
        used = "your connected wallet's RPC connection";
        return r;
      }
      throw new ReadUnavailable(
        "The browser cannot reach the MST RPC directly and no wallet on the right network is connected. Connect your wallet on the right network, or run the cast commands shown below."
      );
    },
  };
}
