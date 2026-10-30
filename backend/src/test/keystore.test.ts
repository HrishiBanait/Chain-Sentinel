import assert from "node:assert/strict";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { test } from "node:test";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptKeystore } from "../keystore.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // public Anvil dev key

function encrypt(pk: Hex, password: string): string {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const dk = scryptSync(password, salt, 32, { N: 1024, r: 8, p: 1 });
  const cipher = createCipheriv("aes-128-ctr", dk.subarray(0, 16), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(pk.slice(2), "hex")), cipher.final()]);
  const mac = keccak256(new Uint8Array(Buffer.concat([dk.subarray(16, 32), ct]))).slice(2);
  return JSON.stringify({
    version: 3,
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ct.toString("hex"),
      kdf: "scrypt",
      kdfparams: { dklen: 32, n: 1024, r: 8, p: 1, salt: salt.toString("hex") },
      mac,
    },
  });
}

test("decrypts a V3 scrypt keystore to the original key", () => {
  const key = decryptKeystore(encrypt(KEY, "correct horse"), "correct horse");
  assert.equal(key, KEY);
  assert.equal(privateKeyToAccount(key).address.toLowerCase(), "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
});

test("a wrong password is rejected by the MAC check", () => {
  assert.throws(() => decryptKeystore(encrypt(KEY, "correct horse"), "wrong"), /MAC mismatch/);
});

test("unsupported or malformed keystores fail with clear errors", () => {
  assert.throws(() => decryptKeystore(JSON.stringify({ version: 3 }), "x"), /not a V3 keystore/);
  const bad = JSON.parse(encrypt(KEY, "p"));
  bad.crypto.cipher = "aes-256-cbc";
  assert.throws(() => decryptKeystore(JSON.stringify(bad), "p"), /unsupported cipher/);
  bad.crypto.cipher = "aes-128-ctr";
  bad.crypto.kdf = "argon2";
  assert.throws(() => decryptKeystore(JSON.stringify(bad), "p"), /unsupported kdf/);
});
