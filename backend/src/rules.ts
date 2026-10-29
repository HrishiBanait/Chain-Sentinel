import type { Hex } from "viem";
import type { StoredEvent } from "./db.js";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const RULE_VERSION = 1;
// Same numbering as the Severity enum in ChainSentinelRegistry.sol.
export const Severity = { Info: 0, Low: 1, Medium: 2, High: 3, Critical: 4 } as const;

export interface RuleTarget {
  id: number;
  address: Hex;
  transferThreshold: bigint;
}

export interface Assessment {
  ruleId: string;
  ruleVersion: number;
  severity: number;
  title: string;
  observed: string; // what happened on-chain (fact)
  assessment: string; // why a rule flags it (judgement)
  caveat: string; // what this does NOT prove
  details: Record<string, string>;
}

export function assess(input: {
  event: StoredEvent;
  target: RuleTarget;
  monitoredTokens: ReadonlySet<string>;
}): Assessment | null {
  const { event, target } = input;
  const where = `tx ${event.txHash}, block ${event.blockNumber}`;

  switch (event.eventName) {
    case "OwnershipTransferred": {
      const prev = String(event.args.previousOwner);
      const next = String(event.args.newOwner);
      if (prev === ZERO_ADDRESS) return null; // initial assignment at deployment is not a change
      const renounced = next === ZERO_ADDRESS;
      return {
        ruleId: renounced ? "ownership.renounced" : "ownership.changed",
        ruleVersion: RULE_VERSION,
        severity: renounced ? Severity.Medium : Severity.High,
        title: renounced ? "Ownership renounced" : "Ownership changed",
        observed: `OwnershipTransferred emitted by ${event.address}: previous owner ${prev}, new owner ${next} (${where}).`,
        assessment: renounced
          ? "Ownership was set to the zero address, so owner-only functions may become permanently unavailable."
          : "Ownership of a monitored contract changed. The new owner can use any owner-only functions, so the change deserves review.",
        caveat:
          "Ownership changes are often routine (key rotation, handover to a multisig or timelock). This alert does not show that the change was unauthorized or malicious.",
        details: { previousOwner: prev, newOwner: next },
      };
    }
    case "Paused":
      return {
        ruleId: "pause.paused",
        ruleVersion: RULE_VERSION,
        severity: Severity.Medium,
        title: "Contract paused",
        observed: `Paused emitted by ${event.address}, triggered by ${String(event.args.account)} (${where}).`,
        assessment: "A monitored contract reported being paused. Pausing blocks the functions guarded by the pause switch.",
        caveat: "Pausing is a normal safety control and is often a protective response. The event alone does not show why it happened.",
        details: { account: String(event.args.account) },
      };
    case "Unpaused":
      return {
        ruleId: "pause.unpaused",
        ruleVersion: RULE_VERSION,
        severity: Severity.Low,
        title: "Contract unpaused",
        observed: `Unpaused emitted by ${event.address}, triggered by ${String(event.args.account)} (${where}).`,
        assessment: "A monitored contract resumed operation after a pause. It is worth confirming that the reason for the pause was resolved.",
        caveat: "Unpausing is normal after maintenance or an incident response. This alert does not show whether the underlying issue was fixed.",
        details: { account: String(event.args.account) },
      };
    case "Transfer":
      return assessTransfer(event, target, input.monitoredTokens, where);
    default:
      return null;
  }
}

function assessTransfer(
  event: StoredEvent,
  target: RuleTarget,
  tokens: ReadonlySet<string>,
  where: string
): Assessment | null {
  const threshold = target.transferThreshold;
  if (threshold === 0n || !tokens.has(event.address.toLowerCase())) return null;

  const value = BigInt(String(event.args.value));
  if (value < threshold) return null;

  const from = String(event.args.from);
  const to = String(event.args.to);
  const me = target.address.toLowerCase();
  const direction = from === me && to === me ? "self" : to === me ? "inbound" : from === me ? "outbound" : null;
  if (!direction) return null;

  const multiple = value / threshold;
  return {
    ruleId: "transfer.large",
    ruleVersion: RULE_VERSION,
    severity: multiple >= 10n ? Severity.High : Severity.Medium,
    title: `Large ${direction} token transfer`,
    observed: `Token ${event.address} moved ${value} raw units from ${from} to ${to} (${where}).`,
    assessment: `The amount is ${multiple}x the configured threshold of ${threshold} raw units for monitored address ${target.address} (${direction}).`,
    caveat:
      "Thresholds are in raw token units (decimals are not applied) and only monitored tokens are checked. A large transfer can be routine treasury activity; this alert does not show theft or an attack.",
    details: {
      direction,
      token: event.address,
      valueRaw: value.toString(),
      thresholdRaw: threshold.toString(),
      multiple: multiple.toString(),
    },
  };
}
