import fs from "node:fs";
import path from "node:path";

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

const baseUrl = readOption("--base-url").replace(/\/$/, "");
const artifactPath = readOption("--artifact");
const lessonId = readOption("--lesson-id");
const shouldApply = process.argv.includes("--apply");

if (!baseUrl || !artifactPath || !lessonId) {
  throw new Error(
    "Usage: node scripts/repairImportedLesson.mjs --base-url <url> --artifact <layout.json> --lesson-id <id> [--apply]"
  );
}

process.env.KID_READING_DB_PATH = ":memory:";

const artifact = JSON.parse(fs.readFileSync(path.resolve(artifactPath), "utf8"));
const { buildPdfImportChaptersFromStructure, buildPdfStructureFromLayout } = await import("../server/index.js");

const lessonsResponse = await fetch(`${baseUrl}/api/lessons`);
if (!lessonsResponse.ok) {
  throw new Error(`Unable to load lessons from ${baseUrl}: HTTP ${lessonsResponse.status}`);
}

const lessons = await lessonsResponse.json();
const currentLesson = lessons.find((lesson) => lesson.id === lessonId);
if (!currentLesson) {
  throw new Error(`Lesson ${lessonId} was not found at ${baseUrl}`);
}

const structure = buildPdfStructureFromLayout({
  title: artifact.title,
  layout: artifact.layout,
  rule: artifact.rule
});
const parsed = buildPdfImportChaptersFromStructure({
  structure,
  sourceMode: "layout-structure"
});

const replacementIds = new Map();
for (const chapter of parsed.chapters) {
  const currentChapter = currentLesson.chapters.find((item) => item.title === chapter.title);
  const currentByText = new Map();
  for (const sentence of currentChapter?.sentences || []) {
    if (!currentByText.has(sentence.text)) currentByText.set(sentence.text, []);
    currentByText.get(sentence.text).push(sentence);
  }

  for (const sentence of chapter.sentences) {
    const existing = currentByText.get(sentence.text)?.shift();
    if (existing) replacementIds.set(sentence.id, existing.id);
  }
}

function replaceSentenceIds(value) {
  if (Array.isArray(value)) return value.map(replaceSentenceIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "id" && replacementIds.has(item) ? replacementIds.get(item) : replaceSentenceIds(item)
    ])
  );
}

const chapters = replaceSentenceIds(parsed.chapters);
const sentenceTexts = chapters.flatMap((chapter) => chapter.sentences.map((sentence) => sentence.text));
const payload = {
  title: currentLesson.title,
  text: "",
  chapters,
  minScore: 75,
  tags: currentLesson.tags
};

const summary = {
  baseUrl,
  lessonId,
  mode: shouldApply ? "apply" : "dry-run",
  previousSentences: currentLesson.sentences.length,
  nextSentences: sentenceTexts.length,
  preservedSentenceIds: replacementIds.size,
  payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  hasFixedTeacherSentence: sentenceTexts.includes("Yes, it is. He's a PE teacher."),
  hasFixedWeatherSentence: sentenceTexts.includes("No, it isn't. It's 21 degrees."),
  hasDanglingFragments: sentenceTexts.some((text) =>
    /(?:^['’](?:s|t)\b|\b(?:isn|aren|wasn|weren|don|doesn|didn|hasn|haven|hadn|couldn|wouldn|shouldn|mustn|won)$|\b(?:He|She|It) a\b|\bThat s\b|[!！]{2,})/i.test(text)
  )
};

if (shouldApply) {
  const updateResponse = await fetch(`${baseUrl}/api/admin/lessons/${encodeURIComponent(lessonId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const updatedLesson = await updateResponse.json();
  if (!updateResponse.ok) {
    throw new Error(`Lesson update failed at ${baseUrl}: HTTP ${updateResponse.status} ${JSON.stringify(updatedLesson)}`);
  }
  summary.status = updateResponse.status;
  summary.savedSentences = updatedLesson.sentences.length;
}

console.log(JSON.stringify(summary, null, 2));
