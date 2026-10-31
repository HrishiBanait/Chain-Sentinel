import type { IncomingMessage, ServerResponse } from "node:http";
import { keccak256, toHex } from "viem";
import { ReadStore, type AlertWithTime } from "./readStore.js";

const SEVERITY = ["Info", "Low", "Medium", "High", "Critical"];
const ALERT_PATH = /^\/api\/alerts\/(.+)$/;
const ALERT_ID = /^0x[0-9a-fA-F]{64}$/;

export interface ApiOptions {
  dbPath: string;
  network: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  registryAddress: string;
  explorerUrl: string;
  confirmations: number;
  monitoredTokens: string[];
  allowedOrigins: string[];
  staleAfterSecs?: number;
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function intParam(url: URL, name: string, def: number | undefined, min: number, max: number): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `invalid parameter: ${name}`);
  return n;
}

function alertSummary(r: AlertWithTime) {
  return {
    alertId: r.alert_id,
    chainId: r.chain_id,
    targetId: r.target_id,
    ruleId: r.rule_id,
    ruleVersion: r.rule_version,
    severity: r.severity,
    severityLabel: SEVERITY[r.severity] ?? "Unknown",
    title: r.title,
    observed: r.observed,
    assessment: r.assessment,
    caveat: r.caveat,
    evidenceHash: r.evidence_hash,
    sourceTxHash: r.source_tx_hash,
    sourceLogIndex: r.source_log_index,
    blockNumber: r.block_number,
    sourceBlockTimestamp: r.source_block_timestamp,
    status: r.status,
    detectedAt: r.detected_at,
    publishTxHash: r.publish_tx_hash,
    publishedAt: r.published_at,
    publishNote: r.publish_note,
    publishAttempts: r.publish_attempts,
    publishBlock: r.publish_block,
    verifiedAt: r.publish_verified_at,
  };
}

export function alertDetail(r: AlertWithTime) {
  let evidence: unknown = null;
  try {
    evidence = JSON.parse(r.evidence_json);
  } catch {
    evidence = null;
  }
  return {
    ...alertSummary(r),
    evidence,
    // The exact string that was hashed, so anyone can recompute keccak256 and compare.
    evidenceJson: r.evidence_json,
    evidenceHashValid: keccak256(toHex(r.evidence_json)) === r.evidence_hash,
  };
}

export function createApi(opts: ApiOptions): { handler: (req: IncomingMessage, res: ServerResponse) => void; close: () => void } {
  const store = new ReadStore(opts.dbPath);
  const staleAfter = opts.staleAfterSecs ?? 90;
  const startedAt = Date.now();

  const requireDb = () => {
    if (!store.ready()) throw new HttpError(503, "database not ready: the monitor has not created it yet");
  };

  const numMeta = (key: string): number | undefined => {
    const v = store.getMeta(key);
    return v === undefined ? undefined : Number(v);
  };

  function publisherInfo(now: number) {
    const lastRunAt = numMeta("publisher_last_run_at");
    return {
      status: lastRunAt === undefined ? "unknown" : now - lastRunAt <= staleAfter ? "ok" : "stale",
      lastRunAt: lastRunAt ?? null,
      secondsSinceLastRun: lastRunAt === undefined ? null : now - lastRunAt,
      backlog: store.backlogCount(numMeta("publisher_min_severity") ?? 0),
      statuses: store.statusCounts(),
    };
  }

  function health() {
    const uptimeSecs = Math.floor((Date.now() - startedAt) / 1000);
    if (!store.ready()) return { ok: false, dbReady: false, monitor: { status: "unknown" }, uptimeSecs };
    const now = Math.floor(Date.now() / 1000);
    const cp = store.checkpoint();
    const lastSyncAt = numMeta("last_sync_at");
    const lastHead = numMeta("last_head");
    const status = lastSyncAt === undefined ? "unknown" : now - lastSyncAt <= staleAfter ? "ok" : "stale";
    return {
      ok: status === "ok",
      dbReady: true,
      network: opts.network,
      chainId: opts.chainId,
      monitor: {
        status,
        lastSyncAt: lastSyncAt ?? null,
        secondsSinceLastSync: lastSyncAt === undefined ? null : now - lastSyncAt,
        lastErrorAt: numMeta("last_error_at") ?? null,
        headBlock: lastHead ?? null,
        checkpointBlock: cp?.blockNumber ?? null,
        blocksBehindHead: lastHead !== undefined && cp ? lastHead - cp.blockNumber : null,
        confirmations: opts.confirmations,
      },
      publisher: publisherInfo(now),
      counts: store.counts(),
      counters: store.counters(),
      uptimeSecs,
    };
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    const origin = req.headers.origin;
    if (origin && (opts.allowedOrigins.includes("*") || opts.allowedOrigins.includes(origin))) {
      headers["access-control-allow-origin"] = origin;
      headers["vary"] = "Origin";
    }
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };

    try {
      if (req.method === "OPTIONS") {
        headers["access-control-allow-methods"] = "GET, OPTIONS";
        headers["access-control-allow-headers"] = "content-type";
        res.writeHead(204, headers);
        res.end();
        return;
      }
      if (req.method !== "GET") throw new HttpError(405, "method not allowed");

      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

      if (pathname === "/api/health") return reply(200, health());

      if (pathname === "/api/config") {
        return reply(200, {
          network: opts.network,
          isTestnet: opts.network === "testnet",
          chainId: opts.chainId,
          chainName: opts.chainName,
          registryAddress: opts.registryAddress,
          explorerUrl: opts.explorerUrl,
          confirmations: opts.confirmations,
          monitoredTokens: opts.monitoredTokens,
        });
      }

      if (pathname === "/api/targets") {
        requireDb();
        return reply(200, {
          targets: store.targets().map((t) => ({
            targetId: t.target_id,
            address: t.target_address,
            owner: t.owner,
            enabled: t.enabled === 1,
            transferThresholdRaw: t.transfer_threshold,
            registrationTx: t.registration_tx,
            registrationBlock: t.registration_block,
            alertCount: t.alert_count,
          })),
        });
      }

      if (pathname === "/api/alerts") {
        requireDb();
        const limit = intParam(url, "limit", 50, 1, 200)!;
        const offset = intParam(url, "offset", 0, 0, 1_000_000)!;
        const targetId = intParam(url, "targetId", undefined, 0, Number.MAX_SAFE_INTEGER);
        const minSeverity = intParam(url, "minSeverity", undefined, 0, 4);
        const includeOrphaned = url.searchParams.get("includeOrphaned") === "1";
        const { total, rows } = store.alerts({ limit, offset, targetId, minSeverity, includeOrphaned });
        return reply(200, { alerts: rows.map(alertSummary), total, limit, offset });
      }

      const m = ALERT_PATH.exec(pathname);
      if (m) {
        if (!ALERT_ID.test(m[1])) throw new HttpError(400, "invalid alert id");
        requireDb();
        const row = store.alertById(m[1].toLowerCase());
        if (!row) throw new HttpError(404, "alert not found");
        return reply(200, { alert: alertDetail(row) });
      }

      throw new HttpError(404, "not found");
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.message });
      console.error("api error:", e);
      reply(500, { error: "internal error" });
    }
  }

  return { handler, close: () => store.close() };
}
