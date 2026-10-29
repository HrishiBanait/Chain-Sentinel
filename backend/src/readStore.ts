import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Param = null | number | bigint | string;

export interface TargetRow {
  target_id: number;
  block_number: number;
  log_index: number;
  owner: string;
  target_address: string;
  enabled: number;
  transfer_threshold: string;
  registration_tx: string | null;
  registration_block: number | null;
  alert_count: number;
}

export interface AlertWithTime {
  alert_id: string;
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
  evidence_hash: string;
  source_tx_hash: string;
  source_log_index: number;
  block_number: number;
  status: string;
  detected_at: number;
  publish_tx_hash: string | null;
  published_at: number | null;
  source_block_timestamp: number | null;
}

export interface AlertQuery {
  limit: number;
  offset: number;
  targetId?: number;
  minSeverity?: number;
  includeOrphaned: boolean;
}

/** Read-only view of the monitor's SQLite file. Opens lazily, so the API can start before the monitor. */
export class ReadStore {
  private db: DatabaseSync | null = null;

  constructor(private readonly file: string) {}

  ready(): boolean {
    if (this.db) return true;
    if (!existsSync(this.file)) return false;
    const db = new DatabaseSync(this.file, { readOnly: true });
    // "metrics" is the last table created, so its presence means the schema is complete.
    const complete = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metrics'").get();
    if (!complete) {
      db.close();
      return false;
    }
    db.exec("PRAGMA busy_timeout = 5000");
    this.db = db;
    return true;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private all<T>(sql: string, ...p: Param[]): T[] {
    return this.db!.prepare(sql).all(...p) as unknown as T[];
  }
  private one<T>(sql: string, ...p: Param[]): T | undefined {
    return this.db!.prepare(sql).get(...p) as unknown as T | undefined;
  }

  getMeta(key: string): string | undefined {
    return this.one<{ value: string }>("SELECT value FROM schema_meta WHERE key = ?", key)?.value;
  }

  checkpoint(): { blockNumber: number; blockHash: string; updatedAt: number } | null {
    const r = this.one<{ block_number: number; block_hash: string; updated_at: number }>(
      "SELECT block_number, block_hash, updated_at FROM checkpoints WHERE name = 'main'"
    );
    return r ? { blockNumber: r.block_number, blockHash: r.block_hash, updatedAt: r.updated_at } : null;
  }

  counts(): { events: number; alerts: number; targets: number } {
    return {
      events: this.one<{ n: number }>("SELECT COUNT(*) AS n FROM events")?.n ?? 0,
      alerts: this.one<{ n: number }>("SELECT COUNT(*) AS n FROM alerts WHERE status <> 'orphaned'")?.n ?? 0,
      targets: this.one<{ n: number }>("SELECT COUNT(DISTINCT target_id) AS n FROM target_config")?.n ?? 0,
    };
  }

  counters(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.all<{ name: string; value: number }>("SELECT name, value FROM metrics")) out[r.name] = r.value;
    return out;
  }

  targets(): TargetRow[] {
    return this.all<TargetRow>(
      `SELECT c.target_id, c.block_number, c.log_index, c.owner, c.target_address, c.enabled, c.transfer_threshold,
         (SELECT e.tx_hash FROM events e WHERE e.event_name = 'TargetRegistered'
            AND CAST(json_extract(e.args_json, '$.targetId') AS INTEGER) = c.target_id
          ORDER BY e.block_number, e.log_index LIMIT 1) AS registration_tx,
         (SELECT e.block_number FROM events e WHERE e.event_name = 'TargetRegistered'
            AND CAST(json_extract(e.args_json, '$.targetId') AS INTEGER) = c.target_id
          ORDER BY e.block_number, e.log_index LIMIT 1) AS registration_block,
         (SELECT COUNT(*) FROM alerts a WHERE a.target_id = c.target_id AND a.status <> 'orphaned') AS alert_count
       FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY block_number DESC, log_index DESC) AS rn
             FROM target_config) c
       WHERE c.rn = 1
       ORDER BY c.target_id`
    );
  }

  private static readonly ALERT_SELECT = `SELECT a.*, e.block_timestamp AS source_block_timestamp
    FROM alerts a LEFT JOIN events e
      ON e.chain_id = a.chain_id AND e.tx_hash = a.source_tx_hash AND e.log_index = a.source_log_index`;

  alerts(q: AlertQuery): { total: number; rows: AlertWithTime[] } {
    const where: string[] = [];
    const params: Param[] = [];
    if (!q.includeOrphaned) where.push("a.status <> 'orphaned'");
    if (q.targetId !== undefined) {
      where.push("a.target_id = ?");
      params.push(q.targetId);
    }
    if (q.minSeverity !== undefined) {
      where.push("a.severity >= ?");
      params.push(q.minSeverity);
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM alerts a ${w}`, ...params)?.n ?? 0;
    const rows = this.all<AlertWithTime>(
      `${ReadStore.ALERT_SELECT} ${w} ORDER BY a.block_number DESC, a.source_log_index DESC, a.id DESC LIMIT ? OFFSET ?`,
      ...params, q.limit, q.offset
    );
    return { total, rows };
  }

  alertById(alertId: string): AlertWithTime | undefined {
    return this.one<AlertWithTime>(`${ReadStore.ALERT_SELECT} WHERE a.alert_id = ?`, alertId);
  }
}
