import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, keccak256, pad, toHex, type Hex } from "viem";
import type { ChainSource, LogFilter, RawLog } from "../chainSource.js";
import { registryAbi, TOPIC, watchedAbi } from "../decode.js";
import { Store } from "../db.js";
import { Monitor, type MonitorConfig } from "../monitor.js";

const CHAIN_ID = 91562037;
const addr = (c: string) => `0x${c.repeat(40)}` as Hex;
const REGISTRY = addr("a");
const TARGET = addr("1");
const TARGET2 = addr("2");
const TOKEN = addr("7");
const OTHER_TOKEN = addr("8");
const OWNER_A = addr("b");
const OWNER_B = addr("c");
const OWNER_C = addr("d");
const OWNER_D = addr("e");
const OTHER = addr("f");
const ZERO = addr("0");

class FakeChain implements ChainSource {
  chainId = CHAIN_ID;
  head = 0n;
  logs: RawLog[] = [];
  forks: bigint[] = [];
  rangeLimit: bigint | null = null;
  failOnCall: number | null = null;
  private calls = 0;
  private nonce = 0;

  hashOf(n: bigint): Hex {
    return keccak256(toHex(`block:${n}:${this.forks.filter((f) => f <= n).length}`));
  }
  async getChainId() { return this.chainId; }
  async getHeadBlock() { return this.head; }
  async getBlockHash(n: bigint) { return n > this.head ? null : this.hashOf(n); }
  async getBlockTimestamp(n: bigint) { return 1_700_000_000 + Number(n) * 3; }
  reorgFrom(n: bigint) {
    this.logs = this.logs.filter((l) => l.blockNumber < n);
    this.forks.push(n);
  }
  add(block: bigint, address: Hex, topics: Hex[], data: Hex = "0x", logIndex = 0) {
    this.logs.push({ address, topics, data, blockNumber: block, blockHash: this.hashOf(block), transactionHash: keccak256(toHex(`tx:${this.nonce++}`)), logIndex });
  }
  async getLogs(f: LogFilter): Promise<RawLog[]> {
    this.calls++;
    if (this.failOnCall === this.calls) throw new Error("upstream 503");
    if (this.rangeLimit !== null && f.toBlock - f.fromBlock + 1n > this.rangeLimit) throw new Error("query exceeds max block range");
    return this.logs.filter((l) => {
      if (l.blockNumber < f.fromBlock || l.blockNumber > f.toBlock) return false;
      if (f.address && !f.address.some((a) => a.toLowerCase() === l.address.toLowerCase())) return false;
      return f.topics.every((t, i) => {
        if (t === null) return true;
        const have = l.topics[i]?.toLowerCase();
        return Array.isArray(t) ? t.some((x) => x.toLowerCase() === have) : t.toLowerCase() === have;
      });
    });
  }
}

// ---- log builders
const topicsOf = (abi: unknown, eventName: string, args?: Record<string, unknown>) =>
  encodeEventTopics({ abi, eventName, args } as any) as Hex[];
const u256 = (n: bigint) => encodeAbiParameters([{ type: "uint256" }], [n]);
const addrData = (a: Hex) => encodeAbiParameters([{ type: "address" }], [a]);
const boolData = (b: boolean) => encodeAbiParameters([{ type: "bool" }], [b]);

const regTarget = (c: FakeChain, block: bigint, id: bigint, owner: Hex, target: Hex, thr: bigint, li = 0) =>
  c.add(block, REGISTRY, topicsOf(registryAbi, "TargetRegistered", { targetId: id, owner, target }), u256(thr), li);
const setEnabled = (c: FakeChain, block: bigint, id: bigint, enabled: boolean) =>
  c.add(block, REGISTRY, topicsOf(registryAbi, "TargetEnabledChanged", { targetId: id }), boolData(enabled));
const own = (c: FakeChain, block: bigint, at: Hex, prev: Hex, next: Hex) =>
  c.add(block, at, topicsOf(watchedAbi, "OwnershipTransferred", { previousOwner: prev, newOwner: next }));
const pause = (c: FakeChain, block: bigint, at: Hex, who: Hex) => c.add(block, at, topicsOf(watchedAbi, "Paused"), addrData(who));
const unpause = (c: FakeChain, block: bigint, at: Hex, who: Hex) => c.add(block, at, topicsOf(watchedAbi, "Unpaused"), addrData(who));
const transfer = (c: FakeChain, block: bigint, token: Hex, from: Hex, to: Hex, value: bigint, li = 0) =>
  c.add(block, token, topicsOf(watchedAbi, "Transfer", { from, to }), u256(value), li);

function cfgWith(over: Partial<MonitorConfig> = {}): MonitorConfig {
  return { chainId: CHAIN_ID, registryAddress: REGISTRY, startBlock: 1n, confirmations: 2n, batchSize: 10n, monitoredTokens: [TOKEN], ...over };
}
function setup(over: Partial<MonitorConfig> = {}) {
  const store = new Store(":memory:");
  const chain = new FakeChain();
  const monitor = new Monitor(store, chain, cfgWith(over), () => {});
  return { store, chain, monitor };
}
const evidence = (a: { evidence_json: string }) => JSON.parse(a.evidence_json);

test("explainable alerts for ownership and pause events; the initial owner assignment is not an alert", async () => {
  const { store, chain, monitor } = setup();
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 0n);
  own(chain, 2n, TARGET, ZERO, OWNER_A);
  own(chain, 3n, TARGET, OWNER_A, OWNER_B);
  pause(chain, 4n, TARGET, OWNER_B);
  unpause(chain, 5n, TARGET, OWNER_B);
  own(chain, 6n, TARGET, OWNER_B, ZERO);
  chain.head = 12n;
  await monitor.syncOnce();

  const alerts = store.listAlerts();
  assert.deepEqual(alerts.map((a) => [a.rule_id, a.severity]), [
    ["ownership.changed", 3], ["pause.paused", 2], ["pause.unpaused", 1], ["ownership.renounced", 2],
  ]);
  assert.equal(store.countEvents(), 6); // the initial assignment is stored as an observation, without an alert
  for (const a of alerts) {
    assert.ok(a.observed.length > 0 && a.assessment.length > 0 && a.caveat.length > 0);
    assert.equal(keccak256(toHex(a.evidence_json)), a.evidence_hash);
    assert.equal(evidence(a).event.txHash, a.source_tx_hash);
  }
});

test("only processes blocks that have enough confirmations", async () => {
  const { store, chain, monitor } = setup();
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 0n);
  own(chain, 9n, TARGET, OWNER_A, OWNER_B);
  chain.head = 10n; // safe head 8
  await monitor.syncOnce();
  assert.equal(store.listAlerts().length, 0);
  assert.equal(store.getCheckpoint()?.blockNumber, 8n);
  chain.head = 11n; // safe head 9
  await monitor.syncOnce();
  assert.equal(store.listAlerts().length, 1);
  assert.equal(store.getCheckpoint()?.blockNumber, 9n);
});

test("large-transfer rule respects thresholds, the token allowlist and ERC-721-style logs", async () => {
  const { store, chain, monitor } = setup();
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 1000n, 0);
  regTarget(chain, 1n, 2n, OWNER_A, TARGET2, 0n, 1);
  transfer(chain, 2n, TOKEN, OTHER, TARGET, 1000n); // exactly the threshold: Medium
  transfer(chain, 3n, TOKEN, OTHER, TARGET, 999n); // below: nothing
  transfer(chain, 4n, TOKEN, OTHER, TARGET, 10_000n); // 10x: High
  transfer(chain, 5n, OTHER_TOKEN, OTHER, TARGET, 5000n); // token not allowlisted: nothing
  chain.add(6n, TOKEN, [TOPIC.Transfer, pad(OTHER), pad(TARGET), pad("0x01")]); // 4 topics: ignored
  transfer(chain, 7n, TOKEN, OTHER, TARGET2, 5000n); // threshold 0 means rule off
  chain.head = 20n;
  await monitor.syncOnce();

  const alerts = store.listAlerts();
  assert.deepEqual(alerts.map((a) => [a.rule_id, a.severity]), [["transfer.large", 2], ["transfer.large", 3]]);
  assert.equal(evidence(alerts[0]).details.direction, "inbound");
  assert.equal(evidence(alerts[0]).details.multiple, "1");
  assert.equal(evidence(alerts[1]).details.multiple, "10");
  assert.equal(store.counters().undecodable_logs, 1);
});

test("events while a target is disabled are ignored, judged by state at the event's block", async () => {
  const { store, chain, monitor } = setup();
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 0n);
  own(chain, 3n, TARGET, OWNER_A, OWNER_B); // enabled: alert
  setEnabled(chain, 4n, 1n, false);
  own(chain, 5n, TARGET, OWNER_B, OWNER_A); // disabled: no alert
  setEnabled(chain, 6n, 1n, true);
  own(chain, 7n, TARGET, OWNER_A, OWNER_C); // enabled again: alert
  chain.head = 12n;
  await monitor.syncOnce();
  assert.equal(store.listAlerts().length, 2);
  assert.equal(store.countEvents(), 6);
});

test("resuming from a checkpoint with a new monitor gives the same result as one run, and reruns add nothing", async () => {
  const chain = new FakeChain();
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 1000n);
  own(chain, 2n, TARGET, OWNER_A, OWNER_B);
  pause(chain, 5n, TARGET, OWNER_B);
  transfer(chain, 8n, TOKEN, OTHER, TARGET, 5000n);
  own(chain, 11n, TARGET, OWNER_B, OWNER_C);
  chain.head = 20n;

  const full = new Store(":memory:");
  await new Monitor(full, chain, cfgWith(), () => {}).syncOnce();

  const split = new Store(":memory:");
  const cfg = cfgWith({ batchSize: 4n });
  await new Monitor(split, chain, cfg, () => {}).syncOnce(2); // "crash" after two batches
  assert.equal(split.getCheckpoint()?.blockNumber, 8n);
  const resumed = new Monitor(split, chain, cfg, () => {});
  await resumed.syncOnce();

  const ids = (s: Store) => s.listAlerts().map((a) => a.alert_id).sort();
  assert.deepEqual(ids(split), ids(full));
  assert.equal(split.listAlerts().length, 4);
  assert.equal(split.countEvents(), full.countEvents());
  assert.equal(split.getCheckpoint()?.blockNumber, full.getCheckpoint()?.blockNumber);

  const again = await resumed.syncOnce();
  assert.equal(again.batches, 0);
  assert.equal(split.listAlerts().length, 4);
});

test("reorg: rolls back to the last matching batch end and replaces orphaned alerts", async () => {
  const { store, chain, monitor } = setup({ batchSize: 3n });
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 0n);
  own(chain, 2n, TARGET, OWNER_A, OWNER_B); // stays valid
  own(chain, 7n, TARGET, OWNER_B, OWNER_C); // will be orphaned
  chain.head = 10n; // safe head 8, batches end at 3, 6, 8
  await monitor.syncOnce();
  assert.equal(store.listAlerts().length, 2);

  chain.reorgFrom(7n);
  own(chain, 7n, TARGET, OWNER_B, OWNER_D);
  await monitor.syncOnce();

  const alerts = store.listAlerts();
  assert.equal(alerts.length, 2);
  assert.equal(evidence(alerts[0]).event.args.newOwner, OWNER_B);
  assert.equal(evidence(alerts[1]).event.args.newOwner, OWNER_D);
  assert.equal(store.countEvents(), 3);
  assert.equal(store.counters().reorgs_handled, 1);
  const cp = store.getCheckpoint()!;
  assert.equal(cp.blockHash, chain.hashOf(cp.blockNumber));
});

test("reorg with no common ancestor in stored history triggers a full re-scan", async () => {
  const { store, chain, monitor } = setup();
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 0n);
  own(chain, 4n, TARGET, OWNER_A, OWNER_B);
  chain.head = 10n; // one batch ending at 8
  await monitor.syncOnce();

  chain.reorgFrom(4n);
  own(chain, 4n, TARGET, OWNER_A, OWNER_C);
  await monitor.syncOnce();

  const alerts = store.listAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(evidence(alerts[0]).event.args.newOwner, OWNER_C);
  assert.equal(store.counters().reorgs_handled, 1);
});

test("splits log queries when the node rejects a block range as too large", async () => {
  const { store, chain, monitor } = setup();
  chain.rangeLimit = 3n;
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 0n);
  own(chain, 2n, TARGET, ZERO, OWNER_A);
  pause(chain, 6n, TARGET, OWNER_A);
  own(chain, 7n, TARGET, OWNER_A, OWNER_B);
  chain.head = 12n;
  await monitor.syncOnce();
  assert.equal(store.listAlerts().length, 2);
  assert.ok((store.counters().range_splits ?? 0) > 0);
});

test("an RPC failure in the middle of a batch commits nothing, and the next run recovers cleanly", async () => {
  const { store, chain, monitor } = setup();
  regTarget(chain, 1n, 1n, OWNER_A, TARGET, 1000n);
  own(chain, 3n, TARGET, OWNER_A, OWNER_B);
  chain.head = 12n;
  chain.failOnCall = 3; // registry query and target-events query succeed, the transfer query fails

  await assert.rejects(() => monitor.syncOnce(), /503/);
  assert.equal(store.countEvents(), 0);
  assert.equal(store.getCheckpoint(), null);

  chain.failOnCall = null;
  await monitor.syncOnce();
  assert.equal(store.listAlerts().length, 1);
  assert.equal(store.countEvents(), 2);
});

test("refuses to run when the RPC reports a different chain id", async () => {
  const { store, chain, monitor } = setup();
  chain.chainId = 1;
  await assert.rejects(() => monitor.syncOnce(), /chain id/i);
  assert.equal(store.countEvents(), 0);
});
