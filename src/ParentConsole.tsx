import {
  Archive,
  BarChart3,
  BookOpen,
  ClipboardList,
  GripVertical,
  Home,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Store,
  Trash2,
  Upload,
  UserPlus,
  Users
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnalyticsOverview, type AnalyticsLessonStat, type AnalyticsRecentScore } from "./components/analytics/AnalyticsOverview";
import { CourseContentEditor } from "./components/course/CourseContentEditor";
import { PdfImportLayersPanel } from "./components/pdf/PdfImportLayersPanel";
import { PdfImportReviewSummary } from "./components/pdf/PdfImportReviewSummary";
import { Badge, Button, EmptyState, IconButton, ProgressBar, ThemeSwitcher } from "./components/ui";
import {
  addLessonToPracticeBook,
  createChildProfile,
  createLessonFromText,
  createPracticeBook,
  deletePracticeBook,
  fetchChildren,
  fetchAdminLessons,
  fetchAutomaticPracticeSessions,
  fetchCourseLibrary,
  fetchLessonPdfImportPreview,
  fetchProgress,
  importCourseLibraryResource,
  previewLessonPdfImport,
  removePracticeBookItem,
  reorderPracticeBookItem,
  updatePracticeBook,
  updateLessonFromText,
  updateLessonStatus
} from "./lib/api";
import { getDeviceChildId, getUrlPracticeContext, storeDevicePracticeContext } from "./lib/deviceSession";
import { formatMessage, getInitialLocale, localeLabels, messages, storeLocale, type Locale } from "./lib/i18n";
import { describePdfImportProgress } from "./lib/pdfImportProgress";
import type {
  AutomaticPracticeSession,
  ChildProfile,
  CourseLibraryResource,
  Lesson,
  LessonProgress,
  PdfImportQualityReport,
  PdfImportSnapshot,
  PdfImportStructure,
  Sentence
} from "./lib/types";

type DraftChapter = {
  id: string;
  title: string;
  sections?: DraftSection[];
  sentences: DraftSentence[];
};

type DraftSection = {
  id: string;
  title: string;
  type?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
  sentences: DraftSentence[];
};

type DraftSentence = {
  id: string;
  text: string;
  itemType?: Sentence["itemType"];
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
};

type DetailMode = "none" | "create" | "existing";
type LayoutPreview = "phone" | "tablet" | "desktop";
type ParentSection = "overview" | "courses" | "course-library" | "practice" | "children" | "analytics" | "settings";
type PracticeTaskDisplayStatus = "pending" | "in_progress" | "completed";
type CourseSortMode = "updated" | "title" | "sentences";

const PARENT_SECTIONS: ParentSection[] = ["overview", "courses", "course-library", "practice", "children", "analytics", "settings"];

const COURSE_LIBRARY_PAGE_SIZE = 10;
const COURSE_MANAGEMENT_PAGE_SIZE = 12;
const PDF_QUALITY_ISSUE_LIMIT = 12;
const PDF_IMPORT_RULES = [
  { value: "pep-textbook", labelKey: "pdfImportRulePep" },
  { value: "default", labelKey: "pdfImportRuleDefault" }
] as const;

function getInitialParentSection(): ParentSection {
  const section = new URLSearchParams(window.location.search).get("section") as ParentSection | null;
  return section && PARENT_SECTIONS.includes(section) ? section : "practice";
}

function getPracticeTaskDisplayStatus(itemStatus: string, progressItem: LessonProgress | undefined, progressPercent: number): PracticeTaskDisplayStatus {
  if (itemStatus === "completed" || progressPercent >= 100) return "completed";
  if (itemStatus === "in_progress" || (progressItem?.passedCount ?? 0) > 0) return "in_progress";
  return "pending";
}

function getLessonSortTime(lesson: Lesson) {
  const timestamp = Date.parse(lesson.updatedAt || lesson.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareLessonTitle(a: Lesson, b: Lesson, locale: Locale) {
  return a.title.localeCompare(b.title, locale === "zh" ? "zh-Hans-CN" : "en", {
    numeric: true,
    sensitivity: "base"
  });
}

function createDraftChapter(index: number): DraftChapter {
  return {
    id: crypto.randomUUID(),
    title: `Chapter ${index}`,
    sentences:
      index === 1
        ? [
            { id: crypto.randomUUID(), text: "I like reading books." },
            { id: crypto.randomUUID(), text: "The little dog runs in the park." }
          ]
        : [{ id: crypto.randomUUID(), text: "" }]
  };
}

function createInitialChapters() {
  return [createDraftChapter(1)];
}

function flattenDraftSections(sections: DraftSection[] | undefined) {
  return sections?.flatMap((section) => section.sentences) || [];
}

function toDraftSentence(sentence: Partial<Sentence> & { text: string }, fallbackId = crypto.randomUUID()): DraftSentence {
  return {
    id: sentence.id || fallbackId,
    text: sentence.text,
    itemType: sentence.itemType,
    phonetic: sentence.phonetic,
    translation: sentence.translation,
    required: sentence.required,
    panelNumber: sentence.panelNumber
  };
}

function getDraftChapterSentences(chapter: DraftChapter) {
  const sectionSentences = flattenDraftSections(chapter.sections);
  return sectionSentences.length > 0 ? sectionSentences : chapter.sentences;
}

function getDraftChapterSections(chapter: DraftChapter) {
  return chapter.sections?.length ? chapter.sections : [];
}

function parseTagsInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

function getLessonDraft(lesson: Lesson) {
  return {
    title: lesson.title,
    minScore: lesson.sentences[0]?.minScore || 75,
    tagsText: (lesson.tags || []).join("，"),
    chapters: lesson.chapters?.length
      ? lesson.chapters.map((chapter, index) => ({
          id: chapter.id,
          title: chapter.title || `Chapter ${index + 1}`,
          sections: chapter.sections?.map((section) => ({
            id: section.id,
            title: section.title,
            type: section.type,
            partKind: section.partKind,
            partLabel: section.partLabel,
            focusQuestion: section.focusQuestion,
            sentences: section.sentences.map((sentence) => toDraftSentence(sentence))
          })),
          sentences:
            chapter.sentences.length > 0
              ? chapter.sentences.map((sentence) => toDraftSentence(sentence))
              : [{ id: crypto.randomUUID(), text: chapter.body }]
        }))
      : [
          {
            id: crypto.randomUUID(),
            title: lesson.title,
            sentences: lesson.sentences.map((sentence) => toDraftSentence(sentence))
          }
        ]
  };
}

export function ParentConsole() {
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
  const [layoutPreview, setLayoutPreview] = useState<LayoutPreview>("desktop");
  const [activeSection, setActiveSection] = useState<ParentSection>(getInitialParentSection);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [activeChildId, setActiveChildId] = useState("");
  const [newChildName, setNewChildName] = useState("");
  const [activePracticeBookId, setActivePracticeBookId] = useState("");
  const [practiceBookTitleDraft, setPracticeBookTitleDraft] = useState("");
  const [courseLibraryQuery, setCourseLibraryQuery] = useState("");
  const [courseLibraryTagFilters, setCourseLibraryTagFilters] = useState<string[]>([]);
  const [courseLibrarySort, setCourseLibrarySort] = useState<CourseSortMode>("updated");
  const [courseLibraryVisibleCount, setCourseLibraryVisibleCount] = useState(COURSE_LIBRARY_PAGE_SIZE);
  const [showOnlyAvailableCourses, setShowOnlyAvailableCourses] = useState(false);
  const [lessonSearchQuery, setLessonSearchQuery] = useState("");
  const [lessonTagFilters, setLessonTagFilters] = useState<string[]>([]);
  const [lessonLibrarySort, setLessonLibrarySort] = useState<CourseSortMode>("updated");
  const [lessonLibraryVisibleCount, setLessonLibraryVisibleCount] = useState(COURSE_MANAGEMENT_PAGE_SIZE);
  const [showArchivedLessons, setShowArchivedLessons] = useState(false);
  const [selectedPracticeLessonIds, setSelectedPracticeLessonIds] = useState<string[]>([]);
  const [isAssigningLessons, setIsAssigningLessons] = useState(false);
  const [draggedLessonId, setDraggedLessonId] = useState("");
  const [draggedPracticeItemId, setDraggedPracticeItemId] = useState("");
  const [practiceItemDropTargetId, setPracticeItemDropTargetId] = useState("");
  const [isReorderingPracticeItems, setIsReorderingPracticeItems] = useState(false);
  const practicePointerDragRef = useRef<{ pointerId: number; sourceItemId: string; targetItemId: string } | null>(null);
  const [dragOverPracticeBookId, setDragOverPracticeBookId] = useState("");
  const [isPracticeDropActive, setIsPracticeDropActive] = useState(false);
  const [childProgress, setChildProgress] = useState<LessonProgress[]>([]);
  const [automaticPracticeSessions, setAutomaticPracticeSessions] = useState<AutomaticPracticeSession[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [catalogResources, setCatalogResources] = useState<CourseLibraryResource[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogBusyId, setCatalogBusyId] = useState("");
  const [detailMode, setDetailMode] = useState<DetailMode>("none");
  const [activeLessonId, setActiveLessonId] = useState("");
  const [isDraftEditing, setIsDraftEditing] = useState(false);
  const [draftSourceType, setDraftSourceType] = useState("manual");
  const [title, setTitle] = useState("");
  const [chapters, setChapters] = useState<DraftChapter[]>(createInitialChapters);
  const [minScore, setMinScore] = useState(75);
  const [tagsText, setTagsText] = useState("");
  const [courseTagDraft, setCourseTagDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isImportingPdf, setIsImportingPdf] = useState(false);
  const [pdfImportElapsed, setPdfImportElapsed] = useState(0);
  const [pdfImportSummary, setPdfImportSummary] = useState("");
  const [pdfImportStructure, setPdfImportStructure] = useState<PdfImportStructure | null>(null);
  const [pdfImportQuality, setPdfImportQuality] = useState<PdfImportQualityReport | null>(null);
  const [pdfImportWarnings, setPdfImportWarnings] = useState<string[]>([]);
  const [pdfImportSnapshot, setPdfImportSnapshot] = useState<PdfImportSnapshot | null>(null);
  const [pdfImportId, setPdfImportId] = useState("");
  const [pdfImportRule, setPdfImportRule] = useState("pep-textbook");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const pdfImportInputRef = useRef<HTMLInputElement>(null);
  const pdfImportRestoreRequestRef = useRef(0);
  const t = messages[locale].parent;
  useEffect(() => {
    if (!isImportingPdf) {
      setPdfImportElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setPdfImportElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isImportingPdf]);
  const supportsCourseDrag =
    typeof window === "undefined" || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const activeChild = children.find((child) => child.id === activeChildId);
  const activePracticeBook =
    activeChild?.practiceBooks.find((book) => book.id === activePracticeBookId) ||
    activeChild?.practiceBooks.find((book) => book.type === "default") ||
    activeChild?.practiceBooks[0];
  const practicePreviewTargetBook = activePracticeBook;
  const activeLesson = lessons.find((lesson) => lesson.id === activeLessonId);
  const normalizedCatalogQuery = catalogQuery.trim().toLowerCase();
  const visibleCatalogResources = catalogResources.filter((resource) =>
    !normalizedCatalogQuery ||
    [resource.title, resource.description, resource.level, resource.language, ...resource.tags]
      .join(" ")
      .toLowerCase()
      .includes(normalizedCatalogQuery)
  );
  const activePracticeItems = activePracticeBook?.items ?? activeChild?.practiceItems ?? [];
  const activePracticeLessonIds = new Set(activePracticeItems.map((item) => item.lessonId));
  const practiceBookRows = activePracticeItems
    .map((item) => {
      const lesson = lessons.find((lessonItem) => lessonItem.id === item.lessonId);
      const progress = childProgress.find((progressItem) => progressItem.lessonId === item.lessonId);
      const progressPercent = progress?.totalCount ? Math.round((progress.passedCount / progress.totalCount) * 100) : 0;
      const displayStatus = getPracticeTaskDisplayStatus(item.status, progress, progressPercent);
      const latestProgress = progress?.sentences
        .filter((sentence) => sentence.latestAttemptAt)
        .sort((a, b) => String(b.latestAttemptAt).localeCompare(String(a.latestAttemptAt)))[0];
      const pendingSentences =
        lesson?.sentences
          .filter((sentence) => {
            const sentenceProgress = progress?.sentences.find((progressSentence) => progressSentence.sentenceId === sentence.id);
            return !sentenceProgress?.passed;
          })
          .slice(0, 2) ?? [];

      return {
        item,
        lesson,
        progress,
        progressPercent,
        displayStatus,
        latestProgress,
        pendingSentences
      };
    })
    .filter((row) => row.lesson);
  const practiceBookStats = practiceBookRows.reduce(
    (stats, row) => ({
      pending: stats.pending + (row.displayStatus === "pending" ? 1 : 0),
      inProgress: stats.inProgress + (row.displayStatus === "in_progress" ? 1 : 0),
      completed: stats.completed + (row.displayStatus === "completed" ? 1 : 0)
    }),
    { pending: 0, inProgress: 0, completed: 0 }
  );
  const practiceBookPassedSentences = practiceBookRows.reduce((sum, row) => sum + (row.progress?.passedCount || 0), 0);
  const practiceBookTotalSentences = practiceBookRows.reduce(
    (sum, row) => sum + (row.progress?.totalCount || row.lesson?.sentences.length || 0),
    0
  );
  const practiceBookProgressPercent = practiceBookTotalSentences
    ? Math.round((practiceBookPassedSentences / practiceBookTotalSentences) * 100)
    : 0;
  const totalPracticeBooks = children.reduce((sum, child) => sum + child.practiceBooks.length, 0);
  const totalPracticeTasks = children.reduce(
    (sum, child) => sum + child.practiceBooks.reduce((bookSum, book) => bookSum + book.items.length, 0),
    0
  );
  const assignedLessonIds = new Set(activeChild?.practiceBooks.flatMap((book) => book.items.map((item) => item.lessonId)) || []);
  const assignedChildProgress = childProgress.filter((progress) => assignedLessonIds.has(progress.lessonId));
  const childPassedSentences = assignedChildProgress.reduce((sum, progress) => sum + progress.passedCount, 0);
  const childTotalSentences = assignedChildProgress.reduce((sum, progress) => sum + progress.totalCount, 0);
  const childProgressPercent = childTotalSentences ? Math.round((childPassedSentences / childTotalSentences) * 100) : 0;
  const completedLessons = assignedChildProgress.filter(
    (progress) => progress.totalCount > 0 && progress.passedCount >= progress.totalCount
  ).length;
  const analyticsAttemptedSentences = assignedChildProgress.flatMap((progress) =>
    progress.sentences.filter((sentence) => sentence.attempts > 0)
  );
  const analyticsTotalAttempts = analyticsAttemptedSentences.reduce((sum, sentence) => sum + sentence.attempts, 0);
  const analyticsAverageBestScore = analyticsAttemptedSentences.length
    ? Math.round(
        analyticsAttemptedSentences.reduce((sum, sentence) => sum + sentence.bestScore, 0) /
          analyticsAttemptedSentences.length
      )
    : null;
  const analyticsLessonStats: AnalyticsLessonStat[] = assignedChildProgress
    .map((progress) => {
      const lesson = lessons.find((item) => item.id === progress.lessonId);
      const attemptedSentences = progress.sentences.filter((sentence) => sentence.attempts > 0);
      return {
        id: progress.lessonId,
        title: lesson?.title || progress.lessonId,
        passed: progress.passedCount,
        total: progress.totalCount,
        percent: progress.totalCount ? Math.round((progress.passedCount / progress.totalCount) * 100) : 0,
        attempts: attemptedSentences.reduce((sum, sentence) => sum + sentence.attempts, 0),
        averageBestScore: attemptedSentences.length
          ? Math.round(attemptedSentences.reduce((sum, sentence) => sum + sentence.bestScore, 0) / attemptedSentences.length)
          : null
      };
    })
    .sort((a, b) => b.percent - a.percent || b.attempts - a.attempts || a.title.localeCompare(b.title));
  const analyticsStatusCounts = analyticsLessonStats.reduce(
    (counts, lesson) => {
      if (lesson.total > 0 && lesson.passed >= lesson.total) counts.completed += 1;
      else if (lesson.attempts > 0 || lesson.passed > 0) counts.inProgress += 1;
      else counts.notStarted += 1;
      return counts;
    },
    { completed: 0, inProgress: 0, notStarted: 0 }
  );
  const analyticsDateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric"
  });
  const analyticsRecentScores: AnalyticsRecentScore[] = assignedChildProgress
    .flatMap((progress) => {
      const lesson = lessons.find((item) => item.id === progress.lessonId);
      return progress.sentences
        .filter((sentence) => sentence.latestAttemptAt && typeof sentence.latestScore === "number")
        .map((sentence) => ({
          id: sentence.latestAttemptId || `${progress.lessonId}-${sentence.sentenceId}`,
          lessonTitle: lesson?.title || progress.lessonId,
          sentenceText: lesson?.sentences.find((item) => item.id === sentence.sentenceId)?.text || "",
          score: Math.round(sentence.latestScore || 0),
          timestamp: Date.parse(sentence.latestAttemptAt || ""),
          dateLabel: analyticsDateFormatter.format(new Date(sentence.latestAttemptAt || ""))
        }));
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 6)
    .map(({ timestamp: _timestamp, ...item }) => item);
  const lessonSourceLabels = t.lessonSourceLabels;
  const getLessonSourceLabel = (sourceType?: string) => {
    const labels = lessonSourceLabels as Record<string, string>;
    return labels[sourceType || "manual"] || sourceType || labels.manual;
  };
  const availableLessonTags = Array.from(new Set(lessons.flatMap((lesson) => lesson.tags || []))).sort((a, b) =>
    a.localeCompare(b, locale === "zh" ? "zh-Hans-CN" : "en")
  );
  const normalizedLessonSearchQuery = lessonSearchQuery.trim().toLowerCase();
  const normalizedCourseLibraryQuery = courseLibraryQuery.trim().toLowerCase();
  const lessonTagFilterKey = lessonTagFilters.join("\u001f");
  const courseLibraryTagFilterKey = courseLibraryTagFilters.join("\u001f");
  const sortLessonsForView = (items: Lesson[], sortMode: CourseSortMode) =>
    [...items].sort((a, b) => {
      if (sortMode === "title") return compareLessonTitle(a, b, locale);
      if (sortMode === "sentences") {
        const sentenceDiff = b.sentences.length - a.sentences.length;
        return sentenceDiff || compareLessonTitle(a, b, locale);
      }
      const timeDiff = getLessonSortTime(b) - getLessonSortTime(a);
      return timeDiff || compareLessonTitle(a, b, locale);
    });
  const courseManagementFilteredLessons = lessons.filter((lesson) => {
    if (!showArchivedLessons && lesson.status === "archived") return false;
    if (lessonTagFilters.length > 0 && !lessonTagFilters.some((tag) => lesson.tags?.includes(tag))) return false;
    if (!normalizedLessonSearchQuery) return true;

    const searchableText = [
      lesson.title,
      lesson.sourceType || "",
      ...(lesson.tags || []),
      ...(lesson.chapters?.map((chapter) => chapter.title) ?? []),
      ...lesson.sentences.map((sentence) => sentence.text)
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedLessonSearchQuery);
  });
  const courseManagementLessons = sortLessonsForView(courseManagementFilteredLessons, lessonLibrarySort);
  const visibleCourseManagementLessons = courseManagementLessons.slice(0, lessonLibraryVisibleCount);
  const hasMoreCourseManagementLessons = visibleCourseManagementLessons.length < courseManagementLessons.length;
  const courseLibraryFilteredLessons = lessons.filter((lesson) => {
    const isInTargetBook = Boolean(practicePreviewTargetBook?.items.some((item) => item.lessonId === lesson.id));
    if (lesson.status === "archived") return false;
    if (showOnlyAvailableCourses && isInTargetBook) return false;
    if (courseLibraryTagFilters.length > 0 && !courseLibraryTagFilters.some((tag) => lesson.tags?.includes(tag))) return false;
    if (!normalizedCourseLibraryQuery) return true;

    const searchableText = [
      lesson.title,
      lesson.sourceType || "",
      ...(lesson.tags || []),
      ...(lesson.chapters?.map((chapter) => chapter.title) ?? []),
      ...lesson.sentences.map((sentence) => sentence.text)
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedCourseLibraryQuery);
  });
  const courseLibraryLessons = sortLessonsForView(courseLibraryFilteredLessons, courseLibrarySort);
  const visibleCourseLibraryLessons = courseLibraryLessons.slice(0, courseLibraryVisibleCount);
  const hasMoreCourseLibraryLessons = visibleCourseLibraryLessons.length < courseLibraryLessons.length;
  const courseLibraryTotal = lessons.filter((lesson) => lesson.status !== "archived").length;
  const selectedAssignableLessonIds = selectedPracticeLessonIds.filter(
    (lessonId) => !practicePreviewTargetBook?.items.some((item) => item.lessonId === lessonId)
  );

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (activeSection === "courses" && detailMode === "none") {
      startCreateLesson();
    }
  }, [activeSection, detailMode]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("section", activeSection);
    window.history.replaceState(null, "", url);
  }, [activeSection]);

  useEffect(() => {
    loadLessons();
  }, [showArchivedLessons]);

  useEffect(() => {
    if (activeSection !== "course-library") return;
    void loadCourseLibrary();
  }, [activeSection]);

  useEffect(() => {
    setCourseLibraryVisibleCount(COURSE_LIBRARY_PAGE_SIZE);
  }, [
    normalizedCourseLibraryQuery,
    courseLibraryTagFilterKey,
    showOnlyAvailableCourses,
    courseLibrarySort,
    activePracticeBook?.id,
    lessons.length
  ]);

  useEffect(() => {
    setLessonLibraryVisibleCount(COURSE_MANAGEMENT_PAGE_SIZE);
  }, [
    normalizedLessonSearchQuery,
    lessonTagFilterKey,
    lessonLibrarySort,
    showArchivedLessons,
    lessons.length
  ]);

  useEffect(() => {
    setPracticeBookTitleDraft(activePracticeBook?.title || "");
  }, [activePracticeBook?.id, activePracticeBook?.title]);

  useEffect(() => {
    const availableLessonIds = new Set(lessons.filter((lesson) => lesson.status !== "archived").map((lesson) => lesson.id));
    setSelectedPracticeLessonIds((lessonIds) => lessonIds.filter((lessonId) => availableLessonIds.has(lessonId)));
  }, [lessons]);

  const draftTags = parseTagsInput(tagsText);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    storeLocale(nextLocale);
  }

  function getPracticeStatusLabel(status: PracticeTaskDisplayStatus) {
    if (status === "completed") return t.practiceDone;
    if (status === "in_progress") return t.practiceInProgress;
    return t.practiceTodo;
  }

  function toggleLessonTagFilter(tag: string) {
    setLessonTagFilters((tags) => (tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]));
  }

  function toggleCourseLibraryTagFilter(tag: string) {
    setCourseLibraryTagFilters((tags) => (tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]));
  }

  function setDraftTags(tags: string[]) {
    setTagsText(parseTagsInput(tags.join("，")).join("，"));
  }

  function addCourseTag() {
    const nextTags = parseTagsInput(`${tagsText}，${courseTagDraft}`);
    if (nextTags.length === draftTags.length && courseTagDraft.trim()) {
      setCourseTagDraft("");
      return;
    }

    setTagsText(nextTags.join("，"));
    setCourseTagDraft("");
  }

  function removeCourseTag(tag: string) {
    setDraftTags(draftTags.filter((item) => item !== tag));
  }

  function handleCourseTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCourseTag();
  }

  function renderTagFilterControl({
    selectedTags,
    onToggle,
    onClear
  }: {
    selectedTags: string[];
    onToggle: (tag: string) => void;
    onClear: () => void;
  }) {
    return (
      <details className="tag-filter-control">
        <summary aria-label={t.tagFilter}>
          <span className={`tag-filter-summary ${selectedTags.length > 0 ? "has-tags" : ""}`}>
            {selectedTags.length === 0 ? (
              t.allTags
            ) : (
              selectedTags.map((tag) => (
                <em key={tag}>{tag}</em>
              ))
            )}
          </span>
        </summary>
        <div className="tag-filter-panel">
          <div className="tag-filter-panel-header">
            <strong>{t.tagFilter}</strong>
            <button type="button" onClick={onClear} disabled={selectedTags.length === 0}>
              {t.clearTagFilter}
            </button>
          </div>
          {availableLessonTags.length === 0 ? (
            <p>{t.noCourseTags}</p>
          ) : (
            <div className="tag-filter-options">
              {availableLessonTags.map((tag) => (
                <label className="tag-filter-option" key={tag}>
                  <input type="checkbox" checked={selectedTags.includes(tag)} onChange={() => onToggle(tag)} />
                  <span>{tag}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
    );
  }

  async function loadInitialData() {
    try {
      const [nextLessons, nextChildren] = await Promise.all([fetchAdminLessons(showArchivedLessons), fetchChildren()]);
      setLessons(nextLessons);
      setChildren(nextChildren);

      const urlContext = getUrlPracticeContext();
      const preferredChildId = urlContext.childId || getDeviceChildId() || "";
      const nextChildId =
        nextChildren.find((child) => child.id === preferredChildId)?.id ||
        nextChildren[0]?.id ||
        "";
      const initialChild = nextChildren.find((child) => child.id === nextChildId);
      setActiveChildId(nextChildId);
      if (initialChild) {
        setActivePracticeBookId(initialChild.defaultPracticeBookId || initialChild.practiceBooks[0]?.id || "");
      }
      if (nextChildId) {
        await loadChildProgress(nextChildId);
      }

      if (urlContext.lessonId) {
        const lesson = nextLessons.find((item) => item.id === urlContext.lessonId);
        if (lesson) {
          setActiveSection("courses");
          setDetailMode("existing");
          setActiveLessonId(lesson.id);
          if (!lesson.sourceType?.startsWith("library:")) {
            setIsDraftEditing(true);
            applyLessonDraft(lesson);
          } else {
            startCreateLesson();
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError);
    }
  }

  async function loadChildProgress(childId: string) {
    if (!childId) {
      setChildProgress([]);
      setAutomaticPracticeSessions([]);
      return;
    }

    try {
      const [progress, sessions] = await Promise.all([fetchProgress(childId), fetchAutomaticPracticeSessions(childId, 8)]);
      setChildProgress(progress);
      setAutomaticPracticeSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError);
    }
  }

  async function loadLessons() {
    try {
      const nextLessons = await fetchAdminLessons(showArchivedLessons);
      setLessons(nextLessons);

      if (detailMode === "existing" && activeLessonId && !isDraftEditing) {
        const activeLesson = nextLessons.find((lesson) => lesson.id === activeLessonId);
        if (activeLesson) {
          applyLessonDraft(activeLesson);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError);
    }
  }

  async function loadCourseLibrary() {
    try {
      setError("");
      setCatalogResources(await fetchCourseLibrary());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.courseLibraryLoadError);
    }
  }

  async function importCatalogResource(resource: CourseLibraryResource) {
    try {
      setCatalogBusyId(resource.id);
      setError("");
      const lesson = await importCourseLibraryResource(resource.id);
      await Promise.all([loadLessons(), loadCourseLibrary()]);
      setStatus(formatMessage(t.courseLibraryImported, { title: lesson.title }));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t.courseLibraryImportError);
    } finally {
      setCatalogBusyId("");
    }
  }

  async function restoreLessonPdfImport(lesson: Lesson, requestId: number) {
    try {
      const preview = await fetchLessonPdfImportPreview(lesson.id);
      if (requestId !== pdfImportRestoreRequestRef.current || !preview) return;
      setPdfImportStructure(preview.structure || null);
      setPdfImportQuality(preview.quality || lesson.importQuality || null);
      setPdfImportWarnings(preview.warnings || []);
      setPdfImportSnapshot(preview.importSnapshot || null);
      setPdfImportId(preview.importId || lesson.importId || "");
    } catch {
      if (requestId !== pdfImportRestoreRequestRef.current) return;
      setPdfImportStructure(null);
      setPdfImportSnapshot(null);
      setPdfImportId(lesson.importId || "");
    }
  }

  function applyLessonDraft(lesson: Lesson, { preservePdfPreview = false } = {}) {
    const draft = getLessonDraft(lesson);
    setTitle(draft.title);
    setMinScore(draft.minScore);
    setTagsText(draft.tagsText);
    setCourseTagDraft("");
    setDraftSourceType(lesson.sourceType || "manual");
    setPdfImportSummary("");
    setPdfImportQuality(lesson.importQuality || null);
    if (!preservePdfPreview) {
      const requestId = ++pdfImportRestoreRequestRef.current;
      setPdfImportStructure(null);
      setPdfImportWarnings([]);
      setPdfImportSnapshot(null);
      setPdfImportId(lesson.importId || "");
      if (lesson.sourceType === "pdf") void restoreLessonPdfImport(lesson, requestId);
    }
    setChapters(draft.chapters);
  }

  function updateChapter(id: string, patch: Partial<DraftChapter>) {
    setChapters((items) => items.map((chapter) => (chapter.id === id ? { ...chapter, ...patch } : chapter)));
  }

  function updateSectionTitle(chapterId: string, sectionId: string, title: string) {
    setChapters((items) => items.map((chapter) => chapter.id === chapterId ? {
      ...chapter,
      sections: chapter.sections?.map((section) => section.id === sectionId ? { ...section, title } : section)
    } : chapter));
  }

  function updateSentence(chapterId: string, sentenceId: string, text: string) {
    setChapters((items) =>
      items.map((chapter) =>
        chapter.id === chapterId
          ? {
              ...chapter,
              sentences: chapter.sentences.map((sentence) =>
                sentence.id === sentenceId ? { ...sentence, text } : sentence
              ),
              sections: chapter.sections?.map((section) => ({
                ...section,
                sentences: section.sentences.map((sentence) =>
                  sentence.id === sentenceId ? { ...sentence, text } : sentence
                )
              }))
            }
          : chapter
      )
    );
  }

  function addSentence(chapterId: string, sectionId?: string) {
    setChapters((items) =>
      items.map((chapter) =>
        chapter.id === chapterId
          ? (() => {
              const nextSentence = { id: crypto.randomUUID(), text: "" };
              return {
                ...chapter,
                sentences: [...chapter.sentences, nextSentence],
                sections: chapter.sections?.map((section) =>
                  section.id === sectionId ? { ...section, sentences: [...section.sentences, nextSentence] } : section
                )
              };
            })()
          : chapter
      )
    );
  }

  function removeSentence(chapterId: string, sentenceId: string) {
    setChapters((items) =>
      items.map((chapter) =>
        chapter.id === chapterId
          ? {
              ...chapter,
              sentences:
                chapter.sentences.length === 1
                  ? chapter.sentences
                  : chapter.sentences.filter((sentence) => sentence.id !== sentenceId),
              sections: chapter.sections?.map((section) => ({
                ...section,
                sentences:
                  section.sentences.length === 1
                    ? section.sentences
                    : section.sentences.filter((sentence) => sentence.id !== sentenceId)
              }))
            }
          : chapter
      )
    );
  }

  function reorderSectionSentence(chapterId: string, sectionId: string, sentenceId: string, direction: "up" | "down") {
    setChapters((items) =>
      items.map((chapter) => {
        if (chapter.id !== chapterId || !chapter.sections) return chapter;
        const nextSections = chapter.sections.map((section) => {
          if (section.id !== sectionId) return section;
          const currentIndex = section.sentences.findIndex((sentence) => sentence.id === sentenceId);
          const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
          if (currentIndex < 0 || targetIndex < 0 || targetIndex >= section.sentences.length) return section;
          const sentences = [...section.sentences];
          [sentences[currentIndex], sentences[targetIndex]] = [sentences[targetIndex], sentences[currentIndex]];
          return { ...section, sentences };
        });
        return { ...chapter, sections: nextSections, sentences: flattenDraftSections(nextSections) };
      })
    );
  }

  function moveSentenceToSection(chapterId: string, sourceSectionId: string, sentenceId: string, targetSectionId: string) {
    if (!targetSectionId || sourceSectionId === targetSectionId) return;
    setChapters((items) =>
      items.map((chapter) => {
        if (chapter.id !== chapterId || !chapter.sections) return chapter;
        const sourceSection = chapter.sections.find((section) => section.id === sourceSectionId);
        const sentence = sourceSection?.sentences.find((item) => item.id === sentenceId);
        if (!sentence || !chapter.sections.some((section) => section.id === targetSectionId)) return chapter;

        const nextSections = chapter.sections.map((section) => {
          if (section.id === sourceSectionId) {
            return { ...section, sentences: section.sentences.filter((item) => item.id !== sentenceId) };
          }
          if (section.id === targetSectionId) {
            return { ...section, sentences: [...section.sentences, sentence] };
          }
          return section;
        });
        return { ...chapter, sections: nextSections, sentences: flattenDraftSections(nextSections) };
      })
    );
  }

  function addChapter() {
    setChapters((items) => [...items, createDraftChapter(items.length + 1)]);
  }

  function removeChapter(id: string) {
    setChapters((items) => (items.length === 1 ? items : items.filter((chapter) => chapter.id !== id)));
  }

  function startCreateLesson() {
    pdfImportRestoreRequestRef.current += 1;
    setActiveSection("courses");
    setDetailMode("create");
    setActiveLessonId("");
    setIsDraftEditing(true);
    setDraftSourceType("manual");
    setTitle("");
    setMinScore(75);
    setTagsText("");
    setCourseTagDraft("");
    setChapters(createInitialChapters());
    setPdfImportSummary("");
    setPdfImportStructure(null);
    setPdfImportQuality(null);
    setPdfImportWarnings([]);
    setPdfImportSnapshot(null);
    setPdfImportId("");
    setStatus("");
    setError("");
  }

  function selectLesson(lesson: Lesson) {
    if (lesson.sourceType?.startsWith("library:")) {
      setStatus("课程广场导入的课程为只读资源，不能修改课程内容。");
      setError("");
      return;
    }
    setActiveSection("courses");
    setDetailMode("existing");
    setActiveLessonId(lesson.id);
    setIsDraftEditing(true);
    setDraftSourceType(lesson.sourceType || "manual");
    applyLessonDraft(lesson);
    setStatus("");
    setError("");
  }

  async function importPdfCourse(file: File) {
    setError("");
    setStatus("");
    setIsImportingPdf(true);

    try {
      const preview = await previewLessonPdfImport(file, pdfImportRule);
      setActiveSection("courses");
      setDetailMode("create");
      setActiveLessonId("");
      setIsDraftEditing(true);
      setDraftSourceType(preview.sourceType || "pdf");
      setTitle(preview.title);
      setMinScore(75);
      setTagsText(preview.tags.join("，"));
      setCourseTagDraft("");
      setPdfImportStructure(preview.structure);
      setPdfImportQuality(preview.quality);
      setPdfImportWarnings(preview.warnings);
      setPdfImportSnapshot(preview.importSnapshot || null);
      setPdfImportId(preview.importId || "");
      setChapters(
        preview.chapters.map((chapter, index) => ({
          id: chapter.id || crypto.randomUUID(),
          title: chapter.title || `${t.chapter} ${index + 1}`,
          sections: chapter.sections?.map((section) => ({
            id: section.id || crypto.randomUUID(),
            title: section.title,
            type: section.type,
            partKind: section.partKind,
            partLabel: section.partLabel,
            focusQuestion: section.focusQuestion,
            sentences:
              section.sentences.length > 0
                ? section.sentences.map((sentence) => toDraftSentence(sentence))
                : [{ id: crypto.randomUUID(), text: "" }]
          })),
          sentences:
            chapter.sentences.length > 0
              ? chapter.sentences.map((sentence) => toDraftSentence(sentence))
              : [{ id: crypto.randomUUID(), text: "" }]
        }))
      );
      setPdfImportSummary(
        formatMessage(t.pdfImportSummary, {
          file: file.name,
          chapters: preview.stats.chapters,
          sentences: preview.stats.sentences
        })
      );
      const importTrace = preview.importId ? ` ${preview.importId}` : "";
      setStatus(preview.warnings.length > 0 ? `${t.pdfImportReady}${importTrace} ${preview.warnings.join(" ")}` : `${t.pdfImportReady}${importTrace}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.pdfImportError);
    } finally {
      setIsImportingPdf(false);
      if (pdfImportInputRef.current) {
        pdfImportInputRef.current.value = "";
      }
    }
  }

  function handlePdfImportInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void importPdfCourse(file);
  }

  async function selectChild(childId: string) {
    setActiveChildId(childId);
    const child = children.find((item) => item.id === childId);
    if (child) {
      storeDevicePracticeContext(child.id);
      setActivePracticeBookId(child.defaultPracticeBookId || child.practiceBooks[0]?.id || "");
    } else {
      setActivePracticeBookId("");
    }
    await loadChildProgress(childId);
  }

  async function addChild() {
    const name = newChildName.trim();
    if (!name) return;

    try {
      const child = await createChildProfile(name);
      setChildren((items) => [...items, child]);
      setActiveChildId(child.id);
      setActivePracticeBookId(child.defaultPracticeBookId || child.practiceBooks[0]?.id || "");
      setChildProgress([]);
      setNewChildName("");
      setStatus(formatMessage(t.childCreated, { name: child.name }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.childCreateError);
    }
  }

  async function createPracticeBookWithTitle(bookTitle: string) {
    if (!activeChildId) {
      setError(t.startPracticeMissing);
      return;
    }

    if (!bookTitle) return;

    try {
      const child = await createPracticeBook(activeChildId, bookTitle);
      setChildren((items) => items.map((item) => (item.id === child.id ? child : item)));
      const createdBook = [...child.practiceBooks]
        .filter((book) => book.title === bookTitle)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      setActivePracticeBookId(createdBook?.id || child.defaultPracticeBookId || child.practiceBooks[0]?.id || "");
      setStatus(formatMessage(t.practiceBookCreated, { title: bookTitle }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.createPracticeBookError);
    }
  }

  async function addPracticeBook() {
    const nextIndex = (activeChild?.practiceBooks.length || 0) + 1;
    await createPracticeBookWithTitle(`${t.defaultPracticeBookTitle} ${nextIndex}`);
  }

  async function renamePracticeBook() {
    if (!activeChildId || !activePracticeBook) {
      setError(t.startPracticeMissing);
      return;
    }

    const nextTitle = practiceBookTitleDraft.trim();
    if (!nextTitle || nextTitle === activePracticeBook.title) return;

    try {
      const child = await updatePracticeBook(activeChildId, activePracticeBook.id, nextTitle);
      setChildren((items) => items.map((item) => (item.id === child.id ? child : item)));
      setActivePracticeBookId(activePracticeBook.id);
      setStatus(formatMessage(t.practiceBookRenamed, { title: nextTitle }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.updatePracticeBookError);
    }
  }

  async function deleteActivePracticeBook() {
    if (!activeChildId || !activePracticeBook) {
      setError(t.startPracticeMissing);
      return;
    }

    if (!window.confirm(formatMessage(t.confirmDeletePracticeBook, { title: activePracticeBook.title }))) {
      return;
    }

    try {
      const child = await deletePracticeBook(activeChildId, activePracticeBook.id);
      setChildren((items) => items.map((item) => (item.id === child.id ? child : item)));
      const nextBook = child.practiceBooks.find((book) => book.type === "default") || child.practiceBooks[0];
      setActivePracticeBookId(nextBook?.id || "");
      setStatus(formatMessage(t.practiceBookDeleted, { title: activePracticeBook.title }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.deletePracticeBookError);
    }
  }

  async function removePracticeItem(itemId: string) {
    if (!activeChildId) {
      setError(t.startPracticeMissing);
      return;
    }

    try {
      const child = await removePracticeBookItem(activeChildId, itemId);
      setChildren((items) => items.map((item) => (item.id === child.id ? child : item)));
      await loadChildProgress(child.id);
      setStatus(t.practiceItemRemoved);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.practiceItemUpdateError);
    }
  }

  async function addLessonToBook(lessonId: string, targetBookId?: string) {
    if (isAssigningLessons) return;

    if (!activeChildId) {
      setError(t.startPracticeMissing);
      return;
    }

    const targetBook = activeChild?.practiceBooks.find((book) => book.id === targetBookId) || activePracticeBook;
    if (!targetBook) {
      setError(t.createPracticeBookFirst);
      return;
    }

    const lesson = lessons.find((item) => item.id === lessonId);
    if (targetBook.items.some((item) => item.lessonId === lessonId)) {
      setActivePracticeBookId(targetBook.id);
      setStatus(formatMessage(t.practiceBookAlreadyHasLesson, { book: targetBook.title }));
      setError("");
      return;
    }

    setIsAssigningLessons(true);

    try {
      const child = await addLessonToPracticeBook(activeChildId, lessonId, targetBook.id);
      setChildren((items) => items.map((item) => (item.id === child.id ? child : item)));
      setActivePracticeBookId(targetBook.id);
      setSelectedPracticeLessonIds((lessonIds) => lessonIds.filter((id) => id !== lessonId));
      storeDevicePracticeContext(child.id);
      await loadChildProgress(child.id);
      setStatus(
        formatMessage(t.practiceLessonAddedToBook, {
          lesson: lesson?.title || t.courseTitle,
          book: targetBook.title
        })
      );
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.assignError);
    } finally {
      setIsAssigningLessons(false);
    }
  }

  function togglePracticeLessonSelection(lessonId: string) {
    setSelectedPracticeLessonIds((lessonIds) =>
      lessonIds.includes(lessonId) ? lessonIds.filter((id) => id !== lessonId) : [...lessonIds, lessonId]
    );
    setError("");
  }

  async function addSelectedLessonsToBook() {
    if (isAssigningLessons) return;

    if (!activeChildId || !activeChild) {
      setError(t.startPracticeMissing);
      return;
    }

    if (!practicePreviewTargetBook) {
      setError(t.createPracticeBookFirst);
      return;
    }

    if (selectedAssignableLessonIds.length === 0) {
      setStatus(t.selectedCoursesAlreadyInTargetBook);
      setError("");
      return;
    }

    setIsAssigningLessons(true);
    setError("");
    let updatedChild: ChildProfile = activeChild;
    const addedLessonIds: string[] = [];

    try {
      for (const lessonId of selectedAssignableLessonIds) {
        updatedChild = await addLessonToPracticeBook(activeChildId, lessonId, practicePreviewTargetBook.id);
        addedLessonIds.push(lessonId);
      }

      setChildren((items) => items.map((item) => (item.id === updatedChild.id ? updatedChild : item)));
      setActivePracticeBookId(practicePreviewTargetBook.id);
      setSelectedPracticeLessonIds((lessonIds) => lessonIds.filter((id) => !addedLessonIds.includes(id)));
      storeDevicePracticeContext(updatedChild.id);
      await loadChildProgress(updatedChild.id);
      setStatus(
        formatMessage(t.practiceLessonsAddedToBook, {
          count: addedLessonIds.length,
          book: practicePreviewTargetBook.title
        })
      );
    } catch (err) {
      if (addedLessonIds.length > 0) {
        setChildren((items) => items.map((item) => (item.id === updatedChild.id ? updatedChild : item)));
        setActivePracticeBookId(practicePreviewTargetBook.id);
        setSelectedPracticeLessonIds((lessonIds) => lessonIds.filter((id) => !addedLessonIds.includes(id)));
        await loadChildProgress(updatedChild.id);
      }
      setError(err instanceof Error ? err.message : t.assignError);
    } finally {
      setIsAssigningLessons(false);
    }
  }

  function beginLessonDrag(event: DragEvent<HTMLElement>, lessonId: string) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", lessonId);
    setDraggedLessonId(lessonId);
    setError("");
  }

  function clearLessonDragState() {
    setDraggedLessonId("");
    setDragOverPracticeBookId("");
    setIsPracticeDropActive(false);
  }

  function handleLessonDragOver(event: DragEvent<HTMLElement>, targetBookId?: string) {
    if (!draggedLessonId && !event.dataTransfer.types.includes("text/plain")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (targetBookId) {
      setDragOverPracticeBookId(targetBookId);
    } else {
      setIsPracticeDropActive(true);
    }
  }

  function handleLessonDragLeave(event: DragEvent<HTMLElement>, targetBookId?: string) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;

    if (targetBookId) {
      setDragOverPracticeBookId((current) => (current === targetBookId ? "" : current));
    } else {
      setIsPracticeDropActive(false);
    }
  }

  async function dropLessonOnPracticeBook(event: DragEvent<HTMLElement>, targetBookId?: string) {
    event.preventDefault();
    const lessonId = draggedLessonId || event.dataTransfer.getData("text/plain");
    clearLessonDragState();
    if (!lessonId) return;
    await addLessonToBook(lessonId, targetBookId || activePracticeBook?.id);
  }

  function beginPracticeItemDrag(event: DragEvent<HTMLElement>, itemId: string) {
    if (isReorderingPracticeItems) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-practice-item-id", itemId);
    setDraggedPracticeItemId(itemId);
    setPracticeItemDropTargetId("");
    setError("");
  }

  function clearPracticeItemDragState() {
    setDraggedPracticeItemId("");
    setPracticeItemDropTargetId("");
  }

  function handlePracticeItemDragOver(event: DragEvent<HTMLElement>, targetItemId: string) {
    const hasPracticeItem =
      Boolean(draggedPracticeItemId) || event.dataTransfer.types.includes("application/x-practice-item-id");
    if (!hasPracticeItem || targetItemId === draggedPracticeItemId) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setPracticeItemDropTargetId(targetItemId);
  }

  function handlePracticeItemDragLeave(event: DragEvent<HTMLElement>, targetItemId: string) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setPracticeItemDropTargetId((current) => (current === targetItemId ? "" : current));
  }

  async function reorderPracticeItem(sourceItemId: string, targetItemId: string) {
    const sourceIndex = practiceBookRows.findIndex(({ item }) => item.id === sourceItemId);
    const targetIndex = practiceBookRows.findIndex(({ item }) => item.id === targetItemId);
    clearPracticeItemDragState();

    if (!activeChildId || !activeChild || sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

    const direction = sourceIndex < targetIndex ? "down" : "up";
    const moveCount = Math.abs(targetIndex - sourceIndex);
    let updatedChild: ChildProfile = activeChild;
    setIsReorderingPracticeItems(true);
    setError("");

    try {
      for (let step = 0; step < moveCount; step += 1) {
        updatedChild = await reorderPracticeBookItem(activeChildId, sourceItemId, direction);
      }
      setChildren((items) => items.map((item) => (item.id === updatedChild.id ? updatedChild : item)));
      setActivePracticeBookId(activePracticeBook?.id || updatedChild.defaultPracticeBookId || updatedChild.practiceBooks[0]?.id || "");
      setStatus(t.practiceItemReordered);
    } catch (err) {
      setChildren((items) => items.map((item) => (item.id === updatedChild.id ? updatedChild : item)));
      setError(err instanceof Error ? err.message : t.practiceItemUpdateError);
    } finally {
      setIsReorderingPracticeItems(false);
    }
  }

  function dropPracticeItem(event: DragEvent<HTMLElement>, targetItemId: string) {
    event.preventDefault();
    event.stopPropagation();
    const sourceItemId =
      draggedPracticeItemId || event.dataTransfer.getData("application/x-practice-item-id");
    if (!sourceItemId) return;
    void reorderPracticeItem(sourceItemId, targetItemId);
  }

  function beginPracticeItemPointerDrag(event: ReactPointerEvent<HTMLSpanElement>, itemId: string) {
    if (event.pointerType === "mouse" || isReorderingPracticeItems) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    practicePointerDragRef.current = { pointerId: event.pointerId, sourceItemId: itemId, targetItemId: itemId };
    setDraggedPracticeItemId(itemId);
    setPracticeItemDropTargetId("");
  }

  function movePracticeItemPointerDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const pointerDrag = practicePointerDragRef.current;
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-practice-item-id]");
    const targetItemId = targetRow?.dataset.practiceItemId || pointerDrag.sourceItemId;
    pointerDrag.targetItemId = targetItemId;
    setPracticeItemDropTargetId(targetItemId === pointerDrag.sourceItemId ? "" : targetItemId);
  }

  function endPracticeItemPointerDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const pointerDrag = practicePointerDragRef.current;
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    practicePointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointerDrag.targetItemId === pointerDrag.sourceItemId) {
      clearPracticeItemDragState();
      return;
    }
    void reorderPracticeItem(pointerDrag.sourceItemId, pointerDrag.targetItemId);
  }

  function cancelPracticeItemPointerDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (practicePointerDragRef.current?.pointerId !== event.pointerId) return;
    practicePointerDragRef.current = null;
    clearPracticeItemDragState();
  }

  function startPractice() {
    if (!activeChild) {
      setError(t.startPracticeMissing);
      return;
    }

    storeDevicePracticeContext(activeChild.id);
    window.location.href = `/practice?childId=${encodeURIComponent(activeChild.id)}`;
  }

  async function saveLesson() {
    if (!isDraftEditing) return;

    if (detailMode === "existing" && activeLesson?.sourceType?.startsWith("library:")) {
      setError("课程广场导入的课程为只读资源，不能修改课程内容。");
      return;
    }

    setError("");
    setStatus("");
    setIsSaving(true);

    try {
      const isUpdatingLesson = detailMode === "existing" && Boolean(activeLessonId);
      const input = {
        title,
        sourceType: isUpdatingLesson ? undefined : draftSourceType,
        tags: parseTagsInput(tagsText),
        chapters: chapters.map((chapter) => {
          const chapterSentences = getDraftChapterSentences(chapter);
          return {
            id: chapter.id,
            title: chapter.title,
            text: chapterSentences.map((sentence) => sentence.text).join(" "),
            sections: chapter.sections?.map((section) => ({
              id: section.id,
              title: section.title,
              type: section.type,
              partKind: section.partKind,
              partLabel: section.partLabel,
              focusQuestion: section.focusQuestion,
              sentences: section.sentences.map((sentence) => toDraftSentence(sentence))
            })),
            sentences: chapterSentences.map((sentence) => toDraftSentence(sentence))
          };
        }),
        importQuality: pdfImportQuality || activeLesson?.importQuality || null,
        importId: pdfImportId || undefined,
        minScore
      };
      const lesson = isUpdatingLesson
        ? await updateLessonFromText(activeLessonId, input)
        : await createLessonFromText(input);

      setLessons((items) => {
        if (!isUpdatingLesson) return [...items, lesson];
        return items.map((item) => (item.id === lesson.id ? lesson : item));
      });
      setDetailMode("existing");
      setActiveLessonId(lesson.id);
      setIsDraftEditing(true);
      applyLessonDraft(lesson, { preservePdfPreview: true });
      setStatus(formatMessage(isUpdatingLesson ? t.statusUpdated : t.statusCreated, { sentences: lesson.sentences.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.createError);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleLessonArchive(lesson: Lesson) {
    setError("");
    setStatus("");
    setIsSaving(true);

    try {
      const nextStatus = lesson.status === "archived" ? "published" : "archived";
      const updatedLesson = await updateLessonStatus(lesson.id, nextStatus);
      setLessons((items) =>
        nextStatus === "archived" && !showArchivedLessons
          ? items.filter((item) => item.id !== lesson.id)
          : items.map((item) => (item.id === lesson.id ? updatedLesson : item))
      );

      if (nextStatus === "archived" && !showArchivedLessons) {
        setDetailMode("none");
        setActiveLessonId("");
      } else {
        setDetailMode("existing");
        setActiveLessonId(updatedLesson.id);
        applyLessonDraft(updatedLesson);
      }

      setStatus(nextStatus === "archived" ? t.lessonArchived : t.lessonRestored);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.updateLessonStatusError);
    } finally {
      setIsSaving(false);
    }
  }

  function renderPracticeCourseLibrary() {
    return (
      <aside className="practice-course-library-pane">
        <div className="practice-course-library">
          <div className="compact-panel-title practice-course-library-title">
            <div>
              <h2>{t.courseLibrary}</h2>
              <span>
                {formatMessage(t.courseLibraryCount, {
                  shown: courseLibraryLessons.length,
                  total: courseLibraryTotal
                })}
              </span>
            </div>
          </div>
          <div className="practice-course-filters">
            <input
              value={courseLibraryQuery}
              onChange={(event) => setCourseLibraryQuery(event.target.value)}
              placeholder={t.courseSearchPlaceholder}
              aria-label={t.courseSearchPlaceholder}
            />
            {renderTagFilterControl({
              selectedTags: courseLibraryTagFilters,
              onToggle: toggleCourseLibraryTagFilter,
              onClear: () => setCourseLibraryTagFilters([])
            })}
            <select
              value={courseLibrarySort}
              onChange={(event) => setCourseLibrarySort(event.target.value as CourseSortMode)}
              aria-label={t.courseSortLabel}
            >
              <option value="updated">{t.courseSortRecent}</option>
              <option value="title">{t.courseSortTitle}</option>
              <option value="sentences">{t.courseSortSentences}</option>
            </select>
            <label className="practice-course-toggle">
              <input
                type="checkbox"
                checked={showOnlyAvailableCourses}
                onChange={(event) => setShowOnlyAvailableCourses(event.target.checked)}
              />
              <span>{t.showUnaddedOnly}</span>
            </label>
            <Button
              variant="primary"
              size="compact"
              className="practice-course-batch-add"
              onClick={addSelectedLessonsToBook}
              disabled={!practicePreviewTargetBook || selectedAssignableLessonIds.length === 0 || isAssigningLessons}
            >
              <Plus size={17} />
              {isAssigningLessons ? t.assigningCourses : t.addSelectedToBook}
            </Button>
          </div>
          <div className="practice-course-list">
            {lessons.length === 0 ? (
              <p className="admin-muted">{t.noPublishedLessons}</p>
            ) : courseLibraryLessons.length === 0 ? (
              <p className="admin-muted">{t.noMatchingCourses}</p>
            ) : (
              visibleCourseLibraryLessons.map((lesson) => {
                const isInTargetBook = Boolean(practicePreviewTargetBook?.items.some((item) => item.lessonId === lesson.id));
                const isSelectedForAssignment = selectedPracticeLessonIds.includes(lesson.id);
                return (
                  <article
                    className={`practice-course-card ${isInTargetBook ? "added" : ""} ${
                      draggedLessonId === lesson.id ? "dragging" : ""
                    } ${isSelectedForAssignment ? "batch-selected" : ""}`}
                    draggable={Boolean(supportsCourseDrag && activeChild && activeChild.practiceBooks.length > 0)}
                    key={lesson.id}
                    onDragStart={(event) => beginLessonDrag(event, lesson.id)}
                    onDragEnd={clearLessonDragState}
                  >
                    <div className="practice-course-card-main">
                      <button className="practice-course-title-button" onClick={() => togglePracticeLessonSelection(lesson.id)} type="button">
                        <strong>{lesson.title}</strong>
                      </button>
                      {lesson.sourceType && lesson.sourceType !== "manual" && (
                        <span className="course-meta-line">
                          <em>{getLessonSourceLabel(lesson.sourceType)}</em>
                        </span>
                      )}
                      {lesson.tags && lesson.tags.length > 0 && (
                        <span className="course-tag-row">
                          {lesson.tags.slice(0, 3).map((tag) => (
                            <em key={tag}>{tag}</em>
                          ))}
                        </span>
                      )}
                      <span>
                        {lesson.chapters?.length || 1} {t.chapterCount} / {lesson.sentences.length} {t.sentenceCount}
                      </span>
                    </div>
                    <div className="practice-course-card-actions">
                      <label className="practice-course-select" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelectedForAssignment}
                          onChange={() => togglePracticeLessonSelection(lesson.id)}
                          disabled={!activeChild || !practicePreviewTargetBook || isAssigningLessons}
                          aria-label={formatMessage(t.selectCourseForAssignment, { course: lesson.title })}
                        />
                        <span>{isSelectedForAssignment ? t.selected : t.selectCourse}</span>
                      </label>
                      <Button
                        size="compact"
                        className="practice-course-add-button"
                        onClick={() => addLessonToBook(lesson.id, practicePreviewTargetBook?.id)}
                        disabled={!activeChild || !practicePreviewTargetBook || isInTargetBook || isAssigningLessons}
                      >
                        {isInTargetBook ? <BookOpen size={16} /> : <Plus size={16} />}
                        {isInTargetBook ? t.alreadyInPracticeBook : t.addToTargetBook}
                      </Button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          {courseLibraryLessons.length > 0 && (
            <div className="course-list-footer">
              <span>
                {formatMessage(t.courseListWindow, {
                  shown: visibleCourseLibraryLessons.length,
                  total: courseLibraryLessons.length
                })}
              </span>
              {hasMoreCourseLibraryLessons && (
                <Button
                  size="compact"
                  onClick={() => setCourseLibraryVisibleCount((count) => count + COURSE_LIBRARY_PAGE_SIZE)}
                >
                  {t.loadMoreCourses}
                </Button>
              )}
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <main className={`admin-shell layout-${layoutPreview}`}>
      <div className="admin-app-frame">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <span className="admin-avatar">{activeChild?.name.slice(0, 1) || "P"}</span>
            <div>
              <strong>{t.eyebrow}</strong>
              <small>{t.previewBadge}</small>
            </div>
          </div>
          <nav className="admin-nav" aria-label={t.parentNavigation}>
            {[
              { id: "overview" as ParentSection, label: t.navOverview, Icon: Home },
              { id: "courses" as ParentSection, label: t.navCourseManagement, Icon: BookOpen },
              { id: "course-library" as ParentSection, label: t.navCourseLibrary, Icon: Store },
              { id: "practice" as ParentSection, label: t.navPracticeBook, Icon: ClipboardList },
              { id: "children" as ParentSection, label: t.navChildren, Icon: Users },
              { id: "analytics" as ParentSection, label: t.navAnalytics, Icon: BarChart3 },
              { id: "settings" as ParentSection, label: t.navSettings, Icon: Settings }
            ].map(({ id, label, Icon }) => (
              <button
                className={`admin-nav-item ${activeSection === id ? "active" : ""}`}
                key={id}
                onClick={() => id === "courses" && detailMode === "none" ? startCreateLesson() : setActiveSection(id)}
                type="button"
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
            <button
              className="admin-nav-item admin-child-page-link"
              onClick={startPractice}
              disabled={!activeChild}
              type="button"
            >
              <Play size={17} />
              <span>{t.childPage}</span>
            </button>
          </nav>
        </aside>

        <section className="admin-workspace">

          {(status || error) && (
            <div className="admin-status-stack">
              {status && <p className="status-text">{status}</p>}
              {error && <p className="error-text">{error}</p>}
            </div>
          )}

          {activeSection === "practice" && (
          <section className="admin-panel practice-board-panel">
            <div className="practice-board-heading">
              <div className="practice-board-title-block">
                <span className="admin-kicker">{t.navPracticeBook}</span>
                <div className="practice-board-title-row">
                  <h1>{activePracticeBook?.title || t.currentPracticeBook}</h1>
                  {activePracticeBook && (
                    <div className="practice-board-tools">
                      <input
                        value={practiceBookTitleDraft}
                        onChange={(event) => setPracticeBookTitleDraft(event.target.value)}
                        placeholder={t.practiceBookName}
                        aria-label={t.practiceBookName}
                      />
                      <button
                        className="admin-secondary-button compact-action"
                        onClick={renamePracticeBook}
                        disabled={
                          !practiceBookTitleDraft.trim() ||
                          practiceBookTitleDraft.trim() === activePracticeBook.title
                        }
                        type="button"
                      >
                        <Pencil size={17} />
                        {t.renamePracticeBook}
                      </button>
                      <button className="icon-danger-button" onClick={deleteActivePracticeBook} aria-label={t.deletePracticeBook} type="button">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="practice-board-stats" aria-label={t.practiceBookStatsLabel}>
                <span>
                  {t.practiceTodo} <strong>{practiceBookStats.pending}</strong>
                </span>
                <span>
                  {t.practiceInProgress} <strong>{practiceBookStats.inProgress}</strong>
                </span>
                <span>
                  {t.practiceDone} <strong>{practiceBookStats.completed}</strong>
                </span>
              </div>
            </div>

            <div className="practice-board-grid">
              <aside className="practice-books-pane">
                <div className="compact-panel-title practice-book-list-title">
                  <div>
                    <h2>{t.practiceBookList}</h2>
                    <span>{activeChild ? formatMessage(t.practiceBookCountShort, { count: activeChild.practiceBooks.length }) : "0"}</span>
                  </div>
                  <button className="admin-secondary-button compact-action" onClick={addPracticeBook} disabled={!activeChild} type="button">
                    <Plus size={17} />
                    {t.createPracticeBook}
                  </button>
                </div>

                <div className="practice-book-selector-list">
                  {activeChild ? (
                    activeChild.practiceBooks.map((book, index) => {
                      const bookTotals = book.items.reduce(
                        (totals, item) => {
                          const lesson = lessons.find((lessonItem) => lessonItem.id === item.lessonId);
                          const progress = childProgress.find((progressItem) => progressItem.lessonId === item.lessonId);
                          return {
                            passed: totals.passed + (progress?.passedCount || 0),
                            total: totals.total + (progress?.totalCount || lesson?.sentences.length || 0)
                          };
                        },
                        { passed: 0, total: 0 }
                      );
                      const bookProgressPercent = bookTotals.total ? Math.round((bookTotals.passed / bookTotals.total) * 100) : 0;
                      return (
                        <button
                          className={`practice-book-option ${book.id === activePracticeBook?.id ? "selected" : ""} ${
                            dragOverPracticeBookId === book.id ? "drop-over" : ""
                          }`}
                          key={book.id}
                          onClick={() => setActivePracticeBookId(book.id)}
                          onDragOver={(event) => handleLessonDragOver(event, book.id)}
                          onDragLeave={(event) => handleLessonDragLeave(event, book.id)}
                          onDrop={(event) => dropLessonOnPracticeBook(event, book.id)}
                          type="button"
                        >
                          <span className="practice-book-mark">{book.title.slice(0, 1) || index + 1}</span>
                          <span className="practice-book-info">
                            <strong>{book.title}</strong>
                            <small>
                              {bookTotals.passed} / {bookTotals.total || book.items.length} {t.sentenceCount}
                            </small>
                            <ProgressBar value={bookProgressPercent} />
                          </span>
                          {book.id === activePracticeBook?.id && <b>{t.selected}</b>}
                        </button>
                      );
                    })
                  ) : (
                    <p className="admin-muted">{t.noAssignment}</p>
                  )}
                </div>

              </aside>

              <section
                className={`practice-content-pane ${isPracticeDropActive ? "drop-over" : ""}`}
                onDragOver={(event) => handleLessonDragOver(event)}
                onDragLeave={(event) => handleLessonDragLeave(event)}
                onDrop={(event) => dropLessonOnPracticeBook(event)}
              >
                <div className="practice-content-heading">
                  <div>
                    <h2>{t.practiceBookContent}</h2>
                    <p>
                      {formatMessage(t.sentenceProgressShort, {
                        done: practiceBookPassedSentences,
                        total: practiceBookTotalSentences
                      })}
                    </p>
                  </div>
                  <div className="practice-content-actions">
                    <button className="admin-secondary-button compact-action" onClick={loadLessons} disabled={isSaving} type="button">
                      <RefreshCw size={17} />
                      {t.refresh}
                    </button>
                  </div>
                </div>

                {practiceBookRows.length === 0 ? (
                  <div className="practice-table-empty">
                    <BookOpen size={26} />
                    <p>{t.practiceBookEmpty}</p>
                  </div>
                ) : (
                  <>
                    <div className="practice-table" role="table" aria-label={t.practiceBookContent}>
                      <div className="practice-table-row practice-table-head" role="row">
                        <span>{t.tableOrder}</span>
                        <span>{t.tableCourse}</span>
                        <span>{t.tableProgress}</span>
                        <span>{t.tableStatus}</span>
                        <span>{t.tableActions}</span>
                      </div>
                      {practiceBookRows.map(({ item, lesson, progress, progressPercent, displayStatus, latestProgress }, index) => {
                        const draggedIndex = practiceBookRows.findIndex(({ item: rowItem }) => rowItem.id === draggedPracticeItemId);
                        const dropPositionClass =
                          practiceItemDropTargetId === item.id && draggedIndex >= 0
                            ? draggedIndex < index
                              ? "drop-after"
                              : "drop-before"
                            : "";
                        return (
                          <div
                            className={`practice-table-row can-reorder ${draggedPracticeItemId === item.id ? "dragging" : ""} ${dropPositionClass}`}
                            role="row"
                            key={item.id}
                            data-practice-item-id={item.id}
                            draggable={supportsCourseDrag && !isReorderingPracticeItems}
                            onDragStart={(event) => beginPracticeItemDrag(event, item.id)}
                            onDragEnd={clearPracticeItemDragState}
                            onDragOver={(event) => handlePracticeItemDragOver(event, item.id)}
                            onDragLeave={(event) => handlePracticeItemDragLeave(event, item.id)}
                            onDrop={(event) => void dropPracticeItem(event, item.id)}
                          >
                            <span
                              className="table-order-cell"
                              title={t.dragPracticeItem}
                              onPointerDown={(event) => beginPracticeItemPointerDrag(event, item.id)}
                              onPointerMove={movePracticeItemPointerDrag}
                              onPointerUp={endPracticeItemPointerDrag}
                              onPointerCancel={cancelPracticeItemPointerDrag}
                            >
                              <GripVertical size={15} aria-hidden="true" />
                              <b>{index + 1}</b>
                            </span>
                            <button className="table-course-button" onClick={() => lesson && selectLesson(lesson)} type="button">
                              <strong>{lesson?.title || item.lessonTitle}</strong>
                              <small>
                                {progress?.passedCount || 0} / {progress?.totalCount || lesson?.sentences.length || 0} {t.sentenceCount}
                              </small>
                            </button>
                            <span className="table-progress-cell">
                              <strong>{progressPercent}%</strong>
                              <ProgressBar value={progressPercent} />
                              <small>{typeof latestProgress?.latestScore === "number" ? Math.round(latestProgress.latestScore) : t.noAttemptsYet}</small>
                            </span>
                            <em className={`practice-status-chip ${displayStatus}`}>{getPracticeStatusLabel(displayStatus)}</em>
                            <span className="practice-table-actions">
                              <button className="practice-remove-course-button" onClick={() => removePracticeItem(item.id)} type="button" aria-label={t.removePracticeItem} title={t.removePracticeItem}>
                                <Trash2 size={18} aria-hidden="true" />
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="practice-table-empty compact">
                      <BookOpen size={22} />
                      <p>{t.practiceBookAddMoreHint}</p>
                    </div>
                  </>
                )}
              </section>
              {renderPracticeCourseLibrary()}
            </div>
          </section>
          )}

          {activeSection === "course-library" && (
            <section className="admin-section-page course-catalog-page">
              <div className="admin-page-heading course-catalog-heading">
                <div>
                  <span className="admin-kicker">{t.navCourseLibrary}</span>
                  <h1>{t.courseLibraryTitle}</h1>
                  <p>{t.courseLibrarySubtitle}</p>
                </div>
                <Button size="compact" onClick={loadCourseLibrary} disabled={Boolean(catalogBusyId)}>
                  <RefreshCw size={17} />
                  {t.refresh}
                </Button>
              </div>
              <div className="course-catalog-toolbar">
                <input
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder={t.courseLibrarySearch}
                  aria-label={t.courseLibrarySearch}
                />
                <span>{formatMessage(t.courseCatalogCount, { count: visibleCatalogResources.length })}</span>
              </div>
              {visibleCatalogResources.length === 0 ? (
                <EmptyState title={t.courseLibraryEmpty} description={t.courseLibraryEmptyHint} />
              ) : (
                <div className="course-catalog-grid">
                  {visibleCatalogResources.map((resource) => (
                    <article className="course-catalog-card" key={resource.id}>
                      <div className="course-catalog-card-head">
                        <span className="course-catalog-cover"><BookOpen size={28} /></span>
                        <div>
                          <small>{resource.sourceLabel}</small>
                          <h2>{resource.title}</h2>
                          <p>{resource.description}</p>
                        </div>
                      </div>
                      <div className="course-catalog-tags">
                        <em>{resource.level}</em>
                        {resource.tags.map((tag) => <em key={tag}>{tag}</em>)}
                      </div>
                      <div className="course-catalog-meta">
                        <span>{resource.stats.chapters} {t.chapterCount}</span>
                        <span>{resource.stats.sections} {t.courseLibrarySections}</span>
                        <span>{resource.stats.sentences} {t.sentenceCount}</span>
                      </div>
                      <Button
                        variant={resource.imported ? "secondary" : "primary"}
                        onClick={() => importCatalogResource(resource)}
                        disabled={resource.imported || Boolean(catalogBusyId)}
                      >
                        {resource.imported ? t.courseLibraryAlreadyAdded : catalogBusyId === resource.id ? t.courseLibraryAdding : t.courseLibraryAdd}
                      </Button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeSection === "courses" && (
            <section className={`platform-admin-grid family-course-admin-grid ${pdfImportSnapshot ? "has-pdf-preview" : ""}`}>
              <form
                className="platform-publish-panel family-course-publish-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveLesson();
                }}
              >
                <div className="platform-panel-heading">
                  <span><Send size={20} /></span>
                  <div>
                    <small>
                      {detailMode === "existing"
                        ? (locale === "zh" ? "修改家庭课程" : "Edit family course")
                        : (locale === "zh" ? "新建家庭课程" : "New family course")}
                    </small>
                    <h1>
                      {detailMode === "existing"
                        ? (locale === "zh" ? `编辑 ${title}` : `Edit ${title}`)
                        : (locale === "zh" ? "创建课程" : "Create course")}
                    </h1>
                  </div>
                  {detailMode === "existing" && (
                    <button onClick={startCreateLesson} type="button">
                      {locale === "zh" ? "新建课程" : "New course"}
                    </button>
                  )}
                </div>

                <input
                  ref={pdfImportInputRef}
                  accept="application/pdf,.pdf"
                  className="hidden-file-input"
                  onChange={handlePdfImportInput}
                  type="file"
                />
                <section className="platform-pdf-upload">
                  <div>
                    <Upload size={24} />
                    <span>
                      <strong>{pdfImportSummary ? title : (locale === "zh" ? "上传教材 PDF" : "Upload textbook PDF")}</strong>
                      <small>
                        {isImportingPdf
                          ? describePdfImportProgress(pdfImportElapsed).hint
                          : pdfImportSummary || (locale === "zh"
                            ? "解析后进入同一套 OCR 复核与课程校对流程"
                            : "Uses the shared OCR review and course editing workflow")}
                      </small>
                    </span>
                  </div>
                  <label>
                    {locale === "zh" ? "解析规则" : "Parsing rule"}
                    <select
                      value={pdfImportRule}
                      onChange={(event) => setPdfImportRule(event.target.value)}
                      disabled={isSaving || isImportingPdf}
                    >
                      {PDF_IMPORT_RULES.map((rule) => (
                        <option value={rule.value} key={rule.value}>{t[rule.labelKey]}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() => pdfImportInputRef.current?.click()}
                    disabled={isSaving || isImportingPdf}
                    type="button"
                  >
                    {isImportingPdf
                      ? describePdfImportProgress(pdfImportElapsed).label
                      : pdfImportSummary
                        ? (locale === "zh" ? "重新上传" : "Upload again")
                        : (locale === "zh" ? "选择 PDF" : "Select PDF")}
                  </button>
                  {isImportingPdf && <small className="pdf-import-running-hint">{describePdfImportProgress(pdfImportElapsed).hint}</small>}
                </section>

                {pdfImportSummary && (
                  <div className="import-preview-banner">
                    <Badge>{t.pdfImportPreview}</Badge>
                    <span>{pdfImportSummary}</span>
                    <small>{t.pdfImportEditHint}</small>
                  </div>
                )}
                {pdfImportQuality && (
                  <PdfImportReviewSummary
                    quality={pdfImportQuality}
                    stats={{
                      chapters: chapters.length,
                      sentences: chapters.reduce((sum, chapter) => sum + getDraftChapterSentences(chapter).length, 0)
                    }}
                    warnings={pdfImportWarnings}
                  />
                )}
                {pdfImportSnapshot && <PdfImportLayersPanel snapshot={pdfImportSnapshot} />}

                <label>
                  {locale === "zh" ? "课程标题" : "Course title"}
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={100}
                    placeholder={locale === "zh" ? "输入课程名称" : "Enter a course title"}
                    required
                  />
                </label>
                <div className="platform-field-row">
                  <label>
                    {locale === "zh" ? "通过分数" : "Pass score"}
                    <input
                      type="number"
                      min={50}
                      max={100}
                      value={minScore}
                      onChange={(event) => setMinScore(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    {locale === "zh" ? "课程来源" : "Course source"}
                    <input value={getLessonSourceLabel(draftSourceType)} readOnly />
                  </label>
                </div>
                <label>
                  {locale === "zh" ? "标签" : "Tags"}
                  <span className="course-tag-add-row">
                    <input
                      value={courseTagDraft}
                      onChange={(event) => setCourseTagDraft(event.target.value)}
                      onKeyDown={handleCourseTagKeyDown}
                      placeholder={t.courseTagsPlaceholder}
                    />
                    <Button size="compact" onClick={addCourseTag} disabled={!courseTagDraft.trim()} type="button">
                      <Plus size={17} />
                      {t.addCourseTag}
                    </Button>
                  </span>
                  {draftTags.length > 0 && (
                    <span className="course-tag-preview">
                      {draftTags.map((tag) => (
                        <em key={tag}>
                          {tag}
                          <button
                            type="button"
                            onClick={() => removeCourseTag(tag)}
                            aria-label={formatMessage(t.removeCourseTag, { tag })}
                          >
                            x
                          </button>
                        </em>
                      ))}
                    </span>
                  )}
                </label>

                {(detailMode === "existing" || Boolean(pdfImportSummary) || Boolean(pdfImportSnapshot)) && (
                  <CourseContentEditor
                    chapters={chapters}
                    structure={pdfImportStructure}
                    snapshot={pdfImportSnapshot}
                    onChapterTitleChange={(chapterIndex, value) => updateChapter(chapters[chapterIndex].id, { title: value })}
                    onSectionTitleChange={(chapterIndex, sectionIndex, value) => {
                      const chapter = chapters[chapterIndex];
                      const section = chapter.sections?.[sectionIndex];
                      if (section) updateSectionTitle(chapter.id, section.id, value);
                    }}
                    onSentenceChange={(chapterIndex, sectionIndex, sentenceIndex, value) => {
                      const chapter = chapters[chapterIndex];
                      const sentence = sectionIndex === null
                        ? chapter.sentences[sentenceIndex]
                        : chapter.sections?.[sectionIndex]?.sentences[sentenceIndex];
                      if (sentence) updateSentence(chapter.id, sentence.id, value);
                    }}
                    onRemoveSentence={(chapterIndex, sectionIndex, sentenceIndex) => {
                      const chapter = chapters[chapterIndex];
                      const sentence = sectionIndex === null
                        ? chapter.sentences[sentenceIndex]
                        : chapter.sections?.[sectionIndex]?.sentences[sentenceIndex];
                      if (sentence) removeSentence(chapter.id, sentence.id);
                    }}
                    onRemoveChapter={(chapterIndex) => removeChapter(chapters[chapterIndex].id)}
                    onAddChapter={addChapter}
                    onAddSentence={(chapterIndex, sectionIndex) => addSentence(
                      chapters[chapterIndex].id,
                      sectionIndex === null ? undefined : chapters[chapterIndex].sections?.[sectionIndex]?.id
                    )}
                    onReorderSentence={(chapterIndex, sectionIndex, sentenceIndex, direction) => {
                      const chapter = chapters[chapterIndex];
                      const section = chapter.sections?.[sectionIndex];
                      const sentence = section?.sentences[sentenceIndex];
                      if (section && sentence) reorderSectionSentence(chapter.id, section.id, sentence.id, direction);
                    }}
                    onMoveSentence={(chapterIndex, sectionIndex, sentenceIndex, targetSectionIndex) => {
                      const chapter = chapters[chapterIndex];
                      const section = chapter.sections?.[sectionIndex];
                      const sentence = section?.sentences[sentenceIndex];
                      const targetSection = chapter.sections?.[targetSectionIndex];
                      if (section && sentence && targetSection) {
                        moveSentenceToSection(chapter.id, section.id, sentence.id, targetSection.id);
                      }
                    }}
                  />
                )}

                <div className="family-course-create-actions">
                  {detailMode === "existing" && activeLesson && (
                    <Button
                      onClick={() => void toggleLessonArchive(activeLesson)}
                      disabled={isSaving}
                      type="button"
                    >
                      {activeLesson.status === "archived" ? <RotateCcw size={17} /> : <Archive size={17} />}
                      {activeLesson.status === "archived" ? t.restoreLesson : t.archiveLesson}
                    </Button>
                  )}
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={
                      isSaving ||
                      isImportingPdf ||
                      !title.trim() ||
                      (detailMode === "create" && !pdfImportSummary && !pdfImportSnapshot)
                    }
                  >
                    <Store size={18} />
                    {isSaving
                      ? (locale === "zh" ? "处理中…" : "Saving…")
                      : detailMode === "existing"
                        ? (locale === "zh" ? "保存修改" : "Save changes")
                        : (locale === "zh" ? "创建课程" : "Create course")}
                  </Button>
                </div>
              </form>

              <section className="platform-resource-panel family-course-resource-panel">
                <div className="platform-panel-heading">
                  <span><BookOpen size={20} /></span>
                  <div>
                    <small>{locale === "zh" ? "当前家庭的课程资源" : "Courses in this family"}</small>
                    <h1>{locale === "zh" ? "已发布课程" : "Published courses"}</h1>
                  </div>
                  <Button size="compact" onClick={loadLessons} disabled={isSaving}>
                    <RefreshCw size={16} />
                    {t.refresh}
                  </Button>
                </div>

                <div className="family-published-course-filters">
                  <input
                    value={lessonSearchQuery}
                    onChange={(event) => setLessonSearchQuery(event.target.value)}
                    placeholder={t.courseSearchPlaceholder}
                    aria-label={t.courseSearchPlaceholder}
                  />
                  {renderTagFilterControl({
                    selectedTags: lessonTagFilters,
                    onToggle: toggleLessonTagFilter,
                    onClear: () => setLessonTagFilters([])
                  })}
                  <select
                    value={lessonLibrarySort}
                    onChange={(event) => setLessonLibrarySort(event.target.value as CourseSortMode)}
                    aria-label={t.courseSortLabel}
                  >
                    <option value="updated">{t.courseSortRecent}</option>
                    <option value="title">{t.courseSortTitle}</option>
                    <option value="sentences">{t.courseSortSentences}</option>
                  </select>
                  <label className="practice-course-toggle">
                    <input
                      type="checkbox"
                      checked={showArchivedLessons}
                      onChange={(event) => setShowArchivedLessons(event.target.checked)}
                    />
                    <span>{t.showArchivedLessons}</span>
                  </label>
                </div>

                {courseManagementLessons.length === 0 ? (
                  <p className="platform-empty">{t.noMatchingCourses}</p>
                ) : (
                  <div className="platform-resource-list">
                    {visibleCourseManagementLessons.map((lesson) => {
                      const isPlazaCourse = lesson.sourceType?.startsWith("library:");
                      return (
                        <article
                          className={lesson.status === "archived" ? "is-unpublished" : ""}
                          key={lesson.id}
                        >
                          <div>
                            <small>
                              {isPlazaCourse
                                ? (locale === "zh" ? "课程广场 · 只读" : "Course plaza · Read only")
                                : getLessonSourceLabel(lesson.sourceType)}
                            </small>
                            <h2>{lesson.title}</h2>
                            <p>
                              {lesson.tags?.length
                                ? lesson.tags.join(" · ")
                                : (locale === "zh" ? "家庭自有课程" : "Family-owned course")}
                            </p>
                          </div>
                          <div className="platform-resource-meta">
                            <span>{lesson.chapters?.length || 1} {t.chapterCount}</span>
                            <span>{lesson.sentences.length} {t.sentenceCount}</span>
                            <span>{lesson.status === "archived" ? t.archivedLesson : t.publishedLesson}</span>
                            {activePracticeLessonIds.has(lesson.id) && <span>{t.inPracticeBook}</span>}
                          </div>
                          <div className="platform-resource-actions">
                            {isPlazaCourse ? (
                              <span className="family-course-readonly-badge">
                                {locale === "zh" ? "禁止编辑" : "Editing disabled"}
                              </span>
                            ) : (
                              <button onClick={() => selectLesson(lesson)} type="button">
                                <Pencil size={15} />
                                {locale === "zh" ? "编辑课程" : "Edit course"}
                              </button>
                            )}
                            <button
                              onClick={() => void toggleLessonArchive(lesson)}
                              disabled={isSaving}
                              type="button"
                            >
                              {lesson.status === "archived" ? <RotateCcw size={15} /> : <Archive size={15} />}
                              {lesson.status === "archived" ? t.restoreLesson : t.archiveLesson}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                {courseManagementLessons.length > 0 && (
                  <div className="course-list-footer">
                    <span>
                      {formatMessage(t.courseListWindow, {
                        shown: visibleCourseManagementLessons.length,
                        total: courseManagementLessons.length
                      })}
                    </span>
                    {hasMoreCourseManagementLessons && (
                      <Button
                        size="compact"
                        onClick={() => setLessonLibraryVisibleCount((count) => count + COURSE_MANAGEMENT_PAGE_SIZE)}
                      >
                        {t.loadMoreCourses}
                      </Button>
                    )}
                  </div>
                )}
              </section>
            </section>
          )}

          {activeSection === "overview" && (
            <section className="admin-section-page overview-page">
              <div className="admin-page-heading">
                <span className="admin-kicker">{t.navOverview}</span>
                <h1>{t.overviewTitle}</h1>
                <p>{t.overviewSubtitle}</p>
              </div>

              <div className="admin-metric-grid">
                <article className="admin-metric-card accent">
                  <span>{t.currentChild}</span>
                  <strong>{activeChild?.name || "-"}</strong>
                  <small>{activeChild ? formatMessage(t.practiceBookCountShort, { count: activeChild.practiceBooks.length }) : t.noAssignment}</small>
                </article>
                <article className="admin-metric-card">
                  <span>{t.currentPracticeBook}</span>
                  <strong>{activePracticeBook?.title || "-"}</strong>
                  <small>{formatMessage(t.taskCountShort, { count: activePracticeItems.length })}</small>
                </article>
                <article className="admin-metric-card">
                  <span>{t.practiceProgress}</span>
                  <strong>{childProgressPercent}%</strong>
                  <ProgressBar value={childProgressPercent} />
                </article>
                <article className="admin-metric-card">
                  <span>{t.publishedLessons}</span>
                  <strong>{lessons.length}</strong>
                  <small>{formatMessage(t.courseCountShort, { count: lessons.length })}</small>
                </article>
              </div>

              <section className="admin-panel admin-action-panel">
                <div className="compact-panel-title">
                  <h2>{t.quickActions}</h2>
                  <span>{t.previewBadge}</span>
                </div>
                <div className="admin-action-grid">
                  <button className="admin-action-card" onClick={() => setActiveSection("courses")} type="button">
                    <BookOpen size={20} />
                    <strong>{t.navCourseManagement}</strong>
                    <span>{t.courseManagementHint}</span>
                  </button>
                  <button className="admin-action-card" onClick={() => setActiveSection("practice")} type="button">
                    <ClipboardList size={20} />
                    <strong>{t.navPracticeBook}</strong>
                    <span>{t.practiceBookHint}</span>
                  </button>
                  <button className="admin-action-card" onClick={() => setActiveSection("children")} type="button">
                    <Users size={20} />
                    <strong>{t.navChildren}</strong>
                    <span>{t.childrenHint}</span>
                  </button>
                  <button className="admin-action-card" onClick={startPractice} disabled={!activeChild} type="button">
                    <Play size={20} />
                    <strong>{t.childPage}</strong>
                    <span>{t.childPageHint}</span>
                  </button>
                </div>
              </section>

              <section className="admin-panel automatic-session-panel">
                <div className="compact-panel-title">
                  <h2>{t.automaticPracticeHistory}</h2>
                  <span>{automaticPracticeSessions.length}</span>
                </div>
                {automaticPracticeSessions.length === 0 ? (
                  <p className="admin-muted">{t.automaticPracticeHistoryEmpty}</p>
                ) : (
                  <div className="automatic-session-list">
                    {automaticPracticeSessions.slice(0, 6).map((session) => {
                      const reasonLabel =
                        session.status === "active"
                          ? t.automaticPracticeActive
                          : session.stopReason === "completed"
                            ? t.automaticPracticeStopCompleted
                            : session.stopReason === "no-speech"
                              ? t.automaticPracticeStopNoSpeech
                              : session.stopReason === "failed-attempts"
                                ? t.automaticPracticeStopFailed
                                : session.stopReason === "interrupted"
                                  ? t.automaticPracticeStopInterrupted
                                  : session.stopReason === "service-error"
                                    ? t.automaticPracticeStopError
                                    : session.stopReason === "navigation"
                                      ? t.automaticPracticeStopNavigation
                                      : t.automaticPracticeStopManual;
                      return (
                        <article className={`automatic-session-row ${session.status}`} key={session.id}>
                          <span className="automatic-session-marker" aria-hidden="true" />
                          <div>
                            <strong>{session.lessonTitle || t.unknownLesson}</strong>
                            <small title={session.lastSentenceText || ""}>{session.lastSentenceText || t.noSentenceRecord}</small>
                          </div>
                          <span className="automatic-session-reason">{reasonLabel}</span>
                          <time dateTime={session.startedAt}>
                            {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            }).format(new Date(session.startedAt))}
                          </time>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </section>
          )}

          {activeSection === "children" && (
            <section className="admin-section-page">
              <div className="admin-page-heading">
                <span className="admin-kicker">{t.navChildren}</span>
                <h1>{t.childManagementTitle}</h1>
                <p>{t.childManagementSubtitle}</p>
              </div>

              <section className="admin-panel child-management-panel">
                <div className="child-management-tools">
                  <label className="admin-field">
                    <span>{t.currentChild}</span>
                    <select value={activeChildId} onChange={(event) => selectChild(event.target.value)}>
                      {children.map((child) => (
                        <option key={child.id} value={child.id}>
                          {child.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="admin-field child-add-field">
                    <span>{t.addChild}</span>
                    <div className="child-create-row">
                      <input value={newChildName} onChange={(event) => setNewChildName(event.target.value)} placeholder={t.childName} />
                      <button className="admin-secondary-button compact-action" onClick={addChild} type="button">
                        <UserPlus size={17} />
                        {t.addChild}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="child-profile-list">
                  {children.length === 0 ? (
                    <div className="practice-table-empty">
                      <Users size={26} />
                      <p>{t.noChildrenYet}</p>
                    </div>
                  ) : (
                  children.map((child) => {
                    const childTaskCount = child.practiceBooks.reduce((sum, book) => sum + book.items.length, 0);
                    return (
                      <button
                        className={`child-profile-row ${child.id === activeChildId ? "selected" : ""}`}
                        key={child.id}
                        onClick={() => selectChild(child.id)}
                        type="button"
                      >
                        <span className="admin-avatar">{child.name.slice(0, 1)}</span>
                        <strong>{child.name}</strong>
                        <small>{formatMessage(t.practiceBookCountShort, { count: child.practiceBooks.length })}</small>
                        <em>{formatMessage(t.taskCountShort, { count: childTaskCount })}</em>
                      </button>
                    );
                  })
                  )}
                </div>
              </section>
            </section>
          )}

          {activeSection === "analytics" && (
            <section className="admin-section-page">
              <div className="admin-page-heading">
                <span className="admin-kicker">{t.navAnalytics}</span>
                <h1>{t.analyticsTitle}</h1>
                <p>{t.analyticsSubtitle}</p>
              </div>

              <div className="admin-metric-grid analytics-grid">
                <article className="admin-metric-card">
                  <span>{t.totalChildrenLabel}</span>
                  <strong>{children.length}</strong>
                  <small>{t.navChildren}</small>
                </article>
                <article className="admin-metric-card">
                  <span>{t.totalPracticeBooksLabel}</span>
                  <strong>{totalPracticeBooks}</strong>
                  <small>{t.navPracticeBook}</small>
                </article>
                <article className="admin-metric-card">
                  <span>{t.totalTasksLabel}</span>
                  <strong>{totalPracticeTasks}</strong>
                  <small>{t.practiceTasks}</small>
                </article>
                <article className="admin-metric-card accent">
                  <span>{t.completedLessonsLabel}</span>
                  <strong>{completedLessons}</strong>
                  <small>{activeChild?.name || t.currentChild}</small>
                </article>
              </div>

              <AnalyticsOverview
                averageBestScore={analyticsAverageBestScore}
                lessonStats={analyticsLessonStats}
                overallPercent={childProgressPercent}
                recentScores={analyticsRecentScores}
                statusCounts={analyticsStatusCounts}
                totalAttempts={analyticsTotalAttempts}
                copy={{
                  attempts: t.analyticsAttempts,
                  averageBestScore: t.analyticsAverageBestScore,
                  completed: t.practiceDone,
                  courseComparison: t.analyticsCourseComparison,
                  inProgress: t.practiceInProgress,
                  noAssignedCourses: t.analyticsNoAssignedCourses,
                  noAttempts: t.noAttemptsYet,
                  notStarted: t.analyticsNotStarted,
                  overallProgress: t.currentChildProgressLabel,
                  recentScores: t.analyticsRecentScores,
                  sentenceCount: t.sentenceCount
                }}
              />
            </section>
          )}

          {activeSection === "settings" && (
            <section className="admin-section-page">
              <div className="admin-page-heading">
                <span className="admin-kicker">{t.navSettings}</span>
                <h1>{t.settingsTitle}</h1>
                <p>{t.settingsSubtitle}</p>
              </div>

              <section className="admin-panel settings-panel">
                <label className="settings-row">
                  <span>
                    <strong>{t.layoutSetting}</strong>
                    <small>{t.layoutSettingHint}</small>
                  </span>
                  <select value={layoutPreview} onChange={(event) => setLayoutPreview(event.target.value as LayoutPreview)}>
                    <option value="phone">{t.layoutPhone}</option>
                    <option value="tablet">{t.layoutTablet}</option>
                    <option value="desktop">{t.layoutDesktop}</option>
                  </select>
                </label>
                <label className="settings-row settings-row--theme">
                  <span>
                    <strong>{t.themeSetting}</strong>
                    <small>{t.themeSettingHint}</small>
                  </span>
                  <ThemeSwitcher locale={locale} showChrome />
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t.languageSetting}</strong>
                    <small>{t.languageSettingHint}</small>
                  </span>
                  <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>
                    {Object.entries(localeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
