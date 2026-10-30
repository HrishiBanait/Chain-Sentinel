import type { Hex } from "viem";
import type { Candidate, PublisherStore } from "./publisherStore.js";

export class ChainRevert extends Error {
  constructor(public readonly errorName: string, message?: string) {
    super(message ?? `reverted: ${errorName}`);
    this.name = "ChainRevert";
  }
}
export class FatalPublisherError extends Error {}

export interface PublishArgs {
  alertId: Hex;
  targetId: bigint;
  evidenceHash: Hex;
  severity: number;
}
export interface TxOutcome {
  status: "success" | "reverted";
  blockNumber: bigint;
}
export interface OnChainAlert {
  exists: boolean;
  evidenceHash?: Hex;
}

export interface PublishChain {
  headBlock(): Promise<bigint>;
  /** atBlock makes a lagging RPC node fail loudly instead of answering from an older state. */
  alertOnChain(alertId: Hex, atBlock?: bigint): Promise<OnChainAlert>;
  simulate(a: PublishArgs): Promise<void>;
  send(a: PublishArgs): Promise<Hex>;
  receipt(txHash: Hex): Promise<TxOutcome | null>;
  waitReceipt(txHash: Hex): Promise<TxOutcome | null>;
  findPublishTx(alertId: Hex): Promise<{ txHash: Hex; blockNumber: bigint } | null>;
}

export interface PublisherConfig {
  minSeverity: number;
  confirmations: bigint;
  maxAttempts: number;
  pendingGraceSecs: number;
  backoffBaseSecs: number;
  maxPerRun: number;
}

export interface RunSummary {
  published: number;
  recovered: number;
  skipped: number;
  failed: number;
  verified: number;
  dropped: number;
  retried: number;
  waiting: number;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export class Publisher {
  constructor(
    private readonly store: PublisherStore,
    private readonly chain: PublishChain,
    private readonly cfg: PublisherConfig,
    private readonly log: (m: string) => void = console.log,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  async runOnce(): Promise<RunSummary> {
    const s: RunSummary = { published: 0, recovered: 0, skipped: 0, failed: 0, verified: 0, dropped: 0, retried: 0, waiting: 0 };
    await this.verifyPublished(s);
    for (const c of this.store.candidates(this.cfg.minSeverity, this.cfg.maxPerRun)) {
      try {
        await this.handle(c, s);
      } catch (e) {
        if (e instanceof FatalPublisherError) throw e;
        this.noteFailure(c, e, s);
      }
    }
    return s;
  }

  private backoff(attempts: number): number {
    return Math.min(3600, this.cfg.backoffBaseSecs * 2 ** Math.max(0, attempts - 1));
  }

  private noteFailure(c: Candidate, e: unknown, s: RunSummary): void {
    const msg = e instanceof Error ? e.message : String(e);
    const at = this.now();
    if (c.attempts + 1 >= this.cfg.maxAttempts) {
      this.store.markTerminal(c.alertId, "failed", `gave up after ${c.attempts + 1} attempts: ${msg}`, at);
      this.log(`FAILED ${short(c.alertId)} (${c.ruleId}): ${msg}`);
      s.failed++;
    } else {
      this.store.recordAttempt(c.alertId, msg, at);
      this.log(`will retry ${short(c.alertId)} (attempt ${c.attempts + 1}/${this.cfg.maxAttempts}): ${msg}`);
      s.retried++;
    }
  }

  private async handle(c: Candidate, s: RunSummary): Promise<void> {
    const now = this.now();

    if (c.logStatus === "pending" && c.txHash) {
      const r = await this.chain.receipt(c.txHash);
      if (r?.status === "success") return this.finalize(c, c.txHash, r.blockNumber, s);
      if (!r && now - (c.lastAttemptAt ?? 0) < this.cfg.pendingGraceSecs) {
        s.waiting++;
        return;
      }
      this.store.clearPending(c.alertId, now); // reverted, or not mined within the grace period
    } else if (c.attempts > 0 && now < (c.lastAttemptAt ?? 0) + this.backoff(c.attempts)) {
      s.waiting++;
      return;
    }

    const existing = await this.chain.alertOnChain(c.alertId);
    if (existing.exists) return this.recover(c, existing.evidenceHash, s);

    const args: PublishArgs = { alertId: c.alertId, targetId: BigInt(c.targetId), evidenceHash: c.evidenceHash, severity: c.severity };
    try {
      await this.chain.simulate(args);
    } catch (e) {
      if (!(e instanceof ChainRevert)) throw e;
      switch (e.errorName) {
        case "TargetDisabled":
          this.store.markTerminal(c.alertId, "skipped", "target disabled on-chain at publish time", now);
          this.log(`skipped ${short(c.alertId)}: target #${c.targetId} is disabled on-chain`);
          s.skipped++;
          return;
        case "NotReporter":
          throw new FatalPublisherError("this reporter account is not authorized on the registry (the admin must call setReporter)");
        case "AlertAlreadyPublished":
          return this.recover(c, (await this.chain.alertOnChain(c.alertId)).evidenceHash, s);
        case "TargetNotFound":
          this.store.markTerminal(c.alertId, "failed", "target not found on-chain", now);
          s.failed++;
          return;
        default:
          throw e;
      }
    }

    const hash = await this.chain.send(args);
    this.store.recordPending(c.alertId, hash, this.now()); // saved before waiting, so a crash cannot lose it
    let r: TxOutcome | null;
    try {
      r = await this.chain.waitReceipt(hash);
    } catch (e) {
      this.log(`could not confirm ${short(hash)} yet: ${(e as Error).message}`);
      s.waiting++;
      return;
    }
    if (!r) {
      this.log(`transaction ${short(hash)} not mined yet; will check again`);
      s.waiting++;
      return;
    }
    if (r.status === "reverted") throw new Error(`transaction ${hash} reverted`);
    return this.finalize(c, hash, r.blockNumber, s);
  }

  private async finalize(c: Candidate, hash: Hex, block: bigint, s: RunSummary): Promise<void> {
    const on = await this.chain.alertOnChain(c.alertId, block);
    if (!on.exists) throw new Error("transaction succeeded but the record is not readable yet");
    if (on.evidenceHash?.toLowerCase() !== c.evidenceHash.toLowerCase()) {
      this.store.markTerminal(c.alertId, "failed", "on-chain evidence hash differs from the stored one", this.now());
      s.failed++;
      return;
    }
    const at = this.now();
    this.store.markPublished(c.alertId, hash, Number(block), at);
    this.log(`published ${short(c.alertId)} (${c.ruleId}) in ${short(hash)}, block ${block}, ${at - c.detectedAt}s after detection`);
    s.published++;
  }

  private async recover(c: Candidate, onChainHash: Hex | undefined, s: RunSummary): Promise<void> {
    if (onChainHash?.toLowerCase() !== c.evidenceHash.toLowerCase()) {
      this.store.markTerminal(c.alertId, "failed", "an on-chain record with this alert id has a different evidence hash", this.now());
      this.log(`FAILED ${short(c.alertId)}: on-chain record differs from our evidence`);
      s.failed++;
      return;
    }
    const found = await this.chain.findPublishTx(c.alertId);
    if (!found) throw new Error("record exists on-chain but its transaction could not be located yet");
    this.store.markPublished(c.alertId, found.txHash, Number(found.blockNumber), this.now());
    this.log(`recovered ${short(c.alertId)}: already on-chain in ${short(found.txHash)}`);
    s.recovered++;
  }

  private async verifyPublished(s: RunSummary): Promise<void> {
    const rows = this.store.publishedToVerify();
    if (rows.length === 0) return;
    const head = await this.chain.headBlock();
    for (const r of rows as any[]) {
      const alertId = r.alertId ?? r.alert_id;
      const blockNumber = r.blockNumber ?? r.block_number;
      const evidenceHash = r.evidenceHash ?? r.evidence_hash;

      if (blockNumber === null || blockNumber === undefined || head < BigInt(blockNumber) + this.cfg.confirmations) continue;
      const on = await this.chain.alertOnChain(alertId);
      const at = this.now();
      if (!on.exists) {
        this.store.markUnpublished(alertId, at);
        this.log(`publication of ${short(alertId)} disappeared from the chain; it will be published again`);
        s.dropped++;
      } else if (on.evidenceHash?.toLowerCase() === evidenceHash?.toLowerCase()) {
        this.store.markVerified(alertId, at);
        s.verified++;
      } else {
        this.store.markTerminal(alertId, "failed", "on-chain record differs from stored evidence", at);
        this.log(`ALERT ${short(alertId)}: on-chain record differs from the stored evidence`);
        s.failed++;
      }
    }
  }
}
