import { formatUnits } from "viem";

export const trimSlash = (s: string): string => s.replace(/\/+$/, "");
export const short = (s: string, head = 6, tail = 4): string =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
export const txUrl = (base: string, hash: string): string => `${trimSlash(base)}/tx/${hash}`;
export const addressUrl = (base: string, address: string): string => `${trimSlash(base)}/address/${address}`;

/** Only called from effects and event data (never during prerender). */
export function fmtTime(secs: number | null | undefined): string {
  return secs ? new Date(secs * 1000).toLocaleString() : "unknown";
}

export function thresholdLabel(raw: string): { main: string; sub: string } {
  if (raw === "0") return { main: "Off", sub: "large-transfer rule disabled" };
  try {
    return { main: `${formatUnits(BigInt(raw), 18)} tokens`, sub: `${raw} raw units (assumes 18 decimals)` };
  } catch {
    return { main: raw, sub: "raw units" };
  }
}
