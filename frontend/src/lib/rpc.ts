export const isLocalHost = (h: string): boolean => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(h);

/** True when reads should go through this site's /api/rpc proxy (always on hosted deployments). */
export function useProxy(): boolean {
  const e = process.env.NEXT_PUBLIC_RPC_PROXY;
  if (e === "1") return true;
  if (e === "0") return false;
  return typeof window !== "undefined" && !isLocalHost(window.location.hostname);
}

/** The channel could not be used (as opposed to the chain answering with an error). */
export class RpcUnavailable extends Error {}

export async function proxyCall(chainId: number, method: string, params: unknown[]): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId, method, params }),
      cache: "no-store",
    });
  } catch {
    throw new RpcUnavailable("could not reach this site's RPC proxy");
  }
  if (res.status === 404 || res.status >= 500) throw new RpcUnavailable(`the RPC proxy is unavailable (HTTP ${res.status})`);
  const body = (await res.json().catch(() => null)) as { result?: unknown; error?: { message?: string } } | null;
  if (!body) throw new RpcUnavailable("the RPC proxy returned an unreadable response");
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}

export async function directCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
  } catch {
    throw new RpcUnavailable("the browser could not call the MST RPC directly (probably blocked by CORS)");
  }
  if (!res.ok) throw new Error(`RPC returned HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}
