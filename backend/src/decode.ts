import { decodeEventLog, keccak256, parseAbi, toHex, type Abi, type Hex } from "viem";

export const registryAbi = parseAbi([
  "event TargetRegistered(uint256 indexed targetId, address indexed owner, address indexed target, uint256 transferThreshold)",
  "event TargetEnabledChanged(uint256 indexed targetId, bool enabled)",
  "event TransferThresholdChanged(uint256 indexed targetId, uint256 oldThreshold, uint256 newThreshold)",
]);

export const watchedAbi = parseAbi([
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const sig = (s: string): Hex => keccak256(toHex(s));

export const TOPIC = {
  TargetRegistered: sig("TargetRegistered(uint256,address,address,uint256)"),
  TargetEnabledChanged: sig("TargetEnabledChanged(uint256,bool)"),
  TransferThresholdChanged: sig("TransferThresholdChanged(uint256,uint256,uint256)"),
  OwnershipTransferred: sig("OwnershipTransferred(address,address)"),
  Paused: sig("Paused(address)"),
  Unpaused: sig("Unpaused(address)"),
  Transfer: sig("Transfer(address,address,uint256)"),
} as const;

export const REGISTRY_TOPICS: Hex[] = [TOPIC.TargetRegistered, TOPIC.TargetEnabledChanged, TOPIC.TransferThresholdChanged];
export const TARGET_EVENT_TOPICS: Hex[] = [TOPIC.OwnershipTransferred, TOPIC.Paused, TOPIC.Unpaused];

const NAME_BY_TOPIC = new Map<string, string>(Object.entries(TOPIC).map(([name, t]) => [t.toLowerCase(), name]));
const REGISTRY_EVENT_NAMES = new Set(["TargetRegistered", "TargetEnabledChanged", "TransferThresholdChanged"]);

export type DecodedArgs = Record<string, string | boolean>;
export interface Decoded {
  eventName: string;
  args: DecodedArgs;
}

function normalize(args: Record<string, unknown>): DecodedArgs {
  const out: DecodedArgs = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "bigint") out[k] = v.toString();
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v;
    else out[k] = String(v);
  }
  return out;
}

/** Decode a supported log, or return null (unknown signature, wrong topic count, malformed data). */
export function decodeLog(topics: readonly Hex[], data: Hex): Decoded | null {
  const t0 = topics[0];
  if (!t0) return null;
  const name = NAME_BY_TOPIC.get(t0.toLowerCase());
  if (!name) return null;
  if (name === "Transfer" && topics.length !== 3) return null; // ERC-721 style (4 topics) is out of scope
  const abi = (REGISTRY_EVENT_NAMES.has(name) ? registryAbi : watchedAbi) as unknown as Abi;
  try {
    const d = decodeEventLog({ abi, data, topics: topics as [Hex, ...Hex[]], strict: true });
    if (d.eventName !== name || !d.args || Array.isArray(d.args)) return null;
    return { eventName: name, args: normalize(d.args as unknown as Record<string, unknown>) };  } catch {
    return null;
  }
}
