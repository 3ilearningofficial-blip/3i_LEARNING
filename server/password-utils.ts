import { randomBytes, pbkdf2 as pbkdf2Cb, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";

const pbkdf2Async = promisify(pbkdf2Cb);

const PBKDF2_ITERATIONS = 210000;
const KEY_LEN = 64;

function toHex(input: Buffer | string): string {
  return Buffer.isBuffer(input) ? input.toString("hex") : Buffer.from(input).toString("hex");
}

export function isScryptHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && (hash.startsWith("scrypt$") || hash.startsWith("pbkdf2$"));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha512")) as Buffer;
  return `pbkdf2$${PBKDF2_ITERATIONS}$sha512$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!isScryptHash(storedHash)) return false;
  const parts = storedHash.split("$");
  if (parts[0] === "pbkdf2") {
    if (parts.length !== 5) return false;
    const [, iterStr, digest, saltHex, hashHex] = parts;
    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || !digest || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = (await pbkdf2Async(password, salt, iterations, expected.length, digest)) as Buffer;
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  // Legacy scrypt-tagged hashes are treated as non-matching by this verifier.
  return false;
}

export function verifyLegacySha256(password: string, userId: number, storedHash: string): boolean {
  const withUserId = createHash("sha256").update(password + String(userId)).digest("hex");
  const plain = createHash("sha256").update(password).digest("hex");
  return storedHash === withUserId || storedHash === plain;
}

