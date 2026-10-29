import { createPublicClient, http, keccak256, pad, toHex, type Hex } from "viem";
import { mstTestnet } from "../chains.js";

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
};
const TOKEN = need("MST_TESTNET_DEMO_TOKEN_ADDRESS") as Hex;
const REGISTRY = need("MST_TESTNET_REGISTRY_ADDRESS") as Hex;
const TREASURY = need("MST_TESTNET_ADMIN_ADDRESS") as Hex;
const DEPLOYER = need("MST_TESTNET_DEPLOYER_ADDRESS") as Hex;
const TOKEN_FROM = BigInt(need("MST_TESTNET_DEMO_TOKEN_DEPLOY_BLOCK"));
const REGISTRY_FROM = BigInt(need("MST_TESTNET_DEPLOY_BLOCK"));

const sig = (s: string) => keccak256(toHex(s));
const TRANSFER = sig("Transfer(address,address,uint256)");
const OWNERSHIP = sig("OwnershipTransferred(address,address)");
const PAUSED = sig("Paused(address)");
const UNPAUSED = sig("Unpaused(address)");
const ALERT_PUBLISHED = sig("AlertPublished(bytes32,uint256,address,bytes32,uint8,address)");
const NAMES: Record<string, string> = {
  [TRANSFER]: "Transfer",
  [OWNERSHIP]: "OwnershipTransferred",
  [PAUSED]: "Paused",
  [UNPAUSED]: "Unpaused",
  [ALERT_PUBLISHED]: "AlertPublished",
};
const topicOf = (a: string) => pad(a.toLowerCase() as Hex, { size: 32 });

type RawLog = { address: Hex; topics: Hex[]; blockHash: Hex; transactionHash: Hex };

const client = createPublicClient({
  chain: mstTestnet,
  transport: http(mstTestnet.rpcUrls.default.http[0], { timeout: 30_000, retryCount: 1 }),
});

let failures = 0;

async function getLogs(filter: Record<string, unknown>): Promise<RawLog[]> {
  return (await client.request({ method: "eth_getLogs", params: [filter as any] })) as unknown as RawLog[];
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`      (${label}: ${Date.now() - started} ms)`);
    return result;
  } catch (e) {
    failures++;
    console.log(`FAIL  ${label}: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    return undefined;
  }
}

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual}, expected ${expected}`);
}

const head = await client.getBlockNumber();
const from = (span: bigint) => (head > span ? head - span : 0n);
console.log("head:", head, "| token deployed at block:", TOKEN_FROM);

// A. everything the fixture emitted, filtered by address
const tokenLogs = await timed("A token logs since deploy", () =>
  getLogs({ address: TOKEN, fromBlock: toHex(TOKEN_FROM), toBlock: toHex(head) })
);
if (tokenLogs) {
  const counts: Record<string, number> = {};
  for (const l of tokenLogs) counts[NAMES[l.topics[0]] ?? l.topics[0]] = (counts[NAMES[l.topics[0]] ?? l.topics[0]] ?? 0) + 1;
  console.log("      by event:", counts);
  check("A total fixture logs", tokenLogs.length, 8);
  check("A Transfer", counts.Transfer ?? 0, 3);
  check("A OwnershipTransferred", counts.OwnershipTransferred ?? 0, 3);
  check("A Paused", counts.Paused ?? 0, 1);
  check("A Unpaused", counts.Unpaused ?? 0, 1);

  // G. query by blockHash (useful for reorg-safe fetching)
  const first = tokenLogs[0];
  const expectedInBlock = tokenLogs.filter((l) => l.blockHash === first.blockHash).length;
  const byHash = await timed("G getLogs by blockHash", () => getLogs({ address: TOKEN, blockHash: first.blockHash }));
  if (byHash) check("G logs in first block via blockHash", byHash.length, expectedInBlock);
}

// B. large-transfer query shape: Transfer TO treasury, across ALL token contracts, growing ranges
for (const span of [head - TOKEN_FROM + 1n, 10_000n, 50_000n, 200_000n]) {
  const logs = await timed(`B Transfer to treasury, ${span} blocks`, () =>
    getLogs({ fromBlock: toHex(from(span)), toBlock: toHex(head), topics: [TRANSFER, null, topicOf(TREASURY)] })
  );
  if (logs) {
    const ours = logs.filter((l) => l.address.toLowerCase() === TOKEN.toLowerCase()).length;
    const others = new Set(logs.filter((l) => l.address.toLowerCase() !== TOKEN.toLowerCase()).map((l) => l.address.toLowerCase()));
    check(`B fixture-token Transfers to treasury (${span} blocks)`, ours, 2);
    console.log(`      other tokens: ${logs.length - ours} transfer(s) from ${others.size} contract(s)`);
  }
}

// C. indexed topic in position 1 (sender)
const fromDeployer = await timed("C Transfer from deployer", () =>
  getLogs({ fromBlock: toHex(TOKEN_FROM), toBlock: toHex(head), topics: [TRANSFER, topicOf(DEPLOYER)] })
);
if (fromDeployer) check("C Transfer from deployer", fromDeployer.length, 2);

// D. OR of two values in one topic position
const orHolders = await timed("D OR in topic2", () =>
  getLogs({
    fromBlock: toHex(TOKEN_FROM),
    toBlock: toHex(head),
    topics: [TRANSFER, null, [topicOf(TREASURY), topicOf(DEPLOYER)]],
  })
);
if (orHolders) check("D Transfer to treasury OR deployer (2 + 1 mint)", orHolders.length, 3);

// E. address array plus OR of event signatures (registry and fixture in one call)
const mixed = await timed("E address array + OR topic0", () =>
  getLogs({
    address: [REGISTRY, TOKEN],
    fromBlock: toHex(REGISTRY_FROM),
    toBlock: toHex(head),
    topics: [[PAUSED, ALERT_PUBLISHED]],
  })
);
if (mixed) {
  check("E Paused + AlertPublished logs", mixed.length, 2);
  check("E distinct emitting addresses", new Set(mixed.map((l) => l.address.toLowerCase())).size, 2);
}

// F. negative control
const none = await timed("F Transfer to unrelated address", () =>
  getLogs({
    fromBlock: toHex(TOKEN_FROM),
    toBlock: toHex(head),
    topics: [TRANSFER, null, topicOf("0x000000000000000000000000000000000000dEaD")],
  })
);
if (none) check("F Transfer to unrelated address", none.length, 0);

// H. parent-hash chain (needed for reorg detection)
const blocks = await Promise.all(
  Array.from({ length: 21 }, (_, i) => client.getBlock({ blockNumber: head - 20n + BigInt(i) }))
);
let linked = true;
for (let i = 1; i < blocks.length; i++) if (blocks[i].parentHash !== blocks[i - 1].hash) linked = false;
check("H parentHash links 21 consecutive blocks", linked, true);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
