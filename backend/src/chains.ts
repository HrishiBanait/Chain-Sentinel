import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineChain } from "viem";

// Load the repo-root .env regardless of where the script is launched from.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// NOTE: decimals = 18 is an assumption (standard EVM). We verify it against
// the MST docs before relying on it for any value formatting.
export const mstTestnet = defineChain({
  id: Number(required("MST_TESTNET_CHAIN_ID")),
  name: "MST Testnet",
  nativeCurrency: { name: "tMSTC", symbol: "tMSTC", decimals: 18 },
  rpcUrls: { default: { http: [required("MST_TESTNET_RPC_URL")] } },
  blockExplorers: {
    default: {
      name: "MSTScan Testnet",
      url: required("MST_TESTNET_EXPLORER_URL"),
    },
  },
  testnet: true,
});

export const mstMainnet = defineChain({
  id: Number(required("MST_MAINNET_CHAIN_ID")),
  name: "MST Mainnet",
  nativeCurrency: { name: "MSTC", symbol: "MSTC", decimals: 18 },
  rpcUrls: { default: { http: [required("MST_MAINNET_RPC_URL")] } },
  blockExplorers: {
    default: {
      name: "MSTScan",
      url: required("MST_MAINNET_EXPLORER_URL"),
    },
  },
});
