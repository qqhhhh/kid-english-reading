import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { AssessmentResultLike } from "../shared/assessmentTypes.js";
import { projectRoot } from "./projectRoot.js";
import type { PdfImportChapter, PdfImportQualityReport, PdfImportSnapshot } from "./types/pdf.js";
import type {
  ChildDeviceSessionRecord,
  ChildPairingCodeRecord,
  ParentSessionRecord,
  ParentUserRecord,
  RegistrationKeyRecord
} from "./types/data.js";

type DatabaseRow = Record<string, SQLOutputValue>;
type JsonRecord = Record<string, unknown>;
type LessonDifficulty = "starter" | "easy" | "medium" | "hard";

interface LessonSentenceInput extends JsonRecord {
  id: string;
  text: string;
  minScore?: number;
  itemType?: string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
}

interface LessonSectionInput extends JsonRecord {
  id?: string;
  title?: string;
  type?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
  sentenceIds?: string[];
  sentences?: LessonSentenceInput[];
  items?: Array<Partial<LessonSentenceInput>>;
}

interface LessonChapterInput extends JsonRecord {
  id?: string;
  title?: string;
  body?: string;
  sections?: LessonSectionInput[];
  sentences: LessonSentenceInput[];
}

interface HydratedLessonSentence extends JsonRecord {
  id: string;
  text: string;
  minScore: number;
  required?: boolean;
}

interface HydratedLessonSection extends JsonRecord {
  id: string;
  title: string;
  type: string;
  partKind: string;
  partLabel: string;
  focusQuestion: string;
  sentences: HydratedLessonSentence[];
}

interface StorybookAttemptInput extends JsonRecord {
  id: string;
  householdId: string;
  childId: string;
  storybookId: string;
  storybookPageId: string;
  sentenceId: string;
  referenceText: string;
  result?: AssessmentResultLike;
  passed?: boolean;
  createdAt: string;
}

interface HydratedAttempt extends JsonRecord {
  id: string;
  childId?: string;
  sentenceId: string;
  referenceText: string;
  createdAt: string;
  speechProvider: string;
  audioBytes: number;
  result: AssessmentResultLike;
  passed: boolean;
  severeIssues: number;
}

interface StorybookSentence extends JsonRecord {
  id: string;
  text: string;
  position?: number;
  required?: boolean;
}

interface StorybookPage extends JsonRecord {
  id: string;
  position: number;
  kind: string;
  storage?: { previewId?: string; pageNumber?: number };
  practiceEnabled?: boolean;
  sourceText?: string;
  sentences: StorybookSentence[];
}

interface HydratedStorybook extends JsonRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  language: string;
  level: string;
  tags: unknown[];
  source: JsonRecord;
  license: JsonRecord;
  creators: unknown[];
  pages: StorybookPage[];
  createdAt: string;
  updatedAt: string;
  imported: true;
}

interface StorybookInput extends JsonRecord {
  id: string;
  householdId: string;
  title: string;
  slug: string;
  summary?: string;
  language?: string;
  level?: string;
  tags?: unknown[];
  source?: JsonRecord;
  license?: JsonRecord;
  creators?: unknown[];
  pages?: StorybookPage[];
}

interface AttemptInput extends JsonRecord {
  id: string;
  householdId: string;
  childId: string;
  sentenceId: string;
  referenceText: string;
  createdAt: string;
  speechProvider?: string;
  audioBytes?: number;
  result?: AssessmentResultLike;
  passed?: boolean;
  severeIssues?: number;
  recordingQuality?: unknown;
  clientDevice?: unknown;
  candidateSelection?: unknown;
  speechEnhancement?: unknown;
  speechProviderComparison?: unknown;
  liveSpeechComparison?: unknown;
  assessmentItemType?: "word" | "sentence" | "paragraph";
  assessmentSource?: "live-stream" | "raw-wav-fallback" | "batch";
  processingTimings?: unknown;
  extraIssues?: number;
  unscoredIssues?: number;
  lowAccuracyIssues?: number;
  minWordAccuracy?: number | null;
}

interface PracticeBookItemRow extends DatabaseRow {
  id: string;
  bookId: string;
  lessonId: string;
  status: string;
  position: number;
}

interface LegacyPracticeItemRow {
  childId: string;
  lessonId: string;
  status: string;
  position: SQLOutputValue | undefined;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface OfficialCourseContent extends JsonRecord {
  chapters?: LessonChapterInput[];
}

interface CourseSyncDraftAsset extends JsonRecord {
  fileName?: string;
  pageNumber?: number;
  url?: string;
  bytes?: number;
  sha256?: string;
}

interface CourseSyncManifest extends JsonRecord {
  packageId?: string;
  source?: JsonRecord & { importId?: unknown };
  metadata?: JsonRecord & {
    resourceId?: unknown;
    slug?: unknown;
    title?: unknown;
    description?: unknown;
    level?: unknown;
    language?: unknown;
    tags?: unknown[];
    sourceLabel?: unknown;
  };
  content?: JsonRecord & { id?: unknown; chapters?: PdfImportChapter[] };
  quality?: PdfImportQualityReport;
  snapshot?: PdfImportSnapshot | null;
  assets?: CourseSyncDraftAsset[];
}

interface CourseSyncDraft {
  id: string;
  packageHash: string;
  sourceImportId: string;
  targetResourceId: string;
  title: string;
  status: string;
  manifest: CourseSyncManifest;
  assets: CourseSyncDraftAsset[];
  receivedAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedResourceId?: string;
  publishedVersion?: number;
}

interface PublishOfficialCourseInput {
  id: string;
  slug: string;
  title: string;
  description?: string;
  level?: string;
  language?: string;
  tags?: unknown;
  sourceLabel?: string;
  sourceHouseholdId: string;
  sourceLessonId: string;
  content: JsonRecord;
  quality?: unknown;
  createdByUserId: string;
}

interface LessonWriteInput {
  id: string;
  title: string;
  sourceType?: string;
  tags?: unknown;
  body?: string;
  sentences?: LessonSentenceInput[];
  chapters?: LessonChapterInput[];
  householdId: string;
  importQuality?: unknown;
  importId?: string | null;
}

interface LessonUpdateInput extends Omit<LessonWriteInput, "sourceType" | "sentences"> {
  importQuality?: unknown;
  importId?: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asRow<T>(row: DatabaseRow | undefined): T | undefined {
  return row as unknown as T | undefined;
}

function asRows<T>(rows: DatabaseRow[]): T[] {
  return rows as unknown as T[];
}

function numericColumn(row: DatabaseRow | undefined, column: string, fallback = 0) {
  return Number(row?.[column] ?? fallback);
}

const dataDir = process.env.KID_READING_DATA_DIR
  ? path.resolve(process.env.KID_READING_DATA_DIR)
  : path.join(projectRoot, "server", "data");
const dbPath = process.env.KID_READING_DB_PATH || path.join(dataDir, "app.sqlite");
const seedLessonsPath = path.join(projectRoot, "server", "lessons.json");
const legacyAttemptsPath = path.join(dataDir, "attempts.json");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
let databaseClosed = false;

export function closeDatabase(): void {
  if (databaseClosed) return;
  db.close();
  databaseClosed = true;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function normalizeLessonDifficulty(value: unknown): LessonDifficulty {
  const difficulty = String(value || "starter").trim().toLowerCase();
  return (["starter", "easy", "medium", "hard"] as string[]).includes(difficulty) ? difficulty as LessonDifficulty : "starter";
}

function getLessonDifficultyTag(value: unknown) {
  const tags: Record<LessonDifficulty, string> = {
    starter: "启蒙",
    easy: "简单",
    medium: "进阶",
    hard: "挑战"
  };
  return tags[normalizeLessonDifficulty(value)];
}

function normalizeLessonTags(tags: unknown): string[] {
  const source = Array.isArray(tags) ? tags : [];
  return Array.from(
    new Set(
      source
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

function normalizeChapterSectionsForStorage(chapter: LessonChapterInput) {
  const source = Array.isArray(chapter.sections) ? chapter.sections : [];
  return source
    .map((section, index) => {
      const sentenceIds = Array.isArray(section.sentences)
        ? section.sentences.map((sentence) => String(sentence.id || "").trim()).filter(Boolean)
        : Array.isArray(section.sentenceIds)
          ? section.sentenceIds.map((id) => String(id || "").trim()).filter(Boolean)
          : [];
      const items = Array.isArray(section.sentences)
        ? section.sentences.map((sentence) => ({
            id: String(sentence.id || "").trim(),
            itemType: ["word", "reading"].includes(String(sentence.itemType || "")) ? String(sentence.itemType) : "sentence",
            phonetic: String(sentence.phonetic || "").trim(),
            translation: String(sentence.translation || "").trim(),
            required: sentence.required !== false,
            panelNumber: Number(sentence.panelNumber || 0)
          }))
        : [];
      return {
        id: String(section.id || `section-${index + 1}`).trim(),
        title: String(section.title || `Section ${index + 1}`).trim(),
        type: String(section.type || "custom").trim(),
        partKind: String(section.partKind || "").trim(),
        partLabel: String(section.partLabel || "").trim(),
        focusQuestion: String(section.focusQuestion || "").trim(),
        sentenceIds,
        items
      };
    })
    .filter((section) => section.id && section.title);
}

function hydrateChapterSections(sectionsJson: unknown, sentences: HydratedLessonSentence[]): HydratedLessonSection[] {
  const storedSections = parseJson<LessonSectionInput[]>(sectionsJson, []);
  if (!Array.isArray(storedSections) || storedSections.length === 0) return [];

  const sentenceById = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  return storedSections
    .map((section, index) => {
      const sentenceIds = Array.isArray(section.sentenceIds) ? section.sentenceIds : [];
      const itemById = new Map(
        (Array.isArray(section.items) ? section.items : []).map((item) => [String(item.id || ""), item])
      );
      return {
        id: String(section.id || `section-${index + 1}`),
        title: String(section.title || `Section ${index + 1}`),
        type: String(section.type || "custom"),
        partKind: String(section.partKind || ""),
        partLabel: String(section.partLabel || ""),
        focusQuestion: String(section.focusQuestion || ""),
        sentences: sentenceIds
          .map((sentenceId) => {
            const sentence = sentenceById.get(sentenceId);
            if (!sentence) return null;
            const item = itemById.get(sentenceId);
            return item
              ? {
                  ...sentence,
                  itemType: String(item.itemType || "sentence"),
                  phonetic: String(item.phonetic || ""),
                  translation: String(item.translation || ""),
                  required: item.required !== false,
                  panelNumber: Number(item.panelNumber || 0)
                }
              : sentence;
          })
          .filter((sentence): sentence is HydratedLessonSentence => Boolean(sentence))
      };
    })
    .filter((section) => section.sentences.length > 0 || section.title);
}

function buildChapterHierarchy(sections: HydratedLessonSection[], chapterId: string) {
  const leadInActivities = sections.filter((section) => section.partKind === "lead-in");
  const partMap = new Map<string, { id: string; label: string; focusQuestion: string; activities: HydratedLessonSection[] }>();

  for (const section of sections) {
    if (section.partKind !== "part" || !section.partLabel) continue;
    if (!partMap.has(section.partLabel)) {
      partMap.set(section.partLabel, {
        id: `${chapterId}-part-${section.partLabel.toLowerCase()}`,
        label: section.partLabel,
        focusQuestion: section.focusQuestion || "",
        activities: []
      });
    }
    partMap.get(section.partLabel)?.activities.push(section);
  }

  return {
    ...(leadInActivities.length > 0
      ? {
          leadIn: {
            id: `${chapterId}-lead-in`,
            label: "Lead-in",
            focusQuestion: "",
            activities: leadInActivities
          }
        }
      : {}),
    parts: [...partMap.values()]
  };
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'preset',
      difficulty TEXT NOT NULL DEFAULT 'starter',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passages (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      sections_json TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sentences (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      passage_id TEXT REFERENCES passages(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      min_score INTEGER NOT NULL DEFAULT 75,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      sentence_id TEXT NOT NULL,
      reference_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      speech_provider TEXT NOT NULL,
      audio_bytes INTEGER NOT NULL DEFAULT 0,
      suggested_score REAL NOT NULL DEFAULT 0,
      pron_accuracy REAL NOT NULL DEFAULT 0,
      pron_fluency REAL NOT NULL DEFAULT 0,
      pron_completion REAL NOT NULL DEFAULT 0,
      severe_issues INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS child_lesson_assignments (
      child_id TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS child_practice_items (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(child_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS practice_books (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS practice_book_items (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES practice_books(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(book_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      extracted_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automatic_practice_sessions (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
      started_sentence_id TEXT REFERENCES sentences(id) ON DELETE SET NULL,
      last_sentence_id TEXT REFERENCES sentences(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      stop_reason TEXT NOT NULL DEFAULT '',
      no_speech_count INTEGER NOT NULL DEFAULT 0,
      failed_attempt_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storybook_attempts (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      sentence_id TEXT NOT NULL,
      reference_text TEXT NOT NULL,
      suggested_score REAL NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      attempt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storybooks (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'en',
      level TEXT NOT NULL DEFAULT '启蒙',
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_json TEXT NOT NULL DEFAULT '{}',
      license_json TEXT NOT NULL DEFAULT '{}',
      creators_json TEXT NOT NULL DEFAULT '[]',
      pages_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(household_id, slug)
    );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS parent_users (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS registration_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL DEFAULT '',
        batch_id TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        max_uses INTEGER NOT NULL DEFAULT 1,
        use_count INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        disabled_at TEXT,
        created_by_user_id TEXT,
        consumed_by_user_id TEXT,
        consumed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES parent_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS child_pairing_codes (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_by_user_id TEXT NOT NULL REFERENCES parent_users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS child_device_sessions (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS official_course_resources (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        level TEXT NOT NULL DEFAULT '入门',
        language TEXT NOT NULL DEFAULT '英语',
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_label TEXT NOT NULL DEFAULT '官方课程',
        status TEXT NOT NULL DEFAULT 'published',
        current_version INTEGER NOT NULL DEFAULT 1,
        created_by_user_id TEXT NOT NULL REFERENCES parent_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS official_course_versions (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES official_course_resources(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        source_household_id TEXT NOT NULL,
        source_lesson_id TEXT NOT NULL,
        content_json TEXT NOT NULL,
        quality_json TEXT NOT NULL DEFAULT '{}',
        created_by_user_id TEXT NOT NULL REFERENCES parent_users(id),
        created_at TEXT NOT NULL,
        UNIQUE(resource_id, version)
      );

      CREATE TABLE IF NOT EXISTS course_sync_drafts (
        id TEXT PRIMARY KEY,
        package_hash TEXT NOT NULL UNIQUE,
        source_import_id TEXT NOT NULL,
        target_resource_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        assets_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        published_resource_id TEXT,
        published_version INTEGER
      );

      CREATE TABLE IF NOT EXISTS course_sync_nonces (
        key_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (key_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS platform_admin_audit_logs (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        actor_user_id TEXT NOT NULL,
        actor_username TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

    CREATE INDEX IF NOT EXISTS idx_sentences_lesson_position ON sentences(lesson_id, position);
    CREATE INDEX IF NOT EXISTS idx_attempts_sentence_created ON attempts(sentence_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_child_practice_child_position ON child_practice_items(child_id, status, position, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_books_default ON practice_books(child_id, type) WHERE type = 'default';
    CREATE INDEX IF NOT EXISTS idx_practice_books_child_position ON practice_books(child_id, position, created_at);
    CREATE INDEX IF NOT EXISTS idx_practice_book_items_book_position ON practice_book_items(book_id, status, position, created_at);
      CREATE INDEX IF NOT EXISTS idx_automatic_sessions_child_started ON automatic_practice_sessions(child_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_parent_users_household ON parent_users(household_id, status);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires ON auth_sessions(user_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_child_pairing_codes_child_expires ON child_pairing_codes(child_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_child_device_sessions_household ON child_device_sessions(household_id, child_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_storybook_attempts_child_book ON storybook_attempts(household_id, child_id, book_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_storybooks_household_updated ON storybooks(household_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_official_courses_status_updated ON official_course_resources(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_official_course_versions_resource ON official_course_versions(resource_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_course_sync_drafts_status_received ON course_sync_drafts(status, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_course_sync_nonces_expires ON course_sync_nonces(expires_at);
      CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_created ON platform_admin_audit_logs(created_at DESC, sequence DESC);
    `);

  addColumnIfMissing("attempts", "child_id", "TEXT");
  addColumnIfMissing("attempts", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing("children", "household_id", "TEXT REFERENCES households(id)");
  addColumnIfMissing("lessons", "household_id", "TEXT REFERENCES households(id)");
  addColumnIfMissing("attempts", "household_id", "TEXT REFERENCES households(id)");
  addColumnIfMissing("imports", "household_id", "TEXT REFERENCES households(id)");
  addColumnIfMissing("automatic_practice_sessions", "household_id", "TEXT REFERENCES households(id)");
  addColumnIfMissing("lessons", "difficulty", "TEXT NOT NULL DEFAULT 'starter'");
  addColumnIfMissing("lessons", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing("lessons", "import_quality_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing("lessons", "import_id", "TEXT");
  addColumnIfMissing("passages", "sections_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing("registration_keys", "key_prefix", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("registration_keys", "batch_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("registration_keys", "note", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("registration_keys", "created_by_user_id", "TEXT");
  addColumnIfMissing("registration_keys", "consumed_by_user_id", "TEXT");
  addColumnIfMissing("registration_keys", "consumed_at", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_child_sentence_created ON attempts(child_id, sentence_id, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_lessons_status_difficulty ON lessons(status, difficulty, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_children_household_created ON children(household_id, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_lessons_household_status ON lessons(household_id, status, updated_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_household_child_created ON attempts(household_id, child_id, created_at);");
}

export function insertStorybookAttempt(attempt: StorybookAttemptInput) {
  const householdId = requireHouseholdId(attempt.householdId);
  assertHouseholdChild(householdId, attempt.childId);
  db.prepare(`
    INSERT INTO storybook_attempts (
      id, household_id, child_id, book_id, page_id, sentence_id, reference_text,
      suggested_score, passed, attempt_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    attempt.id,
    householdId,
    attempt.childId,
    attempt.storybookId,
    attempt.storybookPageId,
    attempt.sentenceId,
    attempt.referenceText,
    Number(attempt.result?.SuggestedScore || 0),
    attempt.passed ? 1 : 0,
    JSON.stringify(attempt),
    attempt.createdAt
  );
}

export function updateStorybookAttemptMetadata(
  attemptId: string,
  householdId: string,
  updates: Record<string, unknown>
) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  const row = db.prepare(`
    SELECT attempt_json AS attemptJson
    FROM storybook_attempts
    WHERE id = ? AND household_id = ?
  `).get(attemptId, scopedHouseholdId);
  if (!row) return false;
  const attempt = parseJson<JsonRecord>(row.attemptJson, {});
  db.prepare(`
    UPDATE storybook_attempts
    SET attempt_json = ?
    WHERE id = ? AND household_id = ?
  `).run(JSON.stringify({ ...attempt, ...updates }), attemptId, scopedHouseholdId);
  return true;
}

export function listStorybookAttempts({ householdId, childId, bookId }: { householdId: string; childId: string; bookId: string }) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  assertHouseholdChild(scopedHouseholdId, childId);
  return db.prepare(`
    SELECT attempt_json AS attemptJson
    FROM storybook_attempts
    WHERE household_id = ? AND child_id = ? AND book_id = ?
    ORDER BY created_at DESC
  `).all(scopedHouseholdId, childId, bookId).map((row) => parseJson(row.attemptJson, null)).filter(Boolean);
}

export function createStorybook(storybook: StorybookInput) {
  const householdId = requireHouseholdId(storybook.householdId);
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO storybooks (
      id, household_id, title, slug, summary, language, level, tags_json,
      source_json, license_json, creators_json, pages_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    storybook.id,
    householdId,
    storybook.title,
    storybook.slug,
    storybook.summary || "",
    storybook.language || "en",
    storybook.level || "启蒙",
    JSON.stringify(storybook.tags || []),
    JSON.stringify(storybook.source || {}),
    JSON.stringify(storybook.license || {}),
    JSON.stringify(storybook.creators || []),
    JSON.stringify(storybook.pages || []),
    createdAt,
    createdAt
  );
  return findStorybookById(storybook.id, householdId);
}

export function listStorybooks(householdId: string) {
  return db.prepare(`SELECT * FROM storybooks WHERE household_id = ? ORDER BY updated_at DESC`).all(requireHouseholdId(householdId)).map(hydrateStorybookRow);
}

export function findStorybookById(id: string, householdId: string) {
  const row = db.prepare(`SELECT * FROM storybooks WHERE id = ? AND household_id = ?`).get(id, requireHouseholdId(householdId));
  return row ? hydrateStorybookRow(row) : null;
}

export function deleteStorybook(id: string, householdId: string) {
  const result = db.prepare(`DELETE FROM storybooks WHERE id = ? AND household_id = ?`).run(id, requireHouseholdId(householdId));
  return Number(result.changes || 0) > 0;
}

function hydrateStorybookRow(row: DatabaseRow): HydratedStorybook {
  return {
    id: String(row.id || ""),
    slug: String(row.slug || ""),
    title: String(row.title || ""),
    summary: String(row.summary || ""),
    language: String(row.language || ""),
    level: String(row.level || ""),
    tags: parseJson<unknown[]>(row.tags_json, []),
    source: parseJson<JsonRecord>(row.source_json, {}),
    license: parseJson<JsonRecord>(row.license_json, {}),
    creators: parseJson<unknown[]>(row.creators_json, []),
    pages: parseJson<StorybookPage[]>(row.pages_json, []),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    imported: true
  };
}

function addColumnIfMissing(tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}

function ensureDefaultChild(householdId: string) {
  if (!householdId) return;
  const count = numericColumn(db.prepare("SELECT COUNT(*) AS count FROM children").get(), "count");
  if (count > 0) return;

  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO children (id, name, household_id, created_at, updated_at)
    VALUES ('child-default', '小朋友', ?, ?, ?)
  `).run(householdId, createdAt, createdAt);
}

function defaultPracticeBookId(childId: string) {
  return `practice-book-${childId}-default`;
}

function ensureDefaultPracticeBooks() {
  const children = db.prepare("SELECT id, created_at AS createdAt, updated_at AS updatedAt FROM children").all();
  const insertBook = db.prepare(`
    INSERT OR IGNORE INTO practice_books (id, child_id, title, type, position, created_at, updated_at)
    VALUES (?, ?, '默认练习簿', 'default', 0, ?, ?)
  `);

  for (const child of children) {
    const createdAt = child.createdAt || nowIso();
    insertBook.run(defaultPracticeBookId(String(child.id)), child.id, createdAt, child.updatedAt || createdAt);
  }
}

function getDefaultPracticeBook(childId: string) {
  const book = asRow<DatabaseRow & { id: string }>(db
    .prepare(
      `SELECT id
       FROM practice_books
       WHERE child_id = ?
       ORDER BY CASE WHEN type = 'default' THEN 0 ELSE 1 END, position ASC, created_at ASC
       LIMIT 1`
    )
    .get(childId));

  if (!book) {
    throw new Error("Practice book not found");
  }

  return book;
}

function getPracticeBookItemForChild(childId: string, itemId: string) {
  return asRow<PracticeBookItemRow>(db
    .prepare(
      `SELECT
        p.id,
        p.book_id AS bookId,
        p.lesson_id AS lessonId,
        p.status,
        p.position
      FROM practice_book_items p
      LEFT JOIN practice_books b ON b.id = p.book_id
      WHERE p.id = ? AND b.child_id = ? AND p.status != 'archived'`
    )
    .get(itemId, childId));
}

function touchPracticeBook(bookId: string) {
  db.prepare("UPDATE practice_books SET updated_at = ? WHERE id = ?").run(nowIso(), bookId);
}

function getOrCreateMigrationPracticeBook(childId: string) {
  const existingBook = asRow<DatabaseRow & { id: string }>(db
    .prepare("SELECT id FROM practice_books WHERE child_id = ? ORDER BY position ASC, created_at ASC LIMIT 1")
    .get(childId));
  if (existingBook) return existingBook;

  const createdAt = nowIso();
  const bookId = `practice-book-${childId}-imported`;
  db.prepare(`
    INSERT OR IGNORE INTO practice_books (id, child_id, title, type, position, created_at, updated_at)
    VALUES (?, ?, '导入练习簿', 'custom', 0, ?, ?)
  `).run(bookId, childId, createdAt, createdAt);

  return asRow<DatabaseRow & { id: string }>(db.prepare("SELECT id FROM practice_books WHERE id = ?").get(bookId))!;
}

function normalizePracticeBookItemPositions(bookId: string) {
  const rows = db
    .prepare(
      `SELECT id
       FROM practice_book_items
       WHERE book_id = ? AND status != 'archived'
       ORDER BY position ASC, created_at ASC, id ASC`
    )
    .all(bookId);
  const updatePosition = db.prepare("UPDATE practice_book_items SET position = ? WHERE id = ?");

  rows.forEach((row, index) => {
    updatePosition.run(index, row.id);
  });
}

function migrateLegacyPracticeItems() {
  const assignments = db
    .prepare(
      `SELECT child_id AS childId, lesson_id AS lessonId, created_at AS createdAt, updated_at AS updatedAt
       FROM child_lesson_assignments`
    )
    .all();
  const legacyPracticeItems = asRows<LegacyPracticeItemRow>(db
    .prepare(
      `SELECT child_id AS childId, lesson_id AS lessonId, status, position, created_at AS createdAt, updated_at AS updatedAt
       FROM child_practice_items`
    )
    .all());
  const legacyItems: LegacyPracticeItemRow[] = [
    ...legacyPracticeItems,
    ...assignments.map((assignment) => ({
      ...assignment,
      childId: String(assignment.childId || ""),
      lessonId: String(assignment.lessonId || ""),
      createdAt: String(assignment.createdAt || ""),
      updatedAt: String(assignment.updatedAt || ""),
      status: "pending",
      position: undefined
    }))
  ];

  if (legacyItems.length === 0) return;

  const maxPosition = db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM practice_book_items WHERE book_id = ?");
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO practice_book_items (id, book_id, lesson_id, status, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN;");
  try {
    for (const item of legacyItems) {
      const book = getOrCreateMigrationPracticeBook(String(item.childId));
      const currentPosition = numericColumn(maxPosition.get(book.id), "position", -1);
      insertItem.run(
        `practice-item-${book.id}-${item.lessonId}`,
        book.id,
        item.lessonId,
        item.status || "pending",
        Number.isFinite(Number(item.position)) ? Number(item.position) : currentPosition + 1,
        item.createdAt || nowIso(),
        item.updatedAt || item.createdAt || nowIso()
      );
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function seedLessonsIfEmpty(householdId: string) {
  if (!householdId) return;
  const count = numericColumn(db.prepare("SELECT COUNT(*) AS count FROM lessons").get(), "count");
  if (count > 0 || !fs.existsSync(seedLessonsPath)) return;

  const lessons = parseJson<Array<{ id: string; title: string; sentences?: LessonSentenceInput[] }>>(fs.readFileSync(seedLessonsPath, "utf8"), []);
  const insertLesson = db.prepare(`
    INSERT INTO lessons (id, title, description, source_type, status, household_id, created_at, updated_at)
    VALUES (?, ?, '', 'preset', 'published', ?, ?, ?)
  `);
  const insertPassage = db.prepare(`
    INSERT INTO passages (id, lesson_id, title, body, sections_json, position, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[]', 0, 'published', ?, ?)
  `);
  const insertSentence = db.prepare(`
    INSERT INTO sentences (id, lesson_id, passage_id, position, text, min_score, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `);

  db.exec("BEGIN;");
  try {
    for (const lesson of lessons) {
      const createdAt = nowIso();
      const passageId = `${lesson.id}-main`;
      const sentences = Array.isArray(lesson.sentences) ? lesson.sentences : [];
      insertLesson.run(lesson.id, lesson.title, householdId, createdAt, createdAt);
      insertPassage.run(
        passageId,
        lesson.id,
        lesson.title,
        sentences.map((sentence) => sentence.text).join("\n"),
        createdAt,
        createdAt
      );
      sentences.forEach((sentence, index) => {
        insertSentence.run(
          sentence.id,
          lesson.id,
          passageId,
          index,
          sentence.text,
          Number(sentence.minScore || 75),
          createdAt,
          createdAt
        );
      });
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function migrateLessonDifficultyTags() {
  const migrationKey = "lesson_difficulty_tags_v1";
  const existing = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(migrationKey);
  if (existing) return;

  const lessons = db
    .prepare("SELECT id, difficulty, tags_json AS tagsJson FROM lessons")
    .all();
  const updateLessonTags = db.prepare("UPDATE lessons SET tags_json = ?, updated_at = ? WHERE id = ?");
  const upsertMeta = db.prepare(`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES (?, 'done', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const updatedAt = nowIso();

  db.exec("BEGIN;");
  try {
    for (const lesson of lessons) {
      const difficultyTag = getLessonDifficultyTag(lesson.difficulty);
      const tags = normalizeLessonTags([...parseJson(lesson.tagsJson, []), difficultyTag]);
      updateLessonTags.run(JSON.stringify(tags), updatedAt, lesson.id);
    }
    upsertMeta.run(migrationKey, updatedAt);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function migrateLegacyAttemptsIfNeeded() {
  const count = numericColumn(db.prepare("SELECT COUNT(*) AS count FROM attempts").get(), "count");
  if (count > 0 || !fs.existsSync(legacyAttemptsPath)) return;

  const attempts = parseJson<AttemptInput[]>(fs.readFileSync(legacyAttemptsPath, "utf8"), []);
  const insertAttempt = db.prepare(`
    INSERT OR IGNORE INTO attempts (
      id,
      sentence_id,
      reference_text,
      created_at,
      speech_provider,
      audio_bytes,
      suggested_score,
      pron_accuracy,
      pron_fluency,
      pron_completion,
      severe_issues,
      passed,
      result_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN;");
  try {
    for (const attempt of attempts) {
      const result = attempt.result || {};
      insertAttempt.run(
        attempt.id,
        attempt.sentenceId,
        attempt.referenceText,
        attempt.createdAt || nowIso(),
        attempt.speechProvider || "unknown",
        Number(attempt.audioBytes || 0),
        Number(result.SuggestedScore || 0),
        Number(result.PronAccuracy || 0),
        Number(result.PronFluency || 0),
        Number(result.PronCompletion || 0),
        Number(attempt.severeIssues || 0),
        attempt.passed ? 1 : 0,
        JSON.stringify(result)
      );
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function claimUnownedHouseholdData(householdId: string) {
  if (!householdId) return;
  db.prepare("UPDATE children SET household_id = ? WHERE household_id IS NULL").run(householdId);
  db.prepare("UPDATE lessons SET household_id = ? WHERE household_id IS NULL").run(householdId);
  db.prepare(`
    UPDATE attempts
    SET household_id = COALESCE(
      (SELECT c.household_id FROM children c WHERE c.id = attempts.child_id),
      ?
    )
    WHERE household_id IS NULL
  `).run(householdId);
  db.prepare("UPDATE imports SET household_id = ? WHERE household_id IS NULL").run(householdId);
  db.prepare(`
    UPDATE automatic_practice_sessions
    SET household_id = COALESCE(
      (SELECT c.household_id FROM children c WHERE c.id = automatic_practice_sessions.child_id),
      ?
    )
    WHERE household_id IS NULL
  `).run(householdId);
}

function migrateLegacyHouseholdOwnership() {
  const households = db.prepare("SELECT id FROM households WHERE status = 'active' ORDER BY created_at ASC").all();
  if (households.length === 1) claimUnownedHouseholdData(String(households[0]?.id || ""));
}

export function initDatabase() {
  createSchema();
  migrateLegacyPracticeItems();
  if (process.env.KID_READING_SEED_DEMO === "1") {
    const households = db.prepare("SELECT id FROM households WHERE status = 'active'").all();
    const householdId = households.length === 1 ? String(households[0]?.id || "") : "";
    ensureDefaultChild(householdId);
    ensureDefaultPracticeBooks();
    seedLessonsIfEmpty(householdId);
  }
  migrateLessonDifficultyTags();
  migrateLegacyAttemptsIfNeeded();
  migrateLegacyHouseholdOwnership();
}

function requireHouseholdId(householdId: unknown) {
  const value = String(householdId || "").trim();
  if (!value) throw new Error("Household scope required");
  return value;
}

function assertHouseholdChild(householdId: string, childId: string) {
  const child = db.prepare("SELECT id FROM children WHERE id = ? AND household_id = ?").get(childId, requireHouseholdId(householdId));
  if (!child) throw new Error("Child not found");
  return child;
}

function assertHouseholdLesson(householdId: string, lessonId: string, includeArchived = false) {
  const lesson = db.prepare(`
    SELECT id FROM lessons
    WHERE id = ? AND household_id = ? AND ${includeArchived ? "status IN ('published', 'archived')" : "status = 'published'"}
  `).get(lessonId, requireHouseholdId(householdId));
  if (!lesson) throw new Error("Lesson not found");
  return lesson;
}

export function listChildren(householdId: string) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  const children = db
    .prepare(
      `SELECT
        id,
        name,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM children
      WHERE household_id = ?
      ORDER BY created_at ASC, id ASC`
    )
    .all(scopedHouseholdId);
  const practiceBooksStatement = db.prepare(`
    SELECT
      id,
      title,
      type,
      position,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM practice_books
    WHERE child_id = ?
    ORDER BY position ASC, created_at ASC, id ASC
  `);
  const practiceItemsStatement = db.prepare(`
    SELECT
      p.id,
      p.lesson_id AS lessonId,
      l.title AS lessonTitle,
      p.status,
      p.position,
      p.created_at AS createdAt,
      p.updated_at AS updatedAt
    FROM practice_book_items p
    JOIN lessons l ON l.id = p.lesson_id
    WHERE p.book_id = ? AND p.status != 'archived' AND l.status = 'published'
    ORDER BY p.position ASC, p.created_at ASC, p.id ASC
  `);

  return children.map((child) => {
    const practiceBooks = practiceBooksStatement.all(child.id).map((book) => {
      const items = practiceItemsStatement.all(book.id).map((item) => ({
        id: String(item.id || ""),
        bookId: String(book.id || ""),
        lessonId: String(item.lessonId || ""),
        lessonTitle: String(item.lessonTitle || ""),
        status: String(item.status || ""),
        position: Number(item.position || 0),
        createdAt: String(item.createdAt || ""),
        updatedAt: String(item.updatedAt || "")
      }));

      return {
        id: String(book.id || ""),
        title: String(book.title || ""),
        type: String(book.type || ""),
        position: Number(book.position || 0),
        createdAt: String(book.createdAt || ""),
        updatedAt: String(book.updatedAt || ""),
        items
      };
    });
    const defaultBook = practiceBooks.find((book) => book.type === "default") || practiceBooks[0];
    const practiceItems = defaultBook?.items || [];
    const firstPracticeItem = practiceItems[0];

    return {
      id: String(child.id || ""),
      name: String(child.name || ""),
      createdAt: String(child.createdAt || ""),
      updatedAt: String(child.updatedAt || ""),
      practiceBooks,
      defaultPracticeBookId: defaultBook?.id,
      practiceItems,
      assignedLessonId: firstPracticeItem?.lessonId,
      assignedLessonTitle: firstPracticeItem?.lessonTitle
    };
  });
}

export function createChild({ id, name, householdId }: { id: string; name: string; householdId: string }) {
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO children (id, name, household_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, requireHouseholdId(householdId), createdAt, createdAt);
}

export function createPracticeBook({ id, childId, title, householdId }: { id: string; childId: string; title: string; householdId: string }) {
  assertHouseholdChild(householdId, childId);

  const createdAt = nowIso();
  const nextPosition =
    numericColumn(db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM practice_books WHERE child_id = ?").get(childId), "position", -1) + 1;

  db.prepare(`
    INSERT INTO practice_books (id, child_id, title, type, position, created_at, updated_at)
    VALUES (?, ?, ?, 'custom', ?, ?, ?)
  `).run(id, childId, title, nextPosition, createdAt, createdAt);
}

export function updatePracticeBook({ childId, bookId, title, householdId }: { childId: string; bookId: string; title: string; householdId: string }) {
  assertHouseholdChild(householdId, childId);
  const result = db
    .prepare("UPDATE practice_books SET title = ?, updated_at = ? WHERE id = ? AND child_id = ?")
    .run(title, nowIso(), bookId, childId);

  if (result.changes === 0) {
    throw new Error("Practice book not found");
  }
}

export function deletePracticeBook({ childId, bookId, householdId }: { childId: string; bookId: string; householdId: string }) {
  assertHouseholdChild(householdId, childId);
  const book = db.prepare("SELECT id FROM practice_books WHERE id = ? AND child_id = ?").get(bookId, childId);
  if (!book) {
    throw new Error("Practice book not found");
  }

  db.prepare("DELETE FROM practice_books WHERE id = ? AND child_id = ?").run(bookId, childId);
}

export function assignLessonToChild({ childId, lessonId, householdId }: { childId: string; lessonId: string; householdId: string }) {
  return addLessonToPracticeBook({ childId, lessonId, householdId });
}

export function addLessonToPracticeBook({ childId, lessonId, bookId, householdId }: {
  childId: string;
  lessonId: string;
  bookId?: string;
  householdId: string;
}) {
  const createdAt = nowIso();
  assertHouseholdChild(householdId, childId);
  assertHouseholdLesson(householdId, lessonId);

  const book = bookId
    ? db.prepare("SELECT id FROM practice_books WHERE id = ? AND child_id = ?").get(bookId, childId)
    : getDefaultPracticeBook(childId);
  if (!book) {
    throw new Error("Practice book not found");
  }

  const nextPosition =
    numericColumn(db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM practice_book_items WHERE book_id = ?").get(book.id), "position", -1) + 1;

  db.prepare(`
    INSERT INTO practice_book_items (id, book_id, lesson_id, status, position, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
    ON CONFLICT(book_id, lesson_id) DO UPDATE SET
      status = 'pending',
      position = excluded.position,
      updated_at = excluded.updated_at
  `).run(`practice-item-${book.id}-${lessonId}`, book.id, lessonId, nextPosition, createdAt, createdAt);
}

export function removeLessonFromPracticeBook({ childId, lessonId, bookId, householdId }: {
  childId: string;
  lessonId: string;
  bookId?: string;
  householdId: string;
}) {
  assertHouseholdChild(householdId, childId);
  assertHouseholdLesson(householdId, lessonId, true);
  const book = bookId
    ? db.prepare("SELECT id FROM practice_books WHERE id = ? AND child_id = ?").get(bookId, childId)
    : getDefaultPracticeBook(childId);
  if (!book) {
    throw new Error("Practice book not found");
  }

  const result = db
    .prepare("UPDATE practice_book_items SET status = 'archived', updated_at = ? WHERE book_id = ? AND lesson_id = ? AND status != 'archived'")
    .run(nowIso(), book.id, lessonId);

  if (result.changes === 0) {
    throw new Error("Practice item not found");
  }
}

export function archivePracticeBookItem({ childId, itemId, householdId }: { childId: string; itemId: string; householdId: string }) {
  assertHouseholdChild(householdId, childId);
  const item = getPracticeBookItemForChild(childId, itemId);
  if (!item) {
    throw new Error("Practice item not found");
  }

  db.exec("BEGIN;");
  try {
    db.prepare("UPDATE practice_book_items SET status = 'archived', updated_at = ? WHERE id = ?").run(nowIso(), item.id);
    normalizePracticeBookItemPositions(item.bookId);
    touchPracticeBook(item.bookId);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function updatePracticeBookItemStatus({ childId, itemId, status, householdId }: {
  childId: string;
  itemId: string;
  status: string;
  householdId: string;
}) {
  assertHouseholdChild(householdId, childId);
  const allowedStatuses = new Set(["pending", "in_progress", "completed"]);
  if (!allowedStatuses.has(status)) {
    throw new Error("Invalid practice item status");
  }

  const item = getPracticeBookItemForChild(childId, itemId);
  if (!item) {
    throw new Error("Practice item not found");
  }

  db.prepare("UPDATE practice_book_items SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), item.id);
  touchPracticeBook(item.bookId);
}

export function movePracticeBookItem({ childId, itemId, targetBookId, householdId }: {
  childId: string;
  itemId: string;
  targetBookId: string;
  householdId: string;
}) {
  assertHouseholdChild(householdId, childId);
  const item = getPracticeBookItemForChild(childId, itemId);
  if (!item) {
    throw new Error("Practice item not found");
  }

  const targetBook = db.prepare("SELECT id FROM practice_books WHERE id = ? AND child_id = ?").get(targetBookId, childId);
  if (!targetBook) {
    throw new Error("Practice book not found");
  }

  if (targetBook.id === item.bookId) {
    return item.id;
  }

  const duplicate = db
    .prepare("SELECT id, status FROM practice_book_items WHERE book_id = ? AND lesson_id = ?")
    .get(targetBook.id, item.lessonId);
  if (duplicate && duplicate.status !== "archived") {
    throw new Error("Practice item already exists in target book");
  }

  const nextPosition =
    numericColumn(db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM practice_book_items WHERE book_id = ?").get(targetBook.id), "position", -1) + 1;
  const nextItemId = `practice-item-${targetBook.id}-${item.lessonId}`;

  db.exec("BEGIN;");
  try {
    if (duplicate) {
      db.prepare("DELETE FROM practice_book_items WHERE id = ? AND status = 'archived'").run(duplicate.id);
    }
    db.prepare("UPDATE practice_book_items SET id = ?, book_id = ?, position = ?, updated_at = ? WHERE id = ?").run(
      nextItemId,
      targetBook.id,
      nextPosition,
      nowIso(),
      item.id
    );
    normalizePracticeBookItemPositions(item.bookId);
    normalizePracticeBookItemPositions(String(targetBook.id));
    touchPracticeBook(item.bookId);
    touchPracticeBook(String(targetBook.id));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return nextItemId;
}

export function reorderPracticeBookItem({ childId, itemId, direction, householdId }: {
  childId: string;
  itemId: string;
  direction: "up" | "down";
  householdId: string;
}) {
  assertHouseholdChild(householdId, childId);
  if (direction !== "up" && direction !== "down") {
    throw new Error("Invalid practice item direction");
  }

  const item = getPracticeBookItemForChild(childId, itemId);
  if (!item) {
    throw new Error("Practice item not found");
  }

  db.exec("BEGIN;");
  try {
    normalizePracticeBookItemPositions(item.bookId);
    const current = asRow<DatabaseRow & { id: string; position: number }>(
      db.prepare("SELECT id, position FROM practice_book_items WHERE id = ?").get(item.id)
    )!;
    const neighbor =
      direction === "up"
        ? db
            .prepare(
              `SELECT id, position
               FROM practice_book_items
               WHERE book_id = ? AND status != 'archived' AND position < ?
               ORDER BY position DESC
               LIMIT 1`
            )
            .get(item.bookId, current.position)
        : db
            .prepare(
              `SELECT id, position
               FROM practice_book_items
               WHERE book_id = ? AND status != 'archived' AND position > ?
               ORDER BY position ASC
               LIMIT 1`
            )
            .get(item.bookId, current.position);

    if (neighbor) {
      const updatePosition = db.prepare("UPDATE practice_book_items SET position = ?, updated_at = ? WHERE id = ?");
      const updatedAt = nowIso();
      updatePosition.run(neighbor.position, updatedAt, current.id);
      updatePosition.run(current.position, updatedAt, neighbor.id);
      touchPracticeBook(item.bookId);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function listLessons({ includeArchived = false, householdId }: { includeArchived?: boolean; householdId?: string } = {}) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  const lessons = db
    .prepare(
      `SELECT
        id,
        title,
        source_type AS sourceType,
        tags_json AS tagsJson,
        import_quality_json AS importQualityJson,
        import_id AS importId,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
       FROM lessons
       WHERE household_id = ? AND ${includeArchived ? "status IN ('published', 'archived')" : "status = 'published'"}
       ORDER BY CASE WHEN status = 'archived' THEN 1 ELSE 0 END, updated_at DESC, created_at ASC, id ASC`
    )
    .all(scopedHouseholdId);
  const passagesStatement = db.prepare(`
    SELECT id, title, body, sections_json AS sectionsJson, position
    FROM passages
    WHERE lesson_id = ? AND status = 'published'
    ORDER BY position ASC, id ASC
  `);
  const sentencesStatement = db.prepare(`
    SELECT s.id, s.text, s.min_score AS minScore, s.passage_id AS passageId
    FROM sentences s
    LEFT JOIN passages p ON p.id = s.passage_id
    WHERE s.lesson_id = ? AND s.status = 'published'
    ORDER BY COALESCE(p.position, 0) ASC, s.position ASC, s.id ASC
  `);
  const passageSentencesStatement = db.prepare(`
    SELECT id, text, min_score AS minScore
    FROM sentences
    WHERE passage_id = ? AND status = 'published'
    ORDER BY position ASC, id ASC
  `);

  return lessons.map((lesson) => {
    const chapters = passagesStatement.all(lesson.id).map((passage) => {
      const passageSentences = passageSentencesStatement.all(passage.id).map((sentence) => ({
        id: String(sentence.id || ""),
        text: String(sentence.text || ""),
        minScore: Number(sentence.minScore)
      }));
      const sections = hydrateChapterSections(passage.sectionsJson, passageSentences);
      const hierarchy = buildChapterHierarchy(sections, String(passage.id || ""));
      return {
        id: String(passage.id || ""),
        title: String(passage.title || ""),
        body: String(passage.body || ""),
        position: Number(passage.position || 0),
        ...hierarchy,
        sections,
        sentences: passageSentences
      };
    });
    const itemBySentenceId = new Map(
      chapters.flatMap((chapter) =>
        (chapter.sections || []).flatMap((section) =>
            (section.sentences || []).map((sentence) => [String(sentence.id), sentence] as const)
        )
      )
    );

    return {
      id: String(lesson.id || ""),
      title: String(lesson.title || ""),
      sourceType: String(lesson.sourceType || ""),
      tags: normalizeLessonTags(parseJson(lesson.tagsJson, [])),
      importQuality: parseJson<PdfImportQualityReport | null>(lesson.importQualityJson, null),
      importId: lesson.importId ? String(lesson.importId) : undefined,
      status: String(lesson.status || ""),
      createdAt: String(lesson.createdAt || ""),
      updatedAt: String(lesson.updatedAt || ""),
      chapters,
      sentences: sentencesStatement.all(lesson.id).map((sentence) => ({
        id: String(sentence.id || ""),
        text: String(sentence.text || ""),
        minScore: Number(sentence.minScore),
        chapterId: String(sentence.passageId || ""),
        ...(itemBySentenceId.get(String(sentence.id)) || {})
      }))
    };
  });
}

function hydrateOfficialCourseResource(row: DatabaseRow) {
  const content = parseJson<OfficialCourseContent>(row.contentJson, {});
  const quality = parseJson<JsonRecord>(row.qualityJson, {});
  const chapters = content?.chapters || [];
  const sections = chapters.flatMap((chapter) => chapter.sections || []);
  return {
    id: String(row.id || ""),
    slug: String(row.slug || ""),
    title: String(row.title || ""),
    description: String(row.description || ""),
    level: String(row.level || ""),
    language: String(row.language || ""),
    tags: parseJson(row.tagsJson, []),
    sourceLabel: String(row.sourceLabel || ""),
    status: String(row.status || ""),
    version: Number(row.currentVersion || 1),
    sourceHouseholdId: String(row.sourceHouseholdId || ""),
    sourceLessonId: String(row.sourceLessonId || ""),
    content,
    quality,
    stats: {
      chapters: chapters.length,
      sections: sections.length,
      sentences: chapters.reduce((sum, chapter) => sum + (chapter.sentences || []).length, 0)
    },
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || "")
  };
}

export function listOfficialCourseResources({ includeUnpublished = false } = {}) {
  return db.prepare(`
    SELECT
      r.id,
      r.slug,
      r.title,
      r.description,
      r.level,
      r.language,
      r.tags_json AS tagsJson,
      r.source_label AS sourceLabel,
      r.status,
      r.current_version AS currentVersion,
      r.created_at AS createdAt,
      r.updated_at AS updatedAt,
      v.source_household_id AS sourceHouseholdId,
      v.source_lesson_id AS sourceLessonId,
      v.content_json AS contentJson,
      v.quality_json AS qualityJson
    FROM official_course_resources r
    JOIN official_course_versions v ON v.resource_id = r.id AND v.version = r.current_version
    WHERE ${includeUnpublished ? "r.status IN ('published', 'unpublished')" : "r.status = 'published'"}
    ORDER BY r.updated_at DESC, r.title ASC
  `).all().map(hydrateOfficialCourseResource);
}

export function findOfficialCourseResource(id: string, { includeUnpublished = false }: { includeUnpublished?: boolean } = {}) {
  return listOfficialCourseResources({ includeUnpublished }).find((resource) => String(resource.id) === id) || null;
}

export function publishOfficialCourseResource({
  id,
  slug,
  title,
  description = "",
  level = "入门",
  language = "英语",
  tags = [],
  sourceLabel = "官方课程",
  sourceHouseholdId,
  sourceLessonId,
  content,
  quality = {},
  createdByUserId
}: PublishOfficialCourseInput) {
  const updatedAt = nowIso();
  const existing = id
    ? asRow<DatabaseRow & { id: string; currentVersion: number; createdAt: string }>(
        db.prepare("SELECT id, current_version AS currentVersion, created_at AS createdAt FROM official_course_resources WHERE id = ?").get(id)
      )
    : null;
  const resourceId = existing?.id || id;
  const version = Number(existing?.currentVersion || 0) + 1;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing) {
      db.prepare(`
        UPDATE official_course_resources
        SET slug = ?, title = ?, description = ?, level = ?, language = ?, tags_json = ?,
            source_label = ?, status = 'published', current_version = ?, updated_at = ?
        WHERE id = ?
      `).run(slug, title, description, level, language, JSON.stringify(normalizeLessonTags(tags)), sourceLabel, version, updatedAt, resourceId);
    } else {
      db.prepare(`
        INSERT INTO official_course_resources (
          id, slug, title, description, level, language, tags_json, source_label,
          status, current_version, created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)
      `).run(resourceId, slug, title, description, level, language, JSON.stringify(normalizeLessonTags(tags)), sourceLabel, version, createdByUserId, updatedAt, updatedAt);
    }
    db.prepare(`
      INSERT INTO official_course_versions (
        id, resource_id, version, source_household_id, source_lesson_id,
        content_json, quality_json, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${resourceId}-v${version}`,
      resourceId,
      version,
      sourceHouseholdId,
      sourceLessonId,
      JSON.stringify(content),
      JSON.stringify(quality),
      createdByUserId,
      updatedAt
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return findOfficialCourseResource(resourceId, { includeUnpublished: true });
}

export function setOfficialCourseResourceStatus(id: string, status: string) {
  const normalizedStatus = status === "published" ? "published" : "unpublished";
  const result = db.prepare(`
    UPDATE official_course_resources
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(normalizedStatus, nowIso(), id);
  return Number(result.changes || 0) > 0
    ? findOfficialCourseResource(id, { includeUnpublished: true })
    : null;
}

function hydrateCourseSyncDraft(row: DatabaseRow | undefined): CourseSyncDraft | null {
  if (!row) return null;
  const manifest = parseJson<CourseSyncManifest>(row.manifestJson, {});
  const assets = parseJson<CourseSyncDraftAsset[]>(row.assetsJson, []);
  return {
    id: String(row.id || ""),
    packageHash: String(row.packageHash || ""),
    sourceImportId: String(row.sourceImportId || ""),
    targetResourceId: String(row.targetResourceId || ""),
    title: String(row.title || ""),
    status: String(row.status || ""),
    manifest,
    assets,
    receivedAt: String(row.receivedAt || ""),
    updatedAt: String(row.updatedAt || ""),
    publishedAt: row.publishedAt ? String(row.publishedAt) : undefined,
    publishedResourceId: row.publishedResourceId ? String(row.publishedResourceId) : undefined,
    publishedVersion: row.publishedVersion == null ? undefined : Number(row.publishedVersion)
  };
}

export function saveCourseSyncDraft({ id, packageHash, sourceImportId, targetResourceId = "", title, manifest, assets = [] }: {
  id: string;
  packageHash: string;
  sourceImportId: string;
  targetResourceId?: string;
  title: string;
  manifest: unknown;
  assets?: unknown[];
}) {
  const receivedAt = nowIso();
  const existing = db.prepare(`
    SELECT status, package_hash AS packageHash
    FROM course_sync_drafts
    WHERE id = ?
  `).get(id);
  if (existing?.status === "published") return findCourseSyncDraft(id);
  if (existing && existing.packageHash !== packageHash) throw new Error("COURSE_SYNC_PACKAGE_ID_CONFLICT");
  db.prepare(`
    INSERT INTO course_sync_drafts (
      id, package_hash, source_import_id, target_resource_id, title,
      manifest_json, assets_json, status, received_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      manifest_json = excluded.manifest_json,
      assets_json = excluded.assets_json,
      updated_at = excluded.updated_at
    WHERE course_sync_drafts.status = 'pending'
  `).run(
    id,
    packageHash,
    sourceImportId,
    targetResourceId,
    title,
    JSON.stringify(manifest || {}),
    JSON.stringify(assets || []),
    receivedAt,
    receivedAt
  );
  return findCourseSyncDraft(id);
}

export function findCourseSyncDraft(id: string) {
  const row = db.prepare(`
    SELECT
      id,
      package_hash AS packageHash,
      source_import_id AS sourceImportId,
      target_resource_id AS targetResourceId,
      title,
      manifest_json AS manifestJson,
      assets_json AS assetsJson,
      status,
      received_at AS receivedAt,
      updated_at AS updatedAt,
      published_at AS publishedAt,
      published_resource_id AS publishedResourceId,
      published_version AS publishedVersion
    FROM course_sync_drafts
    WHERE id = ?
  `).get(id);
  return hydrateCourseSyncDraft(row);
}

export function listCourseSyncDrafts({ includePublished = true }: { includePublished?: boolean } = {}) {
  return db.prepare(`
    SELECT
      id,
      package_hash AS packageHash,
      source_import_id AS sourceImportId,
      target_resource_id AS targetResourceId,
      title,
      manifest_json AS manifestJson,
      assets_json AS assetsJson,
      status,
      received_at AS receivedAt,
      updated_at AS updatedAt,
      published_at AS publishedAt,
      published_resource_id AS publishedResourceId,
      published_version AS publishedVersion
    FROM course_sync_drafts
    WHERE ${includePublished ? "status IN ('pending', 'published')" : "status = 'pending'"}
    ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, received_at DESC
  `).all().map((row) => hydrateCourseSyncDraft(row)!);
}

export function markCourseSyncDraftPublished({ id, resourceId, version }: { id: string; resourceId: string; version: number }) {
  const publishedAt = nowIso();
  const result = db.prepare(`
    UPDATE course_sync_drafts
    SET status = 'published', published_at = ?, published_resource_id = ?, published_version = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(publishedAt, resourceId, Number(version || 1), publishedAt, id);
  return Number(result.changes || 0) > 0 ? findCourseSyncDraft(id) : findCourseSyncDraft(id);
}

export function consumeCourseSyncNonce({ keyId, nonce, expiresAt, now = Date.now() }: {
  keyId: string;
  nonce: string;
  expiresAt: number;
  now?: number;
}) {
  db.prepare("DELETE FROM course_sync_nonces WHERE expires_at < ?").run(Number(now));
  try {
    db.prepare(`
      INSERT INTO course_sync_nonces (key_id, nonce, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      String(keyId || "").slice(0, 32),
      String(nonce || "").slice(0, 80),
      Number(expiresAt),
      nowIso()
    );
    return true;
  } catch (error: unknown) {
    if (String(error instanceof Error ? error.message : "").includes("UNIQUE constraint failed: course_sync_nonces")) return false;
    throw error;
  }
}

export function createPlatformAdminAuditLog({
  id,
  actorUserId,
  actorUsername,
  action,
  status,
  summary,
  metadata = {},
  createdAt = nowIso()
}: {
  id: string;
  actorUserId: string;
  actorUsername: string;
  action: string;
  status: string;
  summary: string;
  metadata?: unknown;
  createdAt?: string;
}) {
  const normalizedStatus = ["started", "success", "failure"].includes(status) ? status : "success";
  db.prepare(`
    INSERT INTO platform_admin_audit_logs (
      id, actor_user_id, actor_username, action, status, summary, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(id || "").slice(0, 80),
    String(actorUserId || "").slice(0, 80),
    String(actorUsername || "unknown").slice(0, 80),
    String(action || "unknown").slice(0, 80),
    normalizedStatus,
    String(summary || "平台管理操作").replace(/\s+/g, " ").trim().slice(0, 300),
    JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
    createdAt
  );
}

export function listPlatformAdminAuditLogs({ limit = 100 } = {}) {
  const normalizedLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  return db.prepare(`
    SELECT
      id,
      actor_user_id AS actorUserId,
      actor_username AS actorUsername,
      action,
      status,
      summary,
      metadata_json AS metadataJson,
      created_at AS createdAt
    FROM platform_admin_audit_logs
    ORDER BY created_at DESC, sequence DESC
    LIMIT ?
  `).all(normalizedLimit).map((row) => ({
    id: row.id,
    actorUserId: row.actorUserId,
    actorUsername: row.actorUsername,
    action: row.action,
    status: row.status,
    summary: row.summary,
    metadata: parseJson(row.metadataJson, {}),
    createdAt: row.createdAt
  }));
}

export function createLesson({ id, title, sourceType = "manual", tags = [], body = "", sentences = [], chapters = [], householdId, importQuality = null, importId = null }: LessonWriteInput) {
  const createdAt = nowIso();
  const scopedHouseholdId = requireHouseholdId(householdId);
  const normalizedTags = normalizeLessonTags(tags);
  const normalizedChapters: LessonChapterInput[] =
    chapters.length > 0
      ? chapters
      : [
          {
            id: `${id}-main`,
            title,
            body,
            sentences
          }
        ];
  const insertLesson = db.prepare(`
    INSERT INTO lessons (id, title, description, source_type, tags_json, import_quality_json, import_id, status, household_id, created_at, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, 'published', ?, ?, ?)
  `);
  const insertPassage = db.prepare(`
    INSERT INTO passages (id, lesson_id, title, body, sections_json, position, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `);
  const insertSentence = db.prepare(`
    INSERT INTO sentences (id, lesson_id, passage_id, position, text, min_score, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `);

  db.exec("BEGIN;");
  try {
    insertLesson.run(id, title, sourceType, JSON.stringify(normalizedTags), JSON.stringify(importQuality || {}), importId || null, scopedHouseholdId, createdAt, createdAt);
    normalizedChapters.forEach((chapter, chapterIndex) => {
      const passageId = chapter.id || `${id}-chapter-${chapterIndex + 1}`;
      insertPassage.run(
        passageId,
        id,
        chapter.title || `${title} ${chapterIndex + 1}`,
        chapter.body || "",
        JSON.stringify(normalizeChapterSectionsForStorage(chapter)),
        chapterIndex,
        createdAt,
        createdAt
      );
      chapter.sentences.forEach((sentence, sentenceIndex) => {
        insertSentence.run(
          sentence.id,
          id,
          passageId,
          sentenceIndex,
          sentence.text,
          Number(sentence.minScore || 75),
          createdAt,
          createdAt
        );
      });
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function updateLesson({ id, title, tags = [], body = "", chapters = [], householdId, importQuality = undefined, importId = undefined }: LessonUpdateInput) {
  const updatedAt = nowIso();
  const scopedHouseholdId = requireHouseholdId(householdId);
  const normalizedTags = normalizeLessonTags(tags);
  const updateLessonStatement = db.prepare(`
    UPDATE lessons
    SET title = ?, tags_json = ?, import_quality_json = COALESCE(?, import_quality_json), import_id = COALESCE(?, import_id), updated_at = ?
    WHERE id = ? AND household_id = ?
  `);
  const deleteSentences = db.prepare("DELETE FROM sentences WHERE lesson_id = ?");
  const deletePassages = db.prepare("DELETE FROM passages WHERE lesson_id = ?");
  const insertPassage = db.prepare(`
    INSERT INTO passages (id, lesson_id, title, body, sections_json, position, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `);
  const insertSentence = db.prepare(`
    INSERT INTO sentences (id, lesson_id, passage_id, position, text, min_score, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `);

  db.exec("BEGIN;");
  try {
    const result = updateLessonStatement.run(
      title,
      JSON.stringify(normalizedTags),
      importQuality === undefined ? null : JSON.stringify(importQuality || {}),
      importId === undefined ? null : importId || null,
      updatedAt,
      id,
      scopedHouseholdId
    );
    if (result.changes === 0) {
      throw new Error("Lesson not found");
    }

    deleteSentences.run(id);
    deletePassages.run(id);
    chapters.forEach((chapter, chapterIndex) => {
      const passageId = chapter.id || `${id}-chapter-${chapterIndex + 1}`;
      insertPassage.run(
        passageId,
        id,
        chapter.title || `${title} ${chapterIndex + 1}`,
        chapter.body || body,
        JSON.stringify(normalizeChapterSectionsForStorage(chapter)),
        chapterIndex,
        updatedAt,
        updatedAt
      );
      chapter.sentences.forEach((sentence, sentenceIndex) => {
        insertSentence.run(
          sentence.id,
          id,
          passageId,
          sentenceIndex,
          sentence.text,
          Number(sentence.minScore || 75),
          updatedAt,
          updatedAt
        );
      });
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function setLessonArchived({ id, archived, householdId }: { id: string; archived: boolean; householdId: string }) {
  const status = archived ? "archived" : "published";
  const result = db
    .prepare("UPDATE lessons SET status = ?, updated_at = ? WHERE id = ? AND household_id = ?")
    .run(status, nowIso(), id, requireHouseholdId(householdId));

  if (result.changes === 0) {
    throw new Error("Lesson not found");
  }
}

export function findSentenceById(sentenceId: string, householdId: string) {
  const sentence = db
    .prepare(
      `SELECT s.id, s.text, s.min_score AS minScore, p.sections_json AS sectionsJson
       FROM sentences s
       LEFT JOIN passages p ON p.id = s.passage_id
       JOIN lessons l ON l.id = s.lesson_id
       WHERE s.id = ? AND s.status = 'published' AND l.household_id = ? AND l.status = 'published'`
    )
    .get(sentenceId, requireHouseholdId(householdId));

  if (!sentence) return null;
  const sections = parseJson<LessonSectionInput[]>(sentence.sectionsJson, []);
  const owningSection = sections.find((section) => {
    const sentenceIds = Array.isArray(section.sentenceIds) ? section.sentenceIds.map(String) : [];
    const itemIds = Array.isArray(section.items) ? section.items.map((item) => String(item.id || "")) : [];
    return sentenceIds.includes(sentenceId) || itemIds.includes(sentenceId);
  });
  const storedItem = Array.isArray(owningSection?.items)
    ? owningSection.items.find((item) => String(item.id || "") === sentenceId)
    : undefined;
  const itemType = storedItem?.itemType === "word" || owningSection?.type === "vocabulary"
    ? "word"
    : storedItem?.itemType === "reading" || owningSection?.type === "reading"
      ? "reading"
      : "sentence";

  return {
    id: String(sentence.id || ""),
    text: String(sentence.text || ""),
    minScore: Number(sentence.minScore),
    itemType,
    required: storedItem?.required !== false
  };
}

export function listAttempts(childId: string, householdId: string) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  if (childId) assertHouseholdChild(scopedHouseholdId, childId);
  const sql = `SELECT
        id,
        child_id AS childId,
        sentence_id AS sentenceId,
        reference_text AS referenceText,
        created_at AS createdAt,
        speech_provider AS speechProvider,
        audio_bytes AS audioBytes,
        severe_issues AS severeIssues,
        passed,
        result_json AS resultJson,
        metadata_json AS metadataJson
      FROM attempts
      WHERE household_id = ? ${childId ? "AND child_id = ?" : ""}
      ORDER BY created_at ASC, id ASC`;
  const rows = childId ? db.prepare(sql).all(scopedHouseholdId, childId) : db.prepare(sql).all(scopedHouseholdId);

  return rows.map(hydrateAttemptRow);
}

export function listAttemptDiagnostics({ householdId, childId = "", query = "", limit = 100 }: {
  householdId: string;
  childId?: string;
  query?: string;
  limit?: number;
}) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  const scopedChildId = String(childId || "").trim();
  if (scopedChildId) assertHouseholdChild(scopedHouseholdId, scopedChildId);
  const safeLimit = Math.min(201, Math.max(1, Number(limit) || 100));
  const normalizedQuery = String(query || "").trim().slice(0, 160);
  const searchPattern = normalizedQuery
    ? `%${normalizedQuery.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`
    : "";
  const childClause = scopedChildId ? "AND a.child_id = ?" : "";
  const searchClause = normalizedQuery
    ? `AND (
        a.id LIKE ? ESCAPE '\\'
        OR a.reference_text LIKE ? ESCAPE '\\'
        OR COALESCE(l.title, '') LIKE ? ESCAPE '\\'
        OR COALESCE(c.name, '') LIKE ? ESCAPE '\\'
      )`
    : "";
  const regularParams = [
    scopedHouseholdId,
    ...(scopedChildId ? [scopedChildId] : []),
    ...(normalizedQuery ? [searchPattern, searchPattern, searchPattern, searchPattern] : []),
    safeLimit
  ];
  const regularRows = db.prepare(`
    SELECT
      a.id,
      a.child_id AS childId,
      a.sentence_id AS sentenceId,
      a.reference_text AS referenceText,
      a.created_at AS createdAt,
      a.speech_provider AS speechProvider,
      a.audio_bytes AS audioBytes,
      a.severe_issues AS severeIssues,
      a.passed,
      a.result_json AS resultJson,
      a.metadata_json AS metadataJson,
      c.name AS childName,
      l.id AS contentId,
      l.title AS contentTitle
    FROM attempts a
    LEFT JOIN children c ON c.id = a.child_id AND c.household_id = a.household_id
    LEFT JOIN sentences s ON s.id = a.sentence_id
    LEFT JOIN lessons l ON l.id = s.lesson_id AND l.household_id = a.household_id
    WHERE a.household_id = ?
      ${childClause}
      ${searchClause}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ?
  `).all(...regularParams).map((row) => ({
    ...hydrateAttemptRow(row),
    childName: String(row.childName || ""),
    sourceType: "lesson",
    contentId: String(row.contentId || ""),
    contentTitle: String(row.contentTitle || "")
  }));

  const storyChildClause = scopedChildId ? "AND a.child_id = ?" : "";
  const storySearchClause = normalizedQuery
    ? `AND (
        a.id LIKE ? ESCAPE '\\'
        OR a.reference_text LIKE ? ESCAPE '\\'
        OR COALESCE(b.title, a.book_id, '') LIKE ? ESCAPE '\\'
        OR COALESCE(c.name, '') LIKE ? ESCAPE '\\'
      )`
    : "";
  const storyParams = [
    scopedHouseholdId,
    ...(scopedChildId ? [scopedChildId] : []),
    ...(normalizedQuery ? [searchPattern, searchPattern, searchPattern, searchPattern] : []),
    safeLimit
  ];
  const storyRows = db.prepare(`
    SELECT
      a.id,
      a.child_id AS childId,
      a.book_id AS contentId,
      a.page_id AS storybookPageId,
      a.attempt_json AS attemptJson,
      a.created_at AS createdAt,
      c.name AS childName,
      COALESCE(b.title, a.book_id) AS contentTitle
    FROM storybook_attempts a
    LEFT JOIN children c ON c.id = a.child_id AND c.household_id = a.household_id
    LEFT JOIN storybooks b ON b.id = a.book_id AND b.household_id = a.household_id
    WHERE a.household_id = ?
      ${storyChildClause}
      ${storySearchClause}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ?
  `).all(...storyParams).map((row) => {
    const storedAttempt = parseJson<Partial<HydratedAttempt> & JsonRecord>(row.attemptJson, {});
    return {
      ...(storedAttempt && typeof storedAttempt === "object" && !Array.isArray(storedAttempt) ? storedAttempt : {}),
      householdId: undefined,
      id: String(row.id || ""),
      childId: row.childId ? String(row.childId) : undefined,
      childName: String(row.childName || ""),
      sourceType: "storybook",
      contentId: String(row.contentId || ""),
      contentTitle: String(row.contentTitle || row.contentId || ""),
      storybookPageId: row.storybookPageId ? String(row.storybookPageId) : undefined,
      createdAt: String(row.createdAt || ""),
      sentenceId: String(storedAttempt.sentenceId || ""),
      referenceText: String(storedAttempt.referenceText || ""),
      speechProvider: String(storedAttempt.speechProvider || ""),
      audioBytes: Number(storedAttempt.audioBytes || 0),
      result: storedAttempt.result || {},
      passed: Boolean(storedAttempt.passed),
      severeIssues: Number(storedAttempt.severeIssues || 0)
    };
  });

  return [...regularRows, ...storyRows]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)))
    .slice(0, safeLimit);
}

export function countAttemptDiagnostics(childId: string, householdId: string) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  const scopedChildId = String(childId || "").trim();
  if (scopedChildId) assertHouseholdChild(scopedHouseholdId, scopedChildId);
  const childClause = scopedChildId ? " AND child_id = ?" : "";
  const params = scopedChildId ? [scopedHouseholdId, scopedChildId] : [scopedHouseholdId];
  const attempts = Number(db.prepare(`SELECT COUNT(*) AS count FROM attempts WHERE household_id = ?${childClause}`).get(...params)?.count || 0);
  const storybookAttempts = Number(db.prepare(`SELECT COUNT(*) AS count FROM storybook_attempts WHERE household_id = ?${childClause}`).get(...params)?.count || 0);
  return attempts + storybookAttempts;
}

export function findAttemptById(attemptId: string, childId: string, householdId: string) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  if (childId) assertHouseholdChild(scopedHouseholdId, childId);
  const sql = `SELECT
        id,
        child_id AS childId,
        sentence_id AS sentenceId,
        reference_text AS referenceText,
        created_at AS createdAt,
        speech_provider AS speechProvider,
        audio_bytes AS audioBytes,
        severe_issues AS severeIssues,
        passed,
        result_json AS resultJson,
        metadata_json AS metadataJson
      FROM attempts
      WHERE id = ? AND household_id = ? ${childId ? "AND child_id = ?" : ""}`;
  const row = childId
    ? db.prepare(sql).get(attemptId, scopedHouseholdId, childId)
    : db.prepare(sql).get(attemptId, scopedHouseholdId);
  return row ? hydrateAttemptRow(row) : null;
}

function hydrateAttemptRow(row: DatabaseRow): HydratedAttempt {
  const metadata = parseJson<JsonRecord>(row.metadataJson, {});
  return {
    ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
    id: String(row.id || ""),
    childId: row.childId ? String(row.childId) : undefined,
    sentenceId: String(row.sentenceId || ""),
    referenceText: String(row.referenceText || ""),
    createdAt: String(row.createdAt || ""),
    speechProvider: String(row.speechProvider || ""),
    audioBytes: Number(row.audioBytes || 0),
    result: parseJson<AssessmentResultLike>(row.resultJson, {}),
    passed: Boolean(row.passed),
    severeIssues: Number(row.severeIssues || 0)
  };
}

export function insertAttempt(attempt: AttemptInput) {
  const scopedHouseholdId = requireHouseholdId(attempt.householdId);
  assertHouseholdChild(scopedHouseholdId, attempt.childId);
  if (!findSentenceById(attempt.sentenceId, scopedHouseholdId)) throw new Error("Sentence not found");
  const result = attempt.result || {};
  const metadata = {
    recordingQuality: attempt.recordingQuality,
    clientDevice: attempt.clientDevice,
    candidateSelection: attempt.candidateSelection,
    speechEnhancement: attempt.speechEnhancement,
    speechProviderComparison: attempt.speechProviderComparison,
    liveSpeechComparison: attempt.liveSpeechComparison,
    assessmentItemType: attempt.assessmentItemType,
    assessmentSource: attempt.assessmentSource,
    processingTimings: attempt.processingTimings,
    extraIssues: attempt.extraIssues,
    unscoredIssues: attempt.unscoredIssues,
    lowAccuracyIssues: attempt.lowAccuracyIssues,
    minWordAccuracy: attempt.minWordAccuracy
  };
  db.prepare(`
    INSERT INTO attempts (
      id,
      sentence_id,
      reference_text,
      created_at,
      speech_provider,
      audio_bytes,
      child_id,
      household_id,
      suggested_score,
      pron_accuracy,
      pron_fluency,
      pron_completion,
      severe_issues,
      passed,
      result_json,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    attempt.id,
    attempt.sentenceId,
    attempt.referenceText,
    attempt.createdAt,
    attempt.speechProvider || "unknown",
    Number(attempt.audioBytes || 0),
    attempt.childId || null,
    scopedHouseholdId,
    Number(result.SuggestedScore || 0),
    Number(result.PronAccuracy || 0),
    Number(result.PronFluency || 0),
    Number(result.PronCompletion || 0),
    Number(attempt.severeIssues || 0),
    attempt.passed ? 1 : 0,
    JSON.stringify(result),
    JSON.stringify(metadata)
  );
}

export function updateAttemptMetadata(
  attemptId: string,
  householdId: string,
  updates: Record<string, unknown>
) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  const row = db.prepare(`
    SELECT metadata_json AS metadataJson
    FROM attempts
    WHERE id = ? AND household_id = ?
  `).get(attemptId, scopedHouseholdId);
  if (!row) return false;
  const metadata = parseJson<JsonRecord>(row.metadataJson, {});
  db.prepare(`
    UPDATE attempts
    SET metadata_json = ?
    WHERE id = ? AND household_id = ?
  `).run(JSON.stringify({ ...metadata, ...updates }), attemptId, scopedHouseholdId);
  return true;
}

export function createAutomaticPracticeSession({ id, childId, lessonId, sentenceId, householdId, startedAt = nowIso() }: {
  id: string;
  childId: string;
  lessonId?: string;
  sentenceId?: string;
  householdId: string;
  startedAt?: string;
}) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  assertHouseholdChild(scopedHouseholdId, childId);
  if (lessonId) assertHouseholdLesson(scopedHouseholdId, lessonId);
  if (sentenceId && !findSentenceById(sentenceId, scopedHouseholdId)) throw new Error("Sentence not found");
  db.prepare(`
    UPDATE automatic_practice_sessions
    SET status = 'stopped', stop_reason = 'interrupted', ended_at = ?, updated_at = ?
    WHERE child_id = ? AND status = 'active'
  `).run(startedAt, startedAt, childId);
  db.prepare(`
    INSERT INTO automatic_practice_sessions (
      id, child_id, lesson_id, started_sentence_id, last_sentence_id, status, household_id, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, childId, lessonId || null, sentenceId || null, sentenceId || null, scopedHouseholdId, startedAt, startedAt);
  return findAutomaticPracticeSession(id, childId, scopedHouseholdId);
}

export function finishAutomaticPracticeSession({
  id,
  childId,
  sentenceId,
  stopReason,
  noSpeechCount = 0,
  failedAttemptCount = 0,
  householdId,
  endedAt = nowIso()
}: {
  id: string;
  childId: string;
  sentenceId?: string;
  stopReason: string;
  noSpeechCount?: number;
  failedAttemptCount?: number;
  householdId: string;
  endedAt?: string;
}) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  assertHouseholdChild(scopedHouseholdId, childId);
  db.prepare(`
    UPDATE automatic_practice_sessions
    SET last_sentence_id = COALESCE(?, last_sentence_id),
        status = ?,
        stop_reason = ?,
        no_speech_count = ?,
        failed_attempt_count = ?,
        ended_at = ?,
        updated_at = ?
    WHERE id = ? AND child_id = ? AND household_id = ?
  `).run(
    sentenceId || null,
    stopReason === "completed" ? "completed" : "stopped",
    stopReason,
    Math.max(0, Number(noSpeechCount || 0)),
    Math.max(0, Number(failedAttemptCount || 0)),
    endedAt,
    endedAt,
    id,
    childId,
    scopedHouseholdId
  );
  return findAutomaticPracticeSession(id, childId, scopedHouseholdId);
}

export function findAutomaticPracticeSession(id: string, childId: string, householdId: string) {
  return db.prepare(`
    SELECT
      s.id,
      s.child_id AS childId,
      s.lesson_id AS lessonId,
      l.title AS lessonTitle,
      s.started_sentence_id AS startedSentenceId,
      s.last_sentence_id AS lastSentenceId,
      sentence.text AS lastSentenceText,
      s.status,
      s.stop_reason AS stopReason,
      s.no_speech_count AS noSpeechCount,
      s.failed_attempt_count AS failedAttemptCount,
      s.started_at AS startedAt,
      s.ended_at AS endedAt
    FROM automatic_practice_sessions s
    LEFT JOIN lessons l ON l.id = s.lesson_id
    LEFT JOIN sentences sentence ON sentence.id = s.last_sentence_id
    WHERE s.id = ? AND s.child_id = ? AND s.household_id = ?
  `).get(id, childId, requireHouseholdId(householdId));
}

export function listAutomaticPracticeSessions(childId: string, limit = 12, householdId: string) {
  const scopedHouseholdId = requireHouseholdId(householdId);
  assertHouseholdChild(scopedHouseholdId, childId);
  return db.prepare(`
    SELECT
      s.id,
      s.child_id AS childId,
      s.lesson_id AS lessonId,
      l.title AS lessonTitle,
      s.started_sentence_id AS startedSentenceId,
      s.last_sentence_id AS lastSentenceId,
      sentence.text AS lastSentenceText,
      s.status,
      s.stop_reason AS stopReason,
      s.no_speech_count AS noSpeechCount,
      s.failed_attempt_count AS failedAttemptCount,
      s.started_at AS startedAt,
      s.ended_at AS endedAt
    FROM automatic_practice_sessions s
    LEFT JOIN lessons l ON l.id = s.lesson_id
    LEFT JOIN sentences sentence ON sentence.id = s.last_sentence_id
    WHERE s.child_id = ? AND s.household_id = ?
    ORDER BY s.started_at DESC, s.id DESC
    LIMIT ?
  `).all(childId, scopedHouseholdId, Math.min(50, Math.max(1, Number(limit || 12))));
}

export function createRegistrationKeyRecord({
  id,
  keyHash,
  keyPrefix = "",
  batchId = "",
  label = "",
  note = "",
  maxUses = 1,
  expiresAt = null,
  createdByUserId = ""
}: {
  id: string;
  keyHash: string;
  keyPrefix?: string;
  batchId?: string;
  label?: string;
  note?: string;
  maxUses?: number;
  expiresAt?: string | null;
  createdByUserId?: string;
}): RegistrationKeyRecord {
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO registration_keys (
      id, key_hash, key_prefix, batch_id, label, note, max_uses, use_count,
      expires_at, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    id,
    keyHash,
    String(keyPrefix || "").slice(0, 16),
    String(batchId || "").slice(0, 80),
    String(label || "").trim().slice(0, 120),
    String(note || "").trim().slice(0, 300),
    Math.max(1, Number(maxUses || 1)),
    expiresAt,
    String(createdByUserId || "").slice(0, 80),
    createdAt,
    createdAt
  );
  return {
    id,
    keyPrefix: String(keyPrefix || "").slice(0, 16),
    batchId: String(batchId || "").slice(0, 80),
    label: String(label || "").trim().slice(0, 120),
    note: String(note || "").trim().slice(0, 300),
    maxUses: Math.max(1, Number(maxUses || 1)),
    expiresAt,
    createdAt
  };
}

export function listRegistrationKeyRecords({ limit = 500 }: { limit?: unknown } = {}) {
  const rows = db.prepare(`
    SELECT
      k.id,
      k.key_prefix AS keyPrefix,
      k.batch_id AS batchId,
      k.label,
      k.note,
      k.max_uses AS maxUses,
      k.use_count AS useCount,
      k.expires_at AS expiresAt,
      k.disabled_at AS disabledAt,
      k.consumed_at AS consumedAt,
      k.created_at AS createdAt,
      k.updated_at AS updatedAt,
      u.username AS consumedByUsername,
      h.name AS consumedByHouseholdName
    FROM registration_keys k
    LEFT JOIN parent_users u ON u.id = k.consumed_by_user_id
    LEFT JOIN households h ON h.id = u.household_id
    ORDER BY k.created_at DESC, k.id DESC
    LIMIT ?
  `).all(Math.min(1000, Math.max(1, Number(limit) || 500)));
  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    status: row.disabledAt
      ? "disabled"
      : Number(row.useCount) >= Number(row.maxUses)
        ? "used"
        : row.expiresAt && Date.parse(String(row.expiresAt)) <= now
          ? "expired"
          : "active"
  }));
}

export function updateRegistrationKeyNote(id: string, note: unknown) {
  const updatedAt = nowIso();
  const result = db.prepare(`
    UPDATE registration_keys SET note = ?, updated_at = ? WHERE id = ?
  `).run(String(note || "").trim().slice(0, 300), updatedAt, String(id || ""));
  return Number(result.changes || 0) > 0;
}

export function disableRegistrationKey(id: string) {
  const updatedAt = nowIso();
  const result = db.prepare(`
    UPDATE registration_keys
    SET disabled_at = COALESCE(disabled_at, ?), updated_at = ?
    WHERE id = ? AND use_count < max_uses
  `).run(updatedAt, updatedAt, String(id || ""));
  return Number(result.changes || 0) > 0;
}

export function createHousehold({ id, name }: { id: string; name: string }) {
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO households (id, name, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(id, String(name || "家庭").trim(), createdAt, createdAt);
  return { id, name: String(name || "家庭").trim(), status: "active", createdAt };
}

export function registerParentWithKey({
  keyHash,
  householdId,
  householdName,
  userId,
  username,
  passwordHash
}: {
  keyHash: string;
  householdId: string;
  householdName: string;
  userId: string;
  username: string;
  passwordHash: string;
}): ParentUserRecord {
  const createdAt = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    const registrationKey = db.prepare(`
      SELECT id, max_uses AS maxUses, use_count AS useCount, expires_at AS expiresAt, disabled_at AS disabledAt
      FROM registration_keys
      WHERE key_hash = ?
    `).get(keyHash);
    if (!registrationKey || registrationKey.disabledAt) throw new Error("REGISTRATION_KEY_INVALID");
    if (registrationKey.expiresAt && Date.parse(String(registrationKey.expiresAt)) <= Date.now()) {
      throw new Error("REGISTRATION_KEY_EXPIRED");
    }
    if (Number(registrationKey.useCount) >= Number(registrationKey.maxUses)) {
      throw new Error("REGISTRATION_KEY_USED");
    }

    db.prepare(`
      INSERT INTO households (id, name, status, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?)
    `).run(householdId, householdName, createdAt, createdAt);
    db.prepare(`
      INSERT INTO parent_users (
        id, household_id, username, password_hash, role, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)
    `).run(userId, householdId, username, passwordHash, createdAt, createdAt);
    const householdCount = numericColumn(db.prepare("SELECT COUNT(*) AS count FROM households").get(), "count");
    if (householdCount === 1) claimUnownedHouseholdData(householdId);
    db.prepare(`
      UPDATE registration_keys
      SET use_count = use_count + 1,
          consumed_by_user_id = ?,
          consumed_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(userId, createdAt, createdAt, registrationKey.id);
    db.exec("COMMIT");
    return findParentUserById(userId)!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function findParentUserByUsername(username: string): ParentUserRecord | undefined {
  return asRow<ParentUserRecord>(db.prepare(`
    SELECT
      u.id,
      u.household_id AS householdId,
      h.name AS householdName,
      u.username,
      u.password_hash AS passwordHash,
      u.role,
      u.status
    FROM parent_users u
    JOIN households h ON h.id = u.household_id
    WHERE u.username = ? COLLATE NOCASE AND h.status = 'active'
  `).get(username));
}

export function findParentUserById(userId: string): ParentUserRecord | undefined {
  return asRow<ParentUserRecord>(db.prepare(`
    SELECT
      u.id,
      u.household_id AS householdId,
      h.name AS householdName,
      u.username,
      u.role,
      u.status
    FROM parent_users u
    JOIN households h ON h.id = u.household_id
    WHERE u.id = ? AND u.status = 'active' AND h.status = 'active'
  `).get(userId));
}

export function createAuthSessionRecord({ id, userId, tokenHash, expiresAt }: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
}) {
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, tokenHash, expiresAt, createdAt, createdAt);
}

export function findAuthSessionByTokenHash(tokenHash: string): ParentSessionRecord | undefined {
  return asRow<ParentSessionRecord>(db.prepare(`
    SELECT
      s.id AS sessionId,
      s.expires_at AS expiresAt,
      u.id,
      u.household_id AS householdId,
      h.name AS householdName,
      u.username,
      u.role
    FROM auth_sessions s
    JOIN parent_users u ON u.id = s.user_id
    JOIN households h ON h.id = u.household_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.status = 'active'
      AND h.status = 'active'
  `).get(tokenHash, nowIso()));
}

export function revokeAuthSessionByTokenHash(tokenHash: string) {
  db.prepare(`
    UPDATE auth_sessions
    SET revoked_at = COALESCE(revoked_at, ?)
    WHERE token_hash = ?
  `).run(nowIso(), tokenHash);
}

export function createChildPairingCodeRecord({ id, householdId, childId, codeHash, expiresAt, createdByUserId }: {
  id: string;
  householdId: string;
  childId: string;
  codeHash: string;
  expiresAt: string;
  createdByUserId: string;
}): ChildPairingCodeRecord {
  const scopedHouseholdId = requireHouseholdId(householdId);
  assertHouseholdChild(scopedHouseholdId, childId);
  const createdAt = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE child_pairing_codes SET used_at = ? WHERE household_id = ? AND child_id = ? AND used_at IS NULL`).run(createdAt, scopedHouseholdId, childId);
    db.prepare(`INSERT INTO child_pairing_codes (id, household_id, child_id, code_hash, expires_at, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, scopedHouseholdId, childId, codeHash, expiresAt, createdByUserId, createdAt);
    db.exec("COMMIT");
    return { id, childId, expiresAt, createdAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function consumeChildPairingCode({ codeHash, sessionId, tokenHash, expiresAt, label = "" }: {
  codeHash: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: string;
  label?: string;
}): ChildDeviceSessionRecord {
  const usedAt = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    const code = asRow<DatabaseRow & { id: string; householdId: string; childId: string; childName: string; householdName: string }>(db.prepare(`SELECT p.id, p.household_id AS householdId, p.child_id AS childId, c.name AS childName, h.name AS householdName FROM child_pairing_codes p JOIN children c ON c.id = p.child_id JOIN households h ON h.id = p.household_id WHERE p.code_hash = ? AND p.used_at IS NULL AND p.expires_at > ? AND h.status = 'active'`).get(codeHash, usedAt));
    if (!code) throw new Error("CHILD_PAIR_CODE_INVALID");
    const changed = db.prepare(`UPDATE child_pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(usedAt, code.id);
    if (Number(changed.changes) !== 1) throw new Error("CHILD_PAIR_CODE_INVALID");
    db.prepare(`INSERT INTO child_device_sessions (id, household_id, child_id, token_hash, label, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sessionId, code.householdId, code.childId, tokenHash, String(label || "").trim().slice(0, 40), expiresAt, usedAt, usedAt);
    db.exec("COMMIT");
    return { ...code, sessionId, expiresAt, label: String(label || "").trim().slice(0, 40) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function findChildDeviceSessionByTokenHash(tokenHash: string): ChildDeviceSessionRecord | undefined {
  return asRow<ChildDeviceSessionRecord>(db.prepare(`SELECT s.id AS sessionId, s.household_id AS householdId, h.name AS householdName, s.child_id AS childId, c.name AS childName, s.label, s.expires_at AS expiresAt FROM child_device_sessions s JOIN children c ON c.id = s.child_id JOIN households h ON h.id = s.household_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND h.status = 'active'`).get(tokenHash, nowIso()));
}

export function revokeChildDeviceSessionByTokenHash(tokenHash: string) {
  db.prepare(`UPDATE child_device_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?`).run(nowIso(), tokenHash);
}

export function listChildDeviceSessions(householdId: string) {
  return db.prepare(`SELECT s.id, s.child_id AS childId, c.name AS childName, s.label, s.expires_at AS expiresAt, s.revoked_at AS revokedAt, s.created_at AS createdAt, s.last_seen_at AS lastSeenAt FROM child_device_sessions s JOIN children c ON c.id = s.child_id WHERE s.household_id = ? ORDER BY s.created_at DESC`).all(requireHouseholdId(householdId));
}

export function revokeChildDeviceSession({ id, householdId }: { id: string; householdId: string }) {
  return db.prepare(`UPDATE child_device_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND household_id = ?`).run(nowIso(), id, requireHouseholdId(householdId));
}
