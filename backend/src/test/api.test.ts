import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http, { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { keccak256, toHex, type Hex } from "viem";
import { createApi } from "../api.js";
import { Store, type NewAlert } from "../db.js";

const CHAIN_ID = 91562037;
const REGISTRY = "0xc9f3d85de752a4112c6399c2bb6eb7f06697d945";
const OWNER = "0x6e377dd5c5d55c25094baeff4eee736ee4097d4e";
const T1 = "0x52a1404119c7119986b8149f155b9bc1254f1047";
const T2 = "0x58e42c5f3472f10d350aba6d5bff1b82bc50a28c";
const hx = (s: string): Hex => keccak256(toHex(s));

type Res = { status: number; headers: http.IncomingHttpHeaders; body: any };

function rawRequest(base: string, method: string, p: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let body: any = null;
        try {
          body = JSON.parse(data);
        } catch {
          body = null;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
const get = (base: string, p: string, headers: Record<string, string> = {}) => rawRequest(base, "GET", p, headers);

async function withApi(fn: (ctx: { base: string; dbFile: string }) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-api-"));
  const dbFile = path.join(dir, "test.db");
  const api = createApi({
    dbPath: dbFile,
    network: "testnet",
    chainId: CHAIN_ID,
    chainName: "MST Testnet",
    registryAddress: REGISTRY,
    explorerUrl: "https://testnet.mstscan.com",
    confirmations: 12,
    monitoredTokens: [T2],
    allowedOrigins: ["http://localhost:3000"],
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

function alertRow(n: number, targetId: number, severity: number, block: bigint, badHash = false): NewAlert {
  const evidenceJson = JSON.stringify({ schema: "chainsentinel.evidence.v1", n });
  return {
    alertId: hx(`alert-${n}`),
    chainId: CHAIN_ID,
    targetId,
    ruleId: "ownership.changed",
    ruleVersion: 1,
    severity,
    title: "Ownership changed",
    observed: `obs ${n}`,
    assessment: `assess ${n}`,
    caveat: `caveat ${n}`,
    evidenceJson,
    evidenceHash: badHash ? hx("tampered") : hx(evidenceJson),
    sourceTxHash: hx(`tx-${n}`),
    sourceLogIndex: 0,
    blockNumber: block,
    detectedAt: 1_700_001_000 + n,
  };
}

function seed(dbFile: string): Store {
  const store = new Store(dbFile);
  store.bindIdentity(CHAIN_ID, REGISTRY as Hex);

  const reg = (id: string, tx: string, block: bigint, target: string) =>
    store.insertEvent({
      chainId: CHAIN_ID, txHash: hx(tx), logIndex: 0, blockNumber: block, blockHash: hx(`b${block}`),
      blockTimestamp: 1_700_000_000 + Number(block), address: REGISTRY as Hex, eventName: "TargetRegistered",
      args: { targetId: id, owner: OWNER, target, transferThreshold: "1000" },
    });
  reg("1", "reg-1", 10n, T1);
  reg("2", "reg-2", 12n, T2);
  store.insertConfig({ targetId: 1, blockNumber: 10n, logIndex: 0, owner: OWNER as Hex, targetAddress: T1 as Hex, enabled: true, transferThreshold: 1000n });
  store.insertConfig({ targetId: 2, blockNumber: 12n, logIndex: 0, owner: OWNER as Hex, targetAddress: T2 as Hex, enabled: true, transferThreshold: 0n });
  // a later configuration change for target 1: the API must show the latest state
  store.insertConfig({ targetId: 1, blockNumber: 25n, logIndex: 0, owner: OWNER as Hex, targetAddress: T1 as Hex, enabled: false, transferThreshold: 5000n });

  // source event for alert 1, so the API can report the block timestamp
  store.insertEvent({
    chainId: CHAIN_ID, txHash: hx("tx-1"), logIndex: 0, blockNumber: 20n, blockHash: hx("b20"),
    blockTimestamp: 1_700_000_060, address: T1 as Hex, eventName: "OwnershipTransferred",
    args: { previousOwner: OWNER, newOwner: T2 },
  });

  store.insertAlert(alertRow(1, 1, 3, 20n));
  store.insertAlert(alertRow(2, 1, 1, 30n));
  store.insertAlert(alertRow(3, 2, 2, 40n));
  store.insertAlert(alertRow(4, 2, 4, 50n));
  store.insertAlert(alertRow(5, 1, 0, 15n, true)); // hash does not match its evidence

  const raw = new DatabaseSync(dbFile);
  raw.prepare("UPDATE alerts SET status = 'orphaned' WHERE alert_id = ?").run(hx("alert-4"));
  raw.close();
  return store;
}

test("API starts before the database exists and picks it up once the monitor creates it", async () => {
  await withApi(async ({ base, dbFile }) => {
    const h1 = await get(base, "/api/health");
    assert.equal(h1.status, 200);
    assert.equal(h1.body.dbReady, false);
    assert.equal(h1.body.ok, false);
    assert.equal((await get(base, "/api/targets")).status, 503);
    assert.equal((await get(base, "/api/alerts")).status, 503);

    new Store(dbFile);
    const h2 = await get(base, "/api/health");
    assert.equal(h2.body.dbReady, true);
    assert.equal(h2.body.monitor.status, "unknown"); // monitor has never reported a sync
    assert.equal((await get(base, "/api/targets")).status, 200);
  });
});

test("health reports ok, stale and blocks-behind-head from the monitor heartbeat", async () => {
  await withApi(async ({ base, dbFile }) => {
    const store = new Store(dbFile);
    const now = Math.floor(Date.now() / 1000);
    store.setMeta("last_sync_at", String(now));
    store.setMeta("last_head", "100");
    store.recordBatchEnd(88n, hx("b88"));

    const ok = await get(base, "/api/health");
    assert.equal(ok.body.monitor.status, "ok");
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.monitor.checkpointBlock, 88);
    assert.equal(ok.body.monitor.blocksBehindHead, 12);

    store.setMeta("last_sync_at", String(now - 1000));
    const stale = await get(base, "/api/health");
    assert.equal(stale.body.monitor.status, "stale");
    assert.equal(stale.body.ok, false);
  });
});

test("config exposes the network, registry, explorer and monitoring coverage", async () => {
  await withApi(async ({ base }) => {
    const c = (await get(base, "/api/config")).body;
    assert.equal(c.chainId, CHAIN_ID);
    assert.equal(c.isTestnet, true);
    assert.equal(c.registryAddress, REGISTRY);
    assert.equal(c.explorerUrl, "https://testnet.mstscan.com");
    assert.deepEqual(c.monitoredTokens, [T2]);
  });
});

test("targets show the latest configuration, registration transaction and non-orphaned alert counts", async () => {
  await withApi(async ({ base, dbFile }) => {
    seed(dbFile);
    const { targets } = (await get(base, "/api/targets")).body;
    assert.deepEqual(targets.map((t: any) => t.targetId), [1, 2]);
    const [t1, t2] = targets;
    assert.equal(t1.enabled, false);
    assert.equal(t1.transferThresholdRaw, "5000");
    assert.equal(t1.registrationTx, hx("reg-1"));
    assert.equal(t1.registrationBlock, 10);
    assert.equal(t1.alertCount, 3);
    assert.equal(t2.enabled, true);
    assert.equal(t2.alertCount, 1); // alert 4 is orphaned
    assert.equal(t1.address, T1);
    assert.equal(t1.owner, OWNER);
  });
});

test("alerts: newest first, pagination, filters, and orphaned alerts hidden unless requested", async () => {
  await withApi(async ({ base, dbFile }) => {
    seed(dbFile);
    const ids = (r: Res) => r.body.alerts.map((a: any) => a.alertId);

    const all = await get(base, "/api/alerts");
    assert.deepEqual(ids(all), [hx("alert-3"), hx("alert-2"), hx("alert-1"), hx("alert-5")]);
    assert.equal(all.body.total, 4);
    assert.equal(all.body.alerts[0].severityLabel, "Medium");

    const page = await get(base, "/api/alerts?limit=2&offset=1");
    assert.deepEqual(ids(page), [hx("alert-2"), hx("alert-1")]);
    assert.equal(page.body.total, 4);

    assert.deepEqual(ids(await get(base, "/api/alerts?targetId=2")), [hx("alert-3")]);
    assert.deepEqual(ids(await get(base, "/api/alerts?minSeverity=2")), [hx("alert-3"), hx("alert-1")]);

    const withOrphans = await get(base, "/api/alerts?includeOrphaned=1");
    assert.equal(withOrphans.body.total, 5);
    assert.equal(withOrphans.body.alerts[0].alertId, hx("alert-4"));
    assert.equal(withOrphans.body.alerts[0].status, "orphaned");
    assert.deepEqual(ids(await get(base, "/api/alerts?targetId=2&includeOrphaned=1")), [hx("alert-4"), hx("alert-3")]);
  });
});

test("alert detail returns the exact evidence string and tells apart a valid hash from a mismatching one", async () => {
  await withApi(async ({ base, dbFile }) => {
    seed(dbFile);
    const good = (await get(base, `/api/alerts/${hx("alert-1")}`)).body.alert;
    assert.equal(good.evidenceHashValid, true);
    assert.equal(keccak256(toHex(good.evidenceJson)), good.evidenceHash);
    assert.deepEqual(good.evidence, { schema: "chainsentinel.evidence.v1", n: 1 });
    assert.equal(good.sourceBlockTimestamp, 1_700_000_060);
    assert.equal(good.status, "new");
    assert.equal(good.publishTxHash, null);

    const bad = (await get(base, `/api/alerts/${hx("alert-5")}`)).body.alert;
    assert.equal(bad.evidenceHashValid, false);

    // lookup is case-insensitive on the hex id
    const upper = await get(base, `/api/alerts/0x${hx("alert-1").slice(2).toUpperCase()}`);
    assert.equal(upper.status, 200);
  });
});

test("input validation, unknown routes and non-GET methods", async () => {
  await withApi(async ({ base, dbFile }) => {
    seed(dbFile);
    assert.equal((await get(base, "/api/alerts/0x12")).status, 400);
    assert.equal((await get(base, `/api/alerts/0x${"ab".repeat(32)}`)).status, 404);
    for (const q of ["limit=1000", "limit=0", "limit=abc", "offset=-1", "minSeverity=9", "targetId=1.5"]) {
      assert.equal((await get(base, `/api/alerts?${q}`)).status, 400, q);
    }
    assert.equal((await get(base, "/api/nope")).status, 404);
    assert.equal((await rawRequest(base, "POST", "/api/alerts")).status, 405);
    assert.equal((await rawRequest(base, "DELETE", "/api/alerts")).status, 405);
  });
});

test("CORS: only allowed origins are echoed back", async () => {
  await withApi(async ({ base, dbFile }) => {
    seed(dbFile);
    const ok = await get(base, "/api/health", { origin: "http://localhost:3000" });
    assert.equal(ok.headers["access-control-allow-origin"], "http://localhost:3000");
    const bad = await get(base, "/api/health", { origin: "http://evil.example" });
    assert.equal(bad.headers["access-control-allow-origin"], undefined);
    const pre = await rawRequest(base, "OPTIONS", "/api/alerts", { origin: "http://localhost:3000" });
    assert.equal(pre.status, 204);
  });
});
