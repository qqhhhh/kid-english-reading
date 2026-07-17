import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";

const { buildProgress } = await import("../server/index.js");
const { createChild, createHousehold, createLesson, findSentenceById, insertAttempt } = await import("../server/db.js");
const householdId = "optional-household";
createHousehold({ id: householdId, name: "Optional household" });

test("an optional vocabulary word needs a non-zero score to be completed", async () => {
  createChild({ id: "optional-child", name: "Optional tester", householdId });
  createLesson({
    id: "optional-lesson",
    title: "Optional words",
    householdId,
    chapters: [
      {
        id: "optional-chapter",
        title: "Unit 1",
        sections: [
          {
            id: "optional-words",
            title: "Words",
            type: "vocabulary",
            partKind: "vocabulary",
            sentences: [
              {
                id: "optional-word",
                text: "job",
                minScore: 75,
                itemType: "word",
                phonetic: "/dʒɒb/",
                translation: "工作；职业",
                required: false
              }
            ]
          },
          {
            id: "required-reading",
            title: "Reading time",
            type: "reading-time",
            partKind: "reading-time",
            sentences: [
              {
                id: "required-sentence",
                text: "Mum is very busy.",
                minScore: 75,
                itemType: "reading",
                required: true
              }
            ]
          }
        ],
        sentences: [
          {
            id: "optional-word",
            text: "job",
            minScore: 75,
            itemType: "word",
            phonetic: "/dʒɒb/",
            translation: "工作；职业",
            required: false
          },
          {
            id: "required-sentence",
            text: "Mum is very busy.",
            minScore: 75,
            itemType: "reading",
            required: true
          }
        ]
      }
    ]
  });
  assert.deepEqual(findSentenceById("optional-word", householdId), {
    id: "optional-word",
    text: "job",
    minScore: 75,
    itemType: "word",
    required: false
  });
  insertAttempt({
    id: "optional-zero-attempt",
    childId: "optional-child",
    householdId,
    sentenceId: "optional-word",
    referenceText: "job",
    createdAt: new Date().toISOString(),
    speechProvider: "mock",
    audioBytes: 1600,
    result: {
      SuggestedScore: 0,
      PronAccuracy: 0,
      PronFluency: 0.5,
      PronCompletion: 1,
      Words: []
    },
    severeIssues: 1,
    passed: false
  });

  const zeroProgress = (await buildProgress("optional-child", householdId)).find((item) => item.lessonId === "optional-lesson");
  assert.ok(zeroProgress);
  assert.equal(zeroProgress.passedCount, 0);
  assert.equal(zeroProgress.sentences[0].completed, false);

  insertAttempt({
    id: "optional-non-zero-attempt",
    childId: "optional-child",
    householdId,
    sentenceId: "optional-word",
    referenceText: "job",
    createdAt: new Date(Date.now() + 1).toISOString(),
    speechProvider: "mock",
    audioBytes: 1600,
    result: {
      SuggestedScore: 45,
      PronAccuracy: 45,
      PronFluency: 0.5,
      PronCompletion: 1,
      Words: []
    },
    severeIssues: 1,
    passed: false
  });

  const progress = (await buildProgress("optional-child", householdId)).find((item) => item.lessonId === "optional-lesson");
  assert.ok(progress);
  assert.equal(progress.passedCount, 1);
  assert.equal(progress.totalCount, 2);
  assert.deepEqual(
    progress.sentences.map((sentence) => ({
      sentenceId: sentence.sentenceId,
      passed: sentence.passed,
      completed: sentence.completed,
      optional: sentence.optional
    })),
    [
      { sentenceId: "optional-word", passed: false, completed: true, optional: true },
      { sentenceId: "required-sentence", passed: false, completed: false, optional: false }
    ]
  );
});
