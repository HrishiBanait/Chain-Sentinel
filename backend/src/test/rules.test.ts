import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex } from "viem";
import type { StoredEvent } from "../db.js";
import { assess, RULE_VERSION, Severity, ZERO_ADDRESS, type RuleTarget } from "../rules.js";

const addr = (c: string) => `0x${c.repeat(40)}` as Hex;
const TARGET = addr("1");
const TOKEN = addr("7");
const OTHER = addr("f");
const A1 = addr("a");
const A2 = addr("b");
const tokens = new Set([TOKEN.toLowerCase()]);
const target = (thr: bigint): RuleTarget => ({ id: 1, address: TARGET, transferThreshold: thr });

function ev(name: string, args: Record<string, string | boolean>, address: Hex = TARGET): StoredEvent {
  return {
    chainId: 91562037, txHash: `0x${"ab".repeat(32)}` as Hex, logIndex: 0, blockNumber: 10n,
    blockHash: `0x${"cd".repeat(32)}` as Hex, blockTimestamp: 1_700_000_000, address, eventName: name, args,
  };
}

test("ownership rule: initial assignment and no-op transfers are silent; real changes and renouncing alert", () => {
  const run = (prev: string, next: string) =>
    assess({ event: ev("OwnershipTransferred", { previousOwner: prev, newOwner: next }), target: target(0n), monitoredTokens: tokens });
  assert.equal(run(ZERO_ADDRESS, A1), null);
  assert.equal(run(A1, A1), null);
  const changed = run(A1, A2)!;
  assert.deepEqual([changed.ruleId, changed.severity, changed.ruleVersion], ["ownership.changed", Severity.High, RULE_VERSION]);
  const renounced = run(A1, ZERO_ADDRESS)!;
  assert.deepEqual([renounced.ruleId, renounced.severity], ["ownership.renounced", Severity.Medium]);
  assert.equal(RULE_VERSION, 2);
});

test("pause rules: pausing is Medium, unpausing is Low", () => {
  const p = assess({ event: ev("Paused", { account: A1 }), target: target(0n), monitoredTokens: tokens })!;
  const u = assess({ event: ev("Unpaused", { account: A1 }), target: target(0n), monitoredTokens: tokens })!;
  assert.deepEqual([p.ruleId, p.severity], ["pause.paused", Severity.Medium]);
  assert.deepEqual([u.ruleId, u.severity], ["pause.unpaused", Severity.Low]);
});

test("transfer rule: boundaries, 10x escalation and direction", () => {
  const run = (value: string, from: string, to: string) =>
    assess({ event: ev("Transfer", { from, to, value }, TOKEN), target: target(1000n), monitoredTokens: tokens });
  assert.equal(run("999", OTHER, TARGET), null);
  const atThreshold = run("1000", OTHER, TARGET)!;
  assert.deepEqual([atThreshold.severity, atThreshold.details.direction, atThreshold.details.multiple], [Severity.Medium, "inbound", "1"]);
  assert.equal(run("9999", OTHER, TARGET)!.severity, Severity.Medium);
  assert.equal(run("10000", OTHER, TARGET)!.severity, Severity.High);
  assert.equal(run("1000", TARGET, OTHER)!.details.direction, "outbound");
  assert.equal(run("1000", TARGET, TARGET)!.details.direction, "self");
  assert.equal(run("5000", OTHER, A1), null); // does not involve the target
});

test("transfer rule is off for threshold 0 and for tokens that are not monitored", () => {
  const big = { from: OTHER, to: TARGET, value: "999999999" };
  assert.equal(assess({ event: ev("Transfer", big, TOKEN), target: target(0n), monitoredTokens: tokens }), null);
  assert.equal(assess({ event: ev("Transfer", big, OTHER), target: target(1000n), monitoredTokens: tokens }), null);
});
