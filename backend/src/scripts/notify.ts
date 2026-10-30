import { loadMonitorSettings } from "../config.js";
import { FatalNotifierError, Notifier } from "../notifier.js";
import { NotifierStore } from "../notifierStore.js";
import { loadNotifySettings } from "../notifyConfig.js";
import { createTelegramClient, TelegramError } from "../telegram.js";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const test = args.has("--test");
const backfill = args.has("--backfill");

const s = loadMonitorSettings();
const ns = loadNotifySettings();
const client = createTelegramClient(ns.token);

if (test) {
  try {
    const me = await client.getMe();
    await client.sendMessage({ chatId: ns.chatId, text: `✅ <b>ChainSentinel</b>: Telegram notifications are configured (${s.chain.name}).` });
    console.log(`test message sent by @${me.username ?? me.id}`);
    process.exit(0);
  } catch (e) {
    console.error(e instanceof TelegramError ? `Telegram error: ${e.description} (${e.status})` : "unexpected error while contacting Telegram");
    process.exit(1);
  }
}

const store = new NotifierStore(s.dbPath);
const notifier = new Notifier(
  store,
  client,
  {
    chatId: ns.chatId,
    minSeverity: ns.minSeverity,
    maxAgeSecs: backfill ? 0 : ns.maxAgeSecs,
    includeSkipped: backfill,
    maxAttempts: ns.maxAttempts,
    backoffBaseSecs: ns.backoffBaseSecs,
    maxPerRun: ns.maxPerRun,
    minIntervalMs: ns.minIntervalMs,
  },
  {
    networkLabel: s.chain.name,
    isTestnet: s.network === "testnet",
    explorerUrl: s.chain.blockExplorers?.default.url ?? "",
    dashboardUrl: ns.dashboardUrl,
  }
);

console.log(
  `ChainSentinel notifier | ${s.chain.name} | min severity ${ns.minSeverity} | ` +
    (backfill ? "backfill: no age limit" : `skipping events older than ${ns.maxAgeSecs}s`)
);
console.log("run a single notifier instance per chat; delivery is at-least-once");

let stop = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stop = true; console.log(`\n${sig}: stopping after the current run`); });

do {
  try {
    const sum = await notifier.runOnce();
    store.setMeta("notifier_last_run_at", String(Math.floor(Date.now() / 1000)));
    if (Object.values(sum).some((v) => v > 0) || once) console.log("notify run:", JSON.stringify(sum));
  } catch (e) {
    if (e instanceof FatalNotifierError) {
      console.error(`FATAL: ${e.message}`);
      process.exit(2);
    }
    console.error(`notify run error (state is consistent, will retry): ${(e as Error).message}`);
  }
  if (once || stop) break;
  await new Promise((r) => setTimeout(r, ns.pollIntervalMs));
} while (!stop);

store.close();
