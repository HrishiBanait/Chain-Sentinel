import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, parseAbi, parseGwei, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { loadMonitorSettings } from "../config.js";
import { decryptKeystoreFile } from "../keystore.js";
import { promptHidden } from "../reporterSetup.js";
import { Severity } from "../rules.js";
import { compare, renderReport, summarize, type ExpectedAlert, type ScenarioReport, type StepResult } from "../scenarioCore.js";
import { ScenarioDb } from "../scenarioDb.js";

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry-run");
const chaos = args.has("--chaos");
const external = args.has("--external-monitor");
const restoreOnly = args.has("--restore");

const s = loadMonitorSettings();
if (s.network !== "testnet") {
  console.error("The scenario runner only runs against MST Testnet.");
  process.exit(1);
}
if (chaos && external) {
  console.error("--chaos needs the runner to manage the monitor process; do not combine it with --external-monitor.");
  process.exit(1);
}

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}`);
    process.exit(1);
  }
  return v;
};
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nowSecs = () => Math.floor(Date.now() / 1000);
const expandHome = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p));

const TOKEN = need("MST_TESTNET_DEMO_TOKEN_ADDRESS") as Hex;
const DEPLOYER = need("MST_TESTNET_DEPLOYER_ADDRESS") as Hex;
const REPORTER = need("MST_TESTNET_REPORTER_ADDRESS") as Hex;
const TREASURY = need("MST_TESTNET_ADMIN_ADDRESS") as Hex;
const REGISTRY = s.registryAddress;
const ownerKeystore = expandHome(process.env.SCENARIO_OWNER_KEYSTORE_PATH || "~/.foundry/keystores/cs-testnet-deployer");
const reporterKeystore = expandHome(need("REPORTER_KEYSTORE_PATH"));
const gasPriceGwei = process.env.SCENARIO_GAS_PRICE_GWEI || "2";
const gasPrice = parseGwei(gasPriceGwei);

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "../..");
const repoRoot = path.resolve(backendDir, "..");
const rpc = s.chain.rpcUrls.default.http[0];
const explorer = (s.chain.blockExplorers?.default.url ?? "").replace(/\/+$/, "");
const pub = createPublicClient({ chain: s.chain, transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });

const E = 10n ** 18n;
const THRESHOLD = 1000n * E;

const tokenAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function pause()",
  "function unpause()",
  "function transferOwnership(address newOwner)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function setTargetEnabled(uint256 targetId, bool enabled)",
  "function setTransferThreshold(uint256 targetId, uint256 newThreshold)",
  "function getTarget(uint256 targetId) view returns ((address owner, address target, uint256 transferThreshold, bool enabled))",
]);

const tokenData = {
  transfer: (amount: bigint) => encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [TREASURY, amount] }),
  pause: encodeFunctionData({ abi: tokenAbi, functionName: "pause" }),
  unpause: encodeFunctionData({ abi: tokenAbi, functionName: "unpause" }),
  owner: (to: Hex) => encodeFunctionData({ abi: tokenAbi, functionName: "transferOwnership", args: [to] }),
};
const regData = {
  enabled: (id: number, v: boolean) => encodeFunctionData({ abi: registryAbi, functionName: "setTargetEnabled", args: [BigInt(id), v] }),
  threshold: (id: number, v: bigint) => encodeFunctionData({ abi: registryAbi, functionName: "setTransferThreshold", args: [BigInt(id), v] }),
};

interface Step {
  id: string;
  label: string;
  signer: "owner" | "reporter";
  to: Hex;
  data: Hex;
  expect: Omit<ExpectedAlert, "stepId" | "txHash">[];
}
const ex = (ruleId: string, targetId: number, severity: number) => ({ ruleId, targetId, severity });

// Target #1 = the treasury (threshold 1000 tokens). Target #2 = the fixture token itself.
const steps: Step[] = [
  { id: "S1", label: "transfer 999 tokens to the treasury (below the 1000 threshold)", signer: "owner", to: TOKEN, data: tokenData.transfer(999n * E), expect: [] },
  { id: "S2", label: "transfer 1000 tokens to the treasury (exactly the threshold)", signer: "owner", to: TOKEN, data: tokenData.transfer(1000n * E), expect: [ex("transfer.large", 1, Severity.Medium)] },
  { id: "S3", label: "transfer 10000 tokens to the treasury (10x the threshold)", signer: "owner", to: TOKEN, data: tokenData.transfer(10_000n * E), expect: [ex("transfer.large", 1, Severity.High)] },
  { id: "S4", label: "pause the token", signer: "owner", to: TOKEN, data: tokenData.pause, expect: [ex("pause.paused", 2, Severity.Medium)] },
  { id: "S5", label: "unpause the token", signer: "owner", to: TOKEN, data: tokenData.unpause, expect: [ex("pause.unpaused", 2, Severity.Low)] },
  { id: "S6", label: "transfer ownership to the current owner (no-op)", signer: "owner", to: TOKEN, data: tokenData.owner(DEPLOYER), expect: [] },
  { id: "S7", label: "transfer ownership to the reporter account", signer: "owner", to: TOKEN, data: tokenData.owner(REPORTER), expect: [ex("ownership.changed", 2, Severity.High)] },
  { id: "S8", label: "transfer ownership back to the deployer", signer: "reporter", to: TOKEN, data: tokenData.owner(DEPLOYER), expect: [ex("ownership.changed", 2, Severity.High)] },
  { id: "S9", label: "disable monitored target #2 in the registry", signer: "owner", to: REGISTRY, data: regData.enabled(2, false), expect: [] },
  { id: "S10", label: "pause the token while target #2 is disabled", signer: "owner", to: TOKEN, data: tokenData.pause, expect: [] },
  { id: "S11", label: "re-enable target #2", signer: "owner", to: REGISTRY, data: regData.enabled(2, true), expect: [] },
  { id: "S12", label: "unpause the token (target enabled again)", signer: "owner", to: TOKEN, data: tokenData.unpause, expect: [ex("pause.unpaused", 2, Severity.Low)] },
  { id: "S13", label: "raise target #1's threshold to 2000 tokens", signer: "owner", to: REGISTRY, data: regData.threshold(1, 2000n * E), expect: [] },
  { id: "S14", label: "transfer 1500 tokens to the treasury (below the new threshold)", signer: "owner", to: TOKEN, data: tokenData.transfer(1500n * E), expect: [] },
  { id: "S15", label: "transfer 2000 tokens to the treasury (exactly the new threshold)", signer: "owner", to: TOKEN, data: tokenData.transfer(2000n * E), expect: [ex("transfer.large", 1, Severity.Medium)] },
  { id: "S16", label: "restore target #1's threshold to 1000 tokens", signer: "owner", to: REGISTRY, data: regData.threshold(1, THRESHOLD), expect: [] },
];

async function fixtureState() {
  const [owner, paused, t1, t2, balance] = await Promise.all([
    pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "owner" }),
    pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "paused" }),
    pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getTarget", args: [1n] }),
    pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getTarget", args: [2n] }),
    pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [DEPLOYER] }),
  ]);
  return { owner, paused, t1, t2, balance };
}
type State = Awaited<ReturnType<typeof fixtureState>>;

function pristineProblems(st: State): string[] {
  const p: string[] = [];
  if (!eq(st.owner, DEPLOYER)) p.push(`token owner is ${st.owner}, expected the deployer`);
  if (st.paused) p.push("token is paused");
  if (!eq(st.t1.target, TREASURY)) p.push(`target #1 is ${st.t1.target}, expected the treasury`);
  if (!st.t1.enabled) p.push("target #1 is disabled");
  if (st.t1.transferThreshold !== THRESHOLD) p.push(`target #1 threshold is ${st.t1.transferThreshold}, expected ${THRESHOLD}`);
  if (!eq(st.t2.target, TOKEN)) p.push(`target #2 is ${st.t2.target}, expected the fixture token`);
  if (!st.t2.enabled) p.push("target #2 is disabled");
  return p;
}

function explainPlan() {
  console.log("\nPlan: 16 transactions, 8 expected alerts, 4 cases that must stay silent (S1, S6, S10, S14)");
  for (const st of steps) {
    console.log(`  ${st.id.padEnd(3)} ${st.label.padEnd(66)} -> ${st.expect.length ? st.expect.map((e) => `${e.ruleId} #${e.targetId}`).join(", ") : "no alert"}`);
  }
}

async function main(): Promise<number> {
  if (!existsSync(s.dbPath)) {
    console.error(`database not found at ${s.dbPath}. Run "npm run monitor -- --once" first.`);
    return 1;
  }
  const db = new ScenarioDb(s.dbPath);
  const fresh = (key: string, secs: number) => {
    const v = db.meta(key);
    return v !== undefined && nowSecs() - Number(v) <= secs;
  };

  // ---- preflight (read-only)
  console.log(`ChainSentinel scenario runner | ${s.chain.name} | registry ${REGISTRY} | token ${TOKEN}`);
  if ((await pub.getChainId()) !== s.chain.id) throw new Error("RPC reports a different chain id");
  const st0 = await fixtureState();
  const problems = pristineProblems(st0);
  const bal = await Promise.all([pub.getBalance({ address: DEPLOYER }), pub.getBalance({ address: REPORTER })]);
  if (bal[0] < 5n * 10n ** 17n) problems.push(`deployer balance is low (${formatEther(bal[0])})`);
  if (bal[1] < 5n * 10n ** 17n) problems.push(`reporter balance is low (${formatEther(bal[1])})`);
  if (st0.balance < 16_000n * E) problems.push(`deployer holds only ${st0.balance / E} fixture tokens; at least 16000 are needed`);
  if (!external && fresh("last_sync_at", 30)) problems.push('a monitor appears to be running; stop it (the runner starts its own) or pass --external-monitor');

  const pubRunning = fresh("publisher_last_run_at", 90);
  const notifRunning = fresh("notifier_last_run_at", 90);
  console.log(`fixture owner ${st0.owner} | paused ${st0.paused} | target #1 threshold ${st0.t1.transferThreshold / E} tokens | target #2 enabled ${st0.t2.enabled}`);
  console.log(`publisher: ${pubRunning ? "running" : "not seen (audit-record stages will not be measured)"} | notifier: ${notifRunning ? "running" : "not seen (Telegram stages will not be measured)"}`);
  if (restoreOnly) problems.length = 0; // restoring is meant to fix exactly these
  if (problems.length) {
    console.error("\nPreflight problems:\n  - " + problems.join("\n  - "));
    if (!dry) return 1;
  }
  if (dry) {
    explainPlan();
    console.log(problems.length ? "\nDry run finished WITH problems (see above)." : "\nDry run OK: nothing was sent.");
    return problems.length ? 1 : 0;
  }

  // ---- unlock keys
  const unlock = async (label: string, file: string, expected: string): Promise<PrivateKeyAccount> => {
    const acct = privateKeyToAccount(decryptKeystoreFile(file, await promptHidden(`${label} keystore password: `)));
    if (!eq(acct.address, expected)) throw new Error(`${label} keystore address ${acct.address} does not match ${expected}`);
    return acct;
  };
  const owner = await unlock("Deployer/owner", ownerKeystore, DEPLOYER);
  const reporter = await unlock("Reporter", reporterKeystore, REPORTER);

  async function sendAndWait(account: PrivateKeyAccount, to: Hex, data: Hex) {
    const wallet = createWalletClient({ account, chain: s.chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
    const hash = await wallet.sendTransaction({ account, chain: s.chain, to, data, gasPrice });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 1_000 });
    const minedAt = nowSecs();
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return { hash, block: Number(receipt.blockNumber), minedAt };
  }

  async function restoreFixture(): Promise<string[]> {
    const notes: string[] = [];
    const st = await fixtureState();
    if (eq(st.owner, REPORTER)) {
      await sendAndWait(reporter, TOKEN, tokenData.owner(DEPLOYER));
      notes.push("returned token ownership to the deployer");
    } else if (!eq(st.owner, DEPLOYER)) {
      notes.push(`WARNING: token owner is ${st.owner}; it cannot be restored automatically`);
    }
    if (st.paused) {
      await sendAndWait(owner, TOKEN, tokenData.unpause);
      notes.push("unpaused the token");
    }
    if (!st.t2.enabled) {
      await sendAndWait(owner, REGISTRY, regData.enabled(2, true));
      notes.push("re-enabled target #2");
    }
    if (st.t1.transferThreshold !== THRESHOLD) {
      await sendAndWait(owner, REGISTRY, regData.threshold(1, THRESHOLD));
      notes.push("restored target #1's threshold");
    }
    return notes;
  }

  if (restoreOnly) {
    const notes = await restoreFixture();
    console.log(notes.length ? `restored: ${notes.join("; ")}` : "fixture already in its starting state");
    return 0;
  }

  // ---- monitor process management
  let monitor: ChildProcess | null = null;
  const logFile = path.join(backendDir, "data", "scenario-monitor.log");
  mkdirSync(path.dirname(logFile), { recursive: true });
  const startMonitor = () => {
    const fd = openSync(logFile, "a");
    monitor = spawn(process.execPath, ["--import", "tsx", "src/scripts/monitor.ts"], { cwd: backendDir, env: process.env, stdio: ["ignore", fd, fd] });
  };
  const stopMonitor = async (signal: NodeJS.Signals) => {
    if (!monitor) return;
    const m: ChildProcess = monitor;
    monitor = null;
    const exited = new Promise<void>((r) => m.once("exit", () => r()));
    m.kill(signal);
    await Promise.race([exited, sleep(10_000)]);
    if (m.exitCode === null && m.signalCode === null) m.kill("SIGKILL");
  };
  process.on("exit", () => (monitor as ChildProcess | null)?.kill("SIGKILL"));
  process.on("SIGINT", () => {
    console.error('\ninterrupted. If the run had started, restore the fixture with: npm run scenario -- --restore');
    (monitor as ChildProcess | null)?.kill("SIGKILL");
    process.exit(130);
  });

  const waitFor = async (cond: () => boolean, timeoutMs: number, pollMs = 3000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (cond()) return true;
      await sleep(pollMs);
    }
    return cond();
  };

  const startBlock = Number(await pub.getBlockNumber());
  const countersBefore = db.counters();
  const results: StepResult[] = [];
  const expected: ExpectedAlert[] = [];
  const silent: string[] = [];
  const incomplete: string[] = [];
  let kills = 0;
  let restarts = 0;
  let catchUpSecs: number | null = null;
  let restoredBy: string[] = [];

  try {
    if (!external) startMonitor();
    console.log(`\nrunning ${steps.length} steps (${external ? "external monitor" : "managed monitor"}${chaos ? ", fault injection ON" : ""})\n`);

    for (const step of steps) {
      const r = await sendAndWait(step.signer === "owner" ? owner : reporter, step.to, step.data);
      results.push({
        id: step.id, label: step.label, signer: step.signer, txHash: r.hash, blockNumber: r.block, minedAt: r.minedAt,
        expected: step.expect.map((e) => e.ruleId),
      });
      for (const e of step.expect) expected.push({ stepId: step.id, txHash: r.hash.toLowerCase(), ...e });
      if (step.expect.length === 0 && step.to === TOKEN) silent.push(r.hash.toLowerCase());
      console.log(`${step.id.padEnd(3)} block ${r.block} ${explorer}/tx/${r.hash}  ${step.label}`);

      if (chaos && !external && step.id === "S8") {
        await stopMonitor("SIGKILL");
        kills++;
        console.log("    >> monitor killed (SIGKILL); it stays down for the next steps");
      }
    }

    if (chaos && !external) {
      const target = Number(await pub.getBlockNumber()) - Number(s.confirmations);
      const t1 = Date.now();
      startMonitor();
      restarts++;
      await sleep(3000);
      await stopMonitor("SIGKILL");
      kills++;
      startMonitor();
      restarts++;
      console.log("    >> monitor restarted, killed again 3 s later, restarted again");
      catchUpSecs = (await waitFor(() => (db.checkpoint() ?? 0) >= target, 5 * 60_000)) ? Math.round((Date.now() - t1) / 1000) : null;
    }

    const lastBlock = Math.max(...results.map((r) => r.blockNumber));
    console.log("\nwaiting for the monitor to process every scenario block…");
    if (!(await waitFor(() => (db.checkpoint() ?? 0) >= lastBlock, 10 * 60_000))) incomplete.push("the monitor did not reach the last scenario block within 10 minutes");

    // Which later stages should have processed the alerts, given how each process is configured
    const pubMin = Number(process.env.PUBLISH_MIN_SEVERITY ?? "0");
    const notifMin = Number(process.env.NOTIFY_MIN_SEVERITY ?? "0");
    const keys = new Set(expected.map((e) => `${e.txHash}|${e.ruleId}|${e.targetId}`));
    const mine = () => db.alertsFrom(startBlock).filter((a) => keys.has(`${a.txHash.toLowerCase()}|${a.ruleId}|${a.targetId}`));
    const pubActive = fresh("publisher_last_run_at", 90);
    const notifActive = fresh("notifier_last_run_at", 90);

    if (pubActive) {
      console.log("waiting for audit records…");
      const ok = await waitFor(() => mine().filter((a) => a.severity >= pubMin).every((a) => a.publishedAt !== null), 6 * 60_000);
      if (!ok) incomplete.push(`timed out waiting for audit records of ${mine().filter((a) => a.severity >= pubMin && a.publishedAt === null).length} alert(s)`);
    }
    if (notifActive) {
      console.log("waiting for Telegram messages…");
      const ok = await waitFor(() => mine().filter((a) => a.severity >= notifMin).every((a) => a.notifiedAt !== null), 3 * 60_000);
      if (!ok) incomplete.push(`timed out waiting for Telegram messages for ${mine().filter((a) => a.severity >= notifMin && a.notifiedAt === null).length} alert(s)`);
    }

    // ---- results
    const detected = db.alertsFrom(startBlock);
    const cmp = compare(expected, detected, results.map((r) => r.txHash), silent);
    const minedByTx = new Map(results.map((r) => [r.txHash.toLowerCase(), r.minedAt]));
    const lat = { detect: [] as number[], publish: [] as number[], notify: [] as number[], endToAudit: [] as number[], endToNotify: [] as number[] };
    for (const p of cmp.truePositives) {
      const t0 = minedByTx.get(p.expected.txHash.toLowerCase());
      if (t0 === undefined) continue;
      lat.detect.push(p.detected.detectedAt - t0);
      if (p.detected.publishedAt !== null) {
        lat.publish.push(p.detected.publishedAt - p.detected.detectedAt);
        lat.endToAudit.push(p.detected.publishedAt - t0);
      }
      if (p.detected.notifiedAt !== null) {
        lat.notify.push(p.detected.notifiedAt - p.detected.detectedAt);
        lat.endToNotify.push(p.detected.notifiedAt - t0);
      }
    }

    // ---- final fixture state (restore ifd)
    let finalProblems = pristineProblems(await fixtureState());
    if (finalProblems.length) {
      restoredBy = await restoreFixture();
      finalProblems = pristineProblems(await fixtureState());
    }

    let commit: string | null = null;
    try {
      commit = execSync("git rev-parse --short HEAD", { cwd: repoRoot }).toString().trim();
    } catch {
      commit = null;
    }

    const report: ScenarioReport = {
      generatedAt: new Date().toISOString(), network: s.chain.name, chainId: s.chain.id, explorerUrl: explorer,
      registry: REGISTRY, token: TOKEN, commit,
      config: { confirmations: Number(s.confirmations), pollIntervalMs: s.pollIntervalMs, gasPriceGwei, chaos },
      steps: results, comparison: cmp,
      latency: {
        detect: summarize(lat.detect), publish: summarize(lat.publish), notify: summarize(lat.notify),
        endToAudit: summarize(lat.endToAudit), endToNotify: summarize(lat.endToNotify),
      },
      stagesMeasured: { publisher: pubActive, notifier: notifActive },
      counters: { before: countersBefore, after: db.counters() },
      chaos: chaos
        ? {
            kills, restarts, catchUpSecs,
            note: "Kills were not synchronized with batch boundaries; atomic batch commits are covered by unit tests. Outcome: compare the Result table with an uninterrupted run.",
          }
        : null,
      finalState: { pristine: finalProblems.length === 0, problems: finalProblems, restoredBy },
      incomplete,
    };

    const outDir = path.join(repoRoot, "docs", "metrics");
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const base = path.join(outDir, `scenario-${stamp}${chaos ? "-chaos" : ""}`);
    writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
    writeFileSync(`${base}.md`, renderReport(report));

    const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
    console.log("\n=== Scenario result ===");
    console.log(`expected ${cmp.truePositives.length + cmp.missed.length} | matched ${cmp.truePositives.length} | missed ${cmp.missed.length} | false positives ${cmp.falsePositives.length} | unattributed ${cmp.unattributed.length}`);
    console.log(`precision ${pct(cmp.precision)} | recall ${pct(cmp.recall)} | silent cases correct ${cmp.silentCorrect}/${cmp.silentTotal} | severity mismatches ${cmp.severityMismatches.length}`);
    for (const m of cmp.missed) console.log(`  MISSED ${m.stepId}: ${m.ruleId} #${m.targetId}`);
    for (const f of cmp.falsePositives) console.log(`  UNEXPECTED ${f.ruleId} #${f.targetId} from ${f.txHash}`);
    const show = (n: string, x: ReturnType<typeof summarize>) => console.log(`  ${n.padEnd(28)} ${x ? `n=${x.n} min ${x.min}s median ${x.median}s p90 ${x.p90}s max ${x.max}s` : "not measured"}`);
    console.log("latency (local clock, about ±2 s):");
    show("mined -> detected", report.latency.detect);
    show("detected -> audit record", report.latency.publish);
    show("detected -> Telegram", report.latency.notify);
    if (chaos) console.log(`fault injection: ${kills} kills, ${restarts} restarts, catch-up ${catchUpSecs === null ? "did not finish" : catchUpSecs + " s"}`);
    console.log(`fixture restored: ${report.finalState.pristine ? "yes" : "NO: " + finalProblems.join("; ")}`);
    for (const i of incomplete) console.log(`  INCOMPLETE: ${i}`);
    console.log(`report: ${path.relative(repoRoot, base)}.md (and .json)`);

    const clean =
    cmp.missed.length === 0 &&
    cmp.falsePositives.length === 0 &&
    cmp.severityMismatches.length === 0 &&
    report.finalState.pristine &&
    incomplete.length === 0;    return clean ? 0 : 1;
  } catch (e) {
    console.error(`\nrun failed: ${(e as Error).message}`);
    try {
      const notes = await restoreFixture();
      console.error(notes.length ? `fixture restored: ${notes.join("; ")}` : "fixture was already in its starting state");
    } catch (re) {
      console.error(`automatic restore failed (${(re as Error).message}); run: npm run scenario -- --restore`);
    }
    return 1;
  } finally {
    await stopMonitor("SIGTERM");
    db.close();
  }
}

process.exit(await main());
