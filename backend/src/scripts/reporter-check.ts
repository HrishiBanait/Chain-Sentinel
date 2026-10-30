import { formatEther, formatGwei } from "viem";
import { loadMonitorSettings } from "../config.js";
import { loadPublisherSettings } from "../publisherConfig.js";
import { PublisherStore } from "../publisherStore.js";
import { openReporter } from "../reporterSetup.js";

const s = loadMonitorSettings();
const ps = loadPublisherSettings(s.network);
const r = await openReporter(s, ps);

console.log(`reporter address : ${r.account.address}${ps.expectedAddress ? " (matches the configured reporter)" : ""}`);
console.log(`chain id         : ${await r.getChainId()} (expected ${s.chain.id})`);
console.log(`balance          : ${formatEther(await r.getBalance(r.account.address))} ${s.chain.nativeCurrency.symbol}`);
console.log(`authorized       : ${await r.isReporter(r.account.address)}`);

const q = await r.feeQuote();
console.log(
  "gasPrice" in q
    ? `fees (legacy)    : gasPrice ${formatGwei(q.gasPrice ?? 0n)} gwei`
    : `fees (auto)      : maxFee ${formatGwei(q.maxFeePerGas)} gwei, tip ${formatGwei(q.maxPriorityFeePerGas)} gwei`
);

const store = new PublisherStore(s.dbPath);
const waiting = store.candidates(ps.minSeverity, 1000);
console.log(`to publish       : ${waiting.length} alert(s) with severity >= ${ps.minSeverity}`);
if (waiting.length > 0) {
  const c = waiting[0];
  try {
    await r.adapter.simulate({ alertId: c.alertId, targetId: BigInt(c.targetId), evidenceHash: c.evidenceHash, severity: c.severity });
    console.log("simulation       : the oldest alert would be accepted (no transaction was sent)");
  } catch (e) {
    console.log(`simulation       : would revert -> ${(e as Error).message}`);
  }
}
console.log("alert statuses   :", store.statusCounts());
store.close();
