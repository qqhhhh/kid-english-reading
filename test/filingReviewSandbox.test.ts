import assert from "node:assert/strict";
import test from "node:test";
import {
  filingReviewChildren,
  filingReviewLessons,
  filingReviewProgress,
  findFilingReviewSentence,
  isFilingReviewSentenceText,
  sendFilingReviewReadModel
} from "../server/filingReviewSandbox.js";

test("filing review sandbox exposes a self-contained practice model", () => {
  assert.equal(filingReviewLessons.length, 1);
  assert.equal(filingReviewChildren.length, 1);
  assert.equal(filingReviewProgress.length, 1);

  const lesson = filingReviewLessons[0];
  const child = filingReviewChildren[0];
  const progress = filingReviewProgress[0];
  assert.equal(child.practiceBooks[0].items[0].lessonId, lesson.id);
  assert.equal(progress.lessonId, lesson.id);
  assert.equal(progress.totalCount, lesson.sentences.length);
  assert.equal(new Set(lesson.sentences.map((item) => item.id)).size, lesson.sentences.length);
  assert.equal(isFilingReviewSentenceText(lesson.sentences[0].text), true);
  assert.equal(isFilingReviewSentenceText("Synthesize arbitrary public text"), false);
  assert.equal(findFilingReviewSentence(lesson.sentences[0].id)?.text, lesson.sentences[0].text);
  assert.equal(findFilingReviewSentence("unknown"), null);
});

test("filing review middleware only handles its virtual read endpoints", () => {
  let payload: unknown;
  const response = { json(value: unknown) { payload = value; return response; } };
  assert.equal(sendFilingReviewReadModel({ path: "/lessons" }, response), true);
  assert.equal(payload, filingReviewLessons);
  assert.equal(sendFilingReviewReadModel({ path: "/unknown" }, response), false);
});
