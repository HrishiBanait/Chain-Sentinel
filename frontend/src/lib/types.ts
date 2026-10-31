export interface ApiConfig {
  network: "testnet" | "mainnet";
  isTestnet: boolean;
  chainId: number;
  chainName: string;
  registryAddress: string;
  explorerUrl: string;
  confirmations: number;
  monitoredTokens: string[];
}

export interface ApiHealth {
  ok: boolean;
  dbReady: boolean;
  monitor: {
    status: "ok" | "stale" | "unknown" | "snapshot";
    snapshotAt?: number | null;
    lastSyncAt?: number | null;
    secondsSinceLastSync?: number | null;
    headBlock?: number | null;
    checkpointBlock?: number | null;
    blocksBehindHead?: number | null;
    confirmations?: number;
  };
  publisher?: {
    status: "ok" | "stale" | "unknown" | "snapshot";
    lastRunAt: number | null;
    secondsSinceLastRun: number | null;
    backlog: number;
    statuses: Record<string, number>;
  };
  counts?: { events: number; alerts: number; targets: number };
  counters?: Record<string, number>;
}

export interface ApiTarget {
  targetId: number;
  address: string;
  owner: string;
  enabled: boolean;
  transferThresholdRaw: string;
  registrationTx: string | null;
  registrationBlock: number | null;
  alertCount: number;
}

export interface ApiAlert {
  alertId: string;
  chainId: number;
  targetId: number;
  ruleId: string;
  ruleVersion: number;
  severity: number;
  severityLabel: string;
  title: string;
  observed: string;
  assessment: string;
  caveat: string;
  evidenceHash: string;
  sourceTxHash: string;
  sourceLogIndex: number;
  blockNumber: number;
  sourceBlockTimestamp: number | null;
  status: string;
  detectedAt: number;
  publishTxHash: string | null;
  publishedAt: number | null;
  publishNote: string | null;
  publishAttempts: number | null;
  publishBlock: number | null;
  verifiedAt: number | null;
}

export interface ApiAlertDetail extends ApiAlert {
  evidence: unknown;
  evidenceJson: string;
  evidenceHashValid: boolean;
}

export interface Snapshot {
  version: number;
  generatedAt: number;
  commit: string | null;
  config: ApiConfig;
  checkpointBlock: number | null;
  counts: { events: number; alerts: number; targets: number };
  targets: ApiTarget[];
  alerts: ApiAlertDetail[];
}
