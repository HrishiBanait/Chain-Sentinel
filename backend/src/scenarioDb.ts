
import { DatabaseSync } from "node:sqlite";
import type { DetectedAlert } from "./scenarioCore.js";

type Param = null | number | bigint | string;

export interface DbSnapshot {
  targets: number;
  enabledTargets: number;
  events: Record<string, number>;
  alertsByRule: Record<string, number>;
  alertsBySeverity: Record<string, number>;
  alertStatuses: Record<string, number>;
  verifiedPublications: number;
  notifyStatuses: Record<string, number>;
  counters: Record<string, number>;
}

/** Read-only view used by the scenario runner and metrics script. */
export class ScenarioDb {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file, { readOnly: true });
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  close(): void {
    this.db.close();
  }

  private all<T>(sql: string, ...p: Param[]): T[] {
    return this.db.prepare(sql).all(...p) as unknown as T[];
  }

  private one<T>(sql: string, ...p: Param[]): T | undefined {
    return this.db.prepare(sql).get(...p) as unknown as T | undefined;
  }

  private group(sql: string): Record<string, number> {
    const out: Record<string, number> = {};

    for (const r of this.all<{ k: string | number; n: number }>(sql)) {
      out[String(r.k)] = r.n;
    }

    return out;
  }

  hasTable(name: string): boolean {
    return !!this.one<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      name
    );
  }

  meta(key: string): string | undefined {
    return this.one<{ value: string }>(
      "SELECT value FROM schema_meta WHERE key = ?",
      key
    )?.value;
  }

  checkpoint(): number | null {
    return this.one<{ block_number: number }>(
      "SELECT block_number FROM checkpoints WHERE name = 'main'"
    )?.block_number ?? null;
  }

  counters(): Record<string, number> {
    const out: Record<string, number> = {};

    for (const r of this.all<{ name: string; value: number }>(
      "SELECT name, value FROM metrics"
    )) {
      out[r.name] = r.value;
    }

    return out;
  }

  alertsFrom(blockNumber: number): DetectedAlert[] {
    const notify = this.hasTable("notify_log");

    return this.all<{
      alert_id: string;
      source_tx_hash: string;
      rule_id: string;
      target_id: number;
      severity: number;
      detected_at: number;
      published_at: number | null;
      notified_at: number | null;
      status: string;
    }>(
      `SELECT
         a.alert_id,
         a.source_tx_hash,
         a.rule_id,
         a.target_id,
         a.severity,
         a.detected_at,
         a.published_at,
         a.status,
         ${notify ? "n.sent_at" : "NULL"} AS notified_at
       FROM alerts a
       ${notify ? "LEFT JOIN notify_log n ON n.alert_id = a.alert_id" : ""}
       WHERE a.block_number >= ?
         AND a.status <> 'orphaned'
       ORDER BY a.block_number, a.id`,
      blockNumber
    ).map((r) => ({
      alertId: r.alert_id,
      txHash: r.source_tx_hash,
      ruleId: r.rule_id,
      targetId: r.target_id,
      severity: r.severity,
      detectedAt: r.detected_at,
      publishedAt: r.published_at,
      notifiedAt: r.notified_at,
      status: r.status,
    }));
  }

  snapshot(): DbSnapshot {
    const enabled = this.one<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM (
         SELECT enabled,
                ROW_NUMBER() OVER (
                  PARTITION BY target_id
                  ORDER BY block_number DESC, log_index DESC
                ) AS rn
         FROM target_config
       )
       WHERE rn = 1 AND enabled = 1`
    )?.n ?? 0;

    return {
      targets: this.one<{ n: number }>(
        "SELECT COUNT(DISTINCT target_id) AS n FROM target_config"
      )?.n ?? 0,

      enabledTargets: enabled,

      events: this.group(
        "SELECT event_name AS k, COUNT(*) AS n FROM events GROUP BY event_name ORDER BY event_name"
      ),

      alertsByRule: this.group(
        "SELECT rule_id AS k, COUNT(*) AS n FROM alerts WHERE status <> 'orphaned' GROUP BY rule_id ORDER BY rule_id"
      ),

      alertsBySeverity: this.group(
        "SELECT severity AS k, COUNT(*) AS n FROM alerts WHERE status <> 'orphaned' GROUP BY severity ORDER BY severity"
      ),

      alertStatuses: this.group(
        "SELECT status AS k, COUNT(*) AS n FROM alerts GROUP BY status"
      ),

      verifiedPublications: this.hasTable("publish_log")
        ? this.one<{ n: number }>(
            "SELECT COUNT(*) AS n FROM publish_log WHERE verified_at IS NOT NULL"
          )?.n ?? 0
        : 0,

      notifyStatuses: this.hasTable("notify_log")
        ? this.group(
            "SELECT status AS k, COUNT(*) AS n FROM notify_log GROUP BY status"
          )
        : {},

      counters: this.counters(),
    };
  }
}
