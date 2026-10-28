import { createPublicClient, http, type Chain } from "viem";
import { mstTestnet, mstMainnet } from "../chains.js";

async function check(chain: Chain): Promise<boolean> {
  const client = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0], { timeout: 10_000, retryCount: 2 }),
  });

  try {
    const started = Date.now();
    const [reportedChainId, blockNumber] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ]);
    const ms = Date.now() - started;

    const ok = reportedChainId === chain.id;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${chain.name}\n` +
        `     expected chain ID : ${chain.id}\n` +
        `     RPC chain ID      : ${reportedChainId}\n` +
        `     latest block      : ${blockNumber}\n` +
        `     round trip        : ${ms} ms\n`
    );
    return ok;
  } catch (err) {
    console.error(`FAIL ${chain.name}: ${(err as Error).message}\n`);
    return false;
  }
}

const results = [await check(mstTestnet), await check(mstMainnet)];
process.exit(results.every(Boolean) ? 0 : 1);
