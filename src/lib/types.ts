export type Sentence = {
  id: string;
  text: string;
  minScore: number;
  chapterId?: string;
  itemType?: "sentence" | "word" | "reading" | string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
};

export type Chapter = {
  id: string;
  title: string;
  body: string;
  position: number;
  leadIn?: LessonPart;
  parts?: LessonPart[];
  sections?: LessonSection[];
  sentences: Sentence[];
};

export type LessonSection = {
  id: string;
  title: string;
  type?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
  sentences: Sentence[];
};

export type LessonPart = {
  id: string;
  label: string;
  focusQuestion?: string;
  activities: LessonSection[];
};

export type Lesson = {
  id: string;
  title: string;
  sourceType?: string;
  tags?: string[];
  status?: "published" | "archived" | string;
  createdAt?: string;
  updatedAt?: string;
  importQuality?: PdfImportQualityReport | null;
  importId?: string;
  chapters?: Chapter[];
  sentences: Sentence[];
};

export type ImportedLessonSentencePreview = Omit<Sentence, "minScore" | "chapterId">;

export type ImportedLessonChapterPreview = {
  id: string;
  title: string;
  text: string;
  leadIn?: {
    id: string;
    label: string;
    focusQuestion?: string;
    activities: ImportedLessonActivityPreview[];
  };
  parts?: Array<{
    id: string;
    label: string;
    focusQuestion?: string;
    activities: ImportedLessonActivityPreview[];
  }>;
  sections?: Array<{
    id: string;
    title: string;
    type?: string;
    partKind?: string;
    partLabel?: string;
    focusQuestion?: string;
    sentences: ImportedLessonSentencePreview[];
  }>;
  sentences: ImportedLessonSentencePreview[];
};

export type ImportedLessonActivityPreview = {
  id: string;
  title: string;
  type?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
  sentences: ImportedLessonSentencePreview[];
};

export type PdfStructureBlock = {
  id: string;
  type: "heading" | "section" | "activity" | "question" | "reading" | "vocabulary" | "note";
  text: string;
  page: number;
  candidate: boolean;
  activity?: string;
  targetActivity?: boolean;
  reason?: string;
  itemType?: string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
  sentences: string[];
};

export type PdfTocEntry = {
  id: string;
  unitNumber: number;
  unitLabel: string;
  title: string;
  shortTitle: string;
  page: number;
};

export type PdfStructureSection = {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  activityKey?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
  blocks: PdfStructureBlock[];
};

export type PdfStructureUnit = {
  id: string;
  title: string;
  toc?: PdfTocEntry;
  pageStart: number;
  pageEnd: number;
  sections: PdfStructureSection[];
};

export type PdfImportStructure = {
  version: number;
  title: string;
  toc: PdfTocEntry[];
  units: PdfStructureUnit[];
  frontMatter: PdfStructureBlock[];
  stats: {
    pages: number;
    tocEntries: number;
    units: number;
    sections: number;
    blocks: number;
    candidateBlocks: number;
    candidateSentences: number;
    targetBlocks: number;
    targetSentences: number;
    ignoredBlocks: number;
  };
};

export type PdfImportQualityIssue = {
  id: string;
  code: "dangling-fragment" | "repeated-punctuation" | "missing-punctuation" | "odd-token" | "long-sentence" | "short-sentence" | string;
  severity: "high" | "medium" | "low";
  chapterId?: string;
  chapterTitle: string;
  chapterIndex: number;
  sectionId?: string;
  sectionTitle?: string;
  sentenceId: string;
  sentenceIndex: number;
  text: string;
};

export type PdfImportQualityReport = {
  status: "good" | "review" | "warning";
  totalSentences: number;
  cleanSentences: number;
  issueSentences: number;
  counts: {
    high: number;
    medium: number;
    low: number;
  };
  issues: PdfImportQualityIssue[];
  coverage?: {
    eligibleLines: number;
    classifiedLines: number;
    ignoredLines: number;
    unclassifiedLines: number;
    percent: number;
    lowConfidencePages: number[];
    pages: Array<{
      page: number;
      eligibleLines: number;
      classifiedLines: number;
      ignoredLines: number;
      unclassifiedLines: number;
      percent: number;
      unclassified: Array<{ id: string; text: string; x: number; top: number }>;
    }>;
  } | null;
  consistency?: {
    expectedUnits: number;
    importedUnits: number;
    sourceSections: number;
    importedSections: number;
    sourceVocabulary: number;
    importedVocabulary: number;
    checks: Array<{
      code: string;
      label: string;
      expected: number;
      actual: number;
      passed: boolean;
    }>;
  } | null;
  ocr?: {
    status: "good" | "review" | "warning" | "unavailable";
    engine: string;
    model?: string;
    message?: string;
    totalPages: number;
    pagesProcessed: number;
    truncated?: boolean;
    pdfTokens?: number;
    ocrTokens?: number;
    matchedTokens?: number;
    tokenAgreement: number;
    reviewPages: number[];
    criticalPages: number[];
    pages: Array<{
      page: number;
      confidence: number;
      pdfLines: number;
      ocrLines: number;
      pdfTokens: number;
      ocrTokens: number;
      matchedTokens: number;
      tokenAgreement: number;
      missingTextLayer: boolean;
      needsReview: boolean;
      pdfOnly: Array<{ text: string; closest: string; similarity: number }>;
      ocrOnly: Array<{ text: string; closest: string; similarity: number }>;
    }>;
    providers?: Array<{
      engine: string;
      model?: string;
      advisory?: boolean;
      status: "good" | "review" | "warning" | "unavailable";
      message?: string;
      detail?: string;
      totalPages: number;
      pagesProcessed: number;
      tokenAgreement: number;
      reviewPages: number[];
      criticalPages: number[];
      pages: Array<{
        page: number;
        confidence: number;
        pdfLines: number;
        ocrLines: number;
        pdfTokens: number;
        ocrTokens: number;
        matchedTokens: number;
        tokenAgreement: number;
        missingTextLayer: boolean;
        needsReview: boolean;
        pdfOnly: Array<{ text: string; closest: string; similarity: number }>;
        ocrOnly: Array<{ text: string; closest: string; similarity: number }>;
      }>;
    }>;
    visualReview?: {
      status: "good" | "review" | "warning" | "unavailable";
      engine: string;
      model?: string;
      message?: string;
      detail?: string;
      pagesProcessed: number;
      totalPages: number;
      pages: Array<{
        page: number;
        status: "good" | "review" | "warning";
        missingLines: string[];
        incorrectLines: string[];
        readingOrderIssue: boolean;
        sectionIssue: boolean;
        notes: string;
      }>;
    } | null;
  } | null;
};

export type PdfImportPreview = {
  provider: string;
  importId?: string;
  rule?: string;
  sourceType: "pdf" | string;
  title: string;
  tags: string[];
  warnings: string[];
  quality: PdfImportQualityReport;
  structure: PdfImportStructure;
  stats: {
    pages: number;
    characters: number;
    lines: number;
    layoutLines?: number;
    layoutItems?: number;
    chapters: number;
    sentences: number;
    detectedSentences?: number;
  };
  chapters: ImportedLessonChapterPreview[];
  importSnapshot?: PdfImportSnapshot;
};

export type PdfImportPageAsset = {
  id: string;
  pageNumber: number;
  fileName: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  uses: string[];
};

export type PdfImportDifference = {
  id: string;
  provider: string;
  pageNumber: number;
  kind: "local-only" | "upstream-only" | "incorrect" | "reading-order" | "section" | string;
  localText: string;
  upstreamText: string;
  similarity: number;
  status: "pending" | "applied" | "ignored" | string;
};

export type PdfImportSnapshot = {
  schemaVersion: number;
  importId: string;
  householdId: string;
  title: string;
  rule: string;
  extractedAt: string;
  pageAssets: PdfImportPageAsset[];
  layers: {
    local: {
      provider: string;
      status: string;
      pages: Array<{
        pageNumber: number;
        imageAssetId: string;
        imageUrl: string;
        width?: number;
        height?: number;
        blocks: Array<{ id: string; text: string; source: string; x?: number; top?: number; width?: number; height?: number; pageWidth?: number; pageHeight?: number }>;
      }>;
      structure: PdfImportStructure;
      chapters: ImportedLessonChapterPreview[];
    };
    upstream: {
      providers: Array<{
        provider: string;
        model: string;
        advisory?: boolean;
        status: string;
        message: string;
        detail: string;
        pagesProcessed: number;
        totalPages: number;
        pages: Array<{ pageNumber: number; status: string; confidence: number; tokenAgreement: number; blocks: Array<{ id: string; text: string; source: string }>; localOnly: Array<{ text: string }>; upstreamOnly: Array<{ text: string }> }>;
      }>;
      visualReview: null | { provider: string; model: string; status: string; message: string; detail: string; pagesProcessed: number; totalPages: number; pages: Array<{ page: number; status: string; missingLines: string[]; incorrectLines: string[]; readingOrderIssue: boolean; sectionIssue: boolean; notes: string }> };
    };
    differences: { total: number; pending: number; pages: number[]; items: PdfImportDifference[] };
    final: {
      strategy: string;
      reviewStatus: "pending-review" | "verified" | string;
      verifiedBy: string[];
      appliedDifferenceIds: string[];
      pendingDifferenceIds: string[];
      structure: PdfImportStructure;
      chapters: ImportedLessonChapterPreview[];
    };
  };
};

export type CourseLibraryResource = {
  id: string;
  title: string;
  description: string;
  level: string;
  language: string;
  tags: string[];
  sourceLabel: string;
  imported: boolean;
  stats: {
    chapters: number;
    sections: number;
    sentences: number;
  };
};

export type PlatformCourseCandidate = {
  id: string;
  title: string;
  sourceType: string;
  tags: string[];
  chapters: number;
  sentences: number;
  quality: {
    status: "good" | "review" | "warning";
    high: number;
    medium: number;
    low: number;
  };
};

export type OfficialCourseResource = Omit<CourseLibraryResource, "imported"> & {
  slug: string;
  status: "published" | "unpublished";
  version: number;
  sourceHouseholdId: string;
  sourceLessonId: string;
  quality: PdfImportQualityReport;
  createdAt: string;
  updatedAt: string;
};

export type CourseSyncStatus = {
  targetEnabled: boolean;
  inboundEnabled: boolean;
  targetUrl: string;
  secure: boolean;
  signatureRequired: boolean;
  legacyBearerAllowed: boolean;
  activeKeyId: string;
  acceptedKeyIds: string[];
  replayWindowSeconds: number;
  maxUploadBytes: number;
  message: string;
};

export type CourseSyncDraft = {
  id: string;
  title: string;
  status: "pending" | "published" | string;
  sourceImportId: string;
  targetResourceId: string;
  description: string;
  sourceLabel: string;
  stats: {
    chapters: number;
    sentences: number;
    images: number;
  };
  receivedAt: string;
  publishedAt?: string;
  publishedResourceId?: string;
  publishedVersion?: number;
};

export type CourseSyncResult = CourseSyncDraft & {
  targetUrl: string;
  uploadedImages: number;
  uploadedBytes: number;
};

export type HunyuanOcrServiceStatus = {
  installed: boolean;
  online: boolean;
  controllable: boolean;
  state: "online" | "offline" | "unavailable";
  endpoint: string;
  port: number;
  model: string;
  message: string;
};

export type PlatformAdminAuditLog = {
  id: string;
  actorUserId: string;
  actorUsername: string;
  action: string;
  status: "started" | "success" | "failure";
  summary: string;
  metadata: {
    method?: string;
    path?: string;
    statusCode?: number;
    durationMs?: number;
    importId?: string;
    fileName?: string;
    pages?: number;
    chapters?: number;
    sentences?: number;
    resourceId?: string;
    requestedStatus?: string;
  } & Record<string, unknown>;
  createdAt: string;
};

export type RegistrationKeyRecord = {
  id: string;
  keyPrefix: string;
  batchId: string;
  label: string;
  note: string;
  maxUses: number;
  useCount: number;
  status: "active" | "used" | "expired" | "disabled";
  expiresAt: string | null;
  disabledAt?: string | null;
  consumedAt?: string | null;
  consumedByUsername?: string | null;
  consumedByHouseholdName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RegistrationKeySnapshot = {
  keys: RegistrationKeyRecord[];
  stats: { total: number; active: number; used: number; expired: number; disabled: number };
};

export type GeneratedRegistrationKey = {
  id: string;
  key: string;
  keyPrefix: string;
  batchId: string;
  label: string;
  note: string;
  maxUses: number;
  expiresAt: string;
  createdAt: string;
};

export type PracticeBookItem = {
  id: string;
  bookId?: string;
  lessonId: string;
  lessonTitle: string;
  status: "pending" | "in_progress" | "completed" | "archived" | string;
  position: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PracticeBook = {
  id: string;
  title: string;
  type: "default" | "custom" | string;
  position: number;
  createdAt?: string;
  updatedAt?: string;
  items: PracticeBookItem[];
};

export type ChildProfile = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  practiceBooks: PracticeBook[];
  defaultPracticeBookId?: string;
  practiceItems: PracticeBookItem[];
  assignedLessonId?: string;
  assignedLessonTitle?: string;
};

export type SentenceProgress = {
  sentenceId: string;
  attempts: number;
  passed: boolean;
  completed?: boolean;
  optional?: boolean;
  bestScore: number;
  bestAttemptId?: string;
  bestAttemptAt?: string;
  latestScore?: number;
  latestAttemptId?: string;
  latestAttemptAt?: string;
};

export type LessonProgress = {
  lessonId: string;
  passedCount: number;
  totalCount: number;
  sentences: SentenceProgress[];
};

export type TtsVoice = {
  id: string;
  provider: "tencent" | "openai" | string;
  name: string;
  description: string;
  modelType?: number;
  voiceType?: number;
  primaryLanguage?: number;
  category: string;
  subtitleSupport?: "timed" | "none" | "unknown" | string;
};

export type TtsVoiceResponse = {
  provider: string;
  defaultVoiceId: string;
  voices: TtsVoice[];
};

export type TtsSubtitle = {
  text: string;
  beginTime: number;
  endTime: number;
  beginIndex?: number;
  endIndex?: number;
  phoneme?: string;
};

export type TtsSubtitleResponse = {
  provider: string;
  voiceId: string;
  sentenceId: string;
  generatedAt?: string;
  subtitles: TtsSubtitle[];
};

export type WordAssessment = {
  Word: string;
  ReferenceWord: string;
  PronAccuracy: number;
  PronFluency: number;
  MatchTag: number;
  ProviderMatchTag?: number;
  MatchInference?: "low-accuracy-as-missed" | string;
  MemBeginTime?: number;
  MemEndTime?: number;
  PhoneInfos: Array<{
    Phone?: string;
    ReferencePhone?: string;
    ReferenceLetter?: string;
    PronAccuracy?: number;
    MatchTag?: number;
    MemBeginTime?: number;
    MemEndTime?: number;
  }>;
};

export type AssessmentResult = {
  SuggestedScore: number;
  ProviderSuggestedScore?: number;
  ProviderPronCompletion?: number;
  ProviderRejected?: boolean;
  ProviderExceptionCode?: number;
  ProviderRawScores?: Record<string, number | undefined>;
  RecognizedText?: string;
  ScorePolicy?: "zero-on-missed-word" | string;
  PronAccuracy: number;
  PronFluency: number;
  PronCompletion: number;
  Words: WordAssessment[];
};

export type RecordingQuality = {
  inputSampleRate: number;
  rawDurationMs: number;
  processedDurationMs: number;
  voiceDurationMs: number;
  peak: number;
  rms: number;
  silenceTrimmedMs: number;
  captureMode?: "audio-worklet" | "script-processor";
  capturedDurationMs?: number;
  captureGapMs?: number;
  vadSegmentCount?: number;
  candidateCount?: number;
  audioInput?: {
    supported: {
      echoCancellation: boolean;
      noiseSuppression: boolean;
      autoGainControl: boolean;
      sampleRate: boolean;
      channelCount: boolean;
    };
    applied: {
      echoCancellation?: boolean;
      noiseSuppression?: boolean;
      autoGainControl?: boolean;
      sampleRate?: number;
      channelCount?: number;
      sampleSize?: number;
      latency?: number;
    };
    capabilities?: {
      echoCancellation?: boolean[];
      noiseSuppression?: boolean[];
      autoGainControl?: boolean[];
      sampleRateMin?: number;
      sampleRateMax?: number;
      channelCountMin?: number;
      channelCountMax?: number;
    };
  };
};

export type Attempt = {
  id: string;
  childId?: string;
  sentenceId: string;
  referenceText: string;
  createdAt: string;
  speechProvider?: "mock" | "tencent" | "azure" | "xfyun" | string;
  audioBytes: number;
  audioAvailable?: boolean;
  rawAudioAvailable?: boolean;
  result: AssessmentResult;
  passed: boolean;
  severeIssues: number;
  extraIssues?: number;
  unscoredIssues?: number;
  lowAccuracyIssues?: number;
  minWordAccuracy?: number | null;
  recordingQuality?: RecordingQuality;
  candidateSelection?: {
    strategy: "latest-complete-contiguous" | "full-session" | string;
    selectedId: string;
    selectedKind: string;
    candidateCount: number;
    evaluated: Array<{
      id: string;
      kind: string;
      durationMs: number;
      passed: boolean;
      suggestedScore: number;
      pronAccuracy: number;
      pronCompletion: number;
      severeIssues: number;
      lowAccuracyIssues: number;
      enhancementApplied?: boolean;
      assessmentDurationMs?: number;
    }>;
  };
  speechProviderComparison?: {
    mode: "shadow" | string;
    comparedAt: string;
    primary: SpeechProviderComparisonResult;
    shadow: SpeechProviderComparisonResult;
  };
  speechEnhancement?: {
    provider: string;
    model?: string;
    applied: boolean;
    processingMs?: number;
    levelGainDb?: number;
    input?: Record<string, number>;
    output?: Record<string, number>;
    preGainOutput?: Record<string, number>;
    overallReductionDb?: number;
    noiseFloorReductionDb?: number;
    speechRetentionDb?: number;
    rawAudioBytes?: number;
    rawComparison?: Record<string, unknown>;
    noiseGate?: Record<string, unknown>;
  };
};

export type AutomaticPracticeSession = {
  id: string;
  childId: string;
  lessonId?: string | null;
  lessonTitle?: string | null;
  startedSentenceId?: string | null;
  lastSentenceId?: string | null;
  lastSentenceText?: string | null;
  status: "active" | "stopped" | "completed";
  stopReason: "" | "manual" | "completed" | "no-speech" | "failed-attempts" | "interrupted" | "service-error" | "navigation";
  noSpeechCount: number;
  failedAttemptCount: number;
  startedAt: string;
  endedAt?: string | null;
};

export type SpeechProviderComparisonResult = {
  provider: "mock" | "tencent" | "azure" | "xfyun" | string;
  status: "success" | "error" | string;
  durationMs: number;
  passed?: boolean;
  suggestedScore?: number;
  providerSuggestedScore?: number;
  pronAccuracy?: number;
  pronFluency?: number;
  pronCompletion?: number;
  severeIssues?: number;
  lowAccuracyIssues?: number;
  providerRejected?: boolean;
  providerExceptionCode?: number;
  result?: AssessmentResult;
  error?: string;
};
