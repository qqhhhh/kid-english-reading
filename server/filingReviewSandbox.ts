interface ReadModelRequest {
  path: string;
}

interface ReadModelResponse {
  json(value: unknown): unknown;
}

export interface FilingReviewSentence {
  id: string;
  text: string;
  minScore: number;
  required: true;
  itemType: "sentence";
}

const sentence = (id: string, text: string, minScore = 75): FilingReviewSentence => ({
  id,
  text,
  minScore,
  required: true,
  itemType: "sentence"
});

const greetingSentences = [
  sentence("filing-review-sentence-1", "Good morning!"),
  sentence("filing-review-sentence-2", "How are you today?"),
  sentence("filing-review-sentence-3", "I'm fine, thank you."),
  sentence("filing-review-sentence-4", "Nice to meet you.")
];
const familySentences = [
  sentence("filing-review-sentence-5", "Can you help?"),
  sentence("filing-review-sentence-6", "Yes, I can. I can clean my room."),
  sentence("filing-review-sentence-7", "I can help my family."),
  sentence("filing-review-sentence-8", "We help each other at home.")
];

export const filingReviewLessons = [
  {
    id: "filing-review-lesson",
    title: "家庭英语入门（体验课程）",
    sourceType: "review-demo",
    tags: ["体验课程", "英语跟读"],
    status: "published",
    chapters: [
      {
        id: "filing-review-chapter-1",
        title: "Unit 1 Greetings",
        body: "日常问候",
        position: 1,
        sections: [{ id: "filing-review-section-1", title: "Listen and repeat", type: "listen-and-chant", sentences: greetingSentences }],
        sentences: greetingSentences
      },
      {
        id: "filing-review-chapter-2",
        title: "Unit 2 Helping at home",
        body: "家庭互助",
        position: 2,
        sections: [{ id: "filing-review-section-2", title: "Let's talk", type: "lets-talk", partLabel: "Part A", focusQuestion: "How can we help our family?", sentences: familySentences }],
        sentences: familySentences
      }
    ],
    sentences: [...greetingSentences, ...familySentences]
  }
];

const practiceItem = {
  id: "filing-review-practice-item",
  bookId: "filing-review-practice-book",
  lessonId: "filing-review-lesson",
  lessonTitle: "家庭英语入门（体验课程）",
  status: "in_progress",
  position: 1
};

export const filingReviewChildren = [{
  id: "filing-review-child",
  name: "体验学生",
  defaultPracticeBookId: "filing-review-practice-book",
  assignedLessonId: "filing-review-lesson",
  assignedLessonTitle: "家庭英语入门（体验课程）",
  practiceBooks: [{ id: "filing-review-practice-book", title: "体验练习簿", type: "default", position: 1, items: [practiceItem] }],
  practiceItems: [practiceItem]
}];

export const filingReviewProgress = [{
  lessonId: "filing-review-lesson",
  passedCount: 2,
  totalCount: 8,
  sentences: filingReviewLessons[0].sentences.map((item, index) => ({
    sentenceId: item.id,
    attempts: index < 2 ? 1 : 0,
    passed: index < 2,
    completed: index < 2,
    bestScore: index === 0 ? 92 : index === 1 ? 86 : 0
  }))
}];

const filingReviewSentenceTexts = new Set(filingReviewLessons[0].sentences.map((item) => item.text));

export function isFilingReviewSentenceText(text: unknown): boolean {
  return filingReviewSentenceTexts.has(String(text || "").trim());
}

export function findFilingReviewSentence(sentenceId: unknown): FilingReviewSentence | null {
  return filingReviewLessons[0].sentences.find((item) => item.id === String(sentenceId || "")) || null;
}

export function sendFilingReviewReadModel(
  request: ReadModelRequest,
  response: ReadModelResponse
): boolean {
  if (request.path === "/lessons") response.json(filingReviewLessons);
  else if (request.path === "/children") response.json(filingReviewChildren);
  else if (request.path === "/progress") response.json(filingReviewProgress);
  else return false;
  return true;
}
