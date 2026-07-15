import type {
  Attempt,
  AutomaticPracticeSession,
  ChildProfile,
  CourseLibraryResource,
  CourseSyncDraft,
  CourseSyncResult,
  CourseSyncStatus,
  HunyuanOcrServiceStatus,
  PlatformAdminAuditLog,
  OfficialCourseResource,
  PlatformCourseCandidate,
  Lesson,
  LessonProgress,
  PdfImportPreview,
  GeneratedRegistrationKey,
  RegistrationKeySnapshot,
  Sentence,
  TtsSubtitleResponse,
  TtsVoiceResponse
} from "./types";
import type { WavRecording } from "./wavRecorder";
import type { PictureBook } from "../data/pictureBooks";

export class AttemptSubmissionError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AttemptSubmissionError";
    this.code = code;
  }
}

type PracticeBookItemPatch = {
  status?: "pending" | "in_progress" | "completed";
  targetBookId?: string;
  direction?: "up" | "down";
};

type LessonSentenceInput = Partial<Omit<Sentence, "minScore" | "chapterId">> & { text: string };
const adminMutationHeader = { "X-Admin-Request": "1" } as const;

export type ParentSession = {
  kind: "parent";
  user: { id: string; username: string; role: string };
  household: { id: string; name: string };
};

export type ChildSession = {
  kind: "child";
  child: { id: string; name: string };
  household: { id: string; name: string };
  device: { id: string; label: string };
  reviewOnly?: boolean;
};

export type AccessSession = ParentSession | ChildSession;

export type ChildDevice = { id: string; childId: string; childName: string; label: string; expiresAt: string; revokedAt?: string | null; createdAt: string; lastSeenAt: string };

export class ParentAuthError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "ParentAuthError";
    this.code = code;
  }
}

async function readParentAuthResponse(response: Response): Promise<AccessSession> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.session) throw new ParentAuthError(String(body.error || "AUTH_FAILED"));
  return body.session;
}

export async function fetchParentSession(): Promise<AccessSession | null> {
  const response = await fetch("/api/auth/session");
  if (!response.ok) return null;
  const body = await response.json();
  return body.authenticated ? body.session : null;
}

export async function registerParentAccount(input: {
  registrationKey: string;
  householdName: string;
  username: string;
  password: string;
}): Promise<ParentSession> {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readParentAuthResponse(response) as Promise<ParentSession>;
}

export async function loginParentAccount(username: string, password: string): Promise<ParentSession> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return readParentAuthResponse(response) as Promise<ParentSession>;
}

export async function logoutParentAccount() {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function pairChildDevice(code: string, label: string): Promise<ChildSession> {
  const response = await fetch("/api/auth/child-pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, label }) });
  return readParentAuthResponse(response) as Promise<ChildSession>;
}

export async function startFilingReviewSession(): Promise<ChildSession> {
  const response = await fetch("/api/auth/filing-review", { method: "POST" });
  return readParentAuthResponse(response) as Promise<ChildSession>;
}

export async function createChildPairingCode(childId: string): Promise<{ code: string; childId: string; expiresAt: string }> {
  const response = await fetch("/api/admin/child-pairing-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ childId }) });
  if (!response.ok) throw new Error("Unable to create pairing code");
  return response.json();
}

export async function fetchChildDevices(): Promise<ChildDevice[]> {
  const response = await fetch("/api/admin/child-devices");
  if (!response.ok) throw new Error("Unable to load child devices");
  return response.json();
}

export async function revokeChildDevice(id: string) {
  const response = await fetch(`/api/admin/child-devices/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Unable to revoke child device");
}

export async function fetchLessons(): Promise<Lesson[]> {
  const response = await fetch("/api/lessons");
  if (!response.ok) {
    throw new Error("Unable to load lessons");
  }
  return response.json();
}

export async function fetchAdminLessons(includeArchived = false): Promise<Lesson[]> {
  const params = includeArchived ? `?${new URLSearchParams({ includeArchived: "1" }).toString()}` : "";
  const response = await fetch(`/api/admin/lessons${params}`);
  if (!response.ok) {
    throw new Error("Unable to load lessons");
  }
  return response.json();
}

export async function fetchCourseLibrary(): Promise<CourseLibraryResource[]> {
  const response = await fetch("/api/admin/course-library");
  if (!response.ok) throw new Error("Unable to load course library");
  return response.json();
}

export async function importCourseLibraryResource(resourceId: string): Promise<Lesson> {
  const response = await fetch(`/api/admin/course-library/${encodeURIComponent(resourceId)}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minScore: 75 })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body.error || "Unable to import course library resource"));
  }
  return response.json();
}

export async function fetchPlatformCourseCandidates(): Promise<PlatformCourseCandidate[]> {
  const response = await fetch("/api/platform-admin/course-candidates");
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "Unable to load course candidates");
  return response.json();
}

export async function fetchOfficialCourses(): Promise<OfficialCourseResource[]> {
  const response = await fetch("/api/platform-admin/courses");
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "Unable to load official courses");
  return response.json();
}

export async function fetchCourseSyncStatus(): Promise<CourseSyncStatus> {
  const response = await fetch("/api/platform-admin/course-sync/status");
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "Unable to load course sync status");
  return response.json();
}

export async function fetchCourseSyncDrafts(): Promise<CourseSyncDraft[]> {
  const response = await fetch("/api/platform-admin/course-sync/drafts");
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "Unable to load course sync drafts");
  return response.json();
}

export async function syncOfficialCourseToServer(input: {
  importId: string;
  chapters: PdfImportPreview["chapters"];
  resourceId?: string;
  title: string;
  description: string;
  level: string;
  language: string;
  tags: string[];
  sourceLabel: string;
}): Promise<CourseSyncResult> {
  const response = await fetch("/api/platform-admin/course-sync/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminMutationHeader },
    body: JSON.stringify(input)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.remoteError || body.error || "Unable to sync official course"));
  return body;
}

export async function publishCourseSyncDraft(draftId: string): Promise<OfficialCourseResource> {
  const response = await fetch(`/api/platform-admin/course-sync/drafts/${encodeURIComponent(draftId)}/publish`, { method: "POST", headers: adminMutationHeader });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "Unable to publish synced course draft"));
  return body;
}

export async function fetchHunyuanOcrStatus(): Promise<HunyuanOcrServiceStatus> {
  const response = await fetch("/api/platform-admin/hunyuan-ocr/status");
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "Unable to load HunyuanOCR status");
  return response.json();
}

export async function controlHunyuanOcr(action: "start" | "stop"): Promise<HunyuanOcrServiceStatus> {
  const response = await fetch(`/api/platform-admin/hunyuan-ocr/${action}`, { method: "POST", headers: adminMutationHeader });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || `Unable to ${action} HunyuanOCR`));
  return body;
}

export async function fetchPlatformAdminLogs(limit = 100): Promise<PlatformAdminAuditLog[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await fetch(`/api/platform-admin/logs?${params.toString()}`);
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "Unable to load platform admin logs");
  return response.json();
}

export async function fetchRegistrationKeys(): Promise<RegistrationKeySnapshot> {
  const response = await fetch("/api/platform-admin/registration-keys");
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "注册 Key 加载失败");
  return response.json();
}

export async function createRegistrationKeyBatch(input: {
  quantity: number;
  expiresInHours: number;
  note: string;
}): Promise<{ batchId: string; expiresAt: string; generated: GeneratedRegistrationKey[]; snapshot: RegistrationKeySnapshot }> {
  const response = await fetch("/api/platform-admin/registration-keys/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminMutationHeader },
    body: JSON.stringify(input)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "注册 Key 生成失败"));
  return body;
}

export async function updateRegistrationKeyNote(keyId: string, note: string): Promise<RegistrationKeySnapshot> {
  const response = await fetch(`/api/platform-admin/registration-keys/${encodeURIComponent(keyId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminMutationHeader },
    body: JSON.stringify({ note })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "备注保存失败"));
  return body;
}

export async function disableRegistrationKey(keyId: string): Promise<RegistrationKeySnapshot> {
  const response = await fetch(`/api/platform-admin/registration-keys/${encodeURIComponent(keyId)}/disable`, {
    method: "POST",
    headers: adminMutationHeader
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "注册 Key 停用失败"));
  return body;
}

export async function publishOfficialCourse(input: {
  importId: string;
  chapters: PdfImportPreview["chapters"];
  resourceId?: string;
  title: string;
  description: string;
  level: string;
  language: string;
  tags: string[];
  sourceLabel: string;
}): Promise<OfficialCourseResource> {
  const response = await fetch("/api/platform-admin/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminMutationHeader },
    body: JSON.stringify(input)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "Unable to publish official course"));
  return body;
}

export async function updateOfficialCourseStatus(resourceId: string, status: "published" | "unpublished"): Promise<OfficialCourseResource> {
  const response = await fetch(`/api/platform-admin/courses/${encodeURIComponent(resourceId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminMutationHeader },
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error("Unable to update official course status");
  return response.json();
}

export async function fetchProgress(childId?: string): Promise<LessonProgress[]> {
  const params = childId ? `?${new URLSearchParams({ childId }).toString()}` : "";
  const response = await fetch(`/api/progress${params}`);
  if (!response.ok) {
    throw new Error("Unable to load progress");
  }
  return response.json();
}

export async function fetchAttempt(attemptId: string, childId: string): Promise<Attempt> {
  const params = new URLSearchParams({ childId });
  const response = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Unable to load attempt");
  }
  return response.json();
}

export function getAttemptAudioUrl(attemptId: string, childId: string, variant: "enhanced" | "raw" = "enhanced") {
  const params = new URLSearchParams({ childId });
  if (variant === "raw") params.set("variant", "raw");
  return `/api/attempts/${encodeURIComponent(attemptId)}/audio?${params.toString()}`;
}

export async function fetchChildren(): Promise<ChildProfile[]> {
  const response = await fetch("/api/children");
  if (!response.ok) {
    throw new Error("Unable to load children");
  }
  return response.json();
}

export async function createAutomaticPracticeSession(input: {
  id: string;
  childId: string;
  lessonId: string;
  sentenceId: string;
}): Promise<AutomaticPracticeSession> {
  const response = await fetch("/api/automatic-practice-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error("Unable to start automatic practice session");
  return response.json();
}

export async function finishAutomaticPracticeSession(
  sessionId: string,
  input: {
    childId: string;
    sentenceId: string;
    stopReason: AutomaticPracticeSession["stopReason"];
    noSpeechCount: number;
    failedAttemptCount: number;
  }
): Promise<AutomaticPracticeSession> {
  const response = await fetch(`/api/automatic-practice-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error("Unable to finish automatic practice session");
  return response.json();
}

export async function fetchAutomaticPracticeSessions(childId: string, limit = 12): Promise<AutomaticPracticeSession[]> {
  const params = new URLSearchParams({ childId, limit: String(limit) });
  const response = await fetch(`/api/admin/automatic-practice-sessions?${params.toString()}`);
  if (!response.ok) throw new Error("Unable to load automatic practice sessions");
  return response.json();
}

export async function createChildProfile(name: string): Promise<ChildProfile> {
  const response = await fetch("/api/admin/children", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to create child profile");
  }

  return response.json();
}

export async function createPracticeBook(childId: string, title: string): Promise<ChildProfile> {
  const response = await fetch(`/api/admin/children/${encodeURIComponent(childId)}/practice-books`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to create practice book");
  }

  return response.json();
}

export async function updatePracticeBook(childId: string, bookId: string, title: string): Promise<ChildProfile> {
  const response = await fetch(
    `/api/admin/children/${encodeURIComponent(childId)}/practice-books/${encodeURIComponent(bookId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title })
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to update practice book");
  }

  return response.json();
}

export async function deletePracticeBook(childId: string, bookId: string): Promise<ChildProfile> {
  const response = await fetch(
    `/api/admin/children/${encodeURIComponent(childId)}/practice-books/${encodeURIComponent(bookId)}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to delete practice book");
  }

  return response.json();
}

export async function assignLessonToChild(childId: string, lessonId: string): Promise<ChildProfile> {
  const response = await fetch(`/api/admin/children/${encodeURIComponent(childId)}/assignment`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ lessonId })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to assign lesson");
  }

  return response.json();
}

export async function addLessonToPracticeBook(childId: string, lessonId: string, bookId?: string): Promise<ChildProfile> {
  const response = await fetch(`/api/admin/children/${encodeURIComponent(childId)}/practice-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ lessonId, bookId })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to add lesson to practice book");
  }

  return response.json();
}

export async function removeLessonFromPracticeBook(childId: string, lessonId: string, bookId?: string): Promise<ChildProfile> {
  const query = bookId ? `?${new URLSearchParams({ bookId }).toString()}` : "";
  const response = await fetch(
    `/api/admin/children/${encodeURIComponent(childId)}/practice-items/${encodeURIComponent(lessonId)}${query}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to remove lesson from practice book");
  }

  return response.json();
}

export async function updatePracticeBookItem(
  childId: string,
  itemId: string,
  input: PracticeBookItemPatch
): Promise<ChildProfile> {
  const response = await fetch(
    `/api/admin/children/${encodeURIComponent(childId)}/practice-book-items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to update practice item");
  }

  return response.json();
}

export async function movePracticeBookItem(childId: string, itemId: string, targetBookId: string): Promise<ChildProfile> {
  return updatePracticeBookItem(childId, itemId, { targetBookId });
}

export async function reorderPracticeBookItem(childId: string, itemId: string, direction: "up" | "down"): Promise<ChildProfile> {
  return updatePracticeBookItem(childId, itemId, { direction });
}

export async function removePracticeBookItem(childId: string, itemId: string): Promise<ChildProfile> {
  const response = await fetch(
    `/api/admin/children/${encodeURIComponent(childId)}/practice-book-items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to remove practice item");
  }

  return response.json();
}

export async function fetchTtsVoices(): Promise<TtsVoiceResponse> {
  const response = await fetch("/api/tts/voices");
  if (!response.ok) {
    throw new Error("Unable to load TTS voices");
  }
  return response.json();
}

export function getReferenceAudioUrl(sentence: Sentence, voiceId: string): string {
  if (sentence.id.startsWith("filing-review-")) return getStorybookTtsUrl(sentence.text, voiceId);
  const params = new URLSearchParams({ voice: voiceId });
  return `/api/tts/sentences/${encodeURIComponent(sentence.id)}?${params.toString()}`;
}

export function getStorybookTtsUrl(text: string, voiceId = ""): string {
  const params = new URLSearchParams({ text });
  if (voiceId) params.set("voice", voiceId);
  return `/api/tts/storybook?${params.toString()}`;
}

export async function fetchReferenceSubtitles(sentence: Sentence, voiceId: string): Promise<TtsSubtitleResponse> {
  if (sentence.id.startsWith("filing-review-")) {
    return { provider: "review", voiceId, sentenceId: sentence.id, subtitles: [] };
  }
  const params = new URLSearchParams({ voice: voiceId });
  const response = await fetch(`/api/tts/sentences/${encodeURIComponent(sentence.id)}/subtitles?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Unable to load TTS subtitles");
  }
  return response.json();
}

export async function createLessonFromText(input: {
  title: string;
  text?: string;
  sourceType?: string;
  tags?: string[];
  importQuality?: PdfImportPreview["quality"] | null;
  importId?: string;
  chapters?: Array<{
    id?: string;
    title: string;
    text: string;
    sections?: Array<{
      id?: string;
      title: string;
      type?: string;
      partKind?: string;
      partLabel?: string;
      focusQuestion?: string;
      sentences?: LessonSentenceInput[];
    }>;
    sentences?: LessonSentenceInput[];
  }>;
  minScore: number;
}): Promise<Lesson> {
  const response = await fetch("/api/admin/lessons", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to create lesson");
  }

  return response.json();
}

export async function previewLessonPdfImport(file: File, rule = "pep-textbook"): Promise<PdfImportPreview> {
  const form = new FormData();
  form.append("pdf", file, file.name);
  form.append("rule", rule);

  const response = await fetch("/api/import/pdf/preview", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const message = await response.text();
    let errorMessage = message;
    try {
      const parsed = JSON.parse(message) as { error?: string };
      errorMessage = parsed.error || message;
    } catch {
      errorMessage = message;
    }
    throw new Error(errorMessage || "Unable to import PDF");
  }

  return response.json();
}

export async function fetchLatestPdfImportPreview(): Promise<PdfImportPreview | null> {
  const response = await fetch("/api/import/pdf/latest");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error((await response.text()) || "Unable to restore PDF import");
  return response.json();
}

export async function fetchLessonPdfImportPreview(lessonId: string): Promise<PdfImportPreview | null> {
  const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}/pdf-import`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error((await response.text()) || "Unable to restore lesson PDF import");
  return response.json();
}

export async function updateLessonFromText(
  lessonId: string,
  input: {
    title: string;
    text?: string;
    sourceType?: string;
    tags?: string[];
    importQuality?: PdfImportPreview["quality"] | null;
    importId?: string;
    chapters?: Array<{
      id?: string;
      title: string;
      text: string;
      sections?: Array<{
        id?: string;
        title: string;
        type?: string;
        partKind?: string;
        partLabel?: string;
        focusQuestion?: string;
        sentences?: LessonSentenceInput[];
      }>;
      sentences?: LessonSentenceInput[];
    }>;
    minScore: number;
  }
): Promise<Lesson> {
  const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to update lesson");
  }

  return response.json();
}

export async function updateLessonStatus(lessonId: string, status: "published" | "archived"): Promise<Lesson> {
  const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to update lesson status");
  }

  return response.json();
}

export async function submitAttempt(
  sentence: Sentence,
  recording: WavRecording,
  childId?: string
): Promise<Attempt> {
  const form = new FormData();
  if (childId) {
    form.append("childId", childId);
  }
  form.append("sentenceId", sentence.id);
  form.append("referenceText", sentence.text);
  form.append("minScore", String(sentence.minScore));
  form.append("durationMs", String(recording.durationMs));
  form.append("recordingQuality", JSON.stringify(recording.quality));
  form.append(
    "candidateMetadata",
    JSON.stringify([
      ...recording.candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind,
        startedAtMs: candidate.startedAtMs,
        endedAtMs: candidate.endedAtMs,
        durationMs: candidate.durationMs,
        voiceDurationMs: candidate.voiceDurationMs,
        quality: candidate.quality
      })),
      {
        id: "full-session",
        kind: "full-session",
        startedAtMs: 0,
        endedAtMs: recording.durationMs,
        durationMs: recording.durationMs,
        quality: recording.quality
      }
    ])
  );
  form.append("audio", recording.blob, `${sentence.id}-full.wav`);
  recording.candidates.forEach((candidate) => {
    form.append("candidateAudio", candidate.blob, `${sentence.id}-${candidate.id}.wav`);
  });

  const response = await fetch("/api/attempts", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new AttemptSubmissionError(payload?.error || "Unable to score reading", payload?.code);
  }

  return response.json();
}

export async function submitStorybookAttempt(input: {
  bookId: string;
  pageId: string;
  sentence: Sentence;
  recording: WavRecording;
  childId: string;
}): Promise<Attempt> {
  const form = new FormData();
  form.append("childId", input.childId);
  form.append("storybookId", input.bookId);
  form.append("storybookPageId", input.pageId);
  form.append("sentenceId", input.sentence.id);
  form.append("referenceText", input.sentence.text);
  form.append("minScore", String(input.sentence.minScore));
  form.append("durationMs", String(input.recording.durationMs));
  form.append("recordingQuality", JSON.stringify(input.recording.quality));
  form.append("candidateMetadata", JSON.stringify([
    ...input.recording.candidates.map((candidate) => ({ id: candidate.id, kind: candidate.kind, startedAtMs: candidate.startedAtMs, endedAtMs: candidate.endedAtMs, durationMs: candidate.durationMs, voiceDurationMs: candidate.voiceDurationMs, quality: candidate.quality })),
    { id: "full-session", kind: "full-session", startedAtMs: 0, endedAtMs: input.recording.durationMs, durationMs: input.recording.durationMs, quality: input.recording.quality }
  ]));
  form.append("audio", input.recording.blob, `${input.sentence.id}-full.wav`);
  input.recording.candidates.forEach((candidate) => form.append("candidateAudio", candidate.blob, `${input.sentence.id}-${candidate.id}.wav`));
  const response = await fetch("/api/attempts", { method: "POST", body: form });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new AttemptSubmissionError(payload?.error || "Unable to score storybook reading", payload?.code);
  }
  return response.json();
}

export async function fetchStorybookAttempts(bookId: string, childId: string): Promise<Attempt[]> {
  const params = new URLSearchParams({ childId });
  const response = await fetch(`/api/storybooks/${encodeURIComponent(bookId)}/attempts?${params.toString()}`);
  if (!response.ok) throw new Error("Unable to load storybook progress");
  return response.json();
}

export type StorybookImportPreview = {
  id: string;
  title: string;
  originalName: string;
  pageCount: number;
  pages: Array<{ id: string; pageNumber: number; imageUrl: string; text: string; sentences: string[]; practiceEnabled: boolean; reviewReason?: string }>;
};

export async function importStorybookPdfPreview(file: File): Promise<StorybookImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/admin/storybooks/import-preview", { method: "POST", body: form });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Unable to parse picture-book PDF");
  }
  return response.json();
}

export async function saveStorybookImportPreview(previewId: string, title: string, pages: StorybookImportPreview["pages"]): Promise<PictureBook> {
  const response = await fetch(`/api/admin/storybooks/import-previews/${encodeURIComponent(previewId)}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, pages: pages.map((page) => ({ pageNumber: page.pageNumber, practiceEnabled: page.practiceEnabled, sentences: page.sentences })) })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Unable to save picture book");
  }
  return response.json();
}

export async function fetchImportedStorybooks(): Promise<PictureBook[]> {
  const response = await fetch("/api/storybooks");
  if (!response.ok) throw new Error("Unable to load imported picture books");
  return response.json();
}

export async function fetchImportedStorybook(bookId: string): Promise<PictureBook> {
  const response = await fetch(`/api/storybooks/${encodeURIComponent(bookId)}`);
  if (!response.ok) throw new Error("Unable to load imported picture book");
  return response.json();
}

export async function deleteImportedStorybook(bookId: string): Promise<void> {
  const response = await fetch(`/api/admin/storybooks/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Unable to delete picture book");
  }
}
