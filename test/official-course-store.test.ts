import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";

const {
  createRegistrationKeyRecord,
  createLesson,
  findCourseSyncDraft,
  findOfficialCourseResource,
  initDatabase,
  listCourseSyncDrafts,
  listOfficialCourseResources,
  listLessons,
  markCourseSyncDraftPublished,
  publishOfficialCourseResource,
  registerParentWithKey,
  saveCourseSyncDraft,
  setOfficialCourseResourceStatus
} = await import("../server/db.js");

initDatabase();
createRegistrationKeyRecord({ id: "key-official", keyHash: "hash-official", label: "test", maxUses: 1 });
const admin = registerParentWithKey({
  keyHash: "hash-official",
  householdId: "household-official",
  householdName: "Official household",
  userId: "user-official",
  username: "official-admin",
  passwordHash: "test-hash"
});

function publish(versionTitle: string) {
  return publishOfficialCourseResource({
    id: "official-course-test",
    slug: "official-course-test",
    title: versionTitle,
    description: "A reviewed official course.",
    level: "入门",
    language: "英语",
    tags: ["测试"],
    sourceLabel: "自有内容",
    sourceHouseholdId: admin.householdId,
    sourceLessonId: "lesson-source",
    content: {
      id: "lesson-source",
      title: versionTitle,
      chapters: [{ id: "chapter-1", title: "Unit 1", sections: [], sentences: [{ id: "sentence-1", text: "Hello." }] }]
    },
    quality: { status: "good", counts: { high: 0, medium: 0, low: 0 } },
    createdByUserId: admin.id
  });
}

test("official course publishing creates immutable versions and advances current version", () => {
  const first = publish("Official v1");
  const second = publish("Official v2");
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(findOfficialCourseResource(first.id)?.title, "Official v2");
  assert.equal(listOfficialCourseResources().length, 1);
});

test("unpublished official courses disappear from the family catalog but remain manageable", () => {
  const unpublished = setOfficialCourseResourceStatus("official-course-test", "unpublished");
  assert.ok(unpublished);
  assert.equal(unpublished.status, "unpublished");
  assert.equal(listOfficialCourseResources().length, 0);
  assert.equal(listOfficialCourseResources({ includeUnpublished: true }).length, 1);
  setOfficialCourseResourceStatus("official-course-test", "published");
});

test("PDF source quality survives lesson storage for the publication gate", () => {
  createLesson({
    id: "quality-source-lesson",
    title: "Quality source",
    householdId: admin.householdId,
    importId: "pdf-quality-source",
    importQuality: {
      status: "warning",
      counts: { high: 0, medium: 0, low: 0 },
      coverage: { percent: 52, lowConfidencePages: [8] }
    },
    chapters: [{ id: "quality-chapter", title: "Unit 1", sentences: [{ id: "quality-sentence", text: "Hello.", minScore: 75 }] }]
  });
  const stored = listLessons({ householdId: admin.householdId }).find((lesson) => lesson.id === "quality-source-lesson");
  assert.ok(stored);
  assert.ok(stored.importQuality);
  assert.ok(stored.importQuality.coverage);
  assert.equal(stored.importQuality.status, "warning");
  assert.deepEqual(stored.importQuality.coverage.lowConfidencePages, [8]);
  assert.equal(stored.importId, "pdf-quality-source");
});

test("received course packages remain drafts until an administrator confirms publication", () => {
  const manifest = {
    metadata: { title: "Synced course", description: "Reviewed locally", sourceLabel: "PDF import" },
    content: { chapters: [{ id: "unit-sync", sentences: [{ id: "sentence-sync", text: "Hello." }] }] }
  };
  const draft = saveCourseSyncDraft({
    id: "course-package-1234567890abcdef12345678",
    packageHash: "a".repeat(64),
    sourceImportId: "pdf-20260714120000-AbCd1234",
    targetResourceId: "official-course-synced",
    title: "Synced course",
    manifest,
    assets: [{ fileName: "page-001.png", pageNumber: 1 }]
  });
  assert.ok(draft);
  assert.equal(draft.status, "pending");
  assert.equal(findCourseSyncDraft(draft.id)?.title, "Synced course");
  assert.equal(listCourseSyncDrafts({ includePublished: false }).length, 1);

  const published = markCourseSyncDraftPublished({ id: draft.id, resourceId: "official-course-synced", version: 1 });
  assert.ok(published);
  assert.equal(published.status, "published");
  assert.equal(published.publishedResourceId, "official-course-synced");
  assert.equal(listCourseSyncDrafts({ includePublished: false }).length, 0);
});
