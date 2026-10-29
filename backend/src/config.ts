import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, type Chain, type Hex } from "viem";
import { mstMainnet, mstTestnet } from "./chains.js"; // also loads the repo-root .env

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function addr(label: string, v: string): Hex {
  if (!isAddress(v, { strict: false })) throw new Error(`${label} is not a valid address: ${v}`);
  return v.toLowerCase() as Hex;
}

export interface MonitorSettings {
  network: "testnet" | "mainnet";
  chain: Chain;
  registryAddress: Hex;
  startBlock: bigint;
  confirmations: bigint;
  batchSize: bigint;
  pollIntervalMs: number;
  monitoredTokens: Hex[];
  dbPath: string;
}

export function loadMonitorSettings(): MonitorSettings {
  const network = (process.env.MONITOR_NETWORK ?? "testnet") as string;
  if (network !== "testnet" && network !== "mainnet") throw new Error("MONITOR_NETWORK must be testnet or mainnet");
  const prefix = network === "mainnet" ? "MST_MAINNET" : "MST_TESTNET";

  return {
    network,
    chain: network === "mainnet" ? mstMainnet : mstTestnet,
    registryAddress: addr(`${prefix}_REGISTRY_ADDRESS`, req(`${prefix}_REGISTRY_ADDRESS`)),
    startBlock: BigInt(process.env.MONITOR_START_BLOCK || req(`${prefix}_DEPLOY_BLOCK`)),
    confirmations: BigInt(process.env.MONITOR_CONFIRMATIONS ?? "12"),
    batchSize: BigInt(process.env.MONITOR_BATCH_SIZE ?? "2000"),
    pollIntervalMs: Number(process.env.MONITOR_POLL_INTERVAL_MS ?? "6000"),
    monitoredTokens: (process.env.MONITOR_TOKENS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t) => addr("MONITOR_TOKENS entry", t)),
    dbPath: path.resolve(repoRoot, process.env.MONITOR_DB_PATH || `backend/data/chainsentinel-${network}.db`),
  };
}
