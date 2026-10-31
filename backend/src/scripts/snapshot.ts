import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMonitorSettings } from "../config.js";
import { ReadStore } from "../readStore.js";
import { buildSnapshot } from "../snapshot.js";

const s = loadMonitorSettings();
if (!existsSync(s.dbPath)) {
  console.error(`database not found at ${s.dbPath}; run the monitor first`);
  process.exit(1);
}
const store = new ReadStore(s.dbPath);
if (!store.ready()) {
  console.error("database is not ready; run the monitor first");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let commit: string | null = null;
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: repoRoot }).toString().trim();
} catch {
  commit = null;
}

const snap = buildSnapshot(store, {
  config: {
    network: s.network,
    isTestnet: s.network === "testnet",
    chainId: s.chain.id,
    chainName: s.chain.name,
    registryAddress: s.registryAddress,
    explorerUrl: s.chain.blockExplorers?.default.url ?? "",
    confirmations: Number(s.confirmations),
    monitoredTokens: s.monitoredTokens,
  },
  commit,
  now: Math.floor(Date.now() / 1000),
});
store.close();

const out = path.join(repoRoot, "frontend", "public", "snapshot.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snap, null, 2));

const byStatus: Record<string, number> = {};
for (const a of snap.alerts) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
console.log(`wrote ${path.relative(repoRoot, out)}`);
console.log(`network ${snap.config.chainName} | registry ${snap.config.registryAddress} | checkpoint ${snap.checkpointBlock}`);
console.log(`targets ${snap.targets.length} | alerts ${snap.alerts.length}`, byStatus);
if ((byStatus.new ?? 0) > 0) console.log(`note: ${byStatus.new} alert(s) are not published yet; run "npm run publish -- --once" and snapshot again for a complete demo`);
