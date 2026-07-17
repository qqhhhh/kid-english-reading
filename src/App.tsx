import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Lock,
  Mic,
  ShieldCheck,
  Square,
  Star,
  Trophy,
  Volume2
} from "lucide-react";
import { lazy, Suspense, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AttemptSubmissionError,
  createAutomaticPracticeSession,
  fetchAttempt,
  fetchChildren,
  fetchLessons,
  fetchProgress,
  fetchReferenceSubtitles,
  fetchTtsVoices,
  finishAutomaticPracticeSession,
  getAttemptAudioUrl,
  getReferenceAudioUrl,
  submitAttempt,
  submitRejectedAttemptDiagnostic,
  updatePracticeBookItem
} from "./lib/api";
import { ChildTopBar } from "./components/child/ChildTopBar";
import { AuthenticatedRoute, LoginPage } from "./components/parent/ParentAccessGate";
import { PracticeIssueNotice } from "./components/practice/PracticeIssueNotice";
import { FilingReviewDemoPage } from "./components/public/FilingReviewDemoPage";
import { useDesignChrome } from "./components/design/DesignThemeContext";
import { Metric, ProgressBar, RecordOrb, StageCard, StatusBanner, VoicePicker, WordChip } from "./components/ui";
import { getDeviceChildId, getDevicePracticeItemId, getUrlPracticeContext, storeDevicePracticeContext } from "./lib/deviceSession";
import { formatMessage, getInitialLocale, messages, storeLocale, type Locale } from "./lib/i18n";
import { selectHistoricalAttempt } from "./lib/historicalAttempt";
import { prepareLiveSpeechSession, type LiveSpeechSession } from "./lib/liveSpeech";
import { preflightMicrophoneAccess, type MicrophoneAccessState } from "./lib/microphonePermission";
import { getPracticeIssue, type PracticeIssue } from "./lib/practiceErrors";
import { releaseScreenWakeLock, requestScreenWakeLock, type ScreenWakeLockHandle } from "./lib/screenWakeLock";
import {
  getAssessmentPhonetic,
  getAssessmentWordText,
  getEffectiveFluency,
  getProblemWords,
  getRequiredWordScore,
  getWordAccuracyMetrics,
  getWordFeedbackKind,
  scoreTone,
  type WordFeedbackKind
} from "./lib/scoring";
import type { Attempt, AutomaticPracticeSession, Chapter, ChildProfile, Lesson, LessonProgress, LessonSection, Sentence, TtsSubtitle, TtsVoice } from "./lib/types";
import { RecordingQualityError, WavRecorder, type SpeechSegmentSummary } from "./lib/wavRecorder";
import { decideAutomaticRecordingFailure, decideAutomaticScoreOutcome } from "../shared/automaticPractice.js";
import { getLiveSpeechTestFinalResult } from "../shared/liveSpeechPilot.js";
import { getAutomaticRecordingStopDelayMs } from "../shared/recordingStopPolicy.js";
import { prepareDuringPlayback, prepareSequentialAudio } from "../shared/sequentialAudio.js";

const LazyDevicePreviewStudio = lazy(() =>
  import("./components/design/DevicePreviewStudio").then(({ DevicePreviewStudio }) => ({ default: DevicePreviewStudio }))
);
const LazyParentConsole = lazy(() =>
  import("./ParentConsole").then(({ ParentConsole }) => ({ default: ParentConsole }))
);
const LazyPlatformAdminPage = lazy(() =>
  import("./components/admin/ServerPlatformAdminPage").then(({ ServerPlatformAdminPage }) => ({ default: ServerPlatformAdminPage }))
);
const LazyLocalCourseStudioPage = import.meta.env.DEV
  ? lazy(() => import("./components/admin/PlatformAdminPage").then(({ PlatformAdminPage }) => ({ default: PlatformAdminPage })))
  : null;
const LazyPictureBookPrototype = lazy(() =>
  import("./components/storybook/PictureBookPrototype").then(({ PictureBookPrototype }) => ({ default: PictureBookPrototype }))
);
const LazyPictureBookSquare = lazy(() =>
  import("./components/storybook/PictureBookSquare").then(({ PictureBookSquare }) => ({ default: PictureBookSquare }))
);
const LazySudokuPage = lazy(() =>
  import("./components/puzzle/SudokuPage").then(({ SudokuPage }) => ({ default: SudokuPage }))
);

function RouteLoadingScreen() {
  return <main className="route-loading-screen" aria-label="页面加载中" />;
}

type PracticeTaskDisplayStatus = "pending" | "in_progress" | "completed";
type GuidedPracticePhase = "idle" | "listening" | "audio-blocked" | "waiting" | "speaking" | "scoring";
type ReferencePlaybackFailure = "blocked" | "failed" | null;
type AutomaticPracticePendingAction =
  | { kind: "retry"; sentenceId: string }
  | { kind: "next"; sentenceIndex: number; sentenceId: string }
  | null;
type AutomaticPracticeNotice = { message: string; tone: "info" | "ok" | "warn" | "bad" } | null;

function getPracticeTaskDisplayStatus(itemStatus: string, progressItem: LessonProgress | undefined, progressPercent: number): PracticeTaskDisplayStatus {
  if (itemStatus === "completed" || progressPercent >= 100) return "completed";
  if (itemStatus === "in_progress" || (progressItem?.passedCount ?? 0) > 0) return "in_progress";
  return "pending";
}

function findPracticeItemId(child: ChildProfile | null | undefined, lessonId: string, preferredItemId = "") {
  if (!child || !lessonId) return "";
  const items = child.practiceBooks.flatMap((book) => book.items);
  if (preferredItemId && items.some((item) => item.id === preferredItemId && item.lessonId === lessonId)) {
    return preferredItemId;
  }
  return items.find((item) => item.lessonId === lessonId)?.id || "";
}

function findTopPracticeTask(child: ChildProfile | null | undefined, lessons: Lesson[], progress: LessonProgress[]) {
  const rows = (child?.practiceBooks ?? []).flatMap((book) =>
    book.items
      .map((item) => {
        const lesson = lessons.find((lessonItem) => lessonItem.id === item.lessonId);
        if (!lesson) return null;
        const progressItem = progress.find((progressItem) => progressItem.lessonId === item.lessonId);
        const progressPercent = progressItem?.totalCount ? Math.round((progressItem.passedCount / progressItem.totalCount) * 100) : 0;
        return {
          lesson,
          practiceBookId: book.id,
          practiceItemId: item.id,
          status: getPracticeTaskDisplayStatus(item.status, progressItem, progressPercent)
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  );

  return rows.find((row) => row.status === "in_progress") || rows.find((row) => row.status === "pending") || rows[0];
}

function getLessonReadingPosition(lesson: Lesson | undefined, progress: LessonProgress[]) {
  if (!lesson || lesson.sentences.length === 0) return { passedCount: 0, sentenceIndex: 0 };
  const lessonProgress = progress.find((item) => item.lessonId === lesson.id);
  if (!lessonProgress) return { passedCount: 0, sentenceIndex: 0 };

  const firstUnpassedIndex = lesson.sentences.findIndex((sentence) => {
    const sentenceProgress = lessonProgress.sentences.find((item) => item.sentenceId === sentence.id);
    return !(sentenceProgress?.completed ?? sentenceProgress?.passed);
  });
  const passedCount = firstUnpassedIndex === -1 ? lesson.sentences.length : firstUnpassedIndex;
  return {
    passedCount,
    sentenceIndex: Math.min(passedCount, lesson.sentences.length - 1)
  };
}

function getNavigatorChapters(lesson: Lesson): Chapter[] {
  if (lesson.chapters?.length) return lesson.chapters;
  return [
    {
      id: `${lesson.id}-chapter`,
      title: lesson.title,
      body: "",
      position: 0,
      sections: [
        {
          id: `${lesson.id}-section`,
          title: "",
          sentences: lesson.sentences
        }
      ],
      sentences: lesson.sentences
    }
  ];
}

function getNavigatorSections(chapter: Chapter): LessonSection[] {
  if (chapter.sections?.length) return chapter.sections;
  return [
    {
      id: `${chapter.id}-section`,
      title: "",
      sentences: chapter.sentences
    }
  ];
}

function getSectionPartLabel(section: LessonSection) {
  if (section.partKind === "lead-in") return section.partLabel || "Lead-in";
  if (section.partLabel) return `Part ${section.partLabel}`;
  return "";
}

function getSentenceBreadcrumb(lesson: Lesson, sentenceId: string, sentenceIndex: number, locale: Locale) {
  for (const chapter of getNavigatorChapters(lesson)) {
    for (const section of getNavigatorSections(chapter)) {
      if (!section.sentences.some((item) => item.id === sentenceId)) continue;
      const partLabel = getSectionPartLabel(section);
      const sectionTitle = section.title || partLabel || chapter.title;
      const sectionIndex = section.sentences.findIndex((item) => item.id === sentenceId);
      const indexLabel =
        section.type === "vocabulary"
          ? locale === "zh"
            ? `第 ${sectionIndex + 1} 个词`
            : `Word ${sectionIndex + 1}`
          : locale === "zh"
            ? `第 ${sectionIndex + 1} 句`
            : `Sentence ${sectionIndex + 1}`;
      return {
        chapterTitle: chapter.title,
        sectionTitle,
        indexLabel,
        label: [chapter.title, sectionTitle, indexLabel].filter(Boolean).join(" · ")
      };
    }
  }
  const indexLabel = locale === "zh" ? `第 ${sentenceIndex + 1} 句` : `Sentence ${sentenceIndex + 1}`;
  return {
    chapterTitle: lesson.title,
    sectionTitle: "",
    indexLabel,
    label: `${lesson.title} · ${indexLabel}`
  };
}

function getSentenceSection(lesson: Lesson, sentenceId: string) {
  for (const chapter of getNavigatorChapters(lesson)) {
    const section = getNavigatorSections(chapter).find((candidate) =>
      candidate.sentences.some((sentence) => sentence.id === sentenceId)
    );
    if (section) return { chapter, section };
  }
  return null;
}

function isWordPracticeItem(lesson: Lesson, sentence: Sentence) {
  return sentence.itemType === "word" || getSentenceSection(lesson, sentence.id)?.section.type === "vocabulary";
}

function getPassedSentenceCount(sentences: Sentence[], progress: LessonProgress | undefined) {
  const sentenceIds = new Set(sentences.map((sentence) => sentence.id));
  return progress?.sentences.filter((sentence) => (sentence.completed ?? sentence.passed) && sentenceIds.has(sentence.sentenceId)).length || 0;
}

function toggleExpandedId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function App() {
  if (window.location.pathname.startsWith("/filing-review")) return <FilingReviewDemoPage />;
  if (window.location.pathname.startsWith("/login")) return <LoginPage />;
  return (
    <AuthenticatedRoute showSessionControls={window.location.pathname.startsWith("/parent") || window.location.pathname.startsWith("/admin") || window.location.pathname.startsWith("/local-course-studio")}>
      <AuthenticatedApplication />
    </AuthenticatedRoute>
  );
}

function AuthenticatedApplication() {
  if (window.location.pathname.startsWith("/local-course-studio")) {
    const localHost = ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
    if (!localHost || !LazyLocalCourseStudioPage) {
      window.location.replace("/admin");
      return <RouteLoadingScreen />;
    }
    return <Suspense fallback={<RouteLoadingScreen />}><LazyLocalCourseStudioPage mode="local-studio" /></Suspense>;
  }
  if (window.location.pathname.startsWith("/admin")) {
    return <Suspense fallback={<RouteLoadingScreen />}><LazyPlatformAdminPage /></Suspense>;
  }
  if (window.location.pathname.startsWith("/sudoku")) {
    return <Suspense fallback={<RouteLoadingScreen />}><LazySudokuPage /></Suspense>;
  }
  if (window.location.pathname.startsWith("/picture-books")) {
    return <Suspense fallback={<RouteLoadingScreen />}><LazyPictureBookSquare /></Suspense>;
  }
  if (window.location.pathname.startsWith("/picture-book-preview")) {
    return <Suspense fallback={<RouteLoadingScreen />}><LazyPictureBookPrototype /></Suspense>;
  }
  if (window.location.pathname.startsWith("/preview")) {
    return (
      <Suspense fallback={<RouteLoadingScreen />}>
        <LazyDevicePreviewStudio />
      </Suspense>
    );
  }

  if (window.location.pathname.startsWith("/parent")) {
    return (
      <Suspense fallback={<RouteLoadingScreen />}>
        <LazyParentConsole />
      </Suspense>
    );
  }

  const designChrome = useDesignChrome();
  const isStorybook = designChrome === "storybook";
  const pageParams = new URLSearchParams(window.location.search);
  const isDevicePreview = pageParams.get("devicePreview") === "1";
  const isFilingReviewSandbox = pageParams.get("review") === "1";
  const isLiveSpeechPreferred = !isDevicePreview && !isFilingReviewSandbox;
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [activeChild, setActiveChild] = useState<ChildProfile | null>(null);
  const [childProgress, setChildProgress] = useState<LessonProgress[]>([]);
  const [activeLessonId, setActiveLessonId] = useState("");
  const [activePracticeItemId, setActivePracticeItemId] = useState("");
  const [expandedPracticeBookId, setExpandedPracticeBookId] = useState("");
  const [expandedPracticeCourseIds, setExpandedPracticeCourseIds] = useState<string[]>([]);
  const [expandedPracticeChapterIds, setExpandedPracticeChapterIds] = useState<string[]>([]);
  const [expandedPracticeSectionIds, setExpandedPracticeSectionIds] = useState<string[]>([]);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [attemptSource, setAttemptSource] = useState<"current" | "history-best" | "history-latest" | null>(null);
  const [passedCount, setPassedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [guidedPracticePhase, setGuidedPracticePhase] = useState<GuidedPracticePhase>("idle");
  const [isAutomaticPracticeActive, setIsAutomaticPracticeActive] = useState(false);
  const [automaticNoSpeechCount, setAutomaticNoSpeechCount] = useState(0);
  const [automaticFailedAttemptCount, setAutomaticFailedAttemptCount] = useState(0);
  const [automaticPracticePendingAction, setAutomaticPracticePendingAction] = useState<AutomaticPracticePendingAction>(null);
  const [automaticPracticeNotice, setAutomaticPracticeNotice] = useState<AutomaticPracticeNotice>(null);
  const [isSentenceChanging, setIsSentenceChanging] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [lessonCelebrationId, setLessonCelebrationId] = useState("");
  const [playingSentenceId, setPlayingSentenceId] = useState("");
  const [playingAttemptAudioId, setPlayingAttemptAudioId] = useState("");
  const [referenceAudioProgress, setReferenceAudioProgress] = useState(0);
  const [referenceAudioTimeMs, setReferenceAudioTimeMs] = useState(0);
  const [referenceSubtitles, setReferenceSubtitles] = useState<TtsSubtitle[]>([]);
  const [ttsVoices, setTtsVoices] = useState<TtsVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [error, setError] = useState<string | PracticeIssue>("");
  const [microphoneAccessState, setMicrophoneAccessState] = useState<MicrophoneAccessState>(
    isDevicePreview ? "skipped" : "checking"
  );
  const recorderRef = useRef<WavRecorder | null>(null);
  const liveSpeechTestSessionRef = useRef<LiveSpeechSession | null>(null);
  const liveSpeechTestRunIdRef = useRef("");
  const liveSpeechTestCaptureActiveRef = useRef(false);
  const liveSpeechTestEndRequestedAtRef = useRef(0);
  const liveSpeechTestPendingAudioRef = useRef<Array<{ samples: Float32Array; inputSampleRate: number }>>([]);
  const liveSpeechTestPendingAudioMsRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const attemptAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const sentenceTransitionTimeoutRef = useRef<number | null>(null);
  const recordingAutoStopTimeoutRef = useRef<number | null>(null);
  const recordingNoSpeechTimeoutRef = useRef<number | null>(null);
  const recordingMaxTimeoutRef = useRef<number | null>(null);
  const automaticPracticeTimeoutRef = useRef<number | null>(null);
  const practiceNavigatorRef = useRef<HTMLElement | null>(null);
  const referencePlaybackResolverRef = useRef<((completed: boolean) => void) | null>(null);
  const referencePlaybackFailureRef = useRef<ReferencePlaybackFailure>(null);
  const referencePlaybackRunRef = useRef(0);
  const stopRecordingInFlightRef = useRef(false);
  const automaticPracticeActiveRef = useRef(false);
  const automaticPracticeSessionRef = useRef(0);
  const automaticNoSpeechCountRef = useRef(0);
  const automaticFailedAttemptCountRef = useRef(0);
  const automaticAttemptSentenceIdRef = useRef("");
  const screenWakeLockRef = useRef<ScreenWakeLockHandle | null>(null);
  const screenWakeLockRequestRef = useRef(0);
  const automaticSessionRecordIdRef = useRef("");
  const automaticSessionStartPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    loadPracticeContext();
  }, []);

  useEffect(() => {
    if (isDevicePreview) return;
    let active = true;
    void preflightMicrophoneAccess().then((state) => {
      if (active) setMicrophoneAccessState(state);
    });
    return () => {
      active = false;
    };
  }, [isDevicePreview]);

  useEffect(() => {
    if (isDevicePreview || !navigator.permissions?.query) return;
    let active = true;
    let permission: PermissionStatus | null = null;
    const handlePermissionChange = () => {
      if (!active || !permission) return;
      if (permission.state === "granted") {
        setMicrophoneAccessState("granted");
      } else if (permission.state === "denied") {
        setMicrophoneAccessState("denied");
      } else {
        setMicrophoneAccessState("checking");
        void preflightMicrophoneAccess(true).then((state) => {
          if (active) setMicrophoneAccessState(state);
        });
      }
    };
    void navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (!active) return;
        permission = status;
        permission.addEventListener("change", handlePermissionChange);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      permission?.removeEventListener("change", handlePermissionChange);
    };
  }, [isDevicePreview]);

  useEffect(() => {
    return () => {
      clearRecordingTimers();
      stopReferenceAudio(false);
      stopAttemptAudio();
      void recorderRef.current?.cancel();
      recorderRef.current = null;
      liveSpeechTestSessionRef.current?.cancel();
      liveSpeechTestSessionRef.current = null;
      liveSpeechTestRunIdRef.current = "";
      liveSpeechTestCaptureActiveRef.current = false;
      liveSpeechTestEndRequestedAtRef.current = 0;
      liveSpeechTestPendingAudioRef.current = [];
      liveSpeechTestPendingAudioMsRef.current = 0;
      screenWakeLockRequestRef.current += 1;
      void releaseScreenWakeLock(screenWakeLockRef.current);
      screenWakeLockRef.current = null;
      if (sentenceTransitionTimeoutRef.current !== null) {
        window.clearTimeout(sentenceTransitionTimeoutRef.current);
      }
      if (automaticPracticeTimeoutRef.current !== null) {
        window.clearTimeout(automaticPracticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (sentenceTransitionTimeoutRef.current !== null) {
      window.clearTimeout(sentenceTransitionTimeoutRef.current);
      sentenceTransitionTimeoutRef.current = null;
    }
    setIsSentenceChanging(false);
  }, [activeLessonId]);

  useEffect(() => {
    if (!attempt) {
      setAnimatedScore(0);
      return;
    }

    const targetScore = Math.min(100, Math.max(0, Math.round(attempt.result.SuggestedScore)));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedScore(targetScore);
      return;
    }

    const startedAt = window.performance.now();
    let animationFrame = 0;
    const animate = (now: number) => {
      const progressValue = Math.min(1, (now - startedAt) / 520);
      const easedProgress = 1 - (1 - progressValue) ** 3;
      setAnimatedScore(Math.round(targetScore * easedProgress));
      if (progressValue < 1) animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [attempt?.id]);

  useEffect(() => {
    if (!lessonCelebrationId) return;
    const timeoutId = window.setTimeout(() => setLessonCelebrationId(""), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [lessonCelebrationId]);

  useEffect(() => {
    const rail = practiceNavigatorRef.current;
    if (!rail) return;
    const frame = window.requestAnimationFrame(() => {
      const currentItem = rail.querySelector<HTMLElement>(".practice-sentence-tree-item[aria-current='true']");
      if (!currentItem) return;
      const railRect = rail.getBoundingClientRect();
      const itemRect = currentItem.getBoundingClientRect();
      const safeTop = railRect.top + 20;
      const safeBottom = railRect.bottom - 28;
      if (itemRect.top < safeTop) {
        rail.scrollTop -= safeTop - itemRect.top;
      } else if (itemRect.bottom > safeBottom) {
        rail.scrollTop += itemRect.bottom - safeBottom;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeLessonId, sentenceIndex, expandedPracticeBookId, expandedPracticeCourseIds, expandedPracticeChapterIds, expandedPracticeSectionIds]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>(".sb-reading-passage-lines");
      const activeLine = container?.querySelector<HTMLElement>("p.active");
      if (!container || !activeLine) return;
      const targetTop = activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeLessonId, sentenceIndex]);

  const lesson = lessons.find((item) => item.id === activeLessonId);
  const sentence = lesson?.sentences[sentenceIndex];
  const sentenceProgress = lesson
    ? childProgress.find((item) => item.lessonId === lesson.id)?.sentences.find((item) => item.sentenceId === sentence?.id)
    : undefined;
  const progress = lesson ? Math.round((passedCount / lesson.sentences.length) * 100) : 0;
  const microphoneReady = microphoneAccessState === "granted" || microphoneAccessState === "skipped";
  const currentItemCompleted = Boolean(
    attempt && (attempt.passed || (sentence?.required === false && attempt.result.SuggestedScore > 0))
  );
  const currentSelectionCompleted = Boolean(sentenceProgress?.completed);
  const canGoNext = Boolean(currentItemCompleted && sentenceIndex < (lesson?.sentences.length ?? 0) - 1);
  const isLessonComplete = Boolean(lesson && passedCount >= lesson.sentences.length);
  const problemWords = useMemo(() => (attempt ? getProblemWords(attempt.result) : []), [attempt]);
  const wordAccuracyMetrics = useMemo(() => (attempt ? getWordAccuracyMetrics(attempt.result) : null), [attempt]);
  const effectiveFluency = useMemo(() => (attempt ? getEffectiveFluency(attempt.result) : 0), [attempt]);
  const t = messages[locale].child;
  const guidedPracticeLabel =
    microphoneAccessState === "checking"
      ? t.preparingMic
      : guidedPracticePhase === "listening"
        ? t.playing
        : guidedPracticePhase === "waiting"
          ? t.waitingForSpeech
          : guidedPracticePhase === "speaking"
            ? t.hearingSpeech
            : guidedPracticePhase === "scoring"
              ? t.checking
              : isAutomaticPracticeActive
                ? t.automaticPracticePreparing
                : currentSelectionCompleted
                  ? t.practiceDone
                  : t.start;
  const automaticPracticeStatusText =
    guidedPracticePhase === "listening"
      ? t.automaticPracticeListening
      : guidedPracticePhase === "waiting" || guidedPracticePhase === "speaking"
          ? t.automaticPracticeReading
          : guidedPracticePhase === "scoring"
            ? t.automaticPracticeScoring
            : automaticPracticePendingAction?.kind === "retry"
              ? automaticNoSpeechCount > 0
                ? formatMessage(t.automaticPracticeNoSpeechRetry, { count: automaticNoSpeechCount })
                : t.automaticPracticeRetrying
              : attemptSource === "current" && attempt && (
                  attempt.passed || (sentence?.required === false && attempt.result.SuggestedScore > 0)
                )
                ? sentenceIndex >= (lesson?.sentences.length ?? 1) - 1
                  ? t.automaticPracticeCompleted
                  : t.automaticPracticePassedNext
                : t.automaticPracticePreparing;
  const retryTips = attempt && sentence && !attempt.passed ? getRetryTips(attempt, sentence, t) : [];

  useEffect(() => {
    if (!isAutomaticPracticeActive || !automaticPracticePendingAction || guidedPracticePhase !== "idle" || !sentence) return;
    const actionMatches =
      automaticPracticePendingAction.sentenceId === sentence.id &&
      (automaticPracticePendingAction.kind === "retry" || automaticPracticePendingAction.sentenceIndex === sentenceIndex);
    if (!actionMatches) return;
    if (currentSelectionCompleted) {
      deactivateAutomaticPractice(t.automaticPracticeAlreadyCompleted, "info", "completed");
      return;
    }

    const sessionId = automaticPracticeSessionRef.current;
    const delayMs = automaticPracticePendingAction.kind === "retry" ? 1700 : 650;
    if (automaticPracticeTimeoutRef.current !== null) window.clearTimeout(automaticPracticeTimeoutRef.current);
    automaticPracticeTimeoutRef.current = window.setTimeout(() => {
      automaticPracticeTimeoutRef.current = null;
      if (!automaticPracticeActiveRef.current || automaticPracticeSessionRef.current !== sessionId) return;
      setAutomaticPracticePendingAction(null);
      void startRecording();
    }, delayMs);
    return () => {
      if (automaticPracticeTimeoutRef.current !== null) {
        window.clearTimeout(automaticPracticeTimeoutRef.current);
        automaticPracticeTimeoutRef.current = null;
      }
    };
  }, [
    automaticPracticePendingAction,
    currentSelectionCompleted,
    guidedPracticePhase,
    isAutomaticPracticeActive,
    sentence?.id,
    sentenceIndex
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && automaticPracticeActiveRef.current) {
        void stopAutomaticPractice(t.automaticPracticeInterrupted, "warn", "interrupted");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [locale]);

  useEffect(() => {
    let isActive = true;
    stopAttemptAudio();
    setAttempt(null);
    setAttemptSource(null);

    const historicalSelection = selectHistoricalAttempt(sentenceProgress);
    if (!activeChild?.id || !sentence?.id || !historicalSelection) {
      return () => {
        isActive = false;
      };
    }

    void fetchAttempt(historicalSelection.attemptId, activeChild.id)
      .then((historicalAttempt) => {
        if (!isActive) return;
        setAttempt(historicalAttempt);
        setAttemptSource(historicalSelection.kind === "best" ? "history-best" : "history-latest");
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
      stopAttemptAudio();
    };
  }, [activeChild?.id, sentence?.id]);
  const practiceBookSections = (activeChild?.practiceBooks ?? [])
    .map((book) => {
      const rows = book.items
        .map((item) => {
          const itemLesson = lessons.find((lessonItem) => lessonItem.id === item.lessonId);
          const itemProgress = childProgress.find((progressItem) => progressItem.lessonId === item.lessonId);
          const progressPercent = itemProgress?.totalCount ? Math.round((itemProgress.passedCount / itemProgress.totalCount) * 100) : 0;
          return {
            item,
            lesson: itemLesson,
            progress: itemProgress,
            progressPercent,
            displayStatus: getPracticeTaskDisplayStatus(item.status, itemProgress, progressPercent)
          };
        })
        .filter((row) => row.lesson);

      return {
        book,
        groups: [
          {
            key: "pending",
            label: t.practiceTodo,
            rows: rows.filter((row) => row.displayStatus === "pending")
          },
          {
            key: "in_progress",
            label: t.practiceInProgress,
            rows: rows.filter((row) => row.displayStatus === "in_progress")
          },
          {
            key: "completed",
            label: t.practiceDone,
            rows: rows.filter((row) => row.displayStatus === "completed")
          }
        ].filter((group) => group.rows.length > 0),
        rows
      };
    })
    .filter((section) => section.rows.length > 0);
  const totalPracticeTasks = practiceBookSections.reduce((sum, section) => sum + section.rows.length, 0);
  const practiceTaskRows = practiceBookSections.flatMap((section) =>
    section.rows.map((row) => ({
      ...row,
      book: section.book
    }))
  );
  const practiceTaskStats = practiceTaskRows.reduce(
    (stats, row) => ({
      pending: stats.pending + (row.displayStatus === "pending" ? 1 : 0),
      inProgress: stats.inProgress + (row.displayStatus === "in_progress" ? 1 : 0),
      completed: stats.completed + (row.displayStatus === "completed" ? 1 : 0)
    }),
    { pending: 0, inProgress: 0, completed: 0 }
  );
  const childTotalStars = childProgress.reduce(
    (total, lessonProgress) =>
      total + lessonProgress.sentences.reduce((lessonTotal, sentenceProgress) => lessonTotal + getScoreStarValue(sentenceProgress.bestScore), 0),
    0
  );
  const activePracticeBookId =
    practiceBookSections.find((section) =>
      section.rows.some((row) => row.item.id === activePracticeItemId || row.item.lessonId === activeLessonId)
    )?.book.id || "";
  const expandedPracticeBookExists = practiceBookSections.some((section) => section.book.id === expandedPracticeBookId);
  const openPracticeBookId = expandedPracticeBookExists ? expandedPracticeBookId : "";

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    storeLocale(nextLocale);
  }

  function openDevicePreview() {
    const target = `${window.location.pathname}${window.location.search}`;
    const params = new URLSearchParams({ target });
    window.location.assign(`/preview?${params.toString()}`);
  }

  function getPracticeStatusLabel(status: PracticeTaskDisplayStatus) {
    if (status === "completed") return t.practiceDone;
    if (status === "in_progress") return t.practiceInProgress;
    return t.practiceTodo;
  }

  async function loadPracticeContext() {
    try {
      const urlContext = getUrlPracticeContext();
      const [nextLessons, nextVoices, nextChildren] = await Promise.all([fetchLessons(), fetchTtsVoices(), fetchChildren()]);
      const childId = urlContext.childId || getDeviceChildId() || nextChildren[0]?.id || "";
      const nextChild = nextChildren.find((child) => child.id === childId) || nextChildren[0] || null;
      const nextProgress = await fetchProgress(nextChild?.id);
      const urlLesson = nextLessons.find((item) => item.id === urlContext.lessonId);
      const defaultTask = urlLesson ? undefined : findTopPracticeTask(nextChild, nextLessons, nextProgress);
      const nextLesson = urlLesson || defaultTask?.lesson;
      const nextPracticeItemId = urlLesson
        ? findPracticeItemId(nextChild, nextLesson?.id || "", urlContext.practiceItemId || getDevicePracticeItemId())
        : defaultTask?.practiceItemId || "";
      let nextActiveChild = nextChild;

      if (!urlLesson && defaultTask?.status === "pending" && nextChild) {
        try {
          nextActiveChild = await updatePracticeBookItem(nextChild.id, defaultTask.practiceItemId, { status: "in_progress" });
        } catch {
          nextActiveChild = nextChild;
        }
      }

      setLessons(nextLessons);
      setActiveChild(nextActiveChild);
      setChildProgress(nextProgress);
      setActiveLessonId(nextLesson?.id || "");
      setActivePracticeItemId(nextPracticeItemId);
      const nextPracticeBookId =
        defaultTask?.practiceBookId ||
        nextActiveChild?.practiceBooks.find((book) => book.items.some((item) => item.id === nextPracticeItemId))?.id ||
        "";
      const readingPosition = getLessonReadingPosition(nextLesson, nextProgress);
      const currentSentenceId = nextLesson?.sentences[readingPosition.sentenceIndex]?.id || "";
      const currentChapter = nextLesson
        ? getNavigatorChapters(nextLesson).find((chapter) => chapter.sentences.some((sentence) => sentence.id === currentSentenceId))
        : undefined;
      const currentSection = currentChapter
        ? getNavigatorSections(currentChapter).find((section) => section.sentences.some((sentence) => sentence.id === currentSentenceId))
        : undefined;
      setExpandedPracticeBookId(nextPracticeBookId);
      setExpandedPracticeCourseIds(nextPracticeItemId ? [nextPracticeItemId] : []);
      setExpandedPracticeChapterIds(currentChapter ? [currentChapter.id] : []);
      setExpandedPracticeSectionIds(currentSection ? [currentSection.id] : []);
      setTtsVoices(nextVoices.voices);
      setSelectedVoiceId(nextVoices.defaultVoiceId || nextVoices.voices[0]?.id || "");
      restoreLessonProgress(nextLesson, nextProgress);

      if (nextActiveChild && nextLesson) {
        storeDevicePracticeContext(nextActiveChild.id, nextLesson.id, nextPracticeItemId);
      } else if (nextActiveChild) {
        storeDevicePracticeContext(nextActiveChild.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.scoreError);
    } finally {
      setIsLoading(false);
    }
  }

  function clearRecordingTimers() {
    for (const timerRef of [recordingAutoStopTimeoutRef, recordingNoSpeechTimeoutRef, recordingMaxTimeoutRef]) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }

  async function retryMicrophoneAccess() {
    setMicrophoneAccessState("checking");
    const state = await preflightMicrophoneAccess(true);
    setMicrophoneAccessState(state);
  }

  function markMicrophoneFailure(error: unknown) {
    const name = error instanceof Error ? error.name : "";
    setMicrophoneAccessState(
      name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError" ? "denied" : "unavailable"
    );
  }

  function cancelLiveSpeechTestSession() {
    liveSpeechTestSessionRef.current?.cancel();
    liveSpeechTestSessionRef.current = null;
    liveSpeechTestRunIdRef.current = "";
    liveSpeechTestCaptureActiveRef.current = false;
    liveSpeechTestEndRequestedAtRef.current = 0;
    liveSpeechTestPendingAudioRef.current = [];
    liveSpeechTestPendingAudioMsRef.current = 0;
  }

  function startLiveSpeechTestCapture() {
    if (!isLiveSpeechPreferred || !liveSpeechTestRunIdRef.current) return;
    liveSpeechTestCaptureActiveRef.current = true;
    liveSpeechTestEndRequestedAtRef.current = 0;
    const session = liveSpeechTestSessionRef.current;
    if (!session) return;
    session.open();
  }

  function finishLiveSpeechTestCapture() {
    if (!isLiveSpeechPreferred || !liveSpeechTestCaptureActiveRef.current) return;
    liveSpeechTestCaptureActiveRef.current = false;
    const runId = liveSpeechTestRunIdRef.current;
    const session = liveSpeechTestSessionRef.current;
    liveSpeechTestEndRequestedAtRef.current = performance.now();
    if (!runId || !session) {
      liveSpeechTestPendingAudioRef.current = [];
      liveSpeechTestPendingAudioMsRef.current = 0;
      return;
    }
    session.finish();
  }

  async function cancelGuidedPractice() {
    clearRecordingTimers();
    stopReferenceAudio();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    cancelLiveSpeechTestSession();
    setIsRecording(false);
    setGuidedPracticePhase("idle");
    if (recorder && !stopRecordingInFlightRef.current) {
      await recorder.cancel();
    }
  }

  function clearAutomaticPracticeTimeout() {
    if (automaticPracticeTimeoutRef.current !== null) {
      window.clearTimeout(automaticPracticeTimeoutRef.current);
      automaticPracticeTimeoutRef.current = null;
    }
  }

  async function acquireAutomaticPracticeWakeLock() {
    const requestId = screenWakeLockRequestRef.current + 1;
    screenWakeLockRequestRef.current = requestId;
    const handle = await requestScreenWakeLock();
    if (!handle) return;
    if (!automaticPracticeActiveRef.current || screenWakeLockRequestRef.current !== requestId) {
      await releaseScreenWakeLock(handle);
      return;
    }
    await releaseScreenWakeLock(screenWakeLockRef.current);
    screenWakeLockRef.current = handle;
  }

  function releaseAutomaticPracticeWakeLock() {
    screenWakeLockRequestRef.current += 1;
    const handle = screenWakeLockRef.current;
    screenWakeLockRef.current = null;
    void releaseScreenWakeLock(handle);
  }

  function finishAutomaticSessionRecord(stopReason: AutomaticPracticeSession["stopReason"]) {
    const sessionId = automaticSessionRecordIdRef.current;
    const childId = activeChild?.id;
    const sentenceId = sentence?.id;
    if (!sessionId || !childId || !sentenceId || !stopReason) return;
    const startPromise = automaticSessionStartPromiseRef.current;
    automaticSessionRecordIdRef.current = "";
    automaticSessionStartPromiseRef.current = null;
    void (async () => {
      if (startPromise && !(await startPromise)) return;
      try {
        await finishAutomaticPracticeSession(sessionId, {
          childId,
          sentenceId,
          stopReason,
          noSpeechCount: automaticNoSpeechCountRef.current,
          failedAttemptCount: automaticFailedAttemptCountRef.current
        });
      } catch {
        // Session diagnostics must never interrupt the child's reading flow.
      }
    })();
  }

  function deactivateAutomaticPractice(
    message = "",
    tone: NonNullable<AutomaticPracticeNotice>["tone"] = "warn",
    stopReason: AutomaticPracticeSession["stopReason"] = "navigation"
  ) {
    const wasActive = automaticPracticeActiveRef.current;
    automaticPracticeActiveRef.current = false;
    if (wasActive) finishAutomaticSessionRecord(stopReason);
    automaticPracticeSessionRef.current += 1;
    releaseAutomaticPracticeWakeLock();
    clearAutomaticPracticeTimeout();
    setIsAutomaticPracticeActive(false);
    setAutomaticPracticePendingAction(null);
    setAutomaticPracticeNotice(message ? { message, tone } : null);
    if (message) setError("");
  }

  async function stopAutomaticPractice(
    message = "",
    tone: NonNullable<AutomaticPracticeNotice>["tone"] = "warn",
    stopReason: AutomaticPracticeSession["stopReason"] = "manual"
  ) {
    deactivateAutomaticPractice(message, tone, stopReason);
    await cancelGuidedPractice();
  }

  function resetAutomaticAttemptCounters(nextSentenceId: string) {
    automaticAttemptSentenceIdRef.current = nextSentenceId;
    automaticFailedAttemptCountRef.current = 0;
    setAutomaticFailedAttemptCount(0);
  }

  function startAutomaticPractice() {
    if (
      !sentence ||
      currentSelectionCompleted ||
      !microphoneReady ||
      guidedPracticePhase !== "idle" ||
      stopRecordingInFlightRef.current
    ) return;
    automaticPracticeSessionRef.current += 1;
    automaticPracticeActiveRef.current = true;
    automaticNoSpeechCountRef.current = 0;
    setAutomaticNoSpeechCount(0);
    resetAutomaticAttemptCounters(sentence.id);
    setIsAutomaticPracticeActive(true);
    setAutomaticPracticePendingAction(null);
    setAutomaticPracticeNotice(null);
    const sessionId = `automatic-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    automaticSessionRecordIdRef.current = sessionId;
    automaticSessionStartPromiseRef.current = createAutomaticPracticeSession({
      id: sessionId,
      childId: activeChild?.id || "",
      lessonId: lesson?.id || "",
      sentenceId: sentence.id
    })
      .then(() => true)
      .catch(() => false);
    void acquireAutomaticPracticeWakeLock();
    void startRecording();
  }

  function getExpectedVoiceDurationMs(currentSentence: Sentence) {
    const wordCount = currentSentence.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length || 1;
    return Math.max(520, wordCount * 190);
  }

  function scheduleAutomaticStop(segments: SpeechSegmentSummary[]) {
    if (!lesson || !sentence || stopRecordingInFlightRef.current) return;
    if (recordingAutoStopTimeoutRef.current !== null) {
      window.clearTimeout(recordingAutoStopTimeoutRef.current);
    }
    const expectedVoiceDurationMs = getExpectedVoiceDurationMs(sentence);
    const stopDelayMs = getAutomaticRecordingStopDelayMs({
      isWordItem: isWordPracticeItem(lesson, sentence),
      segments,
      expectedVoiceDurationMs
    });
    recordingAutoStopTimeoutRef.current = window.setTimeout(
      () => {
        recordingAutoStopTimeoutRef.current = null;
        void stopRecording({ recorderTailMs: isWordPracticeItem(lesson, sentence) ? 0 : undefined });
      },
      stopDelayMs
    );
  }

  async function startRecording() {
    if (!sentence || !microphoneReady || guidedPracticePhase !== "idle" || stopRecordingInFlightRef.current) return;
    setError("");
    setAttempt(null);
    setAttemptSource(null);
    stopAttemptAudio();
    stopReferenceAudio();
    clearRecordingTimers();
    cancelLiveSpeechTestSession();
    setGuidedPracticePhase("listening");

    const wordItem = Boolean(lesson && isWordPracticeItem(lesson, sentence));
    const liveSpeechTestRunId = isLiveSpeechPreferred && activeChild?.id && lesson
      ? `live-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
      : "";
    if (liveSpeechTestRunId) {
      liveSpeechTestRunIdRef.current = liveSpeechTestRunId;
    }
    const recorder = new WavRecorder({
      vadRedemptionMs: wordItem ? 650 : 900,
      onAudioChunk: (samples, inputSampleRate) => {
        const session = liveSpeechTestSessionRef.current;
        if (session) {
          session.sendAudio(samples, inputSampleRate);
          return;
        }
        if (!liveSpeechTestCaptureActiveRef.current || !liveSpeechTestRunIdRef.current) return;
        const durationMs = samples.length / inputSampleRate * 1000;
        if (liveSpeechTestPendingAudioMsRef.current + durationMs > 2000) return;
        liveSpeechTestPendingAudioRef.current.push({ samples: new Float32Array(samples), inputSampleRate });
        liveSpeechTestPendingAudioMsRef.current += durationMs;
      },
      onSpeechStart: () => {
        if (recordingAutoStopTimeoutRef.current !== null) {
          window.clearTimeout(recordingAutoStopTimeoutRef.current);
          recordingAutoStopTimeoutRef.current = null;
        }
        if (recordingNoSpeechTimeoutRef.current !== null) {
          window.clearTimeout(recordingNoSpeechTimeoutRef.current);
          recordingNoSpeechTimeoutRef.current = null;
        }
        setGuidedPracticePhase("speaking");
      },
      onSpeechEnd: (_segment, segments) => {
        setGuidedPracticePhase("waiting");
        scheduleAutomaticStop(segments);
      },
      onVADMisfire: () => {
        setGuidedPracticePhase("waiting");
      }
    });
    recorderRef.current = recorder;
    if (liveSpeechTestRunId && activeChild?.id && lesson) {
      void prepareLiveSpeechSession({
        runId: liveSpeechTestRunId,
        childId: activeChild.id,
        sentenceId: sentence.id,
        referenceText: sentence.text,
        itemType: wordItem ? "word" : sentence.itemType === "reading" ? "paragraph" : "sentence",
        onProgress: (progress) => {
          if (liveSpeechTestRunIdRef.current !== liveSpeechTestRunId) return;
          const receivedAtMs = performance.now();
          const finalResult = getLiveSpeechTestFinalResult({
            final: progress.final,
            suggestedScore: progress.suggestedScore,
            completion: progress.completion,
            wordCount: progress.words.length,
            endRequestedAtMs: liveSpeechTestEndRequestedAtRef.current,
            receivedAtMs
          });
          if (!finalResult) return;
          liveSpeechTestSessionRef.current = null;
        },
        onUnavailable: () => {
          if (liveSpeechTestRunIdRef.current !== liveSpeechTestRunId) return;
          liveSpeechTestSessionRef.current = null;
        }
      }).then((session) => {
        if (!session) {
          if (liveSpeechTestRunIdRef.current === liveSpeechTestRunId) {
            liveSpeechTestRunIdRef.current = "";
          }
          return;
        }
        if (
          liveSpeechTestRunIdRef.current !== liveSpeechTestRunId ||
          liveSpeechTestEndRequestedAtRef.current > 0
        ) {
          session.cancel();
          return;
        }
        liveSpeechTestSessionRef.current = session;
        if (liveSpeechTestCaptureActiveRef.current) {
          session.open();
          for (const audio of liveSpeechTestPendingAudioRef.current) {
            session.sendAudio(audio.samples, audio.inputSampleRate);
          }
          liveSpeechTestPendingAudioRef.current = [];
          liveSpeechTestPendingAudioMsRef.current = 0;
        }
      });
    }

    try {
      // Start audible playback from the tap first, then prepare the microphone
      // while the example is playing. Capture can begin at the ended event
      // without adding an artificial countdown or recording the example.
      const referenceCompleted = await prepareDuringPlayback(
        (onPlaybackStarted) => playReferenceAudio(onPlaybackStarted),
        () => recorder.prepare()
      );
      if (recorderRef.current !== recorder) {
        await recorder.cancel();
        return;
      }
      if (!referenceCompleted) {
        if (referencePlaybackFailureRef.current === "blocked") {
          setError("");
          setGuidedPracticePhase("audio-blocked");
          return;
        }
        await recorder.cancel();
        recorderRef.current = null;
        cancelLiveSpeechTestSession();
        setGuidedPracticePhase("idle");
        return;
      }
      startLiveSpeechTestCapture();
      await beginGuidedRecording(recorder);
    } catch (error) {
      clearRecordingTimers();
      await recorder.cancel();
      cancelLiveSpeechTestSession();
      if (recorderRef.current !== recorder) return;
      if (recorderRef.current === recorder) recorderRef.current = null;
      setIsRecording(false);
      setGuidedPracticePhase("idle");
      markMicrophoneFailure(error);
      setError(getPracticeIssue(error, "microphone", locale));
      if (automaticPracticeActiveRef.current) deactivateAutomaticPractice(t.automaticPracticeErrorStop, "bad", "service-error");
    }
  }

  async function beginGuidedRecording(recorder: WavRecorder) {
    if (!sentence || recorderRef.current !== recorder) return;
    await recorder.start();
    if (recorderRef.current !== recorder) {
      await recorder.cancel();
      return;
    }
    setIsRecording(true);
    setGuidedPracticePhase("waiting");

    recordingNoSpeechTimeoutRef.current = window.setTimeout(() => {
      recordingNoSpeechTimeoutRef.current = null;
      void stopRecording();
    }, 9000);
    const wordCount = sentence.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length || 1;
    recordingMaxTimeoutRef.current = window.setTimeout(
      () => {
        recordingMaxTimeoutRef.current = null;
        void stopRecording();
      },
      Math.min(32000, Math.max(12000, wordCount * 1800))
    );
  }

  async function resumeGuidedPracticeAfterAudioBlock() {
    const recorder = recorderRef.current;
    if (!recorder || guidedPracticePhase !== "audio-blocked") return;

    setError("");
    setGuidedPracticePhase("listening");
    try {
      const referenceCompleted = await prepareDuringPlayback(
        (onPlaybackStarted) => playReferenceAudio(onPlaybackStarted),
        () => recorder.prepare()
      );
      if (recorderRef.current !== recorder) {
        await recorder.cancel();
        return;
      }
      if (!referenceCompleted) {
        if (referencePlaybackFailureRef.current === "blocked") {
          setError("");
          setGuidedPracticePhase("audio-blocked");
          return;
        }
        await recorder.cancel();
        recorderRef.current = null;
        cancelLiveSpeechTestSession();
        setGuidedPracticePhase("idle");
        return;
      }
      startLiveSpeechTestCapture();
      await beginGuidedRecording(recorder);
    } catch (error) {
      clearRecordingTimers();
      await recorder.cancel();
      cancelLiveSpeechTestSession();
      if (recorderRef.current !== recorder) return;
      recorderRef.current = null;
      setIsRecording(false);
      setGuidedPracticePhase("idle");
      markMicrophoneFailure(error);
      setError(getPracticeIssue(error, "microphone", locale));
      if (automaticPracticeActiveRef.current) deactivateAutomaticPractice(t.automaticPracticeErrorStop, "bad", "service-error");
    }
  }

  function queueAutomaticRetry(currentSentence: Sentence) {
    setAutomaticPracticePendingAction({ kind: "retry", sentenceId: currentSentence.id });
  }

  function queueAutomaticNext(currentSentence: Sentence, currentSentenceIndex: number, currentLesson: Lesson) {
    const nextIndex = currentSentenceIndex + 1;
    const nextSentence = currentLesson.sentences[nextIndex];
    if (!nextSentence) {
      clearAutomaticPracticeTimeout();
      automaticPracticeTimeoutRef.current = window.setTimeout(() => {
        automaticPracticeTimeoutRef.current = null;
        if (automaticPracticeActiveRef.current) deactivateAutomaticPractice(t.automaticPracticeCompleted, "ok", "completed");
      }, 1700);
      return;
    }

    clearAutomaticPracticeTimeout();
    const sessionId = automaticPracticeSessionRef.current;
    automaticPracticeTimeoutRef.current = window.setTimeout(() => {
      automaticPracticeTimeoutRef.current = null;
      if (!automaticPracticeActiveRef.current || automaticPracticeSessionRef.current !== sessionId) return;
      resetAutomaticAttemptCounters(nextSentence.id);
      setAutomaticPracticePendingAction({ kind: "next", sentenceIndex: nextIndex, sentenceId: nextSentence.id });
      transitionToSentence(nextIndex, true);
    }, currentSentence.required === false ? 1900 : 1500);
  }

  function handleAutomaticNoSpeech(currentSentence: Sentence) {
    const outcome = decideAutomaticRecordingFailure({
      kind: "no-speech",
      noSpeechCount: automaticNoSpeechCountRef.current
    });
    automaticNoSpeechCountRef.current = outcome.noSpeechCount;
    setAutomaticNoSpeechCount(outcome.noSpeechCount);
    if (outcome.action === "stop-no-speech") {
      deactivateAutomaticPractice(t.automaticPracticeNoSpeechStop, "warn", "no-speech");
      return;
    }
    setError(formatMessage(t.automaticPracticeNoSpeechRetry, { count: outcome.noSpeechCount }));
    queueAutomaticRetry(currentSentence);
  }

  async function stopRecording({ recorderTailMs }: { recorderTailMs?: number } = {}) {
    if (!sentence || !recorderRef.current || stopRecordingInFlightRef.current) return;
    const scoredSentence = sentence;
    const scoredSentenceIndex = sentenceIndex;
    const scoredLesson = lesson;
    const automaticSessionId = automaticPracticeSessionRef.current;
    const liveSpeechTestRunId = liveSpeechTestSessionRef.current ? liveSpeechTestRunIdRef.current : "";
    stopRecordingInFlightRef.current = true;
    clearRecordingTimers();
    finishLiveSpeechTestCapture();
    setIsRecording(false);
    setIsScoring(true);
    setGuidedPracticePhase("scoring");

    try {
      const recording = await recorderRef.current.stop({ tailMs: recorderTailMs });
      const nextAttempt = await submitAttempt(scoredSentence, recording, activeChild?.id, {
        liveSpeechTestRunId: liveSpeechTestRunId || undefined
      });
      setAnimatedScore(0);
      setAttempt(nextAttempt);
      setAttemptSource("current");
      const completesCurrentItem =
        nextAttempt.passed || (scoredSentence.required === false && nextAttempt.result.SuggestedScore > 0);
      if (completesCurrentItem && scoredSentenceIndex === passedCount) {
        setPassedCount((value) => value + 1);
        if (
          scoredSentenceIndex === (scoredLesson?.sentences.length || 0) - 1 &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          setLessonCelebrationId(nextAttempt.id);
        }
      }
      if (activeChild?.id) {
        setChildProgress(await fetchProgress(activeChild.id));
      }
      if (automaticPracticeActiveRef.current && automaticPracticeSessionRef.current === automaticSessionId && scoredLesson) {
        const outcome = decideAutomaticScoreOutcome({
          passed: nextAttempt.passed,
          required: scoredSentence.required !== false,
          suggestedScore: nextAttempt.result.SuggestedScore,
          hasNext: scoredSentenceIndex < scoredLesson.sentences.length - 1,
          failedCount: automaticFailedAttemptCountRef.current
        });
        automaticNoSpeechCountRef.current = outcome.noSpeechCount;
        setAutomaticNoSpeechCount(outcome.noSpeechCount);
        automaticFailedAttemptCountRef.current = outcome.failedCount;
        setAutomaticFailedAttemptCount(outcome.failedCount);
        if (outcome.action === "next" || outcome.action === "complete") {
          resetAutomaticAttemptCounters(scoredSentence.id);
          queueAutomaticNext(scoredSentence, scoredSentenceIndex, scoredLesson);
        } else {
          deactivateAutomaticPractice(t.automaticPracticeFailureStop, "warn", "failed-attempts");
        }
      }
    } catch (err) {
      const automaticSessionIsCurrent =
        automaticPracticeActiveRef.current && automaticPracticeSessionRef.current === automaticSessionId;
      if (err instanceof RecordingQualityError) {
        setError(getPracticeIssue(err, "recording", locale));
        if (err.recording && activeChild?.id) {
          void submitRejectedAttemptDiagnostic({
            childId: activeChild.id,
            sentence: scoredSentence,
            recording: err.recording,
            rejectionCode: err.code,
            sourceType: "lesson",
            contentId: scoredLesson?.id,
            contentTitle: scoredLesson?.title
          }).catch((diagnosticError) => {
            console.warn("Unable to save rejected recording diagnostic.", diagnosticError);
          });
        }
        if (automaticSessionIsCurrent) {
          const failure = decideAutomaticRecordingFailure({
            kind: err.code === "capture-gap" ? "capture-gap" : "no-speech",
            noSpeechCount: automaticNoSpeechCountRef.current
          });
          if (failure.action === "stop-interrupted") deactivateAutomaticPractice(t.automaticPracticeInterrupted, "warn", "interrupted");
          else handleAutomaticNoSpeech(scoredSentence);
        }
      } else if (err instanceof AttemptSubmissionError && err.code === "NO_SPEECH_DETECTED") {
        setError(getPracticeIssue(err, "scoring", locale));
        if (automaticSessionIsCurrent) handleAutomaticNoSpeech(scoredSentence);
      } else if (err instanceof AttemptSubmissionError && err.code === "RECORDING_TOO_NOISY") {
        setError(getPracticeIssue(err, "scoring", locale));
        if (automaticSessionIsCurrent) handleAutomaticNoSpeech(scoredSentence);
      } else {
        setError(getPracticeIssue(err, "scoring", locale));
        if (automaticSessionIsCurrent) deactivateAutomaticPractice(t.automaticPracticeErrorStop, "bad", "service-error");
      }
    } finally {
      setIsScoring(false);
      setGuidedPracticePhase("idle");
      recorderRef.current = null;
      stopRecordingInFlightRef.current = false;
    }
  }

  function retry() {
    stopAttemptAudio();
    setAttempt(null);
    setAttemptSource(null);
    setError("");
  }

  function stopAttemptAudio() {
    if (attemptAudioRef.current) {
      attemptAudioRef.current.pause();
      attemptAudioRef.current.currentTime = 0;
      attemptAudioRef.current = null;
    }
    setPlayingAttemptAudioId("");
  }

  async function playAttemptAudio(variant: "enhanced" | "raw" = "enhanced") {
    if (!attempt?.audioAvailable || !activeChild?.id || isRecording || isScoring) return;
    if (variant === "raw" && !attempt.rawAudioAvailable) return;
    const playbackKey = `${attempt.id}:${variant}`;
    if (playingAttemptAudioId === playbackKey) {
      stopAttemptAudio();
      return;
    }

    setError("");
    stopReferenceAudio();
    stopAttemptAudio();

    const audio = new Audio(getAttemptAudioUrl(attempt.id, activeChild.id, variant));
    attemptAudioRef.current = audio;
    setPlayingAttemptAudioId(playbackKey);
    audio.addEventListener("ended", () => {
      if (attemptAudioRef.current === audio) attemptAudioRef.current = null;
      setPlayingAttemptAudioId("");
    });
    audio.addEventListener("error", () => {
      if (attemptAudioRef.current === audio) attemptAudioRef.current = null;
      setPlayingAttemptAudioId("");
      setError(t.attemptAudioError);
    });

    try {
      await audio.play();
    } catch {
      if (attemptAudioRef.current === audio) attemptAudioRef.current = null;
      setPlayingAttemptAudioId("");
      setError(t.attemptAudioError);
    }
  }

  function stopReferenceAudio(clearState = true) {
    referencePlaybackRunRef.current += 1;
    if (isFilingReviewSandbox && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (referencePlaybackResolverRef.current) {
      const resolvePlayback = referencePlaybackResolverRef.current;
      referencePlaybackResolverRef.current = null;
      resolvePlayback(false);
    }
    cancelReferenceAudioFrame();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
    }
    if (clearState) {
      setPlayingSentenceId("");
      setReferenceAudioProgress(0);
      setReferenceAudioTimeMs(0);
      setReferenceSubtitles([]);
    }
  }

  function cancelReferenceAudioFrame() {
    if (audioFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
  }

  function trackReferenceAudioProgress(audio: HTMLAudioElement) {
    const tick = () => {
      if (audioRef.current !== audio) return;

      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      setReferenceAudioProgress(duration ? Math.min(1, Math.max(0, audio.currentTime / duration)) : 0);
      setReferenceAudioTimeMs(audio.currentTime * 1000);

      if (!audio.paused && !audio.ended) {
        audioFrameRef.current = window.requestAnimationFrame(tick);
      }
    };

    cancelReferenceAudioFrame();
    audioFrameRef.current = window.requestAnimationFrame(tick);
  }

  async function playReferenceAudio(onPlaybackStarted?: () => void): Promise<boolean> {
    if (!sentence || !selectedVoiceId || isRecording || isScoring) return false;

    setError("");
    stopAttemptAudio();
    stopReferenceAudio();
    referencePlaybackFailureRef.current = null;
    const playbackRun = referencePlaybackRunRef.current;

    const currentSentence = sentence;
    const currentVoiceId = selectedVoiceId;
    let playbackStarted = false;
    const signalPlaybackStarted = () => {
      if (playbackStarted) return;
      playbackStarted = true;
      onPlaybackStarted?.();
    };
    const subtitlesPromise = fetchReferenceSubtitles(currentSentence, currentVoiceId)
      .then((response) => response.subtitles || [])
      .catch(() => [] as TtsSubtitle[]);

    // Keep the element unlocked by the child's first tap. WebKit can block a
    // later automatic clip when each sentence creates a new Audio element.
    const audio = prepareSequentialAudio(
      audioRef.current,
      getReferenceAudioUrl(currentSentence, currentVoiceId),
      () => new Audio()
    );
    let settlePlayback: (completed: boolean) => void = () => undefined;
    const playbackCompleted = new Promise<boolean>((resolve) => {
      let settled = false;
      settlePlayback = (completed) => {
        if (settled) return;
        settled = true;
        if (referencePlaybackResolverRef.current === settlePlayback) {
          referencePlaybackResolverRef.current = null;
        }
        resolve(completed);
      };
    });
    referencePlaybackResolverRef.current = settlePlayback;
    let reviewFallbackStarted = false;
    const startReviewDeviceVoice = () => {
      if (!isFilingReviewSandbox || reviewFallbackStarted || !("speechSynthesis" in window)) return false;
      reviewFallbackStarted = true;
      const voiceConfig = ttsVoices.find((voice) => voice.id === currentVoiceId);
      const englishVoices = window.speechSynthesis.getVoices().filter((voice) => /^en(?:-|_)/i.test(voice.lang));
      const preferredPattern =
        currentVoiceId === "501008"
          ? /david|mark|guy|george|james|male/i
          : currentVoiceId === "502007"
            ? /child|kid|zira|samantha|female/i
            : currentVoiceId === "602003"
              ? /jenny|aria|sonia|ava|natural|zira/i
              : /zira|samantha|susan|hazel|female/i;
      const matchingVoice = englishVoices.find((voice) => preferredPattern.test(voice.name));
      const configuredIndex = Math.max(0, ttsVoices.findIndex((voice) => voice.id === currentVoiceId));
      const utterance = new SpeechSynthesisUtterance(currentSentence.text);
      utterance.lang = matchingVoice?.lang || "en-US";
      utterance.voice = matchingVoice || englishVoices[configuredIndex % Math.max(englishVoices.length, 1)] || null;
      utterance.rate = currentVoiceId === "502007" ? 0.92 : currentVoiceId === "501008" ? 0.82 : 0.86;
      utterance.pitch = currentVoiceId === "502007" ? 1.22 : currentVoiceId === "501008" ? 0.86 : currentVoiceId === "602003" ? 1.08 : 1;
      console.info(`[tts-review-fallback] selected=${voiceConfig?.name || currentVoiceId} deviceVoice=${utterance.voice?.name || "default"}`);
      setError("");
      setPlayingSentenceId(currentSentence.id);
      utterance.onend = () => {
        if (referencePlaybackRunRef.current !== playbackRun) return;
        setPlayingSentenceId("");
        setReferenceAudioProgress(0);
        setReferenceAudioTimeMs(0);
        settlePlayback(true);
      };
      utterance.onerror = () => {
        if (referencePlaybackRunRef.current !== playbackRun) return;
        setPlayingSentenceId("");
        setError(getPracticeIssue({ code: "TTS_FAILED" }, "tts", locale));
        settlePlayback(false);
      };
      signalPlaybackStarted();
      window.speechSynthesis.speak(utterance);
      return true;
    };
    audioRef.current = audio;
    setPlayingSentenceId(currentSentence.id);
    setReferenceAudioProgress(0);
    setReferenceAudioTimeMs(0);
    setReferenceSubtitles([]);
    audio.onended = () => {
      if (referencePlaybackRunRef.current !== playbackRun) return;
      cancelReferenceAudioFrame();
      setPlayingSentenceId("");
      setReferenceAudioProgress(0);
      setReferenceAudioTimeMs(0);
      settlePlayback(true);
    };
    audio.onerror = () => {
      if (referencePlaybackRunRef.current !== playbackRun) return;
      cancelReferenceAudioFrame();
      setPlayingSentenceId("");
      setReferenceAudioProgress(0);
      setReferenceAudioTimeMs(0);
      setReferenceSubtitles([]);
      if (reviewFallbackStarted || startReviewDeviceVoice()) return;
      referencePlaybackFailureRef.current = "failed";
      setError(getPracticeIssue({ code: "TTS_FAILED" }, "tts", locale));
      settlePlayback(false);
    };

    try {
      await audio.play();
      if (referencePlaybackRunRef.current !== playbackRun) return playbackCompleted;
      signalPlaybackStarted();
      trackReferenceAudioProgress(audio);
      void subtitlesPromise.then((subtitles) => {
        if (audioRef.current !== audio || referencePlaybackRunRef.current !== playbackRun) return;
        console.info(
          `[tts-subtitles] voice=${currentVoiceId} sentence=${currentSentence.id} subtitles=${subtitles.length} mode=${subtitles.length > 0 ? "timed" : "fallback"}`
        );
        setReferenceSubtitles(subtitles);
      });
    } catch (error) {
      if (referencePlaybackRunRef.current !== playbackRun) return playbackCompleted;
      cancelReferenceAudioFrame();
      audio.pause();
      setPlayingSentenceId("");
      setReferenceAudioProgress(0);
      setReferenceAudioTimeMs(0);
      setReferenceSubtitles([]);
      const wasBlocked = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      if (!wasBlocked && (reviewFallbackStarted || startReviewDeviceVoice())) return playbackCompleted;
      referencePlaybackFailureRef.current = wasBlocked ? "blocked" : "failed";
      setError(getPracticeIssue(wasBlocked ? { name: "NotAllowedError", code: "AUDIO_BLOCKED" } : error, "tts", locale));
      settlePlayback(false);
    }
    return playbackCompleted;
  }

  function nextSentence() {
    if (!canGoNext) return;
    transitionToSentence(sentenceIndex + 1);
  }

  function transitionToSentence(nextIndex: number, preserveAutomaticPractice = false) {
    if (nextIndex === sentenceIndex || isSentenceChanging) return;
    if (!preserveAutomaticPractice) deactivateAutomaticPractice();
    void cancelGuidedPractice();
    stopAttemptAudio();

    const commitTransition = () => {
      setSentenceIndex(nextIndex);
      setAttempt(null);
      setAttemptSource(null);
      setError("");
      setIsSentenceChanging(false);
      sentenceTransitionTimeoutRef.current = null;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      commitTransition();
      return;
    }

    const documentWithTransitions = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (documentWithTransitions.startViewTransition) {
      documentWithTransitions.startViewTransition(() => {
        flushSync(commitTransition);
      });
      return;
    }

    setIsSentenceChanging(true);
    sentenceTransitionTimeoutRef.current = window.setTimeout(commitTransition, 140);
  }

  function openParentConsole() {
    deactivateAutomaticPractice();
    void cancelGuidedPractice();
    if (activeChild) {
      storeDevicePracticeContext(activeChild.id);
      window.location.href = `/parent?childId=${encodeURIComponent(activeChild.id)}`;
      return;
    }

    window.location.href = "/parent";
  }

  function openPracticeBook() {
    deactivateAutomaticPractice();
    void cancelGuidedPractice();
    stopAttemptAudio();
    setActiveLessonId("");
    setActivePracticeItemId("");
    setSentenceIndex(0);
    setPassedCount(0);
    setAttempt(null);
    setAttemptSource(null);
    setError("");
    if (activeChild) {
      storeDevicePracticeContext(activeChild.id);
      window.history.replaceState(null, "", `/practice?childId=${encodeURIComponent(activeChild.id)}${isFilingReviewSandbox ? "&review=1" : ""}`);
    }
  }

  async function startLesson(nextLesson: Lesson, practiceItemId = "", preferredSentenceId = "") {
    if (!activeChild) return;
    deactivateAutomaticPractice();
    await cancelGuidedPractice();
    stopAttemptAudio();
    const nextPracticeItemId = practiceItemId || findPracticeItemId(activeChild, nextLesson.id);
    setActiveLessonId(nextLesson.id);
    setActivePracticeItemId(nextPracticeItemId);
    setAttempt(null);
    setAttemptSource(null);
    setError("");
    restoreLessonProgress(nextLesson, childProgress, preferredSentenceId);
    storeDevicePracticeContext(activeChild.id, nextLesson.id, nextPracticeItemId);
    window.history.replaceState(
      null,
      "",
      `/practice?childId=${encodeURIComponent(activeChild.id)}&lessonId=${encodeURIComponent(nextLesson.id)}${
        nextPracticeItemId ? `&itemId=${encodeURIComponent(nextPracticeItemId)}` : ""
      }${isFilingReviewSandbox ? "&review=1" : ""}`
    );

    const activePracticeItem = activeChild.practiceBooks.flatMap((book) => book.items).find((item) => item.id === nextPracticeItemId);
    if (!nextPracticeItemId || activePracticeItem?.status === "completed") return;

    try {
      const child = await updatePracticeBookItem(activeChild.id, nextPracticeItemId, { status: "in_progress" });
      setActiveChild(child);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.scoreError);
    }
  }

  async function selectPracticeSentence(
    nextLesson: Lesson,
    practiceItemId: string,
    practiceBookId: string,
    chapterId: string,
    sectionId: string,
    sentenceId: string
  ) {
    setExpandedPracticeBookId(practiceBookId);
    setExpandedPracticeCourseIds((ids) => (ids.includes(practiceItemId) ? ids : [...ids, practiceItemId]));
    setExpandedPracticeChapterIds((ids) => (ids.includes(chapterId) ? ids : [...ids, chapterId]));
    setExpandedPracticeSectionIds((ids) => (ids.includes(sectionId) ? ids : [...ids, sectionId]));
    await startLesson(nextLesson, practiceItemId, sentenceId);
  }

  async function completeLessonAndOpenPracticeBook() {
    if (!activeChild) {
      openPracticeBook();
      return;
    }

    try {
      if (activePracticeItemId) {
        await updatePracticeBookItem(activeChild.id, activePracticeItemId, { status: "completed" });
      }
      storeDevicePracticeContext(activeChild.id);
      window.history.replaceState(null, "", `/practice?childId=${encodeURIComponent(activeChild.id)}${isFilingReviewSandbox ? "&review=1" : ""}`);
      await loadPracticeContext();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.scoreError);
    }
  }

  function restoreLessonProgress(nextLesson: Lesson | undefined, nextProgress: LessonProgress[], preferredSentenceId = "") {
    const readingPosition = getLessonReadingPosition(nextLesson, nextProgress);
    const preferredSentenceIndex = nextLesson?.sentences.findIndex((sentence) => sentence.id === preferredSentenceId) ?? -1;
    const sentenceIndex = preferredSentenceIndex >= 0 ? preferredSentenceIndex : readingPosition.sentenceIndex;

    setPassedCount(readingPosition.passedCount);
    setSentenceIndex(sentenceIndex);
  }

  function renderPracticeNavigator() {
    return (
      <aside className="child-left-rail" ref={practiceNavigatorRef}>
        <section className="practice-books-card merged-practice-card">
          <div className="child-panel-title">
            <BookOpen size={18} />
            <strong>{t.practiceBookTitle}</strong>
          </div>

          <div className="task-status-tabs compact-status-tabs">
            <span>
              {t.practiceTodo} <strong>{practiceTaskStats.pending}</strong>
            </span>
            <span>
              {t.practiceInProgress} <strong>{practiceTaskStats.inProgress}</strong>
            </span>
            <span>
              {t.practiceDone} <strong>{practiceTaskStats.completed}</strong>
            </span>
          </div>

          <div className="practice-book-tree">
            {practiceBookSections.map(({ book, rows }, index) => {
              const isOpen = book.id === openPracticeBookId;
              const isSelected = rows.some(
                ({ item, lesson: itemLesson }) =>
                  item.id === activePracticeItemId || (!activePracticeItemId && itemLesson?.id === activeLessonId)
              );
              const bookDone = rows.filter((row) => row.displayStatus === "completed").length;
              const bookProgress = rows.length ? Math.round((bookDone / rows.length) * 100) : 0;
              return (
                <section className={`practice-book-tree-section ${isOpen ? "open" : ""} ${isSelected ? "selected" : ""}`} key={book.id}>
                  <button
                    aria-current={isSelected ? "true" : undefined}
                    aria-expanded={isOpen}
                    className={`practice-book-mini ${isOpen ? "expanded" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => setExpandedPracticeBookId((currentId) => (currentId === book.id ? "" : book.id))}
                    type="button"
                  >
                    <span className="book-cover ui-book-cover">{index + 1}</span>
                    <strong>{book.title}</strong>
                    <ProgressBar value={bookProgress} />
                    <em>
                      {bookDone} / {rows.length}
                    </em>
                    <ChevronDown className="book-expand-icon" size={18} />
                  </button>

                  {isOpen && (
                    <div className="practice-book-lesson-list">
                      {rows.map(({ item, lesson: itemLesson, progress: itemProgress, progressPercent, displayStatus }) => {
                        if (!itemLesson) return null;
                        const isSelected = item.id === activePracticeItemId || (!activePracticeItemId && itemLesson.id === activeLessonId);
                        const isCourseOpen = expandedPracticeCourseIds.includes(item.id);
                        const lessonReadingPosition = getLessonReadingPosition(itemLesson, childProgress);
                        return (
                          <section
                            className={`practice-course-tree-node ${isCourseOpen ? "open" : ""} ${isSelected ? "selected" : ""}`}
                            key={item.id}
                          >
                            <button
                              aria-expanded={isCourseOpen}
                              aria-current={isSelected ? "true" : undefined}
                              className={`task-preview-row ${displayStatus} ${isSelected ? "active selected" : ""}`}
                              onClick={() => {
                                setExpandedPracticeCourseIds((ids) => toggleExpandedId(ids, item.id));
                                void startLesson(itemLesson, item.id);
                              }}
                              type="button"
                              title={itemLesson.title || item.lessonTitle}
                            >
                              <span className="task-thumb">{itemLesson.title.slice(0, 1) || item.lessonTitle.slice(0, 1)}</span>
                              <div>
                                <strong>{itemLesson.title || item.lessonTitle}</strong>
                                <small>{getPracticeStatusLabel(displayStatus)}</small>
                                <ProgressBar value={progressPercent} />
                              </div>
                              <em>
                                {itemProgress?.passedCount || 0}/{itemProgress?.totalCount || itemLesson.sentences.length || 0}
                              </em>
                              <ChevronRight className="practice-tree-chevron" size={18} />
                            </button>

                            {isCourseOpen && (
                              <div className="practice-course-outline">
                                {getNavigatorChapters(itemLesson).map((chapter, chapterIndex) => {
                                  const isChapterOpen = expandedPracticeChapterIds.includes(chapter.id);
                                  const chapterPassed = getPassedSentenceCount(chapter.sentences, itemProgress);
                                  const currentLessonSentenceId =
                                    itemLesson.id === activeLessonId ? itemLesson.sentences[sentenceIndex]?.id || "" : "";
                                  const isCurrentChapter = chapter.sentences.some(
                                    (chapterSentence) => chapterSentence.id === currentLessonSentenceId
                                  );
                                  return (
                                    <section className={`practice-chapter-node ${isChapterOpen ? "open" : ""}`} key={chapter.id}>
                                      <button
                                        aria-current={isCurrentChapter ? "true" : undefined}
                                        aria-expanded={isChapterOpen}
                                        className={`practice-chapter-toggle ${isCurrentChapter ? "active selected" : ""}`}
                                        onClick={() => setExpandedPracticeChapterIds((ids) => toggleExpandedId(ids, chapter.id))}
                                        type="button"
                                        title={chapter.title}
                                      >
                                        <span className="practice-chapter-index">{chapterIndex + 1}</span>
                                        <span className="practice-tree-copy">
                                          <strong>{chapter.title}</strong>
                                          <small>
                                            {chapterPassed}/{chapter.sentences.length} {t.sentence}
                                          </small>
                                        </span>
                                        <ChevronRight className="practice-tree-chevron" size={16} />
                                      </button>

                                      {isChapterOpen && (
                                        <div className="practice-section-tree">
                                          {getNavigatorSections(chapter).map((section) => {
                                            const isSectionOpen = expandedPracticeSectionIds.includes(section.id);
                                            const sectionPassed = getPassedSentenceCount(section.sentences, itemProgress);
                                            const partLabel = getSectionPartLabel(section);
                                            const isCurrentSection = section.sentences.some(
                                              (sectionSentence) => sectionSentence.id === currentLessonSentenceId
                                            );
                                            const sectionTargetSentence =
                                              section.sentences.find((sectionSentence) => {
                                                const sentenceProgress = itemProgress?.sentences.find(
                                                  (progressItem) => progressItem.sentenceId === sectionSentence.id
                                                );
                                                return !(sentenceProgress?.completed ?? sentenceProgress?.passed);
                                              }) || section.sentences[0];
                                            return (
                                              <section className={`practice-section-node ${isSectionOpen ? "open" : ""}`} key={section.id}>
                                                <button
                                                  aria-current={isCurrentSection ? "true" : undefined}
                                                  aria-expanded={isSectionOpen}
                                                  className={`practice-section-toggle ${isCurrentSection ? "active selected" : ""}`}
                                                  onClick={() => {
                                                    setExpandedPracticeSectionIds((ids) => toggleExpandedId(ids, section.id));
                                                    if (sectionTargetSentence) {
                                                      void selectPracticeSentence(
                                                        itemLesson,
                                                        item.id,
                                                        book.id,
                                                        chapter.id,
                                                        section.id,
                                                        sectionTargetSentence.id
                                                      );
                                                    }
                                                  }}
                                                  type="button"
                                                  title={[partLabel, section.title, section.focusQuestion].filter(Boolean).join(" · ")}
                                                >
                                                  <span className="practice-section-heading">
                                                    <span className="practice-section-label-row">
                                                      {partLabel && <i>{partLabel}</i>}
                                                      <strong>{section.title || t.sentence}</strong>
                                                    </span>
                                                    {section.focusQuestion && <small>{section.focusQuestion}</small>}
                                                  </span>
                                                  <em>
                                                    {sectionPassed}/{section.sentences.length}
                                                  </em>
                                                  <ChevronRight className="practice-tree-chevron" size={15} />
                                                </button>

                                                {isSectionOpen && (
                                                  <div className="practice-sentence-tree">
                                                    {section.sentences.map((sectionSentence) => {
                                                      const lessonSentenceIndex = itemLesson.sentences.findIndex(
                                                        (lessonSentence) => lessonSentence.id === sectionSentence.id
                                                      );
                                                      if (lessonSentenceIndex < 0) return null;
                                                      const sentenceProgress = itemProgress?.sentences.find(
                                                        (progressItem) => progressItem.sentenceId === sectionSentence.id
                                                      );
                                                      const isCompleted = Boolean(sentenceProgress?.completed ?? sentenceProgress?.passed);
                                                      const isOptional = sectionSentence.required === false;
                                                      const isCurrentSentence =
                                                        itemLesson.id === activeLessonId && lessonSentenceIndex === sentenceIndex;
                                                      const isUnlocked = lessonSentenceIndex <= lessonReadingPosition.passedCount || isCurrentSentence;
                                                      return (
                                                        <button
                                                          className={`practice-sentence-tree-item ${isCompleted ? "done" : ""} ${isOptional ? "optional" : ""} ${
                                                            isCurrentSentence ? "active selected" : ""
                                                          }`}
                                                          disabled={!isUnlocked}
                                                          aria-current={isCurrentSentence ? "true" : undefined}
                                                          key={sectionSentence.id}
                                                          onClick={() =>
                                                            selectPracticeSentence(
                                                              itemLesson,
                                                              item.id,
                                                              book.id,
                                                              chapter.id,
                                                              section.id,
                                                              sectionSentence.id
                                                            )
                                                          }
                                                          type="button"
                                                          title={sectionSentence.text}
                                                        >
                                                          <span className="practice-sentence-state">
                                                            {isCompleted ? "✓" : isUnlocked ? (isOptional ? "○" : lessonSentenceIndex + 1) : <Lock size={12} />}
                                                          </span>
                                                          <span>
                                                            {sectionSentence.text}
                                                            {isOptional && <small>{locale === "zh" ? "选读" : "Optional"}</small>}
                                                          </span>
                                                          {sentenceProgress?.bestScore ? <em>{Math.round(sentenceProgress.bestScore)}</em> : null}
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                              </section>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </section>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </section>
      </aside>
    );
  }

  function renderLiveReadingStage(currentLesson: Lesson, currentSentence: Sentence) {
    const currentLessonProgress = childProgress.find((item) => item.lessonId === currentLesson.id);
    const currentSentenceProgress = currentLessonProgress?.sentences.find((item) => item.sentenceId === currentSentence.id);
    const currentBestScore = currentSentenceProgress?.bestScore || 0;
    const currentBestStars = getScoreStarCount(currentBestScore);
    const isPerfectBest = isPerfectScore(currentBestScore);
    const isReferencePlaying = playingSentenceId === currentSentence.id;
    const breadcrumb = getSentenceBreadcrumb(currentLesson, currentSentence.id, sentenceIndex, locale);
    const sentenceContext = getSentenceSection(currentLesson, currentSentence.id);
    const currentSection = sentenceContext?.section;
    const isWordItem = currentSentence.itemType === "word" || currentSection?.type === "vocabulary";
    const isOptionalWord = isWordItem && currentSentence.required === false;
    const isReadingTime = currentSentence.itemType === "reading" || currentSection?.type === "reading-time";
    const stageBadge =
      attemptSource === "current" && attempt?.passed
        ? locale === "zh"
          ? "过关啦"
          : "Passed"
        : isOptionalWord
          ? locale === "zh"
            ? "选读词"
            : "Optional word"
          : isWordItem
            ? locale === "zh"
              ? "必学词"
              : "Required word"
            : isReadingTime
              ? locale === "zh"
                ? "短文阅读"
                : "Reading time"
        : locale === "zh"
          ? "跟读这一句"
          : "Read this";
    const nextItemLabel = isWordItem ? (locale === "zh" ? "下一个词" : "Next word") : t.nextSentence;
    const histPassed = Boolean(currentSentenceProgress?.passed);
    const histLabel =
      currentBestScore > 0
        ? `${Math.round(currentBestScore)}`
        : locale === "zh"
          ? "还没过关"
          : "Not passed";
    const histHint =
      guidedPracticePhase !== "idle" && guidedPracticePhase !== "scoring"
        ? guidedPracticePhase === "audio-blocked"
          ? t.audioTapToContinue
          : t.automaticPracticeHint
        : locale === "zh"
          ? "先听一遍，再大声读～"
          : t.practiceTip;

    const voicePicker = (
      <VoicePicker
        disabled={guidedPracticePhase !== "idle"}
        label={t.voice}
        onChange={(voiceId) => {
          stopReferenceAudio();
          setSelectedVoiceId(voiceId);
        }}
        value={selectedVoiceId}
        voices={ttsVoices}
      />
    );

    const recordControls = (
      <>
      <div className="stage-record-controls live-stage-controls ui-stage-actions">
        <button
          className="listen-button ui-btn ui-btn--listen ui-btn--pill"
          onClick={() => void playReferenceAudio()}
          disabled={!selectedVoiceId || guidedPracticePhase !== "idle" || isReferencePlaying || isAutomaticPracticeActive}
          type="button"
        >
          <Volume2 size={22} />
          {isReferencePlaying ? t.playing : t.listen}
        </button>

        {guidedPracticePhase === "audio-blocked" ? (
          <RecordOrb icon={<Volume2 size={34} />} label={t.playToContinue} onClick={resumeGuidedPracticeAfterAudioBlock} />
        ) : !isRecording ? (
          <RecordOrb
            icon={<Mic size={38} />}
            label={guidedPracticeLabel}
            onClick={startAutomaticPractice}
            disabled={
              currentSelectionCompleted ||
              !microphoneReady ||
              guidedPracticePhase !== "idle" ||
              isAutomaticPracticeActive
            }
          />
        ) : (
          <RecordOrb recording wave icon={<Square size={34} />} label={t.finish} onClick={() => void stopRecording()} />
        )}

        {(canGoNext || isLessonComplete) && !isAutomaticPracticeActive ? (
          <button
            className="listen-button play-voice-button next-stage-button ui-btn ui-btn--next ui-btn--pill"
            onClick={isLessonComplete ? completeLessonAndOpenPracticeBook : nextSentence}
            type="button"
          >
            <ChevronRight size={22} />
            {isLessonComplete ? t.backToPracticeBook : nextItemLabel}
          </button>
        ) : (
          <button className="listen-button play-voice-button ui-btn ui-btn--ghost ui-btn--pill ui-btn--next-disabled" disabled type="button">
            {isScoring ? t.checking : nextItemLabel}
          </button>
        )}
      </div>
      {isAutomaticPracticeActive && (
        <div className="automatic-practice-bar" role="status">
          <span className="automatic-practice-status-copy">
            <strong>{automaticPracticeStatusText}</strong>
            <small>
              {formatMessage(t.automaticPracticeRunning, {
                silence: automaticNoSpeechCount,
                retry: automaticFailedAttemptCount
              })}
            </small>
          </span>
          <button
            className="ui-btn ui-btn--pill automatic-practice-stop"
            onClick={() => void stopAutomaticPractice(t.automaticPracticeManualStop, "info", "manual")}
            type="button"
          >
            <Square size={16} />
            {t.stopAutomaticPractice}
          </button>
        </div>
      )}
      {!isAutomaticPracticeActive && automaticPracticeNotice && (
        <StatusBanner
          className="automatic-practice-notice"
          tone={automaticPracticeNotice.tone}
          icon={automaticPracticeNotice.tone === "ok" ? <Trophy size={20} /> : <AlertCircle size={20} />}
        >
          {automaticPracticeNotice.message}
        </StatusBanner>
      )}
      </>
    );

    const microphonePermissionBanner =
      microphoneAccessState === "denied" || microphoneAccessState === "unavailable" ? (
        <StatusBanner tone="warn" className="microphone-permission-banner" icon={<Mic size={20} />}>
          <span>
            {microphoneAccessState === "denied" ? t.microphonePermissionDenied : t.microphonePermissionUnavailable}
          </span>
          <button onClick={retryMicrophoneAccess} type="button">
            {t.microphonePermissionRetry}
          </button>
        </StatusBanner>
      ) : null;

    const feedbackBlock = attempt ? (
      <>
        {attemptSource === "current" && attempt.passed && (
          <div className="sentence-success-sparkles ui-pass-stars" aria-hidden="true" key={`sparkles-${attempt.id}`}>
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index}>✦</span>
            ))}
          </div>
        )}
        <div className={`stage-score-row live-stage-score ui-score-panel ${scoreTone(attempt.result.SuggestedScore)}`}>
          <div className="attempt-result-toolbar">
            <span className={attemptSource?.startsWith("history") ? "history" : "current"}>
              {attemptSource === "history-best"
                ? t.bestAttemptFeedback
                : attemptSource === "history-latest"
                  ? t.latestAttemptFeedback
                  : t.currentAttemptFeedback}
            </span>
            {attempt.audioAvailable && (
              <div className="attempt-audio-actions">
                <button
                  className={`attempt-audio-button ${playingAttemptAudioId === `${attempt.id}:enhanced` ? "playing" : ""}`}
                  disabled={isRecording || isScoring}
                  onClick={() => playAttemptAudio("enhanced")}
                  type="button"
                >
                  <Volume2 size={17} />
                  {playingAttemptAudioId === `${attempt.id}:enhanced`
                    ? t.playingMyRecording
                    : t.listenToMyRecording}
                </button>
              </div>
            )}
          </div>
          <div className="stage-score-ring ui-score-ring">
            <strong>{animatedScore}</strong>
          </div>
          <div className="stage-score-copy">
            <strong>{getAttemptFeedbackSummary(attempt, currentSentence, problemWords, t)}</strong>
            <div className="mini-stars" aria-label={`${getAttemptStarCount(attempt)} / 5`}>
              {Array.from({ length: 5 }).map((_, index) => (
                <Star className={index < getAttemptStarCount(attempt) ? "filled" : "empty"} key={index} size={16} />
              ))}
            </div>
          </div>
          <Metric label={t.clearWords} value={`${wordAccuracyMetrics?.clearCount || 0}/${wordAccuracyMetrics?.totalCount || 0}`} />
          <Metric label={t.effectiveFluency} value={`${Math.round(effectiveFluency)}%`} />

          {attempt.result.Words.length > 0 && (
            <div className="word-accuracy-panel stage-word-feedback">
              <strong className="word-feedback-title">{t.wordAccuracyBreakdown}</strong>
              <div className="word-feedback ui-word-row">
                {attempt.result.Words.map((word, index) => {
                  const kind = getWordFeedbackKind(word);
                  const phonetic = getAssessmentPhonetic(word);
                  const status = getWordFeedbackLabel(kind, t);
                  const score = kind === "extra" ? null : Math.round(getRequiredWordScore(word));
                  return (
                    <WordChip
                      key={`${word.ReferenceWord}-${word.MatchTag}-${index}`}
                      tone={kind}
                      phonetic={phonetic}
                      detail={score === null ? status : formatMessage(t.wordScore, { score, status })}
                    >
                      {getAssessmentWordText(word)}
                    </WordChip>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!attempt.passed && !isOptionalWord && (
          <StatusBanner tone="warn" className="retry-notice stage-retry-notice" icon={<AlertCircle size={22} />}>
            <div className="retry-notice-title">
              <strong>{t.retryTitle}</strong>
            </div>
            <p>{t.retryGuide}</p>
            <ul>
              {retryTips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </StatusBanner>
        )}

        {!attempt.passed && isOptionalWord && (
          <StatusBanner tone="info" className="optional-word-notice" icon={<BookOpen size={20} />}>
            <strong>{locale === "zh" ? "这是选读词，分数不影响继续。" : "This is an optional word. Its score does not block progress."}</strong>
          </StatusBanner>
        )}

        {!isStorybook && (
          <div className="stage-tip ui-stage-tip">
            <Lightbulb size={18} />
            <span>{t.practiceTip}</span>
          </div>
        )}
      </>
    ) : null;

    if (isStorybook) {
      return (
        <section className="child-reading-stage reading-stage-live sb-reading-pane">
          <div className="sb-stage-toolbar">
            <div className="sb-crumb" title={breadcrumb.label}>
              <strong>{breadcrumb.sectionTitle || breadcrumb.chapterTitle}</strong>
              <span>· {breadcrumb.indexLabel}</span>
            </div>
            {voicePicker}
          </div>

          <StageCard
            className="sb-stage-bubble"
            changing={isSentenceChanging}
            passGlow={Boolean(attemptSource === "current" && attempt?.passed)}
            badge={stageBadge}
          >
            {lessonCelebrationId && <LessonCelebration key={lessonCelebrationId} label={t.practiceDone} />}
            <div className="sb-stage-center">
              {isWordItem ? (
                <div className={`sb-word-study-card ${isOptionalWord ? "optional" : "required"}`}>
                  <span className="sb-word-study-kind">
                    {isOptionalWord
                      ? locale === "zh"
                        ? "选读 · 不影响过关"
                        : "Optional · Does not block progress"
                      : locale === "zh"
                        ? "必学 · 需要过关"
                        : "Required · Pass to continue"}
                  </span>
                  <strong>{currentSentence.text}</strong>
                  {currentSentence.phonetic && <em>{currentSentence.phonetic}</em>}
                  {currentSentence.translation && <p>{currentSentence.translation}</p>}
                </div>
              ) : isReadingTime && currentSection ? (
                <article className="sb-reading-passage">
                  <header>
                    <BookOpen size={20} />
                    <strong>{locale === "zh" ? "短文阅读" : "Reading time"}</strong>
                    {currentSentence.panelNumber ? <span>{locale === "zh" ? `第 ${currentSentence.panelNumber} 幅` : `Panel ${currentSentence.panelNumber}`}</span> : null}
                  </header>
                  <div className="sb-reading-passage-lines">
                    {currentSection.sentences.map((passageSentence) => (
                      <p className={passageSentence.id === currentSentence.id ? "active" : ""} key={passageSentence.id}>
                        {passageSentence.text}
                      </p>
                    ))}
                  </div>
                </article>
              ) : (
                <KaraokeSentenceText
                  key={currentSentence.id}
                  active={isReferencePlaying}
                  currentTimeMs={isReferencePlaying ? referenceAudioTimeMs : 0}
                  progress={isReferencePlaying ? referenceAudioProgress : 0}
                  subtitles={isReferencePlaying ? referenceSubtitles : []}
                  text={currentSentence.text}
                />
              )}
              {recordControls}
              {microphonePermissionBanner}
              {error && (
                typeof error === "string" ? (
                  <StatusBanner tone="bad" className="stage-inline-message">{error}</StatusBanner>
                ) : (
                  <PracticeIssueNotice issue={error} className="stage-inline-message" />
                )
              )}
            </div>
          </StageCard>

          <div className="sb-hist-bar">
            <div className="sb-hist-bar__left">
              <span>{t.bestScore}</span>
              <em className={histPassed ? "ok" : "pending"}>{histLabel}</em>
              {currentBestScore > 0 && (
                <ScoreStars
                  className="best-score-stars sb-hist-stars"
                  count={currentBestStars}
                  label={`${t.bestScore} ${Math.round(currentBestScore)}, ${currentBestStars} / 5`}
                  perfect={isPerfectBest}
                />
              )}
            </div>
            <div className="sb-hist-bar__right">{histHint}</div>
          </div>

          {feedbackBlock ? <div className="sb-feedback-dock">{feedbackBlock}</div> : null}
        </section>
      );
    }

    return (
      <section className="child-reading-stage reading-stage-live">
        <div className="stage-header">
          <div>
            <p className="eyebrow">{t.practiceInProgress}</p>
            <h2>{currentLesson.title}</h2>
          </div>
          <div className="stage-actions">
            <span className="streak-chip">
              <Trophy size={16} />
              {progress}%
            </span>
          </div>
        </div>

        <div className="stage-sentence-nav" aria-label={t.progressLabel}>
          {currentLesson.sentences.map((item, index) => {
            const isUnlocked = index <= passedCount;
            return (
              <button
                className={`stage-sentence-step ${index === sentenceIndex ? "active" : ""} ${index < passedCount ? "done" : ""}`}
                disabled={!isUnlocked}
                key={item.id}
                onClick={() => {
                  if (!isUnlocked) return;
                  transitionToSentence(index);
                }}
                type="button"
                aria-label={`${t.sentence} ${index + 1}`}
              >
                {isUnlocked ? index + 1 : <Lock size={16} />}
              </button>
            );
          })}
        </div>

        <StageCard changing={isSentenceChanging} passGlow={Boolean(attemptSource === "current" && attempt?.passed)} badge={stageBadge}>
          {lessonCelebrationId && <LessonCelebration key={lessonCelebrationId} label={t.practiceDone} />}
          <div className="sentence-meta">
            <div className={`sentence-best-summary ${isPerfectBest ? "perfect" : ""}`}>
              <span>{t.bestScore}</span>
              <strong>{currentBestScore > 0 ? Math.round(currentBestScore) : "--"}</strong>
              <ScoreStars
                className="best-score-stars"
                count={currentBestStars}
                label={`${t.bestScore} ${currentBestScore > 0 ? Math.round(currentBestScore) : 0}, ${currentBestStars} / 5`}
                perfect={isPerfectBest}
              />
            </div>
            <div className="live-stage-actions">{voicePicker}</div>
          </div>

          <KaraokeSentenceText
            key={currentSentence.id}
            active={isReferencePlaying}
            currentTimeMs={isReferencePlaying ? referenceAudioTimeMs : 0}
            progress={isReferencePlaying ? referenceAudioProgress : 0}
            subtitles={isReferencePlaying ? referenceSubtitles : []}
            text={currentSentence.text}
          />

          {recordControls}

          {guidedPracticePhase !== "idle" && guidedPracticePhase !== "scoring" && (
            <StatusBanner tone="info" className="guided-practice-status">
              {guidedPracticePhase === "audio-blocked" ? t.audioTapToContinue : t.automaticPracticeHint}
            </StatusBanner>
          )}

          {microphonePermissionBanner}

          {error && (
            typeof error === "string" ? (
              <StatusBanner tone="bad" className="stage-inline-message">{error}</StatusBanner>
            ) : (
              <PracticeIssueNotice issue={error} className="stage-inline-message" />
            )
          )}

          {feedbackBlock}
        </StageCard>
      </section>
    );
  }

  if (isLoading) {
    return (
      <main className="app-shell">
        <section className="loading-panel">{t.loading}</section>
      </main>
    );
  }

  if (!lesson || !sentence) {
    return (
      <main className="app-shell child-shell">
        <ChildTopBar
          locale={locale}
          childName={activeChild?.name || "Lily"}
          totalStars={childTotalStars}
          parentConsoleLabel={t.parentConsole}
          onLocaleChange={changeLocale}
          onOpenParent={openParentConsole}
            onOpenPictureBooks={() => window.location.assign(`/picture-books${activeChild?.id ? `?childId=${encodeURIComponent(activeChild.id)}` : ""}`)}
            onOpenSudoku={() => window.location.assign("/sudoku")}
          onOpenDevicePreview={import.meta.env.DEV && !new URLSearchParams(window.location.search).has("devicePreview") ? openDevicePreview : undefined}
          showChromeSwitcher
        />

        <section className="child-learning-layout">
          {totalPracticeTasks > 0 && renderPracticeNavigator()}
          <div className="empty-practice-book ui-empty-practice">
            <BookOpen size={34} />
            <p>{t.noAssignedLesson}</p>
            <button className="admin-primary-button ui-btn ui-btn--primary" onClick={openParentConsole} type="button">
              {t.parentConsole}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell child-shell">
      <ChildTopBar
        locale={locale}
        childName={activeChild?.name || "Lily"}
        totalStars={childTotalStars}
        parentConsoleLabel={t.parentConsole}
        onLocaleChange={changeLocale}
        onOpenParent={openParentConsole}
        onOpenPictureBooks={() => window.location.assign("/picture-books")}
        onOpenSudoku={() => window.location.assign("/sudoku")}
        onOpenDevicePreview={import.meta.env.DEV && !new URLSearchParams(window.location.search).has("devicePreview") ? openDevicePreview : undefined}
        showChromeSwitcher
      />

      {isFilingReviewSandbox ? (
        <div className="filing-review-live-banner" role="status">
          <ShieldCheck size={17} />
          <span><strong>产品功能体验</strong>：可听发音并真实跟读评分；本次录音、成绩和进度不会保存。</span>
          <button onClick={() => window.location.assign("/filing-review")} type="button">返回体验说明</button>
        </div>
      ) : null}

      <section className="child-learning-layout">
        {renderPracticeNavigator()}
        {renderLiveReadingStage(lesson, sentence)}
      </section>
    </main>
  );
}

type ChildMessages = (typeof messages)[Locale]["child"];

function getRetryTips(attempt: Attempt, sentence: Sentence, t: ChildMessages) {
  const result = attempt.result;
  const severeWords = result.Words.filter((word) => word.MatchTag === 2 || word.MatchTag === 3);
  const extraIssues = attempt.extraIssues ?? result.Words.filter((word) => word.MatchTag === 1).length;
  const unscoredIssues = attempt.unscoredIssues ?? result.Words.filter((word) => word.MatchTag === 4).length;
  const lowAccuracyIssues =
    attempt.lowAccuracyIssues ?? result.Words.filter((word) => word.MatchTag === 0 && word.PronAccuracy < 50).length;
  const wordMetrics = getWordAccuracyMetrics(result);
  const unclearWordCount = wordMetrics.totalCount - wordMetrics.clearCount;
  const tips: string[] = [];

  if (result.PronCompletion < 0.95) {
    tips.push(
      formatMessage(t.retryCompletionTip, {
        value: Math.round(result.PronCompletion * 100),
        target: 95
      })
    );
  }

  if (unclearWordCount > 0) {
    tips.push(formatMessage(t.retryClearWordsTip, { count: unclearWordCount }));
  }

  if (result.SuggestedScore < sentence.minScore) {
    tips.push(
      formatMessage(t.retryScoreTip, {
        value: Math.round(result.SuggestedScore),
        target: sentence.minScore
      })
    );
  }

  if (severeWords.length > 0) {
    tips.push(formatMessage(t.retryWordTip, { count: severeWords.length }));
  }

  if (lowAccuracyIssues > 0) {
    tips.push(formatMessage(t.retryRequiredWordTip, { count: lowAccuracyIssues }));
  }

  if (unscoredIssues > 0) {
    tips.push(formatMessage(t.retryUnscoredWordTip, { count: unscoredIssues }));
  }

  if (extraIssues > 1) {
    tips.push(formatMessage(t.retryExtraWordTip, { count: extraIssues }));
  }

  if (tips.length === 0) {
    tips.push(t.retryGenericTip);
  }

  return tips.slice(0, 3);
}

function getAttemptFeedbackSummary(attempt: Attempt, sentence: Sentence, problemWords: ReturnType<typeof getProblemWords>, t: ChildMessages) {
  const result = attempt.result;

  if (result.PronCompletion < 0.95) {
    return t.feedbackCompletionFocus;
  }

  if (problemWords.length > 0 || result.PronAccuracy < 85) {
    return t.feedbackAccuracyFocus;
  }

  if (result.PronFluency < 0.9) {
    return t.feedbackFluencyFocus;
  }

  if (result.SuggestedScore < sentence.minScore) {
    return t.feedbackRetryFocus;
  }

  return t.feedbackGreat;
}

function getAttemptStarCount(attempt: Attempt) {
  const scoreStars = getScoreStarCount(attempt.result.SuggestedScore);
  return attempt.passed ? scoreStars : Math.min(2, scoreStars);
}

function getScoreStarValue(score: number) {
  return getScoreStarCount(score) + (isPerfectScore(score) ? 1 : 0);
}

function getScoreStarCount(score: number) {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (score >= 95) return 5;
  if (score >= 85) return 4;
  if (score >= 75) return 3;
  if (score >= 60) return 2;
  if (score >= 45) return 1;
  return 0;
}

function isPerfectScore(score: number) {
  return Number.isFinite(score) && score >= 100;
}

function getWordFeedbackLabel(kind: WordFeedbackKind, t: ChildMessages) {
  switch (kind) {
    case "extra":
      return t.wordExtra;
    case "missed":
      return t.wordMissed;
    case "misread":
      return t.wordMisread;
    case "unscored":
      return t.wordUnscored;
    case "unclear":
      return t.wordUnclear;
    default:
      return t.passed;
  }
}

type KaraokeSegment = {
  key: string;
  text: string;
  beginTime?: number;
  endTime?: number;
};

function KaraokeSentenceText({
  text,
  active,
  progress,
  currentTimeMs,
  subtitles
}: {
  text: string;
  active: boolean;
  progress: number;
  currentTimeMs: number;
  subtitles: TtsSubtitle[];
}) {
  const segments = subtitles.length > 0 ? buildSubtitleSegments(text, subtitles) : buildEstimatedSegments(text);
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const playedLength = clampedProgress * Math.max(text.length, 1);
  let estimatedCursor = 0;

  return (
    <p className={`sentence-text preview live-sentence-text karaoke-sentence ${active ? "playing" : ""}`} aria-label={text}>
      {segments.map((segment) => {
        const estimatedStart = estimatedCursor;
        const estimatedEnd = estimatedCursor + segment.text.length;
        estimatedCursor = estimatedEnd;
        const tokenProgress =
          segment.beginTime !== undefined && segment.endTime !== undefined
            ? getTimedTokenProgress(currentTimeMs, segment.beginTime, segment.endTime)
            : Math.min(100, Math.max(0, ((playedLength - estimatedStart) / Math.max(estimatedEnd - estimatedStart, 1)) * 100));

        return (
          <span
            aria-hidden="true"
            className={`karaoke-token ${segment.text.trim() ? "" : "space"}`}
            key={segment.key}
            style={{ "--token-progress": `${tokenProgress}%` } as CSSProperties}
          >
            {segment.text}
          </span>
        );
      })}
    </p>
  );
}

function buildEstimatedSegments(text: string): KaraokeSegment[] {
  return text
    .split(/(\s+)/)
    .filter(Boolean)
    .map((part, index) => ({
      key: `estimated-${index}`,
      text: part
    }));
}

function buildSubtitleSegments(text: string, subtitles: TtsSubtitle[]): KaraokeSegment[] {
  const segments = buildEstimatedSegments(text);
  const timedSubtitles = subtitles
    .filter((subtitle) => subtitle.text && subtitle.endTime > subtitle.beginTime)
    .sort((a, b) => a.beginTime - b.beginTime);

  if (timedSubtitles.length === 0) return segments;

  const textAlignedSegments = alignSubtitleSegmentsByText(segments, timedSubtitles);
  if (textAlignedSegments) return textAlignedSegments;

  const indexedSubtitles = timedSubtitles.filter(
    (subtitle) => typeof subtitle.beginIndex === "number" && typeof subtitle.endIndex === "number"
  );

  if (indexedSubtitles.length === 0) return segments;

  const compactTextLength = text.replace(/\s+/g, "").length;
  const maxSubtitleIndex = indexedSubtitles.reduce((max, subtitle) => Math.max(max, subtitle.endIndex || 0), 0);
  const indexMode: "compact" | "full" = maxSubtitleIndex <= compactTextLength ? "compact" : "full";
  let fullCursor = 0;
  let compactCursor = 0;

  return segments.map((segment) => {
    const fullStart = fullCursor;
    const fullEnd = fullStart + segment.text.length;
    fullCursor = fullEnd;

    const compactStart = compactCursor;
    const compactLength = segment.text.replace(/\s+/g, "").length;
    const compactEnd = compactStart + compactLength;
    compactCursor = compactEnd;

    if (!segment.text.trim()) return segment;

    const start = indexMode === "compact" ? compactStart : fullStart;
    const end = indexMode === "compact" ? compactEnd : fullEnd;
    const matchingSubtitles = indexedSubtitles.filter((subtitle) => {
      const subtitleStart = Math.max(0, subtitle.beginIndex || 0);
      const subtitleEnd = Math.max(subtitleStart + 1, subtitle.endIndex || subtitleStart + 1);
      return subtitleStart < end && subtitleEnd > start;
    });

    if (matchingSubtitles.length === 0) return segment;

    return {
      ...segment,
      beginTime: Math.min(...matchingSubtitles.map((subtitle) => subtitle.beginTime)),
      endTime: Math.max(...matchingSubtitles.map((subtitle) => subtitle.endTime))
    };
  });
}

function normalizeKaraokeText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function alignSubtitleSegmentsByText(segments: KaraokeSegment[], subtitles: TtsSubtitle[]) {
  let subtitleCursor = 0;
  let matchedCount = 0;
  const matchableCount = segments.filter((segment) => normalizeKaraokeText(segment.text)).length;

  const alignedSegments = segments.map((segment) => {
    const targetText = normalizeKaraokeText(segment.text);
    if (!targetText) return segment;

    for (let startIndex = subtitleCursor; startIndex < subtitles.length; startIndex += 1) {
      let combinedText = "";
      let beginTime: number | undefined;
      let endTime: number | undefined;

      for (let endIndex = startIndex; endIndex < subtitles.length; endIndex += 1) {
        const subtitle = subtitles[endIndex];
        const subtitleText = normalizeKaraokeText(subtitle.text);
        if (!subtitleText) continue;

        const nextCombinedText = combinedText + subtitleText;
        if (!targetText.startsWith(nextCombinedText)) break;

        combinedText = nextCombinedText;
        beginTime ??= subtitle.beginTime;
        endTime = subtitle.endTime;

        if (combinedText === targetText) {
          subtitleCursor = endIndex + 1;
          matchedCount += 1;
          return {
            ...segment,
            beginTime,
            endTime
          };
        }
      }
    }

    return segment;
  });

  return matchableCount > 0 && matchedCount === matchableCount ? alignedSegments : null;
}

function getTimedTokenProgress(currentTimeMs: number, beginTime: number, endTime: number) {
  if (currentTimeMs <= beginTime) return 0;
  if (currentTimeMs >= endTime) return 100;
  return Math.min(100, Math.max(0, ((currentTimeMs - beginTime) / Math.max(endTime - beginTime, 1)) * 100));
}

const celebrationColors = ["#f59e0b", "#fb7185", "#a78bfa", "#38bdf8", "#34d399"];

function LessonCelebration({ label }: { label: string }) {
  return (
    <div className="lesson-celebration" role="status" aria-label={label}>
      <strong>{label}</strong>
      {Array.from({ length: 20 }).map((_, index) => (
        <i
          className="confetti-piece"
          key={index}
          style={
            {
              "--confetti-color": celebrationColors[index % celebrationColors.length],
              "--confetti-delay": `${(index % 7) * 45}ms`,
              "--confetti-left": `${4 + ((index * 17) % 92)}%`,
              "--confetti-rotation": `${(index * 47) % 180}deg`
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function ScoreStars({ count, perfect, label, className = "" }: { count: number; perfect?: boolean; label: string; className?: string }) {
  return (
    <div className={`mini-stars ${className} ${perfect ? "perfect" : ""}`} aria-label={label}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Star className={index < count ? "filled" : "empty"} key={index} size={16} />
      ))}
    </div>
  );
}
