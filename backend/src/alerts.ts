import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, type Hex } from "viem";
import type { NewAlert, StoredEvent } from "./db.js";
import type { Assessment, RuleTarget } from "./rules.js";

function sortKeys(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)])
    );
  }
  return v;
}

/** JSON with sorted keys and no whitespace, so the same evidence always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function computeAlertId(a: {
  chainId: number;
  txHash: Hex;
  logIndex: number;
  ruleId: string;
  targetId: number;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint256 chainId, bytes32 txHash, uint256 logIndex, bytes32 ruleHash, uint256 targetId"),
      [BigInt(a.chainId), a.txHash, BigInt(a.logIndex), keccak256(toHex(a.ruleId)), BigInt(a.targetId)]
    )
  );
}

export function buildAlert(input: {
  chainId: number;
  event: StoredEvent;
  target: RuleTarget;
  assessment: Assessment;
  detectedAt: number;
}): NewAlert {
  const { chainId, event, target, assessment } = input;
  const evidenceJson = canonicalJson({
    schema: "chainsentinel.evidence.v1",
    chainId,
    rule: { id: assessment.ruleId, version: assessment.ruleVersion },
    target: { id: target.id, address: target.address, transferThreshold: target.transferThreshold.toString() },
    event: {
      address: event.address,
      name: event.eventName,
      args: event.args,
      blockNumber: event.blockNumber.toString(),
      blockHash: event.blockHash,
      blockTimestamp: event.blockTimestamp,
      txHash: event.txHash,
      logIndex: event.logIndex,
    },
    details: assessment.details,
  });
  return {
    alertId: computeAlertId({ chainId, txHash: event.txHash, logIndex: event.logIndex, ruleId: assessment.ruleId, targetId: target.id }),
    chainId,
    targetId: target.id,
    ruleId: assessment.ruleId,
    ruleVersion: assessment.ruleVersion,
    severity: assessment.severity,
    title: assessment.title,
    observed: assessment.observed,
    assessment: assessment.assessment,
    caveat: assessment.caveat,
    evidenceJson,
    evidenceHash: keccak256(toHex(evidenceJson)),
    sourceTxHash: event.txHash,
    sourceLogIndex: event.logIndex,
    blockNumber: event.blockNumber,
    detectedAt: input.detectedAt,
  };
}
