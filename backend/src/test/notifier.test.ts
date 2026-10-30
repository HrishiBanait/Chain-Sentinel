import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { keccak256, toHex, type Hex } from "viem";
import { Store } from "../db.js";
import { FatalNotifierError, Notifier, type NotifierConfig } from "../notifier.js";
import { NotifierStore } from "../notifierStore.js";
import { formatAlertMessage, type NotifyAlert, type NotifyEnv } from "../notifyFormat.js";
import { createTelegramClient, TelegramError, type SendArgs, type TelegramApi } from "../telegram.js";

const T0 = 1_700_000_000;
const hx = (s: string): Hex => keccak256(toHex(s));
const A = (n: number) => hx(`notify-alert-${n}`);
const TARGET = `0x${"1".repeat(40)}` as Hex;
const OWNER = `0x${"b".repeat(40)}` as Hex;
const OWNER2 = `0x${"c".repeat(40)}` as Hex;

const ENV: NotifyEnv = { networkLabel: "MST Testnet", isTestnet: true, explorerUrl: "https://testnet.mstscan.com" };
const BASE: NotifierConfig = {
  chatId: "42", minSeverity: 0, maxAgeSecs: 3600, includeSkipped: false,
  maxAttempts: 3, backoffBaseSecs: 10, maxPerRun: 50, minIntervalMs: 0,
};

class FakeTelegram implements TelegramApi {
  sent: SendArgs[] = [];
  calls = 0;
  script: (TelegramError | null)[] = [];
  private id = 100;
  async sendMessage(a: SendArgs) {
    this.calls++;
    const next = this.script.shift();
    if (next) throw next;
    this.sent.push(a);
    return { messageId: ++this.id };
  }
}

function addAlert(mon: Store, n: number, o: { severity?: number; block?: bigint; eventTime?: number } = {}) {
  const block = o.block ?? BigInt(10 + n);
  const txHash = hx(`notify-tx-${n}`);
  mon.insertEvent({
    chainId: 91562037, txHash, logIndex: 0, blockNumber: block, blockHash: hx(`nb${block}`),
    blockTimestamp: o.eventTime ?? T0 - 60, address: TARGET, eventName: "OwnershipTransferred",
    args: { previousOwner: OWNER, newOwner: OWNER2 },
  });
  const evidenceJson = JSON.stringify({ n });
  mon.insertAlert({
    alertId: A(n), chainId: 91562037, targetId: 1, ruleId: "ownership.changed", ruleVersion: 1,
    severity: o.severity ?? 3, title: `Ownership changed ${n}`, observed: `obs ${n}`, assessment: `assess ${n}`,
    caveat: `caveat ${n}`, evidenceJson, evidenceHash: hx(evidenceJson), sourceTxHash: txHash, sourceLogIndex: 0,
    blockNumber: block, detectedAt: T0 - 30,
  });
}

interface Env {
  mon: Store; ns: NotifierStore; tg: FakeTelegram; file: string;
  make: (over?: Partial<NotifierConfig>) => Notifier; advance: (s: number) => void;
}

async function withEnv(fn: (e: Env) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-notify-"));
  const file = path.join(dir, "t.db");
  const mon = new Store(file);
  const ns = new NotifierStore(file);
  const tg = new FakeTelegram();
  let t = T0;
  const make = (over: Partial<NotifierConfig> = {}) => new Notifier(ns, tg, { ...BASE, ...over }, ENV, () => {}, () => t, async () => {});
  try {
    await fn({ mon, ns, tg, file, make, advance: (s) => { t += s; } });
  } finally {
    ns.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const sampleAlert = (over: Partial<NotifyAlert> = {}): NotifyAlert => ({
  alertId: A(1), targetId: 2, targetAddress: TARGET, ruleId: "ownership.changed", severity: 3,
  title: "Ownership changed", observed: "obs", assessment: "assess", caveat: "caveat",
  sourceTxHash: hx("some-tx"), blockNumber: 123, ...over,
});

// ------------------------------------------------------------------ formatting
test("messages escape HTML and stay under Telegram's length limit even with huge fields", () => {
  const nasty = formatAlertMessage(sampleAlert({ title: `<script>&"x"`, observed: "a < b && c > d" }), ENV);
  assert.ok(nasty.includes("&lt;script&gt;&amp;"));
  assert.ok(!nasty.includes("<script>"));
  assert.ok(nasty.includes("a &lt; b &amp;&amp; c &gt; d"));

  const long = formatAlertMessage(sampleAlert({ observed: "a".repeat(5000), assessment: "b".repeat(5000), caveat: "c".repeat(5000) }), ENV);
  assert.ok(long.length < 4096);
  assert.ok(long.includes("…"));
});

test("messages show severity, network, explorer link and separate fact from assessment", () => {
  const m = formatAlertMessage(sampleAlert(), ENV);
  assert.ok(m.includes("HIGH: Ownership changed"));
  assert.ok(m.includes("MST Testnet (testnet)"));
  assert.ok(m.includes(`href="https://testnet.mstscan.com/tx/${hx("some-tx")}"`));
  assert.ok(m.includes("<b>Observed on-chain</b>") && m.includes("rule-based, not a verdict") && m.includes("Not shown by this alert"));
  assert.ok(!m.includes("Dashboard"));

  const main = formatAlertMessage(sampleAlert(), { ...ENV, isTestnet: false, dashboardUrl: "https://dash.example/" });
  assert.ok(main.includes("MAINNET") && main.includes('href="https://dash.example/"'));
});

// -------------------------------------------------------------------- notifier
test("sends each eligible alert once, oldest block first, skipping low severity and orphaned alerts", async () => {
  await withEnv(async ({ mon, ns, tg, file, make }) => {
    addAlert(mon, 1, { severity: 3, block: 20n });
    addAlert(mon, 2, { severity: 1, block: 10n });
    addAlert(mon, 3, { severity: 0, block: 15n });
    addAlert(mon, 4, { severity: 4, block: 5n });
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE alerts SET status = 'orphaned' WHERE alert_id = ?").run(A(4));
    raw.close();

    const n = make({ minSeverity: 1 });
    assert.equal((await n.runOnce()).sent, 2);
    assert.ok(tg.sent[0].text.includes("Ownership changed 2"));
    assert.ok(tg.sent[1].text.includes("Ownership changed 1"));
    assert.equal(tg.sent[0].chatId, "42");
    assert.equal(ns.getLog(A(1))?.status, "sent");
    assert.equal(ns.getLog(A(1))?.messageId, 102);
    assert.equal(ns.getLog(A(3)), undefined);
    assert.equal(ns.getLog(A(4)), undefined);

    assert.equal((await n.runOnce()).sent, 0);
    assert.equal(tg.sent.length, 2);
  });
});

test("alerts whose source event is too old are skipped, and --backfill delivers them", async () => {
  await withEnv(async ({ mon, ns, tg, make }) => {
    addAlert(mon, 1, { eventTime: T0 - 7200 });
    addAlert(mon, 2, { eventTime: T0 - 60 });

    const s = await make().runOnce();
    assert.deepEqual([s.sent, s.skipped], [1, 1]);
    assert.equal(ns.getLog(A(1))?.status, "skipped");
    assert.equal((await make().runOnce()).sent, 0); // skipped alerts stay skipped by default

    const b = await make({ maxAgeSecs: 0, includeSkipped: true }).runOnce();
    assert.equal(b.sent, 1);
    assert.equal(ns.getLog(A(1))?.status, "sent");
    assert.equal(tg.sent.length, 2);
  });
});

test("a transient failure is retried after a backoff and then delivered", async () => {
  await withEnv(async ({ mon, ns, tg, make, advance }) => {
    addAlert(mon, 1);
    tg.script = [new TelegramError(502, "Bad Gateway")];
    const n = make();

    assert.equal((await n.runOnce()).retried, 1);
    assert.equal((await n.runOnce()).waiting, 1); // inside the 10 s backoff
    assert.equal(tg.calls, 1);
    advance(11);
    assert.equal((await n.runOnce()).sent, 1);
    assert.equal(ns.getLog(A(1))?.attempts, 2);
  });
});

test("gives up after the maximum number of attempts and marks the alert failed", async () => {
  await withEnv(async ({ mon, ns, tg, make, advance }) => {
    addAlert(mon, 1);
    tg.script = [new TelegramError(0, "network error"), new TelegramError(0, "network error"), new TelegramError(0, "network error")];
    const n = make();
    await n.runOnce();
    advance(11);
    await n.runOnce();
    advance(21);
    assert.equal((await n.runOnce()).failed, 1);
    assert.equal(ns.getLog(A(1))?.status, "failed");
    assert.match(ns.getLog(A(1))?.lastError ?? "", /gave up/);
  });
});

test("flood control pauses the run for retry_after without counting an attempt, then resumes", async () => {
  await withEnv(async ({ mon, ns, tg, make, advance }) => {
    addAlert(mon, 1);
    addAlert(mon, 2);
    tg.script = [new TelegramError(429, "Too Many Requests: retry after 7", 7)];
    const n = make();

    const s1 = await n.runOnce();
    assert.deepEqual([s1.sent, s1.waiting], [0, 1]);
    assert.equal(ns.getLog(A(1)), undefined); // no attempt was recorded
    assert.equal((await n.runOnce()).waiting, 1);
    assert.equal(tg.calls, 1); // paused: Telegram was not called again

    advance(9);
    assert.equal((await n.runOnce()).sent, 2);
  });
});

test("a permanent error fails only that alert; the others are still delivered", async () => {
  await withEnv(async ({ mon, ns, tg, make }) => {
    addAlert(mon, 1, { block: 10n });
    addAlert(mon, 2, { block: 11n });
    tg.script = [new TelegramError(400, "Bad Request: can't parse entities")];
    const s = await make().runOnce();
    assert.deepEqual([s.failed, s.sent], [1, 1]);
    assert.equal(ns.getLog(A(1))?.status, "failed");
    assert.equal(ns.getLog(A(2))?.status, "sent");
  });
});

test("misconfiguration (bad token, bot blocked, chat not found) stops the notifier and leaves alerts unsent", async () => {
  await withEnv(async ({ mon, ns, tg, make }) => {
    addAlert(mon, 1);
    const n = make();
    for (const err of [new TelegramError(401, "Unauthorized"), new TelegramError(403, "Forbidden: bot was blocked by the user"), new TelegramError(400, "Bad Request: chat not found")]) {
      tg.script = [err];
      await assert.rejects(() => n.runOnce(), (e: unknown) => e instanceof FatalNotifierError);
    }
    assert.equal(ns.getLog(A(1)), undefined);
    assert.equal(tg.sent.length, 0);
  });
});

test("a reorg that removes an aounced alert triggers a retraction, and a returning alert is announced again", async () => {
  await withEnv(async ({ mon, ns, tg, make }) => {
    addAlert(mon, 1, { block: 20n });
    const n = make();
    assert.equal((await n.runOnce()).sent, 1);
    assert.equal(ns.getLog(A(1))?.messageId, 101);

    mon.rollbackTo(19n, null); // the source event was reorganized away
    const s = await n.runOnce();
    assert.equal(s.retracted, 1);
    const retraction = tg.sent[tg.sent.length - 1];
    assert.equal(retraction.replyToMessageId, 101);
    assert.ok(retraction.text.includes("Alert retracted"));
    assert.equal(ns.getLog(A(1))?.status, "retracted");
    assert.equal((await n.runOnce()).retracted, 0);

    addAlert(mon, 1, { block: 20n }); // the same transaction is included again on the new chain
    assert.equal((await n.runOnce()).sent, 1);
    assert.equal(ns.getLog(A(1))?.status, "sent");
    assert.equal(ns.getLog(A(1))?.messageId, 103);
  });
});

// ------------------------------------------------------------------ Bot API client
const TOKEN = "123456:AAtest_token_value_for_unit_tests_only_000";

async function withFetch(impl: (url: string, init: RequestInit) => Promise<Response>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => impl(String(input), init ?? {})) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("sendMessage posts HTML to the bot URL and returns the message id", async () => {
  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  await withFetch(
    async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    },
    async () => {
      const r = await createTelegramClient(TOKEN).sendMessage({ chatId: "42", text: "hi", replyToMessageId: 5 });
      assert.equal(r.messageId, 7);
    }
  );
  assert.equal(seenUrl, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(seenBody.chat_id, "42");
  assert.equal(seenBody.parse_mode, "HTML");
  assert.deepEqual(seenBody.reply_parameters, { message_id: 5, allow_sending_without_reply: true });
});

test("a 429 response becomes a TelegramError carrying retry_after", async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } }), { status: 429 }),
    async () => {
      await assert.rejects(
        () => createTelegramClient(TOKEN).sendMessage({ chatId: "42", text: "x" }),
        (e: unknown) => e instanceof TelegramError && e.status === 429 && e.retryAfter === 7
      );
    }
  );
});

test("network failures never leak the token (it is part of the request URL)", async () => {
  await withFetch(
    async (url) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    },
    async () => {
      await assert.rejects(
        () => createTelegramClient(TOKEN).sendMessage({ chatId: "42", text: "x" }),
        (e: unknown) => e instanceof TelegramError && e.status === 0 && !e.message.includes(TOKEN) && !e.description.includes(TOKEN)
      );
    }
  );
});

test("a token echoed back inside an API error description is redacted", async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ ok: false, error_code: 400, description: `Bad Request: bad url bot${TOKEN}/x` }), { status: 400 }),
    async () => {
      await assert.rejects(
        () => createTelegramClient(TOKEN).sendMessage({ chatId: "42", text: "x" }),
        (e: unknown) => e instanceof TelegramError && !e.message.includes(TOKEN) && e.description.includes("[redacted]")
      );
    }
  );
});
