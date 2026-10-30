import type { NotifierStore } from "./notifierStore.js";
import { formatAlertMessage, formatRetraction, type NotifyEnv } from "./notifyFormat.js";
import { TelegramError, type TelegramApi } from "./telegram.js";
import { type Hex } from "viem";

export class FatalNotifierError extends Error {}

export interface NotifierConfig {
  chatId: string;
  minSeverity: number;
  maxAgeSecs: number; // 0 = no limit
  includeSkipped: boolean; // also retry alerts previously skipped as too old (used by --backfill)
  maxAttempts: number;
  backoffBaseSecs: number;
  maxPerRun: number;
  minIntervalMs: number;
}

export interface NotifySummary {
  sent: number;
  retracted: number;
  skipped: number;
  failed: number;
  retried: number;
  waiting: number;
}

type Outcome =
  | { kind: "rate"; retryAfter: number }
  | { kind: "permanent"; message: string }
  | { kind: "transient"; message: string };

type Delivery = { ok: true; messageId: number } | { ok: false; outcome: Outcome };

const shortId = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export class Notifier {
  private pausedUntil = 0;

  constructor(
    private readonly store: NotifierStore,
    private readonly api: TelegramApi,
    private readonly cfg: NotifierConfig,
    private readonly env: NotifyEnv,
    private readonly log: (m: string) => void = console.log,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  private backoff(attempts: number): number {
    return Math.min(3600, this.cfg.backoffBaseSecs * 2 ** Math.max(0, attempts - 1));
  }

  /** Misconfiguration (bad token, bot not in the chat) throws; everything else becomes an Outcome. */
  private classify(e: unknown): Outcome {
    if (!(e instanceof TelegramError)) return { kind: "transient", message: e instanceof Error ? e.message : String(e) };
    if (e.status === 429) return { kind: "rate", retryAfter: Math.max(1, e.retryAfter ?? 5) };
    if (e.status === 401 || e.status === 403 || e.status === 404) {
      throw new FatalNotifierError(
        `Telegram rejected the bot or chat (${e.status}: ${e.description}). Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, and that the bot is allowed to message the chat.`
      );
    }
    if (e.status === 400) {
      if (/chat not found|chat_id is empty|peer_id_invalid/i.test(e.description)) {
        throw new FatalNotifierError(`Telegram cannot find the chat (${e.description}). Check TELEGRAM_CHAT_ID, and press Start in the bot's chat.`);
      }
      return { kind: "permanent", message: e.description };
    }
    return { kind: "transient", message: e.message };
  }

  private async deliver(send: () => Promise<{ messageId: number }>): Promise<Delivery> {
    try {
      const r = await send();
      return { ok: true, messageId: r.messageId };
    } catch (e) {
      return { ok: false, outcome: this.classify(e) };
    }
  }

  private pause(retryAfter: number, s: NotifySummary): NotifySummary {
    this.pausedUntil = this.now() + retryAfter + 1;
    this.log(`Telegram flood control: pausing for ${retryAfter + 1}s`);
    s.waiting++;
    return s;
  }

  async runOnce(): Promise<NotifySummary> {
    const s: NotifySummary = { sent: 0, retracted: 0, skipped: 0, failed: 0, retried: 0, waiting: 0 };
    if (this.now() < this.pausedUntil) {
      s.waiting++;
      return s;
    }

    for (const r of this.store.retractions(20)) {
      const res = await this.deliver(() =>
        this.api.sendMessage({ chatId: this.cfg.chatId, text: formatRetraction(r.title, r.alertId), replyToMessageId: r.messageId ?? undefined })
      );
      if (res.ok) {
        this.store.markRetracted(r.alertId, this.now(), null);
        this.log(`retracted ${shortId(r.alertId)} (source event no longer on the canonical chain)`);
        s.retracted++;
        await this.sleep(this.cfg.minIntervalMs);
      } else if (res.outcome.kind === "rate") {
        return this.pause(res.outcome.retryAfter, s);
      } else if (res.outcome.kind === "permanent") {
        this.store.markRetracted(r.alertId, this.now(), `retraction not delivered: ${res.outcome.message}`);
      } else {
        s.retried++;
      }
    }

    for (const c of this.store.candidates(this.cfg.minSeverity, this.cfg.maxPerRun, this.cfg.includeSkipped)) {
      const now = this.now();
      const reference = c.eventTime ?? c.detectedAt;

      if (this.cfg.maxAgeSecs > 0 && now - reference > this.cfg.maxAgeSecs) {
        this.store.markTerminal(c.alertId as Hex, "skipped", `source event older than ${this.cfg.maxAgeSecs}s when first considered`, now);
        s.skipped++;
        continue;
      }
      if (c.attempts >= this.cfg.maxAttempts) {
        this.store.markTerminal(c.alertId as Hex, "failed", `gave up after ${c.attempts} attempts`, now);
        s.failed++;
        continue;
      }
      if (c.attempts > 0 && c.lastAttemptAt !== null && now < c.lastAttemptAt + this.backoff(c.attempts)) {
        s.waiting++;
        continue;
      }

      const res = await this.deliver(() =>
        this.api.sendMessage({ chatId: this.cfg.chatId, text: formatAlertMessage(c, this.env) })
      );
      if (res.ok) {
        const at = this.now();
        this.store.markSent(c.alertId as Hex, res.messageId, c.title, at);
        this.log(`sent ${shortId(c.alertId)} (${c.ruleId}), ${at - reference}s after the source block`);
        s.sent++;
        await this.sleep(this.cfg.minIntervalMs);
        continue;
      }

      const o = res.outcome;
      if (o.kind === "rate") {
        return this.pause(o.retryAfter, s);
      }

      
      const nextAttempts = c.attempts + 1;
      const attemptTime = this.now();

      // Every actual failed delivery counts as an attempt.
      // HTTP 429 is handled separately and does not count.
      this.store.recordAttempt(
        c.alertId as Hex,
        o.message,
        attemptTime
      );

      if (
        o.kind === "permanent" ||
        nextAttempts >= this.cfg.maxAttempts
      ) {
        const why =
          o.kind === "permanent"
            ? o.message
            : `gave up after ${nextAttempts} attempts: ${o.message}`;

        this.store.markTerminal(
          c.alertId as Hex,
          "failed",
          why,
          attemptTime
        );

        this.log(`FAILED ${shortId(c.alertId)}: ${why}`);
        s.failed++;
      } else {
        this.log(
          `will retry ${shortId(c.alertId)} ` +
          `(attempt ${nextAttempts}/${this.cfg.maxAttempts}): ${o.message}`
        );

        s.retried++;
      }

    }
    return s;
  }
}