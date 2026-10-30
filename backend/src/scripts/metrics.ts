import { existsSync } from "node:fs";
import { loadMonitorSettings } from "../config.js";
import { ScenarioDb } from "../scenarioDb.js";

const s = loadMonitorSettings();
if (!existsSync(s.dbPath)) {
  console.error(`database not found at ${s.dbPath}; run the monitor first`);
  process.exit(1);
}
const db = new ScenarioDb(s.dbPath);
const m = db.snapshot();
db.close();

const created = m.counters.alerts_created ?? 0;
const dup = m.counters.duplicate_alerts_ignored ?? 0;
const sent = m.notifyStatuses.sent ?? 0;
const failed = m.notifyStatuses.failed ?? 0;
const SEV = ["Info", "Low", "Medium", "High", "Critical"];

console.log(`== ChainSentinel metrics | ${s.chain.name} | registry ${s.registryAddress}`);
console.log(`targets monitored       : ${m.targets} (${m.enabledTargets} enabled)`);
console.log("events observed         :", m.events);
console.log("alerts by rule          :", m.alertsByRule);
console.log("alerts by severity      :", Object.fromEntries(Object.entries(m.alertsBySeverity).map(([k, v]) => [SEV[Number(k)] ?? k, v])));
console.log("alert statuses          :", m.alertStatuses);
console.log(`verified publications   : ${m.verifiedPublications}`);
console.log(`duplicate alert attempts: ${dup} of ${created + dup} (${created + dup > 0 ? ((100 * dup) / (created + dup)).toFixed(1) : "0.0"}%)`);
console.log("notifications           :", m.notifyStatuses, sent + failed > 0 ? `| delivery rate ${((100 * sent) / (sent + failed)).toFixed(1)}% of sent+failed` : "");
console.log("monitor counters        :", m.counters);
console.log("These are totals across everything this database has seen, including test runs. Per-scenario figures come from `npm run scenario`.");
