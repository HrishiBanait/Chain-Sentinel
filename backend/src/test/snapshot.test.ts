import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { keccak256, toHex, type Hex } from "viem";
import { Store } from "../db.js";
import { PublisherStore } from "../publisherStore.js";
import { ReadStore } from "../readStore.js";
import { buildSnapshot, type SnapshotConfig } from "../snapshot.js";

const hx = (s: string): Hex => keccak256(toHex(s));
const CHAIN_ID = 91562037;
const REGISTRY = `0x${"c".repeat(40)}` as Hex;
const OWNER = `0x${"b".repeat(40)}` as Hex;
const T1 = `0x${"1".repeat(40)}` as Hex;
const T2 = `0x${"2".repeat(40)}` as Hex;
const CFG: SnapshotConfig = {
  network: "testnet", isTestnet: true, chainId: CHAIN_ID, chainName: "MST Testnet", registryAddress: REGISTRY,
  explorerUrl: "https://testnet.mstscan.com", confirmations: 12, monitoredTokens: [],
};

function addAlert(store: Store, n: number, severity: number, block: bigint, targetId = 1) {
  const evidenceJson = JSON.stringify({ n });
  store.insertAlert({
    alertId: hx(`snap-${n}`), chainId: CHAIN_ID, targetId, ruleId: "ownership.changed", ruleVersion: 2, severity,
    title: "t", observed: "o", assessment: "a", caveat: "c", evidenceJson, evidenceHash: hx(evidenceJson),
    sourceTxHash: hx(`snap-tx-${n}`), sourceLogIndex: 0, blockNumber: block, detectedAt: 1_700_000_000,
  });
}

function withDb(fn: (store: Store, read: ReadStore, file: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-snap-"));
  const file = path.join(dir, "t.db");
  const store = new Store(file);
  const read = new ReadStore(file);
  try {
    fn(store, read, file);
  } finally {
    read.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("snapshot captures targets, alerts (including orphaned ones, flagged), valid evidence and truncated notes", () => {
  withDb((store, read, file) => {
    for (const [id, tx, addr] of [["1", "reg-1", T1], ["2", "reg-2", T2]] as const) {
      store.insertEvent({
        chainId: CHAIN_ID, txHash: hx(tx), logIndex: 0, blockNumber: 10n, blockHash: hx("b10"), blockTimestamp: 1_700_000_000,
        address: REGISTRY, eventName: "TargetRegistered", args: { targetId: id, owner: OWNER, target: addr, transferThreshold: "1000" },
      });
      store.insertConfig({ targetId: Number(id), blockNumber: 10n, logIndex: 0, owner: OWNER, targetAddress: addr, enabled: true, transferThreshold: 1000n });
    }
    addAlert(store, 1, 3, 20n);
    addAlert(store, 2, 2, 21n, 2);
    addAlert(store, 3, 1, 22n);
    addAlert(store, 4, 3, 23n);
    const ps = new PublisherStore(file);
    ps.markPublished(hx("snap-1"), hx("pub-tx-1"), 500, 1_700_000_100);
    ps.markTerminal(hx("snap-3"), "failed", "x".repeat(500), 1_700_000_100);
    ps.close();
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE alerts SET status = 'orphaned' WHERE alert_id = ?").run(hx("snap-4"));
    raw.close();

    const snap = buildSnapshot(read, { config: CFG, commit: "abc1234", now: 1_700_000_200 });
    assert.equal(snap.version, 1);
    assert.equal(snap.generatedAt, 1_700_000_200);
    assert.equal(snap.commit, "abc1234");
    assert.equal(snap.config.chainId, CHAIN_ID);
    assert.equal(snap.counts.targets, 2);
    assert.deepEqual(snap.targets.map((t) => [t.targetId, t.registrationTx]), [[1, hx("reg-1")], [2, hx("reg-2")]]);
    assert.equal(snap.targets[0].alertCount, 2); // alert 4 is orphaned and not counted

    assert.equal(snap.alerts.length, 4);
    assert.equal(snap.alerts.find((a) => a.alertId === hx("snap-4"))?.status, "orphaned");
    for (const a of snap.alerts) {
      assert.equal(keccak256(toHex(a.evidenceJson)), a.evidenceHash);
      assert.equal(a.evidenceHashValid, true);
    }
    const published = snap.alerts.find((a) => a.alertId === hx("snap-1"))!;
    assert.deepEqual([published.status, published.publishTxHash, published.publishBlock], ["published", hx("pub-tx-1"), 500]);
    assert.equal(snap.alerts.find((a) => a.alertId === hx("snap-3"))?.publishNote?.length, 300);
    assert.doesNotThrow(() => JSON.stringify(snap));
  });
});

test("snapshot pages through more alerts than one query returns", () => {
  withDb((store, read) => {
    for (let n = 1; n <= 205; n++) addAlert(store, n, 1, BigInt(100 + n));
    const snap = buildSnapshot(read, { config: CFG, commit: null, now: 1 });
    assert.equal(snap.alerts.length, 205);
    assert.equal(new Set(snap.alerts.map((a) => a.alertId)).size, 205);
  });
});
