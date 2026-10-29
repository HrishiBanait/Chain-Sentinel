import { createPublicClient, http, toHex, type Chain, type Hex } from "viem";

export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export interface LogFilter {
  fromBlock: bigint;
  toBlock: bigint;
  address?: Hex[];
  topics: (Hex | Hex[] | null)[];
}

export interface ChainSource {
  getChainId(): Promise<number>;
  getHeadBlock(): Promise<bigint>;
  getBlockHash(n: bigint): Promise<Hex | null>;
  getBlockTimestamp(n: bigint): Promise<number>;
  getLogs(filter: LogFilter): Promise<RawLog[]>;
}

/** True when an error means "the query was too big", not "the node is unhappy". */
export function isRangeError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  if (/rate.?limit|too many requests|429/i.test(m)) return false;
  return /range|exceed|too many (results|logs)|response size|more than \d+ (results|logs)/i.test(m);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  o: { attempts?: number; baseMs?: number; shouldRetry?: (e: unknown) => boolean; onRetry?: (e: unknown, attempt: number) => void } = {}
): Promise<T> {
  const attempts = o.attempts ?? 4;
  const base = o.baseMs ?? 500;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === attempts || (o.shouldRetry && !o.shouldRetry(e))) throw e;
      o.onRetry?.(e, i);
      await new Promise((r) => setTimeout(r, base * 2 ** (i - 1) + Math.random() * base));
    }
  }
  throw last;
}

interface RpcLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  removed?: boolean;
}

export function createViemSource(
  chain: Chain,
  rpcUrl: string,
  opts: { onRetry?: () => void; retryBaseMs?: number } = {}
): ChainSource {
  // Retries are handled by withRetry so they can be counted and can skip range errors.
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }) });
  const retry = <T>(fn: () => Promise<T>, shouldRetry?: (e: unknown) => boolean) =>
    withRetry(fn, { baseMs: opts.retryBaseMs, shouldRetry, onRetry: () => opts.onRetry?.() });

  const getBlock = (n: bigint) =>
    retry(async () => {
      const b = await client.request({ method: "eth_getBlockByNumber", params: [toHex(n), false] });
      return b as unknown as { hash: Hex; timestamp: Hex } | null;
    });

  return {
    getChainId: () => retry(() => client.getChainId()),
    getHeadBlock: () => retry(() => client.getBlockNumber()),
    async getBlockHash(n) {
      const b = await getBlock(n);
      return b ? b.hash : null;
    },
    async getBlockTimestamp(n) {
      const b = await getBlock(n);
      if (!b) throw new Error(`block ${n} not found`);
      return Number(BigInt(b.timestamp));
    },
    getLogs: (f) =>
      retry(
        async () => {
          const filter: Record<string, unknown> = { fromBlock: toHex(f.fromBlock), toBlock: toHex(f.toBlock), topics: f.topics };
          if (f.address && f.address.length > 0) filter.address = f.address;
          const raw = (await client.request({ method: "eth_getLogs", params: [filter as any] })) as unknown as RpcLog[];
          return raw
            .filter((l) => !l.removed)
            .map((l) => ({
              address: l.address.toLowerCase() as Hex,
              topics: l.topics,
              data: l.data,
              blockNumber: BigInt(l.blockNumber),
              blockHash: l.blockHash,
              transactionHash: l.transactionHash,
              logIndex: Number(BigInt(l.logIndex)),
            }));
        },
        (e) => !isRangeError(e)
      ),
  };
}
