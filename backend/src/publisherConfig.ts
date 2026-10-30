import os from "node:os";
import path from "node:path";
import { isAddress, parseGwei, type Hex } from "viem";

export interface PublisherSettings {
  keystorePath: string;
  passwordFile: string | null;
  expectedAddress: Hex | null;
  feeMode: "auto" | "legacy";
  minTipWei: bigint;
  legacyGasPriceWei: bigint;
  minSeverity: number;
  pollIntervalMs: number;
  maxAttempts: number;
  pendingGraceSecs: number;
  backoffBaseSecs: number;
  maxPerRun: number;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

export function loadPublisherSettings(network: "testnet" | "mainnet"): PublisherSettings {
  const prefix = network === "mainnet" ? "MST_MAINNET" : "MST_TESTNET";
  const raw = process.env.REPORTER_KEYSTORE_PATH;
  if (!raw) throw new Error("REPORTER_KEYSTORE_PATH is required (path to an encrypted keystore file)");
  const keystorePath = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);

  const expected = process.env[`${prefix}_REPORTER_ADDRESS`];
  if (expected && !isAddress(expected, { strict: false })) throw new Error(`${prefix}_REPORTER_ADDRESS is not a valid address`);

  const feeMode = process.env.REPORTER_FEE_MODE ?? "auto";
  if (feeMode !== "auto" && feeMode !== "legacy") throw new Error("REPORTER_FEE_MODE must be auto or legacy");

  return {
    keystorePath,
    passwordFile: process.env.REPORTER_PASSWORD_FILE || null,
    expectedAddress: expected ? (expected.toLowerCase() as Hex) : null,
    feeMode,
    minTipWei: parseGwei(process.env.REPORTER_MIN_TIP_GWEI || "1"),
    legacyGasPriceWei: parseGwei(process.env.REPORTER_GAS_PRICE_GWEI || "2"),
    minSeverity: num("PUBLISH_MIN_SEVERITY", 0),
    pollIntervalMs: num("PUBLISH_POLL_INTERVAL_MS", 15_000),
    maxAttempts: num("PUBLISH_MAX_ATTEMPTS", 5),
    pendingGraceSecs: num("PUBLISH_PENDING_GRACE_SECS", 120),
    backoffBaseSecs: 10,
    maxPerRun: 50,
  };
}
