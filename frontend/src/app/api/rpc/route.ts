// A narrow read-only JSON-RPC proxy so browsers need no CORS access to the MST node.
// It forwards only four methods, eth_call only to the registry contract, to one fixed upstream.
const UPSTREAM = process.env.MST_RPC_URL ?? "https://testnetrpc.mstblockchain.com";
const CHAIN_ID = Number(process.env.MST_CHAIN_ID ?? "91562037");
const REGISTRY = (process.env.MST_REGISTRY_ADDRESS ?? "0xC9f3D85De752a4112c6399c2bB6eb7f06697d945").toLowerCase();
const ALLOWED = new Set(["eth_chainId", "eth_blockNumber", "eth_call", "eth_getTransactionReceipt"]);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x[0-9a-fA-F]*$/;
const BLOCK_TAG = /^(latest|0x[0-9a-fA-F]{1,16})$/;

const fail = (status: number, message: string): Response => Response.json({ error: { message } }, { status });

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > 4096) return fail(413, "request too large");

  let body: { chainId?: unknown; method?: unknown; params?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "invalid JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return fail(400, "invalid request");
  if (body.chainId !== CHAIN_ID) return fail(400, `this site proxies chain ${CHAIN_ID} only`);

  const { method, params } = body;
  if (typeof method !== "string" || !ALLOWED.has(method)) return fail(403, "method not allowed");
  if (!Array.isArray(params)) return fail(400, "params must be an array");

  let forward: unknown[] = [];
  if (method === "eth_call") {
    const tx = params[0] as { to?: unknown; data?: unknown } | null;
    const tag = params[1];
    if (typeof tx?.to !== "string" || tx.to.toLowerCase() !== REGISTRY) return fail(403, "eth_call is only allowed to the registry contract");
    if (typeof tx.data !== "string" || !HEX.test(tx.data) || tx.data.length > 2048) return fail(400, "invalid call data");
    if (typeof tag !== "string" || !BLOCK_TAG.test(tag)) return fail(400, "invalid block tag");
    forward = [{ to: tx.to, data: tx.data }, tag];
  } else if (method === "eth_getTransactionReceipt") {
    if (typeof params[0] !== "string" || !HASH.test(params[0])) return fail(400, "invalid transaction hash");
    forward = [params[0]];
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: forward }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    return fail(502, "upstream RPC unreachable");
  }
  if (!upstream.ok) return fail(502, `upstream RPC returned HTTP ${upstream.status}`);

  const payload = (await upstream.json().catch(() => null)) as { result?: unknown; error?: { message?: string } } | null;
  if (!payload) return fail(502, "upstream RPC returned an unreadable response");
  if (payload.error) return Response.json({ error: { message: payload.error.message ?? "RPC error" } });
  return Response.json({ result: payload.result });
}
