import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http, { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { keccak256, toHex, type Hex } from "viem";
import { createApi } from "../api.js";
import { Store, type NewAlert } from "../db.js";
import { PublisherStore } from "../publisherStore.js";

const hx = (s: string): Hex => keccak256(toHex(s));

function getJson(base: string, p: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http
      .get(base + p, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      })
      .on("error", reject);
  });
}

async function withApi(fn: (ctx: { base: string; dbFile: string }) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-apipub-"));
  const dbFile = path.join(dir, "t.db");
  const api = createApi({
    dbPath: dbFile, network: "testnet", chainId: 91562037, chainName: "MST Testnet",
    registryAddress: "0xc9f3d85de752a4112c6399c2bb6eb7f06697d945", explorerUrl: "https://testnet.mstscan.com",
    confirmations: 12, monitoredTokens: [], allowedOrigins: [],
  });
  const server: Server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn({ base, dbFile });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function alertRow(n: number, severity: number, block: bigint): NewAlert {
  const evidenceJson = JSON.stringify({ n });
  return {
    alertId: hx(`pubx-${n}`), chainId: 91562037, targetId: 1, ruleId: "ownership.changed", ruleVersion: 1, severity,
    title: "t", observed: "o", assessment: "a", caveat: "c", evidenceJson, evidenceHash: hx(evidenceJson),
    sourceTxHash: hx(`pubx-tx-${n}`), sourceLogIndex: 0, blockNumber: block, detectedAt: 1_700_000_000,
  };
}

test("alerts expose the publisher's notes, attempts, block and verification time", async () => {
  await withApi(async ({ base, dbFile }) => {
    const store = new Store(dbFile);
    for (let n = 1; n <= 5; n++) store.insertAlert(alertRow(n, 3, BigInt(10 + n)));
    const ps = new PublisherStore(dbFile);
    const now = 1_700_000_100;
    ps.markPublished(hx("pubx-1"), hx("tx-1"), 500, now);
    ps.markVerified(hx("pubx-1"), now + 5);
    ps.markPublished(hx("pubx-2"), hx("tx-2"), 501, now);
    ps.markTerminal(hx("pubx-3"), "failed", "gave up after 5 attempts: boom", now);
    ps.markTerminal(hx("pubx-4"), "skipped", "target disabled on-chain at publish time", now);
    ps.recordAttempt(hx("pubx-5"), "ECONNRESET", now);
    ps.close();

    const { body } = await getJson(base, "/api/alerts");
    const by = new Map<string, any>(body.alerts.map((a: any) => [a.alertId, a]));

    const a1 = by.get(hx("pubx-1"));
    assert.equal(a1.status, "published");
    assert.equal(a1.publishTxHash, hx("tx-1"));
    assert.equal(a1.publishBlock, 500);
    assert.equal(a1.verifiedAt, now + 5);
    assert.equal(a1.publishNote, null);

    assert.equal(by.get(hx("pubx-2")).verifiedAt, null);
    assert.equal(by.get(hx("pubx-3")).status, "failed");
    assert.match(by.get(hx("pubx-3")).publishNote, /gave up/);
    assert.equal(by.get(hx("pubx-4")).status, "skipped");
    assert.match(by.get(hx("pubx-4")).publishNote, /disabled/);
    const a5 = by.get(hx("pubx-5"));
    assert.equal(a5.status, "new");
    assert.equal(a5.publishNote, "ECONNRESET");
    assert.equal(a5.publishAttempts, 1);
  });
});

test("health reports publisher status, and a backlog that respects the publisher's minimum severity", async () => {
  await withApi(async ({ base, dbFile }) => {
    const store = new Store(dbFile);
    store.insertAlert(alertRow(1, 0, 11n)); // below the publisher's minimum
    store.insertAlert(alertRow(2, 3, 12n));
    store.insertAlert(alertRow(3, 4, 13n));
    const ps = new PublisherStore(dbFile);
    ps.markPublished(hx("pubx-3"), hx("tx-3"), 500, 1);

    assert.equal((await getJson(base, "/api/health")).body.publisher.status, "unknown");

    const now = Math.floor(Date.now() / 1000);
    store.setMeta("publisher_min_severity", "2");
    store.setMeta("publisher_last_run_at", String(now));
    const ok = (await getJson(base, "/api/health")).body.publisher;
    assert.equal(ok.status, "ok");
    assert.equal(ok.backlog, 1);
    assert.deepEqual(ok.statuses, { new: 2, published: 1 });

    store.setMeta("publisher_last_run_at", String(now - 1000));
    assert.equal((await getJson(base, "/api/health")).body.publisher.status, "stale");
    ps.close();
  });
});
