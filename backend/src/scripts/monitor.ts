import { createViemSource } from "../chainSource.js";
import { loadMonitorSettings } from "../config.js";
import { Store } from "../db.js";
import { Monitor } from "../monitor.js";

const once = process.argv.includes("--once");
const s = loadMonitorSettings();
const store = new Store(s.dbPath);
store.bindIdentity(s.chain.id, s.registryAddress);

const source = createViemSource(s.chain, s.chain.rpcUrls.default.http[0], { onRetry: () => store.incr("rpc_retries") });
const monitor = new Monitor(store, source, {
  chainId: s.chain.id,
  registryAddress: s.registryAddress,
  startBlock: s.startBlock,
  confirmations: s.confirmations,
  batchSize: s.batchSize,
  monitoredTokens: s.monitoredTokens,
});

console.log(
  `ChainSentinel monitor | ${s.chain.name} | registry ${s.registryAddress} | confirmations ${s.confirmations} | ` +
    `tokens monitored: ${s.monitoredTokens.length} | db ${s.dbPath}`
);
if (s.monitoredTokens.length === 0) console.log("note: MONITOR_TOKENS is empty, so the large-transfer rule is inactive");

let stop = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stop = true; console.log(`\n${sig}: stopping after the current batch`); });

do {
  try {
    const r = await monitor.syncOnce();
    console.log(`head ${r.head} | safe ${r.safeHead} | checkpoint ${r.checkpoint} | +${r.events} events, +${r.alerts} alerts${r.reorg ? " | REORG HANDLED" : ""}`);
  } catch (e) {
    store.incr("sync_errors");
    console.error(`sync error (state is consistent, will retry): ${(e as Error).message}`);
  }
  if (once || stop) break;
  await new Promise((r) => setTimeout(r, s.pollIntervalMs));
} while (!stop);
