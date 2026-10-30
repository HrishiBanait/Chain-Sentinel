import { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from "viem";
import type { Reader } from "./chainRead";
import { CHAINS } from "./chains";
import type { ApiAlert, ApiConfig } from "./types";

const abi = parseAbi([
  "function alertExists(bytes32 alertId) view returns (bool)",
  "function getAlert(bytes32 alertId) view returns ((uint256 targetId, bytes32 evidenceHash, uint8 severity, address reporter, uint64 publishedAt))",
  "event AlertPublished(bytes32 indexed alertId, uint256 indexed targetId, address indexed target, bytes32 evidenceHash, uint8 severity, address reporter)",
]);

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}
export interface VerifyResult {
  source: string;
  verdict: "verified" | "mismatch" | "not-found";
  checks: Check[];
}

const eq = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

interface RpcReceipt {
  status?: string;
  to?: string | null;
  from?: string;
  blockNumber?: string;
  logs?: { address: string; topics: Hex[]; data: Hex }[];
}

/** Reads the registry (and the publishing transaction) from the chain and compares them with the alert's evidence. */
export async function verifyOnChain(reader: Reader, cfg: ApiConfig, a: ApiAlert, evidenceJson: string): Promise<VerifyResult> {
  const checks: Check[] = [];
  const done = (verdict: VerifyResult["verdict"]): VerifyResult => ({ source: reader.source() ?? "unknown", verdict, checks });

  const localHash = keccak256(toHex(evidenceJson));
  checks.push({ label: "The evidence text hashes to this alert's evidence hash", ok: eq(localHash, a.evidenceHash), detail: localHash });

  const alertId = a.alertId as Hex;
  const existsRaw = (await reader.call("eth_call", [
    { to: cfg.registryAddress, data: encodeFunctionData({ abi, functionName: "alertExists", args: [alertId] }) },
    "latest",
  ])) as Hex;
  if (!decodeFunctionResult({ abi, functionName: "alertExists", data: existsRaw })) {
    checks.push({ label: "A record with this alert id exists in the registry", ok: false, detail: "alertExists returned false" });
    return done("not-found");
  }
  checks.push({ label: "A record with this alert id exists in the registry", ok: true, detail: cfg.registryAddress });

  const recRaw = (await reader.call("eth_call", [
    { to: cfg.registryAddress, data: encodeFunctionData({ abi, functionName: "getAlert", args: [alertId] }) },
    "latest",
  ])) as Hex;
  const rec = decodeFunctionResult({ abi, functionName: "getAlert", data: recRaw });

  checks.push({ label: "On-chain evidence hash equals this alert's evidence hash", ok: eq(rec.evidenceHash, a.evidenceHash), detail: rec.evidenceHash });
  checks.push({ label: "On-chain target id matches", ok: rec.targetId === BigInt(a.targetId), detail: `#${rec.targetId}` });
  checks.push({ label: "On-chain severity matches", ok: Number(rec.severity) === a.severity, detail: String(rec.severity) });
  checks.push({ label: "Published by reporter", ok: true, detail: rec.reporter });

  if (a.publishTxHash) {
    const r = (await reader.call("eth_getTransactionReceipt", [a.publishTxHash])) as RpcReceipt | null;
    if (!r) {
      checks.push({ label: "Publishing transaction has a receipt", ok: false, detail: "no receipt found for " + a.publishTxHash });
    } else {
      checks.push({ label: "Publishing transaction succeeded", ok: r.status === "0x1", detail: `status ${r.status}` });
      checks.push({ label: "It was sent to the registry contract", ok: eq(r.to, cfg.registryAddress), detail: r.to ?? "none" });
      checks.push({ label: "It was sent by the record's reporter", ok: eq(r.from, rec.reporter), detail: r.from ?? "unknown" });

      let logOk = false;
      for (const l of r.logs ?? []) {
        if (!eq(l.address, cfg.registryAddress)) continue;
        try {
          const d = decodeEventLog({ abi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
          if (d.eventName === "AlertPublished" && eq(d.args.alertId, a.alertId) && eq(d.args.evidenceHash, a.evidenceHash)) logOk = true;
        } catch {
          // a log from the registry that is not AlertPublished
        }
      }
      checks.push({ label: "The transaction's AlertPublished event matches this alert and evidence", ok: logOk, detail: a.publishTxHash });

      if (r.blockNumber) {
        const head = BigInt((await reader.call("eth_blockNumber", [])) as string);
        const depth = head - BigInt(r.blockNumber);
        checks.push({ label: "Confirmations", ok: true, detail: `${depth < 0n ? 0n : depth} blocks deep (block ${BigInt(r.blockNumber)})` });
      }
    }
  }
  return done(checks.every((c) => c.ok) ? "verified" : "mismatch");
}

/** Commands anyone can run to repeat the check without trusting this page. */
export function castCommands(cfg: ApiConfig, a: ApiAlert, evidenceJson?: string): string {
  const rpc = CHAINS[cfg.chainId]?.rpcUrl ?? "<rpc url>";
  const lines = [
    "# 1. the record stored in the registry contract",
    `cast call ${cfg.registryAddress} "getAlert(bytes32)((uint256,bytes32,uint8,address,uint64))" ${a.alertId} --rpc-url ${rpc}`,
  ];
  if (a.publishTxHash) lines.push("# 2. the publishing transaction", `cast receipt ${a.publishTxHash} --rpc-url ${rpc}`);
  lines.push(
    "# 3. the evidence hash; it must equal the second field of the record from step 1",
    evidenceJson ? `cast keccak '${evidenceJson.replace(/'/g, "'\\''")}'` : "cast keccak '<the exact evidence text>'"
  );
  return lines.join("\n");
}
