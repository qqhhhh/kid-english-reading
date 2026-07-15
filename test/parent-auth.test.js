import assert from "node:assert/strict";
import test from "node:test";
import {
  generateRegistrationKey,
  hashParentPassword,
  normalizeRegistrationKey,
  normalizeUsername,
  validateParentCredentials,
  verifyParentPassword
} from "../server/authCrypto.js";

test("parent passwords are salted and verifiable", async () => {
  const first = await hashParentPassword("correct horse");
  const second = await hashParentPassword("correct horse");
  assert.notEqual(first, second);
  assert.equal(await verifyParentPassword("correct horse", first), true);
  assert.equal(await verifyParentPassword("wrong password", first), false);
});

test("registration keys are human readable but normalize to stable entropy", () => {
  const key = generateRegistrationKey();
  assert.match(key, /^KID-(?:[A-Z2-9]{4}-){3}[A-Z2-9]{4}$/);
  assert.equal(normalizeRegistrationKey(key.toLowerCase()), key.replaceAll("-", ""));
});

test("parent credential validation accepts local usernames and strong-enough passwords", () => {
  assert.equal(normalizeUsername("  Family_01 "), "family_01");
  assert.equal(validateParentCredentials("家庭01", "12345678"), null);
  assert.equal(validateParentCredentials("ab", "12345678"), "USERNAME_INVALID");
  assert.equal(validateParentCredentials("family", "short"), "PASSWORD_INVALID");
});
