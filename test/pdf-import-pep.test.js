import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";

const { buildPdfImportChaptersFromStructure, buildPdfStructureFromLayout, mergePepReadingParagraphs } = await import("../server/index.js");
const { createHousehold, createLesson, listLessons } = await import("../server/db.js");
const householdId = "pep-household";
createHousehold({ id: householdId, name: "PEP household" });

function makeLine(text, top, x = 72) {
  const width = Math.max(40, text.length * 7);
  return {
    id: `line-${top}-${x}`,
    text,
    x,
    y: top + 14,
    top,
    right: x + width,
    bottom: top + 17,
    width,
    height: 14,
    itemCount: 1,
    items: []
  };
}

function makePage(page, entries) {
  const lines = entries.map((entry, index) =>
    makeLine(typeof entry === "string" ? entry : entry.text, typeof entry === "string" ? 60 + index * 34 : entry.top, entry.x)
  );
  return {
    page,
    width: 595,
    height: 842,
    items: lines.map((line) => ({ ...line })),
    lines
  };
}

function makeFragmentItem(text, x, top, index) {
  const width = text === "'" ? 2 : Math.max(8, text.length * 7);
  return {
    id: `fragment-${index}`,
    text,
    x,
    y: top + 14,
    top,
    right: x + width,
    bottom: top + 17,
    width,
    height: 14,
    fontName: "test-font",
    hasEOL: false
  };
}

test("Reading time keeps one paragraph per illustrated panel", () => {
  const paragraphs = mergePepReadingParagraphs([
    { text: "My mum is a writer.", page: 17, panelNumber: 1, layout: makeLine("My mum is a writer.", 120) },
    { text: "She writes a lot of good books.", page: 17, panelNumber: 1, layout: makeLine("She writes a lot of good books.", 145) },
    { text: "Mum is also a great cook.", page: 17, panelNumber: 2, layout: makeLine("Mum is also a great cook.", 260) }
  ]);

  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].panelNumber, 1);
  assert.equal(paragraphs[0].text, "My mum is a writer. She writes a lot of good books.");
  assert.equal(paragraphs[0].layout.top, 120);
  assert.ok(paragraphs[0].layout.bottom >= 162);
});

function makeFragmentRow(parts, startX, top, startIndex, topOffsets = []) {
  const items = [];
  let x = startX;
  for (let index = 0; index < parts.length; index += 1) {
    const item = makeFragmentItem(parts[index], x, top + (topOffsets[index] || 0), startIndex + index);
    items.push(item);
    x = item.right;
  }
  return items;
}

function makeFragmentedWeatherPage() {
  const lines = [
    makeLine("A How can the weather be different?", 60),
    makeLine("Let's talk", 90),
    makeLine("No, it isn't. It's 21 degrees.", 120, 45),
    makeLine("That's not bad. It's only", 123, 280),
    makeLine("two degrees in Beijing.", 145, 282),
    makeLine("Wow! It's cold!", 175, 107),
    makeLine("Look and say", 220)
  ];
  const items = [
    makeFragmentItem("A How can the weather be different?", 72, 60, 1),
    makeFragmentItem("Let's talk", 72, 90, 2),
    ...makeFragmentRow(["No, it isn", "'", "t. It", "'s 21 degrees."], 45, 120, 10, [0, 0.06, 0, 0.06]),
    ...makeFragmentRow(["That", "'", "s not bad. It", "'s only"], 280, 123, 20, [0, 0.05, 0, 0.05]),
    ...makeFragmentRow(["two degrees in Beijing."], 282, 145, 30),
    ...makeFragmentRow(["Wow! It", "'s cold!"], 107, 175, 40),
    makeFragmentItem("Look and say", 72, 220, 50)
  ];

  return {
    page: 57,
    width: 595,
    height: 842,
    items,
    lines
  };
}

function makeVocabularyItem(text, x, top, index, fontName = "pep-regular") {
  return {
    ...makeFragmentItem(text, x, top, index),
    fontName
  };
}

function makeRequiredVocabularyRow(parts, x, top, startIndex) {
  const items = [makeVocabularyItem("*", x, top, startIndex, "pep-regular")];
  let nextX = x + 8;
  parts.forEach((part, index) => {
    const item = makeVocabularyItem(part, nextX, top, startIndex + index + 1, "pep-required-bold");
    items.push(item);
    nextX = item.right + 8;
  });
  items.push(makeVocabularyItem("/test/", nextX, top - 0.2, startIndex + parts.length + 1, "pep-phonetic"));
  return items;
}

function makeVocabularyPage(page, lineEntries, items) {
  return {
    page,
    width: 595,
    height: 842,
    lines: lineEntries.map((entry, index) =>
      makeLine(typeof entry === "string" ? entry : entry.text, typeof entry === "string" ? 40 + index * 28 : entry.top, entry.x)
    ),
    items
  };
}

function makePepVocabularyAppendixPages() {
  return [
    makeVocabularyPage(
      85,
      [
        { text: "Appendix 2", top: 20, x: 45 },
        { text: "Words in each unit", top: 55, x: 160 },
        { text: "Unit 1", top: 120, x: 45 },
        { text: "Unit 2", top: 120, x: 305 },
        { text: "Unit 3", top: 310, x: 305 }
      ],
      [
        makeVocabularyItem("Appendix 2", 45, 20, 1, "pep-heading"),
        makeVocabularyItem("Words in each unit", 160, 55, 2, "pep-heading"),
        makeVocabularyItem("Unit 1", 45, 120, 3, "pep-heading"),
        makeVocabularyItem("*job", 45, 150, 4, "pep-regular"),
        ...makeRequiredVocabularyRow(["doctor"], 45, 180, 10),
        ...makeRequiredVocabularyRow(["office", "worker"], 45, 210, 20),
        makeVocabularyItem("Unit 2", 305, 120, 30, "pep-heading"),
        ...makeRequiredVocabularyRow(["strong"], 305, 150, 40),
        makeVocabularyItem("Unit 3", 305, 310, 50, "pep-heading"),
        ...makeRequiredVocabularyRow(["playground"], 305, 340, 60)
      ]
    ),
    makeVocabularyPage(
      86,
      [
        { text: "Appendix 2", top: 20, x: 305 },
        { text: "Unit 4", top: 310, x: 45 },
        { text: "Unit 5", top: 310, x: 305 }
      ],
      [
        makeVocabularyItem("Appendix 2", 305, 20, 100, "pep-heading"),
        ...makeRequiredVocabularyRow(["park"], 45, 80, 110),
        makeVocabularyItem("Unit 4", 45, 310, 120, "pep-heading"),
        ...makeRequiredVocabularyRow(["driver"], 45, 340, 130),
        ...makeRequiredVocabularyRow(["cleaner"], 305, 80, 140),
        makeVocabularyItem("Unit 5", 305, 310, 150, "pep-heading"),
        ...makeRequiredVocabularyRow(["sunny"], 305, 340, 160)
      ]
    ),
    makeVocabularyPage(
      87,
      [
        { text: "Appendix 2", top: 20, x: 45 },
        { text: "Unit 6", top: 55, x: 45 }
      ],
      [
        makeVocabularyItem("Appendix 2", 45, 20, 200, "pep-heading"),
        makeVocabularyItem("Unit 6", 45, 55, 201, "pep-heading"),
        ...makeRequiredVocabularyRow(["sweater"], 45, 85, 210),
        ...makeRequiredVocabularyRow(["winter"], 305, 85, 220)
      ]
    ),
    makeVocabularyPage(
      88,
      [
        { text: "Appendix 3", top: 20, x: 45 },
        { text: "Vocabulary", top: 55, x: 160 }
      ],
      [
        makeVocabularyItem("Appendix 3", 45, 20, 300, "pep-heading"),
        makeVocabularyItem("Vocabulary", 160, 55, 301, "pep-heading"),
        ...makeRequiredVocabularyRow(["appendix-only"], 45, 85, 310)
      ]
    )
  ];
}

function makePepRegressionLayout() {
  const toc = [
    [1, "Helping at home", 2],
    [2, "My friends", 14],
    [3, "Places we live in", 26],
    [4, "Helping in the community", 38],
    [5, "The weather and us", 50],
    [6, "Changing for the seasons", 62]
  ];
  const pages = [
    makePage(5, ["Contents", ...toc.flatMap(([unit, title, bookPage]) => [`Unit ${unit} ${title}`, String(bookPage)])]),
    makePage(7, ["UnitUnit11", "Helping atHelping at", "homehome"]),
    makePage(8, [
      "Let’s chantListen and chant",
      "Can you help?",
      "Yes, I can. I can clean my room.",
      "Can she help?",
      "Yes, she can. She can do some chores.",
      "Can he help?",
      "Yes, he can. He can sweep the floor.",
      "Can we help?",
      "Yes, we can. That's for sure.",
      "Let’s singListen and sing"
    ]),
    makePage(9, [
      "A How are families different?",
      "Let’s talk",
      "You have a big family. Is this your father?",
      "Yes, it is. He's a PE teacher.",
      "What's your mother's job?",
      "She's a doctor.",
      "Doctors are great! My father is a doctor too.",
      "Let’s learn"
    ]),
    makePage(12, [
      "B How can we help our family?",
      "Let’s talk",
      "Mum and Dad are busy and tired. What can we do for them?",
      "We can do some chores.",
      "Let’s learn"
    ]),
    makePage(13, ["Listen and chant", "Mum and Dad are busy.", "We are a happy family.", "Reading time"]),
    makePage(17, ["Reading timeReading time", "1 My mum writes good books.", "2 She can cook great food!"]),
    makePage(18, ["3 We can help her at home.", "4 We want to make this."]),
    makePage(19, ["UnitUnit22", "My friendsMy friends"]),
    makePage(20, ["Let’s chantListen and chant", "Some friends are short.", "Let’s singListen and sing"]),
    makePage(31, ["UnitUnit33", "Places wePlaces we", "live inlive in"]),
    makePage(32, ["Let’s chantListen and chant", "There is a playground.", "Let’s singListen and sing"]),
    makePage(43, ["UnitUnit44", "Helping inHelping in", "the communitythe community"]),
    makePage(44, ["Let’s chantListen and chant", "People in the community help us.", "Let’s singListen and sing"]),
    makePage(55, ["UnitUnit55", "The weatherThe weather", "and usand us"]),
    makePage(56, ["Let’s chantListen and chant", "How is the weather?", "Let’s singListen and sing"]),
    makeFragmentedWeatherPage(),
    makePage(67, ["UnitUnit66", "Changing forChanging for", "the seasonsthe seasons"]),
    makePage(68, ["Let’s chantListen and chant", "Spring, summer, autumn and winter.", "Let’s singListen and sing"]),
    makePage(79, ["Revision Let’s help!", "Read aloud and act it out."]),
    makePage(82, ["Listen and chant.", "This appendix chant must not be imported."]),
    ...makePepVocabularyAppendixPages()
  ];

  return {
    version: 1,
    pageCount: 94,
    pages,
    stats: {
      pages: 94,
      items: 0,
      lines: pages.reduce((sum, page) => sum + page.lines.length, 0)
    }
  };
}

test("PEP layout keeps all six TOC units and excludes revision/appendix content", () => {
  const structure = buildPdfStructureFromLayout({
    title: "PEP 四年级上册",
    layout: makePepRegressionLayout(),
    rule: "pep-textbook"
  });
  const result = buildPdfImportChaptersFromStructure({ structure, sourceMode: "layout-structure" });

  assert.equal(structure.toc.length, 6);
  assert.deepEqual(
    structure.units.map((unit) => unit.title),
    [
      "Unit 1 Helping at home",
      "Unit 2 My friends",
      "Unit 3 Places we live in",
      "Unit 4 Helping in the community",
      "Unit 5 The weather and us",
      "Unit 6 Changing for the seasons"
    ]
  );
  assert.equal(result.chapters[0].leadIn.label, "Lead-in");
  assert.deepEqual(result.chapters[0].leadIn.activities.map((activity) => activity.title), ["Listen and chant"]);
  assert.deepEqual(
    result.chapters[0].parts.map((part) => ({
      label: part.label,
      focusQuestion: part.focusQuestion,
      activities: part.activities.map((activity) => activity.title)
    })),
    [
      {
        label: "A",
        focusQuestion: "How are families different?",
        activities: ["Let's talk"]
      },
      {
        label: "B",
        focusQuestion: "How can we help our family?",
        activities: ["Let's talk", "Listen and chant"]
      }
    ]
  );
  assert.equal(result.chapters.length, 6);
  assert.equal(result.chapters[0].sections[0].title, "Words");
  assert.equal(result.chapters[0].sections[0].partKind, "vocabulary");
  assert.deepEqual(
    result.chapters[0].sections[0].sentences.map((sentence) => sentence.text),
    ["job", "doctor", "office worker"]
  );
  assert.equal(result.chapters[0].sections[0].sentences[0].required, false);
  assert.equal(result.chapters[0].sections[0].sentences[1].required, true);
  assert.deepEqual(
    result.chapters[0].sections[1].sentences.map((sentence) => sentence.text),
    [
      "Can you help?",
      "Yes, I can. I can clean my room.",
      "Can she help?",
      "Yes, she can. She can do some chores.",
      "Can he help?",
      "Yes, he can. He can sweep the floor.",
      "Can we help?",
      "Yes, we can. That's for sure."
    ]
  );
  assert.deepEqual(
    result.chapters[0].sections[2].sentences.map((sentence) => sentence.text),
    [
      "You have a big family. Is this your father?",
      "Yes, it is. He's a PE teacher.",
      "What's your mother's job?",
      "She's a doctor.",
      "Doctors are great! My father is a doctor too."
    ]
  );
  assert.equal(
    result.chapters.some((chapter) => chapter.sentences.some((sentence) => sentence.text.includes("appendix"))),
    false
  );
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.sections[0].sentences.map((sentence) => sentence.text)),
    [
      ["job", "doctor", "office worker"],
      ["strong"],
      ["playground", "park"],
      ["driver", "cleaner"],
      ["sunny"],
      ["sweater", "winter"]
    ]
  );
  assert.equal(result.chapters[0].sentences[0].text, "job");
  assert.equal(result.chapters[0].sections.at(-1).title, "Reading time");
  assert.deepEqual(
    result.chapters[0].sections.at(-1).sentences.map((sentence) => sentence.text),
    ["My mum writes good books.", "She can cook great food!", "We can help her at home.", "We want to make this."]
  );
  const weatherTalk = result.chapters[4].sections.find((section) => section.partLabel === "A" && section.type === "lets-talk");
  assert.ok(weatherTalk);
  assert.deepEqual(
    weatherTalk.sentences.map((sentence) => sentence.text),
    ["No, it isn't. It's 21 degrees.", "That's not bad. It's only two degrees in Beijing.", "Wow! It's cold!"]
  );
});

test("PEP import does not deduplicate the same sentence across different units", () => {
  const structure = buildPdfStructureFromLayout({
    title: "PEP 四年级上册",
    layout: makePepRegressionLayout(),
    rule: "pep-textbook"
  });
  const unitTwoChant = structure.units[1].sections.find((section) => section.activityKey === "listen-and-chant");
  unitTwoChant.blocks[0].text = "Can you help?";
  unitTwoChant.blocks[0].sentences = ["Can you help?"];

  const result = buildPdfImportChaptersFromStructure({ structure, sourceMode: "layout-structure" });
  assert.equal(result.chapters[0].sentences.some((sentence) => sentence.text === "Can you help?"), true);
  assert.equal(result.chapters[1].sentences.some((sentence) => sentence.text === "Can you help?"), true);
});

test("PEP Part hierarchy survives SQLite storage and hydration", () => {
  const structure = buildPdfStructureFromLayout({
    title: "PEP 四年级上册",
    layout: makePepRegressionLayout(),
    rule: "pep-textbook"
  });
  const result = buildPdfImportChaptersFromStructure({ structure, sourceMode: "layout-structure" });
  const sourceChapter = result.chapters[0];
  const lessonId = "pep-part-roundtrip";
  const withScores = new Map(sourceChapter.sentences.map((sentence) => [sentence.id, { ...sentence, minScore: 75 }]));
  const chapter = {
    ...sourceChapter,
    sentences: sourceChapter.sentences.map((sentence) => withScores.get(sentence.id)),
    sections: sourceChapter.sections.map((section) => ({
      ...section,
      sentences: section.sentences.map((sentence) => withScores.get(sentence.id))
    }))
  };

  createLesson({
    id: lessonId,
    title: "PEP Part roundtrip",
    householdId,
    sourceType: "pdf",
    tags: ["PDF导入"],
    chapters: [chapter]
  });

  const saved = listLessons({ includeArchived: true, householdId }).find((lesson) => lesson.id === lessonId);
  assert.ok(saved);
  assert.equal(saved.chapters[0].sections[0].title, "Words");
  assert.deepEqual(saved.chapters[0].sections[0].sentences.map((sentence) => sentence.text), ["job", "doctor", "office worker"]);
  assert.equal(saved.chapters[0].sections[0].sentences[0].required, false);
  assert.equal(saved.chapters[0].sections[0].sentences[1].itemType, "word");
  assert.equal(saved.chapters[0].sections[0].sentences[1].phonetic, "/test/");
  assert.equal(saved.chapters[0].sections.at(-1).type, "reading-time");
  assert.equal(saved.chapters[0].sections.at(-1).sentences[0].itemType, "reading");
  assert.equal(saved.chapters[0].sections.at(-1).sentences[0].panelNumber, 1);
  assert.equal(saved.chapters[0].leadIn.activities[0].title, "Listen and chant");
  assert.deepEqual(
    saved.chapters[0].parts.map((part) => ({
      label: part.label,
      focusQuestion: part.focusQuestion,
      activities: part.activities.map((activity) => activity.title)
    })),
    [
      {
        label: "A",
        focusQuestion: "How are families different?",
        activities: ["Let's talk"]
      },
      {
        label: "B",
        focusQuestion: "How can we help our family?",
        activities: ["Let's talk", "Listen and chant"]
      }
    ]
  );
});
