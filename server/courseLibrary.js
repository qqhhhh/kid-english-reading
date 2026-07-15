import { nanoid } from "nanoid";

const resources = [
  {
    id: "family-helpers-starter",
    title: "Family Helpers · 入门示例",
    description: "围绕家庭成员和家务帮助的自有示例课程，包含词汇、短句和一段选读。",
    level: "入门",
    language: "英语",
    tags: ["家庭", "日常表达", "入门"],
    sourceLabel: "官方自有内容",
    chapters: [
      {
        title: "Unit 1 Helping at home",
        sections: [
          {
            title: "Words",
            type: "vocabulary",
            partKind: "vocabulary",
            sentences: [
              { text: "family", itemType: "word", phonetic: "/ˈfæməli/", translation: "家庭", required: true },
              { text: "help", itemType: "word", phonetic: "/help/", translation: "帮助", required: true },
              { text: "room", itemType: "word", phonetic: "/ruːm/", translation: "房间", required: true },
              { text: "chore", itemType: "word", phonetic: "/tʃɔːr/", translation: "家务", required: false }
            ]
          },
          {
            title: "Let's talk",
            type: "lets-talk",
            partKind: "part",
            partLabel: "A",
            focusQuestion: "How can we help our family?",
            sentences: [
              { text: "Can you help?", required: true },
              { text: "Yes, I can.", required: true },
              { text: "I can clean my room.", required: true },
              { text: "We can help our family.", required: true }
            ]
          },
          {
            title: "Reading time",
            type: "reading-time",
            partKind: "reading-time",
            sentences: [
              { text: "Mia helps at home every day.", itemType: "reading", required: false, panelNumber: 1 },
              { text: "She puts her books away and cleans her room.", itemType: "reading", required: false, panelNumber: 1 }
            ]
          }
        ]
      }
    ]
  }
];

function countResource(resource) {
  const sections = resource.chapters.flatMap((chapter) => chapter.sections || []);
  return {
    chapters: resource.chapters.length,
    sections: sections.length,
    sentences: sections.reduce((sum, section) => sum + (section.sentences || []).length, 0)
  };
}

export function listCourseLibraryResources() {
  return resources.map((resource) => ({
    id: resource.id,
    title: resource.title,
    description: resource.description,
    level: resource.level,
    language: resource.language,
    tags: resource.tags,
    sourceLabel: resource.sourceLabel,
    stats: countResource(resource)
  }));
}

export function cloneCourseLibraryResource(resourceId, minScore = 75) {
  const resource = resources.find((item) => item.id === resourceId);
  if (!resource) return null;
  return cloneCourseLibrarySnapshot(resource, minScore);
}

export function cloneCourseLibrarySnapshot(resource, minScore = 75) {
  const lessonId = `lesson-${nanoid(10)}`;
  const sourceChapters = resource.chapters || resource.content?.chapters || [];
  const chapters = sourceChapters.map((chapter, chapterIndex) => {
    const chapterId = `${lessonId}-chapter-${chapterIndex + 1}`;
    const sections = (chapter.sections || []).map((section, sectionIndex) => ({
      ...section,
      id: `${chapterId}-section-${sectionIndex + 1}`,
      sentences: (section.sentences || []).map((sentence, sentenceIndex) => ({
        ...sentence,
        id: `${chapterId}-sentence-${sectionIndex + 1}-${sentenceIndex + 1}`,
        minScore
      }))
    }));
    return {
      id: chapterId,
      title: chapter.title,
      body: sections.flatMap((section) => section.sentences).map((sentence) => sentence.text).join("\n"),
      sections,
      sentences: sections.flatMap((section) => section.sentences)
    };
  });

  return {
    lessonId,
    resourceId: resource.id,
    title: resource.title,
    sourceType: `library:${resource.id}`,
    tags: ["课程广场", ...resource.tags],
    chapters
  };
}
