import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";

const {
  consumeChildPairingCode,
  createChild,
  createChildPairingCodeRecord,
  createRegistrationKeyRecord,
  findChildDeviceSessionByTokenHash,
  initDatabase,
  listChildDeviceSessions,
  registerParentWithKey,
  revokeChildDeviceSession
} = await import("../server/db.js");

initDatabase();

test("a pairing code is single-use and its child device can be revoked", () => {
  createRegistrationKeyRecord({ id: "pairing-key", keyHash: "key-hash" });
  const parent = registerParentWithKey({ keyHash: "key-hash", householdId: "pairing-household", householdName: "测试家庭", userId: "pairing-parent", username: "pairing-user", passwordHash: "fake-password-hash" });
  createChild({ id: "pairing-child", name: "小朋友", householdId: parent.householdId });
  createChildPairingCodeRecord({ id: "pairing-code", householdId: parent.householdId, childId: "pairing-child", codeHash: "code-hash", expiresAt: new Date(Date.now() + 60_000).toISOString(), createdByUserId: parent.id });

  const device = consumeChildPairingCode({ codeHash: "code-hash", sessionId: "child-session", tokenHash: "token-hash", expiresAt: new Date(Date.now() + 60_000).toISOString(), label: "测试 iPad" });
  assert.equal(device.childId, "pairing-child");
  assert.equal(findChildDeviceSessionByTokenHash("token-hash")?.childName, "小朋友");
  assert.throws(() => consumeChildPairingCode({ codeHash: "code-hash", sessionId: "second-session", tokenHash: "second-token", expiresAt: new Date(Date.now() + 60_000).toISOString() }), /CHILD_PAIR_CODE_INVALID/);

  revokeChildDeviceSession({ id: "child-session", householdId: parent.householdId });
  assert.equal(findChildDeviceSessionByTokenHash("token-hash"), undefined);
  assert.ok(listChildDeviceSessions(parent.householdId)[0]?.revokedAt);
});
