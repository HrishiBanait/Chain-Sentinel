import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from "viem";
import { CHAINS } from "./chains";
import { directCall, isLocalHost, proxyCall, RpcUnavailable, useProxy } from "./rpc";
import type { ApiAlert, ApiAlertDetail, ApiConfig, ApiHealth, ApiTarget, Snapshot } from "./types";

// Override with NEXT_PUBLIC_API_URL in frontend/.env.local (that file is git-ignored).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

/**
 * snapshot: data from /snapshot.json plus live on-chain reads (hosted demos).
 * api: the ChainSentinel API. NEXT_PUBLIC_DATA_SOURCE=snapshot|api forces a mode;
 * otherwise any non-local host uses the snapshot.
 */
export function isSnapshotMode(): boolean {
  const e = process.env.NEXT_PUBLIC_DATA_SOURCE;
  if (e === "snapshot") return true;
  if (e === "api") return false;
  return typeof window !== "undefined" && !isLocalHost(window.location.hostname);
}

// ------------------------------------------------------------------ live API
async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, { cache: "no-store" });
  } catch {
    throw new Error(`Cannot reach the ChainSentinel API at ${API_URL}. Is "npm run api" running in backend/?`);
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `API error ${res.status}`);
  return body as T;
}

type AlertQuery = { minSeverity?: number; targetId?: number; limit?: number; includeOrphaned?: boolean };

function liveAlerts(q: AlertQuery) {
  const p = new URLSearchParams();
  if (q.minSeverity !== undefined) p.set("minSeverity", String(q.minSeverity));
  if (q.targetId !== undefined) p.set("targetId", String(q.targetId));
  if (q.includeOrphaned) p.set("includeOrphaned", "1");
  p.set("limit", String(q.limit ?? 50));
  return getJson<{ alerts: ApiAlert[]; total: number }>("/api/alerts?" + p.toString());
}

// ------------------------------------------------------------------ snapshot
let snapshotPromise: Promise<Snapshot> | null = null;

function loadSnapshot(): Promise<Snapshot> {
  if (!snapshotPromise) {
    snapshotPromise = fetch("/snapshot.json", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("The demo snapshot (snapshot.json) was not found on this site.");
        return (await r.json()) as Snapshot;
      })
      .catch((e) => {
        snapshotPromise = null;
        throw e;
      });
  }
  return snapshotPromise;
}

function stripDetail(d: ApiAlertDetail): ApiAlert {
  const { evidence: _evidence, evidenceJson: _json, evidenceHashValid: _valid, ...summary } = d;
  return summary;
}

async function snapshotAlerts(q: AlertQuery) {
  const s = await loadSnapshot();
  const rows = s.alerts
    .filter(
      (a) =>
        (q.includeOrphaned || a.status !== "orphaned") &&
        (q.minSeverity === undefined || a.severity >= q.minSeverity) &&
        (q.targetId === undefined || a.targetId === q.targetId)
    )
    .sort((a, b) => b.blockNumber - a.blockNumber || b.sourceLogIndex - a.sourceLogIndex);
  return { total: rows.length, alerts: rows.slice(0, q.limit ?? 50).map(stripDetail) };
}

async function snapshotHealth(): Promise<ApiHealth> {
  const s = await loadSnapshot();
  return {
    ok: true,
    dbReady: true,
    monitor: { status: "snapshot", snapshotAt: s.generatedAt, checkpointBlock: s.checkpointBlock, confirmations: s.config.confirmations },
    publisher: { status: "snapshot", lastRunAt: null, secondsSinceLastRun: null, backlog: 0, statuses: {} },
    counts: s.counts,
  };
}

const registryAbi = parseAbi([
  "function targetCount() view returns (uint256)",
  "function getTarget(uint256 targetId) view returns ((address owner, address target, uint256 transferThreshold, bool enabled))",
]);

async function chainCall(chainId: number, to: string, data: Hex): Promise<Hex> {
  const params = [{ to, data }, "latest"];
  if (useProxy()) {
    try {
      return (await proxyCall(chainId, "eth_call", params)) as Hex;
    } catch (e) {
      if (!(e instanceof RpcUnavailable)) throw e;
    }
  }
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`unknown chain ${chainId}`);
  return (await directCall(chain.rpcUrl, "eth_call", params)) as Hex;
}

/** Target configuration is read live from the registry; registration links and alert counts come from the snapshot. */
async function snapshotTargets(): Promise<ApiTarget[]> {
  const s = await loadSnapshot();
  const { chainId, registryAddress } = s.config;
  const countRaw = await chainCall(chainId, registryAddress, encodeFunctionData({ abi: registryAbi, functionName: "targetCount" }));
  const count = Number(decodeFunctionResult({ abi: registryAbi, functionName: "targetCount", data: countRaw }));
  const ids = Array.from({ length: Math.min(count, 100) }, (_, i) => i + 1);
  return Promise.all(
    ids.map(async (id) => {
      const raw = await chainCall(chainId, registryAddress, encodeFunctionData({ abi: registryAbi, functionName: "getTarget", args: [BigInt(id)] }));
      const t = decodeFunctionResult({ abi: registryAbi, functionName: "getTarget", data: raw });
      const known = s.targets.find((x) => x.targetId === id);
      return {
        targetId: id,
        address: t.target.toLowerCase(),
        owner: t.owner.toLowerCase(),
        enabled: t.enabled,
        transferThresholdRaw: t.transferThreshold.toString(),
        registrationTx: known?.registrationTx ?? null,
        registrationBlock: known?.registrationBlock ?? null,
        alertCount: s.alerts.filter((a) => a.targetId === id && a.status !== "orphaned").length,
      };
    })
  );
}

async function snapshotAlert(id: string): Promise<ApiAlertDetail> {
  const s = await loadSnapshot();
  const a = s.alerts.find((x) => x.alertId.toLowerCase() === id.toLowerCase());
  if (!a) throw new Error("alert not found");
  return { ...a, evidenceHashValid: keccak256(toHex(a.evidenceJson)) === a.evidenceHash };
}

// -------------------------------------------------------------------- public
export const api = {
  config: (): Promise<ApiConfig> => (isSnapshotMode() ? loadSnapshot().then((s) => s.config) : getJson<ApiConfig>("/api/config")),
  health: (): Promise<ApiHealth> => (isSnapshotMode() ? snapshotHealth() : getJson<ApiHealth>("/api/health")),
  targets: async (): Promise<ApiTarget[]> =>
    isSnapshotMode() ? snapshotTargets() : (await getJson<{ targets: ApiTarget[] }>("/api/targets")).targets,
  alerts: (q: AlertQuery) => (isSnapshotMode() ? snapshotAlerts(q) : liveAlerts(q)),
  alert: async (id: string): Promise<ApiAlertDetail> =>
    isSnapshotMode() ? snapshotAlert(id) : (await getJson<{ alert: ApiAlertDetail }>(`/api/alerts/${id}`)).alert,
};
