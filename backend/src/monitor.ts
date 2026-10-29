import { pad, type Hex } from "viem";
import { buildAlert } from "./alerts.js";
import { isRangeError, type ChainSource, type LogFilter, type RawLog } from "./chainSource.js";
import type { Store, StoredEvent } from "./db.js";
import { decodeLog, REGISTRY_TOPICS, TARGET_EVENT_TOPICS, TOPIC, type Decoded } from "./decode.js";
import { assess, type RuleTarget } from "./rules.js";

export interface MonitorConfig {
  chainId: number;
  registryAddress: Hex;
  startBlock: bigint;
  confirmations: bigint;
  batchSize: bigint;
  monitoredTokens: Hex[];
  addressChunkSize?: number;
}

export interface SyncResult {
  head: bigint;
  safeHead: bigint;
  batches: number;
  events: number;
  alerts: number;
  reorg: boolean;
  checkpoint: bigint | null;
}

const topicOfAddress = (a: string): Hex => pad(a.toLowerCase() as Hex, { size: 32 });
const byPos = (a: RawLog, b: RawLog) =>
  a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class Monitor {
  private readonly tokens: Set<string>;
  private chainVerified = false;

  constructor(
    private readonly store: Store,
    private readonly source: ChainSource,
    private readonly cfg: MonitorConfig,
    private readonly log: (msg: string) => void = console.log
  ) {
    this.tokens = new Set(cfg.monitoredTokens.map((t) => t.toLowerCase()));
  }

  async syncOnce(maxBatches = Number.POSITIVE_INFINITY): Promise<SyncResult> {
    await this.ensureChain();
    const result: SyncResult = { head: 0n, safeHead: 0n, batches: 0, events: 0, alerts: 0, reorg: false, checkpoint: null };

    result.reorg = await this.handleReorgIfAny();
    result.head = await this.source.getHeadBlock();
    result.safeHead = result.head > this.cfg.confirmations ? result.head - this.cfg.confirmations : 0n;

    const cp = this.store.getCheckpoint();
    let next = cp ? cp.blockNumber + 1n : this.cfg.startBlock;

    while (next <= result.safeHead && result.batches < maxBatches) {
      const end = next + this.cfg.batchSize - 1n;
      const to = end < result.safeHead ? end : result.safeHead;
      const r = await this.processRange(next, to);
      result.batches++;
      result.events += r.events;
      result.alerts += r.alerts;
      this.store.incr("batches_processed");
      this.log(`blocks ${next}-${to}: ${r.events} new events, ${r.alerts} new alerts`);
      next = to + 1n;
    }
    result.checkpoint = this.store.getCheckpoint()?.blockNumber ?? null;
    return result;
  }

  private async ensureChain(): Promise<void> {
    if (this.chainVerified) return;
    const id = await this.source.getChainId();
    if (id !== this.cfg.chainId) {
      throw new Error(`RPC reports chain id ${id} but the monitor is configured for ${this.cfg.chainId}`);
    }
    this.chainVerified = true;
  }

  private async handleReorgIfAny(): Promise<boolean> {
    const cp = this.store.getCheckpoint();
    if (!cp) return false;
    if ((await this.source.getBlockHash(cp.blockNumber)) === cp.blockHash) return false;

    this.log(`reorg detected: checkpoint block ${cp.blockNumber} no longer matches the chain`);
    for (const c of this.store.recentBlockHashes(256)) {
      if (c.blockNumber >= cp.blockNumber) continue;
      if ((await this.source.getBlockHash(c.blockNumber)) === c.blockHash) {
        this.log(`rolling back to common ancestor at block ${c.blockNumber}`);
        this.store.rollbackTo(c.blockNumber, c.blockHash);
        this.store.incr("reorgs_handled");
        return true;
      }
    }
    this.log("no common ancestor found in stored history; re-scanning from the start block");
    this.store.rollbackTo(this.cfg.startBlock - 1n, null);
    this.store.incr("reorgs_handled");
    return true;
  }

  private async fetchSplit(base: Pick<LogFilter, "address" | "topics">, from: bigint, to: bigint): Promise<RawLog[]> {
    try {
      return await this.source.getLogs({ ...base, fromBlock: from, toBlock: to });
    } catch (e) {
      if (from < to && isRangeError(e)) {
        this.store.incr("range_splits");
        const mid = from + (to - from) / 2n;
        const left = await this.fetchSplit(base, from, mid);
        const right = await this.fetchSplit(base, mid + 1n, to);
        return [...left, ...right];
      }
      throw e;
    }
  }

  private async timestamps(blocks: bigint[]): Promise<Map<bigint, number>> {
    const out = new Map<bigint, number>();
    for (const part of chunks(blocks, 10)) {
      const ts = await Promise.all(part.map((b) => this.source.getBlockTimestamp(b)));
      part.forEach((b, i) => out.set(b, ts[i]));
    }
    return out;
  }

  private async processRange(from: bigint, to: bigint): Promise<{ events: number; alerts: number }> {
    const hashBefore = await this.source.getBlockHash(to);
    if (!hashBefore) throw new Error(`block ${to} is not available from the RPC yet`);

    // 1. registry events (decides which addresses we need to watch)
    const regLogs = await this.fetchSplit({ address: [this.cfg.registryAddress], topics: [REGISTRY_TOPICS] }, from, to);
    const addresses = new Set(this.store.targetAddresses());
    for (const l of regLogs) {
      if (l.topics[0] === TOPIC.TargetRegistered) {
        const d = decodeLog(l.topics, l.data);
        if (d) addresses.add(String(d.args.target));
      }
    }

    // 2. events emitted by targets, and monitored-token transfers to/from targets
    const otherLogs: RawLog[] = [];
    const tokenList = [...this.tokens] as Hex[];
    for (const part of chunks([...addresses] as Hex[], this.cfg.addressChunkSize ?? 50)) {
      otherLogs.push(...(await this.fetchSplit({ address: part, topics: [TARGET_EVENT_TOPICS] }, from, to)));
      if (tokenList.length > 0) {
        const topics = part.map(topicOfAddress);
        otherLogs.push(...(await this.fetchSplit({ address: tokenList, topics: [TOPIC.Transfer, null, topics] }, from, to)));
        otherLogs.push(...(await this.fetchSplit({ address: tokenList, topics: [TOPIC.Transfer, topics] }, from, to)));
      }
    }

    // 3. dedupe by (tx hash, log index), order by position, fetch timestamps
    const byKey = new Map<string, RawLog>();
    for (const l of [...regLogs, ...otherLogs]) byKey.set(`${l.transactionHash}:${l.logIndex}`, l);
    const logs = [...byKey.values()].sort(byPos);
    const ts = await this.timestamps([...new Set(logs.map((l) => l.blockNumber))]);

    // 4. make sure the chain did not change under us while we were scanning
    const hashAfter = await this.source.getBlockHash(to);
    if (hashAfter !== hashBefore) throw new Error("chain changed while scanning a batch; it will be retried");

    // 5. commit atomically: events, alerts and checkpoint together
    const registry = this.cfg.registryAddress.toLowerCase();
    return this.store.tx(() => {
      let events = 0;
      let alerts = 0;

      for (const raw of logs.filter((l) => l.address.toLowerCase() === registry)) {
        const ev = this.toEvent(raw, ts);
        if (!ev) continue;
        if (!this.store.insertEvent(ev)) {
          this.store.incr("duplicate_events_ignored");
          continue;
        }
        events++;
        this.applyRegistryEvent(ev);
      }

      for (const raw of logs.filter((l) => l.address.toLowerCase() !== registry)) {
        const ev = this.toEvent(raw, ts);
        if (!ev) continue;
        if (!this.store.insertEvent(ev)) {
          this.store.incr("duplicate_events_ignored");
          continue;
        }
        events++;
        for (const target of this.matchTargets(ev)) {
          const a = assess({ event: ev, target, monitoredTokens: this.tokens });
          if (!a) continue;
          const alert = buildAlert({ chainId: this.cfg.chainId, event: ev, target, assessment: a, detectedAt: Math.floor(Date.now() / 1000) });
          if (this.store.insertAlert(alert)) {
            alerts++;
            this.store.incr("alerts_created");
          } else {
            this.store.incr("duplicate_alerts_ignored");
          }
        }
      }

      this.store.recordBatchEnd(to, hashBefore);
      return { events, alerts };
    });
  }

  private toEvent(raw: RawLog, ts: Map<bigint, number>): StoredEvent | null {
    const d: Decoded | null = decodeLog(raw.topics, raw.data);
    if (!d) {
      this.store.incr("undecodable_logs");
      return null;
    }
    return {
      chainId: this.cfg.chainId,
      txHash: raw.transactionHash,
      logIndex: raw.logIndex,
      blockNumber: raw.blockNumber,
      blockHash: raw.blockHash,
      blockTimestamp: ts.get(raw.blockNumber) ?? 0,
      address: raw.address.toLowerCase() as Hex,
      eventName: d.eventName,
      args: d.args,
    };
  }

  private applyRegistryEvent(ev: StoredEvent): void {
    const id = Number(ev.args.targetId);
    if (ev.eventName === "TargetRegistered") {
      this.store.insertConfig({
        targetId: id,
        blockNumber: ev.blockNumber,
        logIndex: ev.logIndex,
        owner: String(ev.args.owner) as Hex,
        targetAddress: String(ev.args.target) as Hex,
        enabled: true,
        transferThreshold: BigInt(String(ev.args.transferThreshold)),
      });
      return;
    }
    const prev = this.store.latestConfig(id, ev.blockNumber, ev.logIndex);
    if (!prev) {
      this.log(`ignoring ${ev.eventName} for unknown target ${id} (is MONITOR_START_BLOCK before its registration?)`);
      this.store.incr("config_events_for_unknown_target");
      return;
    }
    if (ev.eventName === "TargetEnabledChanged") {
      this.store.insertConfig({ ...prev, blockNumber: ev.blockNumber, logIndex: ev.logIndex, enabled: ev.args.enabled === true });
    } else if (ev.eventName === "TransferThresholdChanged") {
      this.store.insertConfig({
        ...prev,
        blockNumber: ev.blockNumber,
        logIndex: ev.logIndex,
        transferThreshold: BigInt(String(ev.args.newThreshold)),
      });
    }
  }

  /** Targets that were registered and enabled at this event's position, with their config at that moment. */
  private matchTargets(ev: StoredEvent): RuleTarget[] {
    const addrs = ev.eventName === "Transfer" ? [...new Set([String(ev.args.from), String(ev.args.to)])] : [ev.address];
    const seen = new Set<number>();
    const out: RuleTarget[] = [];
    for (const addr of addrs) {
      for (const id of this.store.targetIdsForAddress(addr)) {
        if (seen.has(id)) continue;
        const cfg = this.store.latestConfig(id, ev.blockNumber, ev.logIndex);
        if (!cfg || !cfg.enabled) continue;
        seen.add(id);
        out.push({ id, address: cfg.targetAddress, transferThreshold: cfg.transferThreshold });
      }
    }
    return out;
  }
}
