import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";

const {
  createChild,
  createHousehold,
  createLesson,
  findAttemptById,
  findSentenceById,
  initDatabase,
  insertAttempt,
  listChildren,
  listLessons
} = await import("../server/db.js");

initDatabase();

function seedHousehold(suffix) {
  const householdId = `isolation-household-${suffix}`;
  const childId = `isolation-child-${suffix}`;
  const lessonId = `isolation-lesson-${suffix}`;
  const sentenceId = `isolation-sentence-${suffix}`;
  createHousehold({ id: householdId, name: `Household ${suffix}` });
  createChild({ id: childId, name: `Child ${suffix}`, householdId });
  createLesson({
    id: lessonId,
    title: `Lesson ${suffix}`,
    householdId,
    chapters: [{ id: `${lessonId}-chapter`, title: "Unit 1", sentences: [{ id: sentenceId, text: `Hello ${suffix}.`, minScore: 75 }] }]
  });
  return { householdId, childId, lessonId, sentenceId };
}

test("children, lessons, sentences and attempts stay inside their household", () => {
  const first = seedHousehold("a");
  const second = seedHousehold("b");
  insertAttempt({
    id: "isolation-attempt-a",
    householdId: first.householdId,
    childId: first.childId,
    sentenceId: first.sentenceId,
    referenceText: "Hello a.",
    createdAt: new Date().toISOString(),
    speechProvider: "mock",
    result: { SuggestedScore: 90, PronAccuracy: 90, PronFluency: 0.9, PronCompletion: 1, Words: [] },
    passed: true
  });

  assert.deepEqual(listChildren(first.householdId).map((child) => child.id), [first.childId]);
  assert.deepEqual(listChildren(second.householdId).map((child) => child.id), [second.childId]);
  assert.deepEqual(listLessons({ householdId: first.householdId }).map((lesson) => lesson.id), [first.lessonId]);
  assert.equal(findSentenceById(first.sentenceId, second.householdId), null);
  assert.equal(findAttemptById("isolation-attempt-a", second.childId, second.householdId), null);
});
