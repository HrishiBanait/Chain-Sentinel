import { loadMonitorSettings } from "../config.js";
import { FatalPublisherError, Publisher } from "../publisher.js";
import { loadPublisherSettings } from "../publisherConfig.js";
import { PublisherStore } from "../publisherStore.js";
import { openReporter } from "../reporterSetup.js";

const once = process.argv.includes("--once");
const s = loadMonitorSettings();
const ps = loadPublisherSettings(s.network);
const r = await openReporter(s, ps);

if (!(await r.isReporter(r.account.address))) {
  console.error(`FATAL: ${r.account.address} is not an authorized reporter on ${s.registryAddress}`);
  process.exit(2);
}

const store = new PublisherStore(s.dbPath);
store.setMeta("publisher_min_severity", String(ps.minSeverity));
const publisher = new Publisher(
  store,
  r.adapter,
  {
    minSeverity: ps.minSeverity,
    confirmations: s.confirmations,
    maxAttempts: ps.maxAttempts,
    pendingGraceSecs: ps.pendingGraceSecs,
    backoffBaseSecs: ps.backoffBaseSecs,
    maxPerRun: ps.maxPerRun,
  },
  (m) => console.log(m)
);

console.log(`ChainSentinel publisher | ${s.chain.name} | registry ${s.registryAddress} | reporter ${r.account.address} | fee mode ${ps.feeMode} | min severity ${ps.minSeverity}`);
console.log("run a single publisher instance per registry and reporter account");

let stop = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stop = true; console.log(`\n${sig}: stopping after the current run`); });

do {
  try {
    const sum = await publisher.runOnce();
    store.setMeta("publisher_last_run_at", String(Math.floor(Date.now() / 1000)));
    const active = Object.values(sum).some((v) => v > 0);
    if (active || once) console.log("publish run:", JSON.stringify(sum));
  } catch (e) {
    if (e instanceof FatalPublisherError) {
      console.error(`FATAL: ${e.message}`);
      process.exit(2);
    }
    store.setMeta("publisher_last_error_at", String(Math.floor(Date.now() / 1000)));
    console.error(`publish run error (state is consistent, will retry): ${(e as Error).message}`);
  }
  if (once || stop) break;
  await new Promise((res) => setTimeout(res, ps.pollIntervalMs));
} while (!stop);

store.close();
