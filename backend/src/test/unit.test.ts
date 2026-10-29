import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex } from "viem";
import { canonicalJson, computeAlertId } from "../alerts.js";
import { isRangeError, withRetry } from "../chainSource.js";

test("withRetry retries failures and returns the first success", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("temporary");
      return "ok";
    },
    { attempts: 3, baseMs: 1 }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry does not retry when shouldRetry says no, and range errors are told apart from rate limits", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error("query exceeds max block range"); }, { attempts: 4, baseMs: 1, shouldRetry: (e) => !isRangeError(e) }),
    /range/
  );
  assert.equal(calls, 1);
  assert.equal(isRangeError(new Error("query exceeds max block range")), true);
  assert.equal(isRangeError(new Error("429 Too Many Requests: rate limit exceeded")), false);
  assert.equal(isRangeError(new Error("upstream 503")), false);
});

test("alert ids are deterministic and distinct per target; evidence JSON is canonical", () => {
  const base = { chainId: 91562037, txHash: `0x${"ab".repeat(32)}` as Hex, logIndex: 3, ruleId: "ownership.changed", targetId: 1 };
  assert.equal(computeAlertId(base), computeAlertId({ ...base }));
  assert.notEqual(computeAlertId(base), computeAlertId({ ...base, targetId: 2 }));
  assert.notEqual(computeAlertId(base), computeAlertId({ ...base, ruleId: "pause.paused" }));
  assert.notEqual(computeAlertId(base), computeAlertId({ ...base, logIndex: 4 }));
  assert.equal(canonicalJson({ b: 1n, a: { d: 2, c: [3n] } }), canonicalJson({ a: { c: ["3"], d: 2 }, b: "1" }));
});
