import assert from "node:assert/strict";
import test from "node:test";

import { cloneCourseLibraryResource, listCourseLibraryResources } from "../server/courseLibrary.js";

test("course library exposes summary metadata without leaking mutable source data", () => {
  const resources = listCourseLibraryResources();
  assert.equal(resources.length > 0, true);
  assert.equal(resources[0].stats.chapters, 1);
  assert.equal(resources[0].stats.sections, 3);
  assert.equal(resources[0].stats.sentences, 10);
  assert.equal("chapters" in resources[0], false);
});

test("course library clone regenerates stable lesson hierarchy for each household copy", () => {
  const first = cloneCourseLibraryResource("family-helpers-starter", 78);
  const second = cloneCourseLibraryResource("family-helpers-starter", 78);

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.lessonId, second.lessonId);
  assert.equal(first.sourceType, "library:family-helpers-starter");
  assert.equal(first.chapters[0].sections[0].partKind, "vocabulary");
  assert.equal(first.chapters[0].sections[0].sentences[0].phonetic, "/ˈfæməli/");
  assert.equal(first.chapters[0].sections[0].sentences[0].minScore, 78);
  assert.equal(first.chapters[0].sentences.length, 10);
  assert.equal(new Set(first.chapters[0].sentences.map((sentence) => sentence.id)).size, 10);
});

test("course library clone rejects an unknown resource", () => {
  assert.equal(cloneCourseLibraryResource("missing-resource"), null);
});
