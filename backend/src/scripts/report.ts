import { loadMonitorSettings } from "../config.js";
import { Store } from "../db.js";

const s = loadMonitorSettings();
const store = new Store(s.dbPath);
const SEV = ["Info", "Low", "Medium", "High", "Critical"];

console.log(`== ${s.chain.name} | registry ${s.registryAddress}`);
const cp = store.getCheckpoint();
console.log(`checkpoint: ${cp ? `block ${cp.blockNumber}` : "none"}`);

console.log("\n== targets (current configuration)");
for (const id of store.allTargetIds()) {
  const c = store.latestConfig(id, BigInt(Number.MAX_SAFE_INTEGER), 0);
  if (c) console.log(`#${id} ${c.targetAddress} enabled=${c.enabled} threshold=${c.transferThreshold} owner=${c.owner}`);
}

console.log("\n== events observed");
for (const r of store.eventCounts()) console.log(`${r.event_name.padEnd(26)} ${r.n}`);

console.log("\n== alerts");
for (const a of store.listAlerts()) {
  console.log(`[${SEV[a.severity]}] #${a.target_id} ${a.rule_id} block ${a.block_number} status=${a.status}`);
  console.log(`   observed  : ${a.observed}`);
  console.log(`   assessment: ${a.assessment}`);
  console.log(`   evidence  : ${a.evidence_hash}`);
}

console.log("\n== counters");
console.log(store.counters());

const lat = store.alertLatencies();
if (lat.length) {
  const avg = lat.reduce((x, y) => x + y, 0) / lat.length;
  console.log(`\nblock-timestamp to detection latency over ${lat.length} alerts: min ${Math.min(...lat)}s, avg ${avg.toFixed(1)}s, max ${Math.max(...lat)}s`);
  console.log("(historical alerts include catch-up time; only live-tailed alerts reflect steady-state latency)");
}
