import { nanoid } from "nanoid";
import { buildPdfImportHierarchy, normalizeSentenceKey } from "./pdfImportParser.js";

const allowedLessonSourceTypes = new Set(["manual", "preset", "pdf", "ebook", "import", "textbook"]);

interface IncomingLessonItem {
  id?: string;
  text?: string;
  itemType?: string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
}

interface IncomingLessonSection {
  id?: string;
  title?: string;
  type?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
  sentences?: IncomingLessonItem[];
}

interface IncomingLessonPart {
  label?: string;
  focusQuestion?: string;
  activities?: IncomingLessonSection[];
}

export interface IncomingLessonChapter {
  id?: string;
  title?: string;
  text?: string;
  leadIn?: IncomingLessonPart;
  parts?: IncomingLessonPart[];
  sections?: IncomingLessonSection[];
  sentences?: IncomingLessonItem[];
}

interface NormalizedLessonItem {
  id?: string;
  text: string;
  itemType?: string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
}

interface NormalizedLessonSection {
  id?: string;
  title: string;
  type: string;
  partKind: string;
  partLabel: string;
  focusQuestion: string;
  sentenceTexts: NormalizedLessonItem[];
}

interface NormalizedLessonChapter {
  id?: string;
  title: string;
  body: string;
  sections: NormalizedLessonSection[];
  sentenceTexts: NormalizedLessonItem[];
}
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function splitReadingText(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/[.!?]$/.test(item) ? item : `${item}.`));
}

export function normalizeLessonSourceType(sourceType: unknown): string {
  const normalized = String(sourceType || "manual").trim();
  return allowedLessonSourceTypes.has(normalized) ? normalized : "manual";
}


export function buildLessonChapters({ lessonId, title, text, chapters, minScore }: {
  lessonId: string;
  title: string;
  text: string;
  chapters: IncomingLessonChapter[];
  minScore: number;
}) {
  const normalizeLessonItem = (sentence: IncomingLessonItem): NormalizedLessonItem => ({
    id: sentence.id,
    text: String(sentence.text || "").trim(),
    itemType: ["word", "reading"].includes(String(sentence.itemType || "")) ? String(sentence.itemType) : "sentence",
    phonetic: String(sentence.phonetic || "").trim(),
    translation: String(sentence.translation || "").trim(),
    required: sentence.required !== false,
    panelNumber: Number(sentence.panelNumber || 0)
  });
  const normalizedChapters: NormalizedLessonChapter[] =
    chapters.length > 0
      ? chapters
          .map((chapter, index) => {
            const chapterTitle = String(chapter.title || `Chapter ${index + 1}`).trim();
            const chapterText = String(chapter.text || "").trim();
            const leadIn = chapter.leadIn;
            const nestedSections = [
              ...(Array.isArray(leadIn?.activities)
                ? leadIn.activities.map((activity) => ({
                    ...activity,
                    partKind: "lead-in",
                    partLabel: leadIn.label || "Lead-in",
                    focusQuestion: ""
                  }))
                : []),
              ...(Array.isArray(chapter.parts)
                ? chapter.parts.flatMap((part) =>
                    Array.isArray(part.activities)
                      ? part.activities.map((activity) => ({
                          ...activity,
                          partKind: "part",
                          partLabel: part.label,
                          focusQuestion: part.focusQuestion || ""
                        }))
                      : []
                  )
                : [])
            ];
            const sectionSource = nestedSections.length > 0 ? nestedSections : Array.isArray(chapter.sections) ? chapter.sections : [];
            const explicitSections = sectionSource.length > 0
              ? sectionSource
                  .map((section, sectionIndex) => {
                    const sectionTitle = String(section.title || `Section ${sectionIndex + 1}`).trim();
                    const sectionSentences = Array.isArray(section.sentences)
                      ? section.sentences
                          .map(normalizeLessonItem)
                          .filter((sentence) => sentence.text)
                      : [];
                    return {
                      id: section.id,
                      title: sectionTitle || `Section ${sectionIndex + 1}`,
                      type: String(section.type || "custom").trim(),
                      partKind: String(section.partKind || "").trim(),
                      partLabel: String(section.partLabel || "").trim(),
                      focusQuestion: String(section.focusQuestion || "").trim(),
                      sentenceTexts: sectionSentences
                    };
                  })
                  .filter((section) => section.sentenceTexts.length > 0)
              : [];
            const explicitSentences = Array.isArray(chapter.sentences)
              ? chapter.sentences
                  .map(normalizeLessonItem)
                  .filter((sentence) => sentence.text)
              : [];
            const sentenceTexts =
              explicitSections.length > 0
                ? explicitSections.flatMap((section) => section.sentenceTexts)
                : explicitSentences.length > 0
                ? explicitSentences
                : splitReadingText(chapterText).map((sentenceText): NormalizedLessonItem => ({ text: sentenceText }));
            return {
              id: chapter.id,
              title: chapterTitle || `Chapter ${index + 1}`,
              body: chapterText || sentenceTexts.map((sentence) => sentence.text).join(" "),
              sections: explicitSections,
              sentenceTexts
            };
          })
          .filter((chapter) => chapter.sentenceTexts.length > 0)
      : [
          {
            title,
            body: text,
            sections: [],
            sentenceTexts: splitReadingText(text).map((sentenceText): NormalizedLessonItem => ({ text: sentenceText }))
          }
        ];

  return {
    body: normalizedChapters.map((chapter) => chapter.body).join("\n\n"),
    totalSentences: normalizedChapters.reduce((sum, chapter) => sum + chapter.sentenceTexts.length, 0),
    chapters: normalizedChapters.map((chapter, index) => {
      const sentences = chapter.sentenceTexts.map((sentence) => ({
        id: sentence.id || `sentence-${nanoid(10)}`,
        text: sentence.text,
        minScore,
        itemType: sentence.itemType || "sentence",
        phonetic: sentence.phonetic || "",
        translation: sentence.translation || "",
        required: sentence.required !== false,
        panelNumber: Number(sentence.panelNumber || 0)
      }));
      const sentenceByTextQueue = new Map<string, Array<(typeof sentences)[number]>>();
      for (const sentence of sentences) {
        const key = normalizeSentenceKey(sentence.text);
        if (!sentenceByTextQueue.has(key)) sentenceByTextQueue.set(key, []);
        sentenceByTextQueue.get(key)!.push(sentence);
      }

      const sections = (chapter.sections || []).map((section, sectionIndex) => ({
        id: section.id || `${lessonId}-chapter-${index + 1}-section-${sectionIndex + 1}`,
        title: section.title,
        type: section.type,
        partKind: section.partKind,
        partLabel: section.partLabel,
        focusQuestion: section.focusQuestion,
        sentences: section.sentenceTexts
          .map((sentence) => {
            const key = normalizeSentenceKey(sentence.text);
            return sentenceByTextQueue.get(key)?.shift();
          })
          .filter((sentence): sentence is (typeof sentences)[number] => Boolean(sentence))
      }));
      const hierarchy = buildPdfImportHierarchy(sections, index);

      return {
        id: chapter.id || `${lessonId}-chapter-${index + 1}`,
        title: chapter.title,
        body: chapter.body,
        ...hierarchy,
        sections,
        sentences
      };
    })
  };
}
