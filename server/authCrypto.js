import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateParentCredentials(username, password) {
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) return "USERNAME_INVALID";
  if (typeof password !== "string" || password.length < 8 || password.length > 72) return "PASSWORD_INVALID";
  return null;
}

export async function hashParentPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyParentPassword(password, encodedHash) {
  const [algorithm, n, r, p, saltValue, hashValue] = String(encodedHash || "").split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = Buffer.from(
    await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 32 * 1024 * 1024
    })
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeRegistrationKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generateRegistrationKey() {
  const bytes = randomBytes(16);
  const body = Array.from(bytes, (value) => keyAlphabet[value % keyAlphabet.length]).join("").match(/.{1,4}/g).join("-");
  return `KID-${body}`;
}
