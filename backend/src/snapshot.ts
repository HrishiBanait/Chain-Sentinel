import { alertDetail } from "./api.js";
import type { ReadStore } from "./readStore.js";

export interface SnapshotConfig {
  network: "testnet" | "mainnet";
  isTestnet: boolean;
  chainId: number;
  chainName: string;
  registryAddress: string;
  explorerUrl: string;
  confirmations: number;
  monitoredTokens: string[];
}

export interface SnapshotTarget {
  targetId: number;
  address: string;
  owner: string;
  enabled: boolean;
  transferThresholdRaw: string;
  registrationTx: string | null;
  registrationBlock: number | null;
  alertCount: number;
}

export interface Snapshot {
  version: 1;
  generatedAt: number;
  commit: string | null;
  config: SnapshotConfig;
  checkpointBlock: number | null;
  counts: { events: number; alerts: number; targets: number };
  targets: SnapshotTarget[];
  alerts: ReturnType<typeof alertDetail>[];
}

const MAX_NOTE = 300;

/** A static, public copy of the monitor's data for the hosted demo. Contains only public on-chain data and our own analysis. */
export function buildSnapshot(store: ReadStore, o: { config: SnapshotConfig; commit: string | null; now: number }): Snapshot {
  if (!store.ready()) throw new Error("database not ready: run the monitor first");

  const alerts: Snapshot["alerts"] = [];
  let offset = 0;
  for (;;) {
    const { total, rows } = store.alerts({ limit: 200, offset, includeOrphaned: true });
    for (const r of rows) {
      const d = alertDetail(r);
      alerts.push({ ...d, publishNote: d.publishNote ? d.publishNote.slice(0, MAX_NOTE) : null });
    }
    offset += rows.length;
    if (rows.length === 0 || offset >= total || offset >= 10_000) break;
  }

  return {
    version: 1,
    generatedAt: o.now,
    commit: o.commit,
    config: o.config,
    checkpointBlock: store.checkpoint()?.blockNumber ?? null,
    counts: store.counts(),
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
    alerts,
  };
}
