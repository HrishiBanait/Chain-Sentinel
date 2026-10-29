import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Hex } from "viem";

type Param = null | number | bigint | string;

export interface Checkpoint {
  blockNumber: bigint;
  blockHash: Hex;
}

export interface StoredEvent {
  chainId: number;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: number;
  address: Hex;
  eventName: string;
  args: Record<string, string | boolean>;
}

export interface TargetConfig {
  targetId: number;
  blockNumber: bigint;
  logIndex: number;
  owner: Hex;
  targetAddress: Hex;
  enabled: boolean;
  transferThreshold: bigint;
}

export interface NewAlert {
  alertId: Hex;
  chainId: number;
  targetId: number;
  ruleId: string;
  ruleVersion: number;
  severity: number;
  title: string;
  observed: string;
  assessment: string;
  caveat: string;
  evidenceJson: string;
  evidenceHash: Hex;
  sourceTxHash: Hex;
  sourceLogIndex: number;
  blockNumber: bigint;
  detectedAt: number;
}

export interface AlertRow {
  id: number;
  alert_id: Hex;
  chain_id: number;
  target_id: number;
  rule_id: string;
  rule_version: number;
  severity: number;
  title: string;
  observed: string;
  assessment: string;
  caveat: string;
  evidence_json: string;
  evidence_hash: Hex;
  source_tx_hash: Hex;
  source_log_index: number;
  block_number: number;
  status: string;
  detected_at: number;
  publish_tx_hash: Hex | null;
  published_at: number | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (
  name TEXT PRIMARY KEY, block_number INTEGER NOT NULL, block_hash TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS block_hashes (block_number INTEGER PRIMARY KEY, block_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS target_config (
  target_id INTEGER NOT NULL, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL,
  owner TEXT NOT NULL, target_address TEXT NOT NULL, enabled INTEGER NOT NULL, transfer_threshold TEXT NOT NULL,
  PRIMARY KEY (target_id, block_number, log_index));
CREATE INDEX IF NOT EXISTS idx_target_config_address ON target_config(target_address);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL, block_hash TEXT NOT NULL, block_timestamp INTEGER NOT NULL,
  address TEXT NOT NULL, event_name TEXT NOT NULL, args_json TEXT NOT NULL, observed_at INTEGER NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index));
CREATE INDEX IF NOT EXISTS idx_events_block ON events(block_number);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id TEXT NOT NULL UNIQUE, chain_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
  rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL, severity INTEGER NOT NULL,
  title TEXT NOT NULL, observed TEXT NOT NULL, assessment TEXT NOT NULL, caveat TEXT NOT NULL,
  evidence_json TEXT NOT NULL, evidence_hash TEXT NOT NULL,
  source_tx_hash TEXT NOT NULL, source_log_index INTEGER NOT NULL, block_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', detected_at INTEGER NOT NULL,
  publish_tx_hash TEXT, published_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_alerts_block ON alerts(block_number);
CREATE TABLE IF NOT EXISTS metrics (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

const nowSecs = () => Math.floor(Date.now() / 1000);

export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(DDL);
    this.run("INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '1')");
  }

  private run(sql: string, ...p: Param[]) {
    return this.db.prepare(sql).run(...p);
  }
  private one<T>(sql: string, ...p: Param[]): T | undefined {
    return this.db.prepare(sql).get(...p) as unknown as T | undefined;
  }
  private many<T>(sql: string, ...p: Param[]): T[] {
    return this.db.prepare(sql).all(...p) as unknown as T[];
  }

  /** Synchronous only. Not re-entrant. */
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Refuse to reuse a database that belongs to a different chain or registry. */
  bindIdentity(chainId: number, registry: Hex): void {
    const id = `${chainId}:${registry.toLowerCase()}`;
    const row = this.one<{ value: string }>("SELECT value FROM schema_meta WHERE key = 'identity'");
    if (!row) this.run("INSERT INTO schema_meta(key, value) VALUES ('identity', ?)", id);
    else if (row.value !== id) {
      throw new Error(`Database belongs to ${row.value}, not ${id}. Use a different MONITOR_DB_PATH.`);
    }
  }

  // ------------------------------------------------------------ checkpoints
  getCheckpoint(): Checkpoint | null {
    const r = this.one<{ block_number: number; block_hash: Hex }>(
      "SELECT block_number, block_hash FROM checkpoints WHERE name = 'main'"
    );
    return r ? { blockNumber: BigInt(r.block_number), blockHash: r.block_hash } : null;
  }

  private setCheckpoint(n: bigint, hash: Hex): void {
    this.run(
      `INSERT INTO checkpoints(name, block_number, block_hash, updated_at) VALUES ('main', ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET block_number = excluded.block_number,
         block_hash = excluded.block_hash, updated_at = excluded.updated_at`,
      n, hash, nowSecs()
    );
  }

  recordBatchEnd(n: bigint, hash: Hex): void {
    this.setCheckpoint(n, hash);
    this.run("INSERT OR REPLACE INTO block_hashes(block_number, block_hash) VALUES (?, ?)", n, hash);
    this.run(
      "DELETE FROM block_hashes WHERE block_number NOT IN (SELECT block_number FROM block_hashes ORDER BY block_number DESC LIMIT 512)"
    );
  }

  recentBlockHashes(limit: number): Checkpoint[] {
    return this.many<{ block_number: number; block_hash: Hex }>(
      "SELECT block_number, block_hash FROM block_hashes ORDER BY block_number DESC LIMIT ?", limit
    ).map((r) => ({ blockNumber: BigInt(r.block_number), blockHash: r.block_hash }));
  }

  /** Undo everything after `blockNumber`. hash === null clears the checkpoint (full re-scan). */
  rollbackTo(blockNumber: bigint, hash: Hex | null): void {
    this.tx(() => {
      this.run("DELETE FROM events WHERE block_number > ?", blockNumber);
      this.run("DELETE FROM target_config WHERE block_number > ?", blockNumber);
      this.run("DELETE FROM alerts WHERE block_number > ? AND status = 'new'", blockNumber);
      this.run(
        "UPDATE alerts SET status = 'orphaned' WHERE block_number > ? AND status <> 'orphaned'", blockNumber
      );
      this.run("DELETE FROM block_hashes WHERE block_number > ?", blockNumber);
      if (hash) this.setCheckpoint(blockNumber, hash);
      else this.run("DELETE FROM checkpoints WHERE name = 'main'");
    });
  }

  // ------------------------------------------------------------------ events
  insertEvent(e: StoredEvent): boolean {
    const r = this.run(
      `INSERT OR IGNORE INTO events(chain_id, tx_hash, log_index, block_number, block_hash, block_timestamp,
         address, event_name, args_json, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      e.chainId, e.txHash, e.logIndex, e.blockNumber, e.blockHash, e.blockTimestamp,
      e.address, e.eventName, JSON.stringify(e.args), nowSecs()
    );
    return Number(r.changes) > 0;
  }

  countEvents(): number {
    return this.one<{ n: number }>("SELECT COUNT(*) AS n FROM events")?.n ?? 0;
  }

  eventCounts(): { event_name: string; n: number }[] {
    return this.many("SELECT event_name, COUNT(*) AS n FROM events GROUP BY event_name ORDER BY event_name");
  }

  // ----------------------------------------------------------- target config
  insertConfig(c: TargetConfig): void {
    this.run(
      `INSERT OR IGNORE INTO target_config(target_id, block_number, log_index, owner, target_address, enabled, transfer_threshold)
       VALUES (?,?,?,?,?,?,?)`,
      c.targetId, c.blockNumber, c.logIndex, c.owner, c.targetAddress, c.enabled ? 1 : 0, c.transferThreshold.toString()
    );
  }

  /** Configuration in force at (block, logIndex), inclusive. */
  latestConfig(targetId: number, block: bigint, logIndex: number): TargetConfig | undefined {
    const r = this.one<{
      target_id: number; block_number: number; log_index: number; owner: Hex;
      target_address: Hex; enabled: number; transfer_threshold: string;
    }>(
      `SELECT * FROM target_config WHERE target_id = ?
         AND (block_number < ? OR (block_number = ? AND log_index <= ?))
       ORDER BY block_number DESC, log_index DESC LIMIT 1`,
      targetId, block, block, logIndex
    );
    return r
      ? {
          targetId: r.target_id,
          blockNumber: BigInt(r.block_number),
          logIndex: r.log_index,
          owner: r.owner,
          targetAddress: r.target_address,
          enabled: r.enabled === 1,
          transferThreshold: BigInt(r.transfer_threshold),
        }
      : undefined;
  }

  targetIdsForAddress(address: string): number[] {
    return this.many<{ target_id: number }>(
      "SELECT DISTINCT target_id FROM target_config WHERE target_address = ? ORDER BY target_id",
      address.toLowerCase()
    ).map((r) => r.target_id);
  }

  allTargetIds(): number[] {
    return this.many<{ target_id: number }>("SELECT DISTINCT target_id FROM target_config ORDER BY target_id").map(
      (r) => r.target_id
    );
  }

  targetAddresses(): string[] {
    return this.many<{ target_address: string }>("SELECT DISTINCT target_address FROM target_config").map(
      (r) => r.target_address
    );
  }

  // ------------------------------------------------------------------ alerts
  insertAlert(a: NewAlert): boolean {
    const r = this.run(
      `INSERT OR IGNORE INTO alerts(alert_id, chain_id, target_id, rule_id, rule_version, severity, title,
         observed, assessment, caveat, evidence_json, evidence_hash, source_tx_hash, source_log_index,
         block_number, status, detected_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`,
      a.alertId, a.chainId, a.targetId, a.ruleId, a.ruleVersion, a.severity, a.title,
      a.observed, a.assessment, a.caveat, a.evidenceJson, a.evidenceHash, a.sourceTxHash, a.sourceLogIndex,
      a.blockNumber, a.detectedAt
    );
    return Number(r.changes) > 0;
  }

  listAlerts(): AlertRow[] {
    return this.many<AlertRow>("SELECT * FROM alerts ORDER BY block_number, source_log_index, id");
  }

  alertLatencies(): number[] {
    return this.many<{ secs: number }>(
      `SELECT a.detected_at - e.block_timestamp AS secs FROM alerts a
       JOIN events e ON e.chain_id = a.chain_id AND e.tx_hash = a.source_tx_hash AND e.log_index = a.source_log_index`
    ).map((r) => r.secs);
  }

  // ----------------------------------------------------------------- metrics
  incr(name: string, by = 1): void {
    this.run(
      "INSERT INTO metrics(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = value + excluded.value",
      name, by
    );
  }

  counters(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.many<{ name: string; value: number }>("SELECT name, value FROM metrics")) out[r.name] = r.value;
    return out;
  }
}
