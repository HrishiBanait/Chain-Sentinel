import { readFileSync, statSync } from "node:fs";
import readline from "node:readline";
import { Writable } from "node:stream";
import { privateKeyToAccount } from "viem/accounts";
import type { MonitorSettings } from "./config.js";
import { decryptKeystoreFile } from "./keystore.js";
import type { PublisherSettings } from "./publisherConfig.js";
import { createViemPublishChain } from "./reporterChain.js";

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
    process.stdout.write(question);
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readPassword(ps: PublisherSettings): Promise<string> {
  if (ps.passwordFile) {
    if (statSync(ps.passwordFile).mode & 0o077) console.warn(`warning: ${ps.passwordFile} is readable by other users; run chmod 600 on it`);
    return readFileSync(ps.passwordFile, "utf8").replace(/\r?\n$/, "");
  }
  return promptHidden("Keystore password: ");
}

/** Decrypt the reporter keystore and build the chain adapter. The key is never logged or written anywhere. */
export async function openReporter(s: MonitorSettings, ps: PublisherSettings) {
  const account = privateKeyToAccount(decryptKeystoreFile(ps.keystorePath, await readPassword(ps)));
  if (ps.expectedAddress && account.address.toLowerCase() !== ps.expectedAddress) {
    throw new Error(`keystore address ${account.address} does not match the configured reporter ${ps.expectedAddress}`);
  }
  const chain = createViemPublishChain({
    chain: s.chain,
    rpcUrl: s.chain.rpcUrls.default.http[0],
    registry: s.registryAddress,
    account,
    startBlock: s.startBlock,
    fees: { mode: ps.feeMode, minTipWei: ps.minTipWei, legacyGasPriceWei: ps.legacyGasPriceWei },
  });
  return { account, ...chain };
}
