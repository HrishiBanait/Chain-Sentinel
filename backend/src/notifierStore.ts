import { DatabaseSync } from "node:sqlite";
import type { Hex } from "viem";
import type { NotifyAlert } from "./notifyFormat.js";

type Param = null | number | bigint | string;

export interface NotifyCandidate extends NotifyAlert {
  detectedAt: number;
  eventTime: number | null;
  attempts: number;
  lastAttemptAt: number | null;
}

export interface RetractionRow {
  alertId: Hex;
  messageId: number | null;
  title: string | null;
}

export interface NotifyLog {
  status: string;
  messageId: number | null;
  attempts: number;
  lastError: string | null;
  sentAt: number | null;
}

/** Notification bookkeeping, kept in the monitor's SQLite file. */
export class NotifierStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000");
    const has = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'alerts'").get();
    if (!has) {
      this.db.close();
      throw new Error("alerts table not found: run the monitor first so it creates the database");
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS notify_log (
      alert_id TEXT PRIMARY KEY, status TEXT NOT NULL, message_id INTEGER, title TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_attempt_at INTEGER,
      sent_at INTEGER, retracted_at INTEGER, updated_at INTEGER NOT NULL)`);
  }

  close(): void {
    this.db.close();
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

  setMeta(key: string, value: string): void {
    this.run(
      "INSERT INTO schema_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, value
    );
  }

  candidates(minSeverity: number, limit: number, includeSkipped: boolean): NotifyCandidate[] {
    const statuses = includeSkipped ? "'retry', 'retracted', 'skipped'" : "'retry', 'retracted'";
    return this.all<{
      alert_id: Hex; target_id: number; target_address: string | null; rule_id: string; severity: number; title: string;
      observed: string; assessment: string; caveat: string; source_tx_hash: string; block_number: number;
      detected_at: number; event_time: number | null; attempts: number; last_attempt_at: number | null;
    }>(
      `SELECT a.alert_id, a.target_id, a.rule_id, a.severity, a.title, a.observed, a.assessment, a.caveat,
              a.source_tx_hash, a.block_number, a.detected_at, e.block_timestamp AS event_time,
              (SELECT t.target_address FROM target_config t WHERE t.target_id = a.target_id
                 ORDER BY t.block_number DESC, t.log_index DESC LIMIT 1) AS target_address,
              COALESCE(l.attempts, 0) AS attempts, l.last_attempt_at
       FROM alerts a
       LEFT JOIN events e ON e.chain_id = a.chain_id AND e.tx_hash = a.source_tx_hash AND e.log_index = a.source_log_index
       LEFT JOIN notify_log l ON l.alert_id = a.alert_id
       WHERE a.status <> 'orphaned' AND a.severity >= ? AND (l.alert_id IS NULL OR l.status IN (${statuses}))
       ORDER BY a.block_number, a.id LIMIT ?`,
      minSeverity, limit
    ).map((r) => ({
      alertId: r.alert_id, targetId: r.target_id, targetAddress: r.target_address, ruleId: r.rule_id,
      severity: r.severity, title: r.title, observed: r.observed, assessment: r.assessment, caveat: r.caveat,
      sourceTxHash: r.source_tx_hash, blockNumber: r.block_number, detectedAt: r.detected_at,
      eventTime: r.event_time, attempts: r.attempts, lastAttemptAt: r.last_attempt_at,
    }));
  }

  /** Alerts we announced whose source event has since been removed or orphaned by a reorg. */
  retractions(limit: number): RetractionRow[] {
    return this.all<{ alert_id: Hex; message_id: number | null; title: string | null }>(
      `SELECT l.alert_id, l.message_id, l.title FROM notify_log l
       LEFT JOIN alerts a ON a.alert_id = l.alert_id
       WHERE l.status = 'sent' AND (a.alert_id IS NULL OR a.status = 'orphaned')
       ORDER BY l.sent_at LIMIT ?`,
      limit
    ).map((r) => ({ alertId: r.alert_id, messageId: r.message_id, title: r.title }));
  }

  markSent(alertId: Hex, messageId: number, title: string, at: number): void {
    this.run(
      `INSERT INTO notify_log(alert_id, status, message_id, title, attempts, sent_at, updated_at) VALUES (?, 'sent', ?, ?, 1, ?, ?)
       ON CONFLICT(alert_id) DO UPDATE SET status = 'sent', message_id = excluded.message_id, title = excluded.title,
         attempts = attempts + 1, last_error = NULL, sent_at = excluded.sent_at, retracted_at = NULL, updated_at = excluded.updated_at`,
      alertId, messageId, title, at, at
    );
  }
  
  recordAttempt(alertId: Hex, error: string, at: number): void {
    this.run(
      `INSERT INTO notify_log(
        alert_id, status, attempts, last_error,
        last_attempt_at, updated_at
      )
      VALUES (?, 'retry', 1, ?, ?, ?)
      ON CONFLICT(alert_id) DO UPDATE SET
        status = 'retry',
        attempts = notify_log.attempts + 1,
        last_error = excluded.last_error,
        last_attempt_at = excluded.last_attempt_at,
        updated_at = excluded.updated_at`,
      alertId,
      error,
      at,
      at
    );
  }

  
  markTerminal(alertId: Hex, status: "skipped" | "failed", reason: string, at: number): void {
    this.run(
      `INSERT INTO notify_log(alert_id, status, last_error, attempts, updated_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(alert_id) DO UPDATE SET status = excluded.status, last_error = excluded.last_error, updated_at = excluded.updated_at`,
      alertId, status, reason, at
    );
  }

  markRetracted(alertId: Hex, at: number, note: string | null): void {
    this.run(
      `UPDATE notify_log SET status = 'retracted', retracted_at = ?, attempts = 0, last_attempt_at = NULL,
         last_error = ?, updated_at = ? WHERE alert_id = ?`,
      at, note, at, alertId
    );
  }

  getLog(alertId: Hex): NotifyLog | undefined {
    const r = this.one<{ status: string; message_id: number | null; attempts: number; last_error: string | null; sent_at: number | null }>(
      "SELECT status, message_id, attempts, last_error, sent_at FROM notify_log WHERE alert_id = ?", alertId
    );
    return r ? { status: r.status, messageId: r.message_id, attempts: r.attempts, lastError: r.last_error, sentAt: r.sent_at } : undefined;
  }
}
