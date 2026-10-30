import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { keccak256, toHex, type Hex } from "viem";
import { Store, type NewAlert } from "../db.js";
import {
  ChainRevert, FatalPublisherError, Publisher,
  type OnChainAlert, type PublishArgs, type PublishChain, type PublisherConfig, type TxOutcome,
} from "../publisher.js";
import { PublisherStore } from "../publisherStore.js";

const T0 = 1_700_000_000;
const hx = (s: string): Hex => keccak256(toHex(s));
const A = (n: number) => hx(`pub-alert-${n}`);

class FakeRegistry implements PublishChain {
  head = 1000n;
  targets = new Map<bigint, boolean>([[1n, true], [2n, true]]);
  authorized = true;
  onchain = new Map<string, { evidenceHash: Hex; txHash: Hex; block: bigint }>();
  receipts = new Map<string, TxOutcome>();
  pending = new Map<string, PublishArgs>();
  sent: Hex[] = [];
  sendAttempts = 0;
  failSends = 0;
  sendThenThrow = false;
  stuck = false;
  private n = 0;

  async headBlock() { return this.head; }
  async alertOnChain(id: Hex): Promise<OnChainAlert> {
    const r = this.onchain.get(id);
    return r ? { exists: true, evidenceHash: r.evidenceHash } : { exists: false };
  }
  private check(a: PublishArgs) {
    if (!this.authorized) throw new ChainRevert("NotReporter");
    if (this.onchain.has(a.alertId)) throw new ChainRevert("AlertAlreadyPublished");
    const t = this.targets.get(a.targetId);
    if (t === undefined) throw new ChainRevert("TargetNotFound");
    if (!t) throw new ChainRevert("TargetDisabled");
  }
  async simulate(a: PublishArgs) { this.check(a); }
  mine(hash: Hex) {
    const a = this.pending.get(hash)!;
    this.pending.delete(hash);
    this.head += 1n;
    this.onchain.set(a.alertId, { evidenceHash: a.evidenceHash, txHash: hash, block: this.head });
    this.receipts.set(hash, { status: "success", blockNumber: this.head });
  }
  async send(a: PublishArgs): Promise<Hex> {
    this.sendAttempts++;
    if (this.failSends > 0) {
      this.failSends--;
      throw new Error("ECONNRESET");
    }
    this.check(a);
    const hash = hx(`tx:${this.n++}`);
    this.pending.set(hash, a);
    this.sent.push(a.alertId);
    if (!this.stuck) this.mine(hash);
    if (this.sendThenThrow) {
      this.sendThenThrow = false;
      throw new Error("socket hang up");
    }
    return hash;
  }
  async receipt(h: Hex) { return this.receipts.get(h) ?? null; }
  async waitReceipt(h: Hex) { return this.receipts.get(h) ?? null; }
  async findPublishTx(id: Hex) {
    const r = this.onchain.get(id);
    return r ? { txHash: r.txHash, blockNumber: r.block } : null;
  }
  drop(id: Hex) { this.onchain.delete(id); }
}

function alertRow(n: number, targetId: number, severity: number, block: bigint): NewAlert {
  const evidenceJson = JSON.stringify({ n });
  return {
    alertId: A(n), chainId: 91562037, targetId, ruleId: "ownership.changed", ruleVersion: 1, severity,
    title: "t", observed: "o", assessment: "a", caveat: "c", evidenceJson, evidenceHash: hx(evidenceJson),
    sourceTxHash: hx(`pub-tx-${n}`), sourceLogIndex: 0, blockNumber: block, detectedAt: T0 - 5,
  };
}

const BASE: PublisherConfig = { minSeverity: 0, confirmations: 2n, maxAttempts: 3, pendingGraceSecs: 100, backoffBaseSecs: 10, maxPerRun: 50 };

interface Env { mon: Store; ps: PublisherStore; chain: FakeRegistry; pub: Publisher; file: string; advance: (s: number) => void }

async function withEnv(over: Partial<PublisherConfig>, fn: (e: Env) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-pub-"));
  const file = path.join(dir, "t.db");
  const mon = new Store(file);
  const ps = new PublisherStore(file);
  const chain = new FakeRegistry();
  let t = T0;
  const pub = new Publisher(ps, chain, { ...BASE, ...over }, () => {}, () => t);
  try {
    await fn({ mon, ps, chain, pub, file, advance: (s) => { t += s; } });
  } finally {
    ps.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("publishes eligible alerts once, oldest block first; skips low severity and orphaned alerts", async () => {
  await withEnv({ minSeverity: 1 }, async ({ mon, ps, chain, pub, file }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    mon.insertAlert(alertRow(2, 1, 1, 10n));
    mon.insertAlert(alertRow(3, 1, 0, 15n));
    mon.insertAlert(alertRow(4, 1, 4, 5n));
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE alerts SET status = 'orphaned' WHERE alert_id = ?").run(A(4));
    raw.close();

    const s1 = await pub.runOnce();
    assert.equal(s1.published, 2);
    assert.deepEqual(chain.sent, [A(2), A(1)]);
    for (const n of [1, 2]) {
      const st = ps.getAlertState(A(n))!;
      assert.equal(st.status, "published");
      assert.ok(st.publishTxHash);
      assert.equal(chain.onchain.get(A(n))?.evidenceHash, hx(JSON.stringify({ n })));
    }
    assert.equal(ps.getAlertState(A(3))!.status, "new");
    assert.equal(ps.getAlertState(A(4))!.status, "orphaned");

    const s2 = await pub.runOnce();
    assert.equal(s2.published, 0);
    assert.equal(chain.sent.length, 2);
  });
});

test("verifies publications after enough confirmations and republishes one that disappeared", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    mon.insertAlert(alertRow(2, 1, 3, 21n));
    await pub.runOnce();
    chain.head += 10n;
    chain.drop(A(2));

    const s = await pub.runOnce();
    assert.equal(s.verified, 1);
    assert.equal(s.dropped, 1);
    assert.equal(s.published, 1);
    assert.deepEqual(chain.sent, [A(1), A(2), A(2)]);

    chain.head += 5n;
    assert.equal((await pub.runOnce()).verified, 1);
    assert.ok(ps.getLog(A(2))!.verifiedAt !== null);
    assert.equal(ps.getAlertState(A(2))!.status, "published");
  });
});

test("recovers a publication that was mined while the process failed, without sending a duplicate", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub, advance }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.sendThenThrow = true;

    const s1 = await pub.runOnce();
    assert.equal(s1.retried, 1);
    assert.equal(ps.getAlertState(A(1))!.status, "new");

    assert.equal((await pub.runOnce()).waiting, 1); // still inside the backoff window
    advance(11);
    const s3 = await pub.runOnce();
    assert.equal(s3.recovered, 1);
    assert.equal(chain.sent.length, 1);
    assert.equal(ps.getAlertState(A(1))!.publishTxHash, chain.onchain.get(A(1))!.txHash);
  });
});

test("does not resend while a transaction is pending, and finalizes it once mined", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub, advance }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.stuck = true;

    assert.equal((await pub.runOnce()).waiting, 1);
    assert.equal(ps.getLog(A(1))!.status, "pending");
    advance(30);
    assert.equal((await pub.runOnce()).waiting, 1);
    assert.equal(chain.sent.length, 1);

    const [hash] = [...chain.pending.keys()] as Hex[];
    chain.mine(hash);
    assert.equal((await pub.runOnce()).published, 1);
    assert.equal(chain.sent.length, 1);
    assert.equal(ps.getAlertState(A(1))!.publishTxHash, hash);
  });
});

test("a transaction that never mines is replaced after the grace period", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub, advance }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.stuck = true;
    await pub.runOnce();
    advance(101);
    chain.stuck = false;

    assert.equal((await pub.runOnce()).published, 1);
    assert.equal(chain.sent.length, 2);
    assert.equal(ps.getAlertState(A(1))!.status, "published");
  });
});

test("an alert whose target was disabled on-chain is skipped and never retried", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.targets.set(1n, false);
    assert.equal((await pub.runOnce()).skipped, 1);
    assert.equal(ps.getAlertState(A(1))!.status, "skipped");
    assert.equal((await pub.runOnce()).skipped, 0);
    assert.equal(chain.sendAttempts, 0);
  });
});

test("an unauthorized reporter stops the publisher and leaves alerts untouched", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.authorized = false;
    await assert.rejects(() => pub.runOnce(), (e: unknown) => e instanceof FatalPublisherError);
    assert.equal(ps.getAlertState(A(1))!.status, "new");
  });
});

test("transient send failures are retried with exponential backoff", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub, advance }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.failSends = 2;

    assert.equal((await pub.runOnce()).retried, 1);
    assert.equal((await pub.runOnce()).waiting, 1);
    assert.equal(chain.sendAttempts, 1);
    advance(11);
    assert.equal((await pub.runOnce()).retried, 1);
    advance(11);
    assert.equal((await pub.runOnce()).waiting, 1); // backoff has doubled to 20 s
    advance(10);
    assert.equal((await pub.runOnce()).published, 1);
    assert.equal(ps.getAlertState(A(1))!.status, "published");
  });
});

test("gives up after the maximum number of attempts and marks the alert failed", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub, advance }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.failSends = 99;
    await pub.runOnce();
    advance(11);
    await pub.runOnce();
    advance(21);
    const s = await pub.runOnce();
    assert.equal(s.failed, 1);
    assert.equal(ps.getAlertState(A(1))!.status, "failed");
    assert.match(ps.getLog(A(1))!.lastError ?? "", /gave up/);
  });
});

test("an on-chain record with the same id but different evidence is flagged, not overwritten", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.onchain.set(A(1), { evidenceHash: hx("someone else"), txHash: hx("x"), block: 5n });
    assert.equal((await pub.runOnce()).failed, 1);
    assert.equal(ps.getAlertState(A(1))!.status, "failed");
    assert.equal(chain.sent.length, 0);
  });
});

test("a publication dropped from the chain is republished promptly with a fresh retry budget", async () => {
  await withEnv({}, async ({ mon, ps, chain, pub, advance }) => {
    mon.insertAlert(alertRow(1, 1, 3, 20n));
    chain.failSends = 1;
    await pub.runOnce(); // attempt 1 fails
    advance(11);
    assert.equal((await pub.runOnce()).published, 1); // attempt 2 succeeds
    assert.equal(ps.getLog(A(1))!.attempts, 2);

    chain.head += 5n;
    chain.drop(A(1));
    const s = await pub.runOnce();
    assert.equal(s.dropped, 1);
    assert.equal(s.published, 1); // no backoff wait, and no attempts carried over
    assert.equal(ps.getLog(A(1))!.attempts, 1);
    assert.equal(ps.getAlertState(A(1))!.status, "published");
  });
});
