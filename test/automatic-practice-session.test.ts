import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";

const {
  createAutomaticPracticeSession,
  createChild,
  createHousehold,
  createLesson,
  finishAutomaticPracticeSession,
  findAutomaticPracticeSession,
  initDatabase,
  listAutomaticPracticeSessions
} = await import("../server/db.js");

initDatabase();
const householdId = "automatic-session-household";
createHousehold({ id: householdId, name: "Session household" });

test("automatic practice sessions retain their final sentence and stop reason", () => {
  createChild({ id: "automatic-session-child", name: "Session tester", householdId });
  createLesson({
    id: "automatic-session-lesson",
    title: "Automatic session lesson",
    householdId,
    chapters: [
      {
        id: "automatic-session-chapter",
        title: "Unit 1",
        sentences: [
          { id: "automatic-session-sentence-1", text: "Can you help?", minScore: 75 },
          { id: "automatic-session-sentence-2", text: "Yes, I can.", minScore: 75 }
        ]
      }
    ]
  });

  const started = createAutomaticPracticeSession({
    id: "automatic-session-1",
    childId: "automatic-session-child",
    lessonId: "automatic-session-lesson",
    sentenceId: "automatic-session-sentence-1",
    householdId,
    startedAt: "2026-07-11T12:00:00.000Z"
  });
  assert.ok(started);
  assert.equal(started.status, "active");

  const finished = finishAutomaticPracticeSession({
    id: "automatic-session-1",
    childId: "automatic-session-child",
    sentenceId: "automatic-session-sentence-2",
    stopReason: "failed-attempts",
    noSpeechCount: 0,
    failedAttemptCount: 3,
    householdId,
    endedAt: "2026-07-11T12:05:00.000Z"
  });
  assert.ok(finished);
  assert.equal(finished.status, "stopped");
  assert.equal(finished.stopReason, "failed-attempts");
  assert.equal(finished.lastSentenceText, "Yes, I can.");
  assert.equal(finished.failedAttemptCount, 3);

  const recent = listAutomaticPracticeSessions("automatic-session-child", 5, householdId);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.lessonTitle, "Automatic session lesson");
});

test("starting a new automatic session closes an abandoned active session", () => {
  createAutomaticPracticeSession({
    id: "automatic-session-abandoned",
    childId: "automatic-session-child",
    lessonId: "automatic-session-lesson",
    sentenceId: "automatic-session-sentence-1",
    householdId,
    startedAt: "2026-07-11T13:00:00.000Z"
  });
  createAutomaticPracticeSession({
    id: "automatic-session-current",
    childId: "automatic-session-child",
    lessonId: "automatic-session-lesson",
    sentenceId: "automatic-session-sentence-2",
    householdId,
    startedAt: "2026-07-11T13:01:00.000Z"
  });

  const abandoned = findAutomaticPracticeSession("automatic-session-abandoned", "automatic-session-child", householdId);
  assert.ok(abandoned);
  assert.equal(abandoned.status, "stopped");
  assert.equal(abandoned.stopReason, "interrupted");
});
