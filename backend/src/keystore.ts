import { createDecipheriv, pbkdf2Sync, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";

interface V3Crypto {
  cipher: string;
  cipherparams: { iv: string };
  ciphertext: string;
  kdf: string;
  kdfparams: Record<string, unknown>;
  mac: string;
}

/** Decrypt a Web3 Secret Storage v3 keystore (the format used by Foundry's `cast wallet new`). */
export function decryptKeystore(json: string, password: string): Hex {
  const ks = JSON.parse(json) as { crypto?: V3Crypto; Crypto?: V3Crypto };
  const c = ks.crypto ?? ks.Crypto;
  if (!c) throw new Error("not a V3 keystore (no crypto section)");
  if (c.cipher !== "aes-128-ctr") throw new Error(`unsupported cipher: ${c.cipher}`);

  const salt = Buffer.from(String(c.kdfparams.salt), "hex");
  const dklen = Number(c.kdfparams.dklen);
  let dk: Buffer;
  if (c.kdf === "scrypt") {
    dk = scryptSync(password, salt, dklen, {
      N: Number(c.kdfparams.n),
      r: Number(c.kdfparams.r),
      p: Number(c.kdfparams.p),
      maxmem: 1024 * 1024 * 1024,
    });
  } else if (c.kdf === "pbkdf2") {
    if (c.kdfparams.prf !== "hmac-sha256") throw new Error(`unsupported pbkdf2 prf: ${String(c.kdfparams.prf)}`);
    dk = pbkdf2Sync(password, salt, Number(c.kdfparams.c), dklen, "sha256");
  } else {
    throw new Error(`unsupported kdf: ${c.kdf}`);
  }

  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const mac = keccak256(new Uint8Array(Buffer.concat([dk.subarray(16, 32), ciphertext])));
  if (mac.slice(2).toLowerCase() !== c.mac.toLowerCase()) {
    throw new Error("wrong password or corrupted keystore (MAC mismatch)");
  }
  const decipher = createDecipheriv("aes-128-ctr", dk.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  const key = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (key.length !== 32) throw new Error("decrypted key has an unexpected length");
  return `0x${key.toString("hex")}` as Hex;
}

export function decryptKeystoreFile(file: string, password: string): Hex {
  let json: string;
  try {
    json = readFileSync(file, "utf8");
  } catch {
    throw new Error(`cannot read keystore file: ${file}`);
  }
  return decryptKeystore(json, password);
}
