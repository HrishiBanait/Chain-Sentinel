import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseAbiItem,
  type Chain,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { ChainRevert, type OnChainAlert, type PublishArgs, type PublishChain, type TxOutcome } from "./publisher.js";

export const publishAbi = parseAbi([
  "function publishAlert(bytes32 alertId, uint256 targetId, bytes32 evidenceHash, uint8 severity)",
  "function alertExists(bytes32 alertId) view returns (bool)",
  "function getAlert(bytes32 alertId) view returns ((uint256 targetId, bytes32 evidenceHash, uint8 severity, address reporter, uint64 publishedAt))",
  "function isReporter(address account) view returns (bool)",
  "error NotReporter()",
  "error TargetNotFound()",
  "error TargetDisabled()",
  "error ZeroAlertId()",
  "error ZeroEvidenceHash()",
  "error AlertAlreadyPublished()",
  "error AlertNotFound()",
]);

const alertPublished = parseAbiItem(
  "event AlertPublished(bytes32 indexed alertId, uint256 indexed targetId, address indexed target, bytes32 evidenceHash, uint8 severity, address reporter)"
);

export interface FeePolicy {
  mode: "auto" | "legacy";
  minTipWei: bigint;
  legacyGasPriceWei: bigint;
}

function toChainRevert(e: unknown): unknown {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      return new ChainRevert(r.data?.errorName ?? r.reason ?? "UnknownRevert", r.shortMessage);
    }
  }
  return e;
}

export function createViemPublishChain(o: {
  chain: Chain;
  rpcUrl: string;
  registry: Hex;
  account: PrivateKeyAccount;
  startBlock: bigint;
  fees: FeePolicy;
  receiptTimeoutMs?: number;
}) {
  const pub = createPublicClient({ chain: o.chain, transport: http(o.rpcUrl, { timeout: 30_000, retryCount: 2 }) });
  const wallet = createWalletClient({ account: o.account, chain: o.chain, transport: http(o.rpcUrl, { timeout: 30_000, retryCount: 0 }) });

  async function quote() {
    if (o.fees.mode === "legacy") return { gasPrice: o.fees.legacyGasPriceWei };
    const f = await pub.estimateFeesPerGas();
    const tip = f.maxPriorityFeePerGas > o.fees.minTipWei ? f.maxPriorityFeePerGas : o.fees.minTipWei;
    const max = f.maxFeePerGas > tip ? f.maxFeePerGas : tip;
    return { maxFeePerGas: max, maxPriorityFeePerGas: tip };
  }

  const adapter: PublishChain = {
    headBlock: () => pub.getBlockNumber(),

    async alertOnChain(alertId, atBlock): Promise<OnChainAlert> {
      const blockNumber = atBlock;
      const exists = await pub.readContract({ address: o.registry, abi: publishAbi, functionName: "alertExists", args: [alertId], blockNumber });
      if (!exists) return { exists: false };
      const rec = await pub.readContract({ address: o.registry, abi: publishAbi, functionName: "getAlert", args: [alertId], blockNumber });
      return { exists: true, evidenceHash: rec.evidenceHash };
    },

    async simulate(a: PublishArgs) {
      try {
        await pub.simulateContract({
          account: o.account,
          address: o.registry,
          abi: publishAbi,
          functionName: "publishAlert",
          args: [a.alertId, a.targetId, a.evidenceHash, a.severity],
        });
      } catch (e) {
        throw toChainRevert(e);
      }
    },

    async send(a: PublishArgs) {
      const q = await quote();
      const common = {
        account: o.account,
        chain: o.chain,
        address: o.registry,
        abi: publishAbi,
        functionName: "publishAlert" as const,
        args: [a.alertId, a.targetId, a.evidenceHash, a.severity] as const,
      };
      try {
        return "gasPrice" in q
          ? await wallet.writeContract({ ...common, gasPrice: q.gasPrice })
          : await wallet.writeContract({ ...common, maxFeePerGas: q.maxFeePerGas, maxPriorityFeePerGas: q.maxPriorityFeePerGas });
      } catch (e) {
        throw toChainRevert(e);
      }
    },

    async receipt(hash): Promise<TxOutcome | null> {
      try {
        const r = await pub.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: r.blockNumber };
      } catch (e) {
        if ((e as Error).name === "TransactionReceiptNotFoundError") return null;
        throw e;
      }
    },

    async waitReceipt(hash): Promise<TxOutcome | null> {
      try {
        const r = await pub.waitForTransactionReceipt({ hash, timeout: o.receiptTimeoutMs ?? 90_000, pollingInterval: 2_000 });
        return { status: r.status, blockNumber: r.blockNumber };
      } catch (e) {
        if ((e as Error).name === "WaitForTransactionReceiptTimeoutError") return null;
        throw e;
      }
    },

    async findPublishTx(alertId) {
      const head = await pub.getBlockNumber();
      const STEP = 50_000n;
      for (let from = o.startBlock; from <= head; from += STEP) {
        const to = from + STEP - 1n < head ? from + STEP - 1n : head;
        const logs = await pub.getLogs({ address: o.registry, event: alertPublished, args: { alertId }, fromBlock: from, toBlock: to });
        const hit = logs.find((l) => l.transactionHash !== null);
        if (hit && hit.transactionHash) return { txHash: hit.transactionHash, blockNumber: hit.blockNumber };
      }
      return null;
    },
  };

  return {
    adapter,
    isReporter: (who: Hex) => pub.readContract({ address: o.registry, abi: publishAbi, functionName: "isReporter", args: [who] }),
    getBalance: (who: Hex) => pub.getBalance({ address: who }),
    getChainId: () => pub.getChainId(),
    feeQuote: quote,
  };
}
