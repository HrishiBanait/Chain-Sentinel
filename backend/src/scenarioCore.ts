export interface ExpectedAlert {
  stepId: string;
  txHash: string;
  ruleId: string;
  targetId: number;
  severity: number;
}

export interface DetectedAlert {
  alertId: string;
  txHash: string;
  ruleId: string;
  targetId: number;
  severity: number;
  detectedAt: number;
  publishedAt: number | null;
  notifiedAt: number | null;
  status: string;
}

export interface Pair {
  expected: ExpectedAlert;
  detected: DetectedAlert;
}

export interface Comparison {
  truePositives: Pair[];
  missed: ExpectedAlert[];
  falsePositives: DetectedAlert[]; // from a scenario transaction, but not expected
  unattributed: DetectedAlert[]; // not from any scenario transaction
  severityMismatches: Pair[];
  silentTotal: number;
  silentCorrect: number;
  precision: number | null;
  recall: number | null;
}

const key = (tx: string, rule: string, target: number) => `${tx.toLowerCase()}|${rule}|${target}`;

export function compare(expected: ExpectedAlert[], detected: DetectedAlert[], scenarioTxs: string[], silentTxs: string[]): Comparison {
  const txSet = new Set(scenarioTxs.map((t) => t.toLowerCase()));
  const expectedByKey = new Map(expected.map((e) => [key(e.txHash, e.ruleId, e.targetId), e]));
  const matched = new Set<string>();
  const truePositives: Pair[] = [];
  const falsePositives: DetectedAlert[] = [];
  const unattributed: DetectedAlert[] = [];

  for (const d of detected) {
    const k = key(d.txHash, d.ruleId, d.targetId);
    const e = expectedByKey.get(k);
    if (e && !matched.has(k)) {
      matched.add(k);
      truePositives.push({ expected: e, detected: d });
    } else if (txSet.has(d.txHash.toLowerCase())) {
      falsePositives.push(d);
    } else {
      unattributed.push(d);
    }
  }

  const missed = expected.filter((e) => !matched.has(key(e.txHash, e.ruleId, e.targetId)));
  const detectedTxs = new Set(detected.map((d) => d.txHash.toLowerCase()));
  const tp = truePositives.length;
  return {
    truePositives,
    missed,
    falsePositives,
    unattributed,
    severityMismatches: truePositives.filter((p) => p.expected.severity !== p.detected.severity),
    silentTotal: silentTxs.length,
    silentCorrect: silentTxs.filter((t) => !detectedTxs.has(t.toLowerCase())).length,
    precision: tp + falsePositives.length > 0 ? tp / (tp + falsePositives.length) : null,
    recall: tp + missed.length > 0 ? tp / (tp + missed.length) : null,
  };
}

export interface Summary {
  n: number;
  min: number;
  median: number;
  p90: number;
  max: number;
}

export function summarize(values: number[]): Summary | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length / 2;
  return {
    n: v.length,
    min: v[0],
    median: v.length % 2 ? v[(v.length - 1) / 2] : (v[mid - 1] + v[mid]) / 2,
    p90: v[Math.min(v.length - 1, Math.ceil(0.9 * v.length) - 1)], // nearest rank
    max: v[v.length - 1],
  };
}

export interface StepResult {
  id: string;
  label: string;
  signer: string;
  txHash: string;
  blockNumber: number;
  minedAt: number;
  expected: string[];
}

export interface ChaosResult {
  kills: number;
  restarts: number;
  catchUpSecs: number | null;
  note: string;
}

export interface ScenarioReport {
  generatedAt: string;
  network: string;
  chainId: number;
  explorerUrl: string;
  registry: string;
  token: string;
  commit: string | null;
  config: { confirmations: number; pollIntervalMs: number; gasPriceGwei: string; chaos: boolean };
  steps: StepResult[];
  comparison: Comparison;
  latency: {
    detect: Summary | null;
    publish: Summary | null;
    notify: Summary | null;
    endToAudit: Summary | null;
    endToNotify: Summary | null;
  };
  stagesMeasured: { publisher: boolean; notifier: boolean };
  counters: { before: Record<string, number>; after: Record<string, number> };
  chaos: ChaosResult | null;
  finalState: { pristine: boolean; problems: string[]; restoredBy: string[] };
  incomplete: string[];
}

const COUNTERS = ["alerts_created", "duplicate_alerts_ignored", "duplicate_events_ignored", "undecodable_logs", "rpc_retries", "sync_errors", "reorgs_handled", "range_splits"];

export function renderReport(r: ScenarioReport): string {
  const c = r.comparison;
  const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
  const link = (h: string) => `[${h.slice(0, 10)}…${h.slice(-6)}](${r.explorerUrl}/tx/${h})`;
  const lat = (name: string, s: Summary | null, why: string) =>
    s ? `| ${name} | ${s.n} | ${s.min} | ${s.median} | ${s.p90} | ${s.max} |` : `| ${name} (not measured: ${why}) | 0 | — | — | — | — |`;

  const out: string[] = [
    "# ChainSentinel scripted-scenario report",
    "",
    `Generated ${r.generatedAt} · ${r.network} (chain ID ${r.chainId}) · commit ${r.commit ?? "unknown"}`,
    `Registry [${r.registry}](${r.explorerUrl}/address/${r.registry}) · fixture token [${r.token}](${r.explorerUrl}/address/${r.token})`,
    `Settings: ${r.config.confirmations} confirmations, monitor poll ${r.config.pollIntervalMs} ms, gas price ${r.config.gasPriceGwei} gwei, fault injection ${r.config.chaos ? "ON" : "off"}`,
    "",
    "## Result",
    "",
    "| Measure | Value |",
    "|---|---|",
    `| Expected alerts | ${c.truePositives.length + c.missed.length} |`,
    `| Detected as expected | ${c.truePositives.length} |`,
    `| Missed | ${c.missed.length} |`,
    `| Unexpected alerts from scenario transactions (false positives) | ${c.falsePositives.length} |`,
    `| Alerts not attributable to a scenario transaction | ${c.unattributed.length} |`,
    `| Precision | ${pct(c.precision)} |`,
    `| Recall | ${pct(c.recall)} |`,
    `| Cases that correctly produced no alert | ${c.silentCorrect} of ${c.silentTotal} |`,
    `| Severity mismatches among matched alerts | ${c.severityMismatches.length} |`,
    "",
    "## Steps",
    "",
    "| Step | Action | Signer | Transaction | Block | Expected |",
    "|---|---|---|---|---|---|",
    ...r.steps.map((s) => `| ${s.id} | ${s.label} | ${s.signer} | ${link(s.txHash)} | ${s.blockNumber} | ${s.expected.length ? s.expected.join(", ") : "no alert"} |`),
    "",
    "## Latency (seconds, local clock, resolution about ±2 s)",
    "",
    "| Stage | n | min | median | p90 (nearest rank) | max |",
    "|---|---|---|---|---|---|",
    lat("Transaction mined → alert detected", r.latency.detect, "no matched alerts"),
    lat("Alert detected → audit record published", r.latency.publish, "publisher was not running"),
    lat("Alert detected → Telegram message sent", r.latency.notify, "notifier was not running"),
    lat("Transaction mined → audit record published", r.latency.endToAudit, "publisher was not running"),
    lat("Transaction mined → Telegram message sent", r.latency.endToNotify, "notifier was not running"),
    "",
    "The sample is small, so treat these as indicative. The minimum possible detection time is set by the confirmation depth (blocks of about 3 s on testnet).",
  ];
  if (r.config.chaos) out.push("", "These latencies include the monitor outage caused by fault injection; use a run without it for steady-state latency.");

  out.push("", "## Monitor counters", "", "| Counter | Before | After | Change |", "|---|---|---|---|");
  for (const k of COUNTERS) {
    const b = r.counters.before[k] ?? 0;
    const a = r.counters.after[k] ?? 0;
    out.push(`| ${k} | ${b} | ${a} | ${a - b} |`);
  }

  if (r.chaos) {
    out.push(
      "", "## Fault injection", "",
      `The monitor process was killed with SIGKILL ${r.chaos.kills} time(s) and restarted ${r.chaos.restarts} time(s). ` +
        `Catch-up after the final restart: ${r.chaos.catchUpSecs === null ? "did not complete within the timeout" : `${r.chaos.catchUpSecs} s`}. ${r.chaos.note}`
    );
  }

  out.push("", "## Final fixture state", "", r.finalState.pristine ? "The fixture was back in its starting state." : `Problems: ${r.finalState.problems.join("; ")}`);
  if (r.finalState.restoredBy.length) out.push("", `Automatic restoration: ${r.finalState.restoredBy.join("; ")}`);
  if (r.incomplete.length) out.push("", "## Incomplete", "", ...r.incomplete.map((x) => `- ${x}`));

  out.push(
    "", "## Caveats", "",
    "- The events are generated by a fixture token with standard OpenZeppelin-style event signatures. The scenarios check that the rules behave as specified; they do not show that real attacks would be detected.",
    "- An alert is an observation plus a rule-based assessment, not proof of malicious activity.",
    "- A published audit record proves only that a record was submitted and included on-chain.",
    "- Measurements come from a single run on a public testnet, so network conditions affect them."
  );
  return out.join("\n") + "\n";
}
