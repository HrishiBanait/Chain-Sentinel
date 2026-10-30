import { DatabaseSync } from "node:sqlite";
import type { Hex } from "viem";

type Param = null | number | bigint | string;

export interface Candidate {
  alertId: Hex;
  targetId: number;
  evidenceHash: Hex;
  severity: number;
  ruleId: string;
  blockNumber: number;
  detectedAt: number;
  logStatus: string | null;
  txHash: Hex | null;
  attempts: number;
  lastAttemptAt: number | null;
}

export interface ToVerify {
  alertId: Hex;
  evidenceHash: Hex;
  txHash: Hex | null;
  blockNumber: number | null;
}

export interface AlertState {
  status: string;
  publishTxHash: Hex | null;
  publishedAt: number | null;
}

export interface LogState {
  status: string;
  txHash: Hex | null;
  blockNumber: number | null;
  attempts: number;
  lastError: string | null;
  verifiedAt: number | null;
}

/** Publication bookkeeping. Opens its own connection to the monitor's database file. */
export class PublisherStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000");
    const has = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'alerts'").get();
    if (!has) {
      this.db.close();
      throw new Error("alerts table not found: run the monitor first so it creates the database");
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS publish_log (
      alert_id TEXT PRIMARY KEY, status TEXT NOT NULL, tx_hash TEXT, block_number INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_attempt_at INTEGER,
      verified_at INTEGER, updated_at INTEGER NOT NULL)`);
  }

  close(): void {
    this.db.close();
  }

  setMeta(key: string, value: string): void {
    this.run(
      "INSERT INTO schema_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, value
    );
  }

  private run(sql: string, ...p: Param[]) {
    return this.db.prepare(sql).run(...p);
  }
  private all<T>(sql: string, ...p: Param[]): T[] {
    return this.db.prepare(sql).all(...p) as unknown as T[];
  }
  private one<T>(sql: string, ...p: Param[]): T | undefined {
    return this.db.prepare(sql).get(...p) as unknown as T | undefined;
  }
  private tx(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  candidates(minSeverity: number, limit: number): Candidate[] {
    return this.all<{
      alert_id: Hex; target_id: number; evidence_hash: Hex; severity: number; rule_id: string;
      block_number: number; detected_at: number; log_status: string | null; tx_hash: Hex | null;
      attempts: number; last_attempt_at: number | null;
    }>(
      `SELECT a.alert_id, a.target_id, a.evidence_hash, a.severity, a.rule_id, a.block_number, a.detected_at,
              l.status AS log_status, l.tx_hash, COALESCE(l.attempts, 0) AS attempts, l.last_attempt_at
       FROM alerts a LEFT JOIN publish_log l ON l.alert_id = a.alert_id
       WHERE a.status = 'new' AND a.severity >= ?
       ORDER BY a.block_number, a.id LIMIT ?`,
      minSeverity, limit
    ).map((r) => ({
      alertId: r.alert_id, targetId: r.target_id, evidenceHash: r.evidence_hash, severity: r.severity,
      ruleId: r.rule_id, blockNumber: r.block_number, detectedAt: r.detected_at, logStatus: r.log_status,
      txHash: r.tx_hash, attempts: r.attempts, lastAttemptAt: r.last_attempt_at,
    }));
  }

  recordPending(alertId: Hex, txHash: Hex, at: number): void {
    this.run(
      `INSERT INTO publish_log(alert_id, status, tx_hash, attempts, last_attempt_at, updated_at) VALUES (?, 'pending', ?, 1, ?, ?)
       ON CONFLICT(alert_id) DO UPDATE SET status = 'pending', tx_hash = excluded.tx_hash, attempts = attempts + 1,
         last_attempt_at = excluded.last_attempt_at, updated_at = excluded.updated_at`,
      alertId, txHash, at, at
    );
  }

  recordAttempt(alertId: Hex, error: string, at: number): void {
    this.run(
      `INSERT INTO publish_log(alert_id, status, attempts, last_error, last_attempt_at, updated_at) VALUES (?, 'retry', 1, ?, ?, ?)
       ON CONFLICT(alert_id) DO UPDATE SET status = 'retry', tx_hash = NULL, attempts = attempts + 1,
         last_error = excluded.last_error, last_attempt_at = excluded.last_attempt_at, updated_at = excluded.updated_at`,
      alertId, error, at, at
    );
  }

  clearPending(alertId: Hex, at: number): void {
    this.run("UPDATE publish_log SET status = 'retry', tx_hash = NULL, updated_at = ? WHERE alert_id = ?", at, alertId);
  }

  markPublished(alertId: Hex, txHash: Hex, blockNumber: number, at: number): void {
    this.tx(() => {
      this.run("UPDATE alerts SET status = 'published', publish_tx_hash = ?, published_at = ? WHERE alert_id = ? AND status = 'new'", txHash, at, alertId);
      this.run(
        `INSERT INTO publish_log(alert_id, status, tx_hash, block_number, attempts, last_error, updated_at) VALUES (?, 'published', ?, ?, 0, NULL, ?)
         ON CONFLICT(alert_id) DO UPDATE SET status = 'published', tx_hash = excluded.tx_hash, block_number = excluded.block_number,
           last_error = NULL, verified_at = NULL, updated_at = excluded.updated_at`,
        alertId, txHash, blockNumber, at
      );
    });
  }

  /** Terminal states for alerts still waiting ('skipped') or in need of attention ('failed'). */
  markTerminal(alertId: Hex, status: "skipped" | "failed", reason: string, at: number): void {
    this.tx(() => {
      this.run("UPDATE alerts SET status = ? WHERE alert_id = ? AND status IN ('new', 'published')", status, alertId);
      this.run(
        `INSERT INTO publish_log(alert_id, status, last_error, attempts, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(alert_id) DO UPDATE SET status = excluded.status, last_error = excluded.last_error, updated_at = excluded.updated_at`,
        alertId, status, reason, at
      );
    });
  }

  publishedToVerify(): ToVerify[] {
    return this.all<{ alert_id: Hex; evidence_hash: Hex; tx_hash: Hex | null; block_number: number | null }>(
      `SELECT a.alert_id, a.evidence_hash, l.tx_hash, l.block_number FROM alerts a
       JOIN publish_log l ON l.alert_id = a.alert_id
       WHERE a.status = 'published' AND l.verified_at IS NULL`
    ).map((r) => ({ alertId: r.alert_id, evidenceHash: r.evidence_hash, txHash: r.tx_hash, blockNumber: r.block_number }));
  }

  markVerified(alertId: Hex, at: number): void {
    this.run("UPDATE publish_log SET verified_at = ?, updated_at = ? WHERE alert_id = ?", at, at, alertId);
  }

  markUnpublished(alertId: Hex, at: number): void {
    this.tx(() => {
      this.run("UPDATE alerts SET status = 'new', publish_tx_hash = NULL, published_at = NULL WHERE alert_id = ? AND status = 'published'", alertId);
      this.run(
        `UPDATE publish_log SET status = 'retry', tx_hash = NULL, block_number = NULL, verified_at = NULL,
           attempts = 0, last_attempt_at = NULL,
           last_error = 'publication no longer on chain (reorg?)', updated_at = ? WHERE alert_id = ?`,
        at, alertId
      );
    });
  }

  getAlertState(alertId: Hex): AlertState | undefined {
    const r = this.one<{ status: string; publish_tx_hash: Hex | null; published_at: number | null }>(
      "SELECT status, publish_tx_hash, published_at FROM alerts WHERE alert_id = ?", alertId
    );
    return r ? { status: r.status, publishTxHash: r.publish_tx_hash, publishedAt: r.published_at } : undefined;
  }

  getLog(alertId: Hex): LogState | undefined {
    const r = this.one<{ status: string; tx_hash: Hex | null; block_number: number | null; attempts: number; last_error: string | null; verified_at: number | null }>(
      "SELECT status, tx_hash, block_number, attempts, last_error, verified_at FROM publish_log WHERE alert_id = ?", alertId
    );
    return r ? { status: r.status, txHash: r.tx_hash, blockNumber: r.block_number, attempts: r.attempts, lastError: r.last_error, verifiedAt: r.verified_at } : undefined;
  }

  statusCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM alerts GROUP BY status")) out[r.status] = r.n;
    return out;
  }
}
