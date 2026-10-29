import { encodeFunctionData, isAddress, parseAbi, parseUnits, type Hex } from "viem";

export const registryAbi = parseAbi([
  "function registerTarget(address target, uint256 transferThreshold) returns (uint256 targetId)",
  "function setTargetEnabled(uint256 targetId, bool enabled)",
  "function setTransferThreshold(uint256 targetId, uint256 newThreshold)",
]);

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type ParsedAmount = { ok: true; raw: bigint } | { ok: false; error: string };

/** Human token amount + decimals -> raw uint256. Zero is allowed (it turns the transfer rule off). */
export function parseThreshold(amount: string, decimalsInput: string): ParsedAmount {
  const a = amount.trim();
  const d = Number(decimalsInput);
  if (!Number.isInteger(d) || d < 0 || d > 36) return { ok: false, error: "Decimals must be a whole number from 0 to 36." };
  if (!/^\d+(\.\d+)?$/.test(a)) return { ok: false, error: "Enter a plain non-negative number such as 1000 or 2.5." };
  const frac = a.split(".")[1] ?? "";
  if (frac.length > d) return { ok: false, error: `At most ${d} decimal places for a token with ${d} decimals.` };
  const raw = parseUnits(a, d);
  if (raw > UINT256_MAX) return { ok: false, error: "That value is too large." };
  return { ok: true, raw };
}

export function validateTarget(input: string): string | null {
  const t = input.trim();
  if (!isAddress(t, { strict: false })) return "Enter a valid 0x address (40 hex characters).";
  if (t.toLowerCase() === ZERO_ADDRESS) return "The zero address cannot be monitored.";
  return null;
}

export const registerData = (target: string, raw: bigint): Hex =>
  encodeFunctionData({ abi: registryAbi, functionName: "registerTarget", args: [target as Hex, raw] });

export const enabledData = (id: number, enabled: boolean): Hex =>
  encodeFunctionData({ abi: registryAbi, functionName: "setTargetEnabled", args: [BigInt(id), enabled] });

export const thresholdData = (id: number, raw: bigint): Hex =>
  encodeFunctionData({ abi: registryAbi, functionName: "setTransferThreshold", args: [BigInt(id), raw] });
