import { CHAINS } from "./chains";
import { directCall, proxyCall, RpcUnavailable, useProxy } from "./rpc";
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

/** Order of preference: this site's proxy (hosted deployments), the public RPC from the browser, then the wallet. */
export function makeReader(chainId: number, wallet: WalletRead): Reader {
  const chain = CHAINS[chainId];
  let used: string | null = null;
  return {
    source: () => used,
    async call(method, params) {
      if (useProxy()) {
        try {
          const r = await proxyCall(chainId, method, params);
          used = "this site's RPC proxy to the MST node";
          return r;
        } catch (e) {
          if (!(e instanceof RpcUnavailable)) throw e;
        }
      }
      if (chain && !directBlocked.has(chain.rpcUrl)) {
        try {
          const r = await directCall(chain.rpcUrl, method, params);
          used = "the public MST RPC, called directly from your browser";
          return r;
        } catch (e) {
          if (!(e instanceof RpcUnavailable)) throw e;
          directBlocked.add(chain.rpcUrl);
        }
      }
      if (wallet.provider && wallet.chainId === chainId) {
        const r = await wallet.provider.request({ method, params });
        used = "your connected wallet's RPC connection";
        return r;
      }
      throw new ReadUnavailable(
        "The chain could not be read: no RPC path is available. Connect your wallet on the right network, or run the cast commands shown below."
      );
    },
  };
}
