import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, renderReport, summarize, type DetectedAlert, type ExpectedAlert, type ScenarioReport } from "../scenarioCore.js";

const tx = (c: string) => `0x${c.repeat(64)}`;
const exp = (stepId: string, t: string, rule: string, target: number, severity: number): ExpectedAlert => ({ stepId, txHash: t, ruleId: rule, targetId: target, severity });
const det = (t: string, rule: string, target: number, severity: number): DetectedAlert => ({
  alertId: tx("9"), txHash: t, ruleId: rule, targetId: target, severity, detectedAt: 100, publishedAt: null, notifiedAt: null, status: "new",
});

test("summarize handles empty, single and even-sized samples", () => {
  assert.equal(summarize([]), null);
  assert.deepEqual(summarize([5]), { n: 1, min: 5, median: 5, p90: 5, max: 5 });
  assert.deepEqual(summarize([10, 1, 3, 2]), { n: 4, min: 1, median: 2.5, p90: 10, max: 10 });
});

test("compare separates matches, misses, false positives and unattributed alerts, and scores silent cases", () => {
  const A = tx("a"), B = tx("b"), D = tx("d"), F = tx("f"), Z = tx("e");
  const expected = [exp("S1", A, "pause.paused", 2, 2), exp("S2", B, "ownership.changed", 2, 3)];
  const detected = [det(A, "pause.paused", 2, 3), det(D, "ownership.changed", 2, 3), det(Z, "pause.paused", 2, 2)];
  const c = compare(expected, detected, [A, B, D, F], [D, F]);

  assert.equal(c.truePositives.length, 1);
  assert.deepEqual(c.missed.map((m) => m.stepId), ["S2"]);
  assert.deepEqual(c.falsePositives.map((f) => f.txHash), [D]);
  assert.deepEqual(c.unattributed.map((u) => u.txHash), [Z]);
  assert.equal(c.severityMismatches.length, 1);
  assert.deepEqual([c.silentCorrect, c.silentTotal], [1, 2]);
  assert.equal(c.precision, 0.5);
  assert.equal(c.recall, 0.5);
});

function sampleReport(over: Partial<ScenarioReport> = {}): ScenarioReport {
  const A = tx("a");
  return {
    generatedAt: "2026-11-01T10:00:00Z", network: "MST Testnet", chainId: 91562037, explorerUrl: "https://testnet.mstscan.com",
    registry: `0x${"c".repeat(40)}`, token: `0x${"7".repeat(40)}`, commit: "abc1234",
    config: { confirmations: 12, pollIntervalMs: 6000, gasPriceGwei: "2", chaos: false },
    steps: [{ id: "S1", label: "pause the token", signer: "owner", txHash: A, blockNumber: 100, minedAt: 1000, expected: ["pause.paused"] }],
    comparison: compare([exp("S1", A, "pause.paused", 2, 2)], [det(A, "pause.paused", 2, 2)], [A], []),
    latency: { detect: summarize([40, 44]), publish: null, notify: summarize([5]), endToAudit: null, endToNotify: summarize([45]) },
    stagesMeasured: { publisher: false, notifier: true },
    counters: { before: { alerts_created: 1 }, after: { alerts_created: 2 } },
    chaos: null,
    finalState: { pristine: true, problems: [], restoredBy: [] },
    incomplete: [],
    ...over,
  };
}

test("the report links every transaction, states precision and recall, and marks unmeasured stages", () => {
  const md = renderReport(sampleReport());
  assert.ok(md.includes(`(https://testnet.mstscan.com/tx/${tx("a")})`));
  assert.ok(md.includes("| Precision | 100% |") && md.includes("| Recall | 100% |"));
  assert.ok(md.includes("not measured: publisher was not running"));
  assert.ok(md.includes("| alerts_created | 1 | 2 | 1 |"));
  assert.ok(md.includes("## Caveats") && md.includes("not proof of malicious activity"));
  assert.ok(!md.includes("## Fault injection"));
});

test("fault-injection runs say so, flag the latency caveat and report incomplete stages", () => {
  const md = renderReport(
    sampleReport({
      config: { confirmations: 12, pollIntervalMs: 6000, gasPriceGwei: "2", chaos: true },
      chaos: { kills: 2, restarts: 2, catchUpSecs: 41, note: "Kills were not synchronized with batch boundaries." },
      incomplete: ["timed out waiting for 2 audit records"],
      finalState: { pristine: false, problems: ["token is paused"], restoredBy: ["unpaused the token"] },
    })
  );
  assert.ok(md.includes("SIGKILL 2 time(s)") && md.includes("41 s"));
  assert.ok(md.includes("include the monitor outage"));
  assert.ok(md.includes("timed out waiting for 2 audit records"));
  assert.ok(md.includes("Problems: token is paused") && md.includes("unpaused the token"));
});
