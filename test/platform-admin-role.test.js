import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";
process.env.PLATFORM_ADMIN_USERNAMES = "boss, 管理员";

const { isPlatformAdminSession, publicParentSession } = await import("../server/parentAuth.js");

test("platform admin role accepts an explicit database role or configured username", () => {
  assert.equal(isPlatformAdminSession({ username: "normal", role: "platform_admin" }), true);
  assert.equal(isPlatformAdminSession({ username: "BOSS", role: "owner" }), true);
  assert.equal(isPlatformAdminSession({ username: "family", role: "owner" }), false);
  assert.equal(isPlatformAdminSession({ kind: "child", username: "boss", role: "owner" }), false);
});

test("public session exposes only the effective platform role", () => {
  const session = publicParentSession({
    id: "user-1",
    username: "boss",
    role: "owner",
    householdId: "household-1",
    householdName: "Boss home"
  });
  assert.equal(session.user.role, "platform_admin");
});
