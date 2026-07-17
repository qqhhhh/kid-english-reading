const terminalPunctuationPattern = /[.!?。！？]["'”’)]?$/;
const danglingFragmentPattern =
  /(?:^['’](?:s|t|re|ve|ll|d|m)\b|\b(?:isn|aren|wasn|weren|don|doesn|didn|hasn|haven|hadn|couldn|wouldn|shouldn|mustn|won)$|\b(?:He|She|It) a\b|\b(?:That|What|Who|It|He|She) s\b)/i;
const repeatedPunctuationPattern = /[!！?？]{2,}/;
const oddStandaloneTokenPattern = /(?:^|\s)[b-hj-z](?=\s|[,.!?;:]|$)/i;

import type {
  OcrAudit,
  PdfImportChapter,
  PdfImportQualityReport,
  PdfImportSection,
  PdfImportStructure,
  PdfLayout,
  PdfLayoutCoverage,
  PdfQualityIssue,
  PdfQualitySeverity,
  PdfStructureConsistency
} from "./types/pdf.js";

interface PdfQualityContext {
  layout?: PdfLayout | null;
  structure?: PdfImportStructure | null;
  ocr?: OcrAudit | null;
}

interface StructureSources {
  lineKeys: Set<string>;
  itemKeys: Set<string>;
  texts: Set<string>;
  relevantPages: Set<number>;
}

interface PdfQualityReportLike {
  counts?: Partial<Record<PdfQualitySeverity, number>>;
  consistency?: { checks?: Array<{ passed: boolean }> } | null;
  ocr?: {
    truncated?: boolean;
    criticalPages?: number[];
    status?: string;
    providers?: Array<{ engine: string; status: string }>;
  } | null;
}

function getWords(text: unknown): string[] {
  return String(text || "").match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
}

function normalizeSourceText(text: unknown): string {
  return String(text || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^A-Za-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isIgnorableLayoutLine(text: unknown): boolean {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || !/[A-Za-z]/.test(value)) return true;
  if (/^\d{1,3}$/.test(value)) return true;
  if (/^(?:unit\s*\d+|part\s*[a-z]|lead-in|words?|reading time|revision)$/i.test(value)) return true;
  if (/^(?:listen and (?:chant|sing)|let['’]?s (?:talk|chant|sing)|look and (?:say|match)|read and (?:answer|choose)|talk about it)[.!]?$/i.test(value)) return true;
  if (/^(?:contents?|vocabulary|appendix|copyright|isbn|published|publisher|people['’]?s education press)/i.test(value)) return true;
  if (/^(?:read aloud and act it out|listen,? point and repeat|ask and answer|work in pairs?)[.!]?$/i.test(value)) return true;
  const words = getWords(value);
  return words.length === 0 || (words.length === 1 && value.length <= 2);
}

function collectStructureSources(structure: PdfImportStructure): StructureSources {
  const lineKeys = new Set<string>();
  const itemKeys = new Set<string>();
  const texts = new Set<string>();
  const relevantPages = new Set<number>();

  for (const unit of structure?.units || []) {
    const pageStart = Number(unit.pageStart || 0);
    const pageEnd = Number(unit.pageEnd || pageStart);
    if (pageStart > 0 && pageEnd >= pageStart) {
      for (let page = pageStart; page <= pageEnd; page += 1) relevantPages.add(page);
    }
    const unitTitle = normalizeSourceText(unit.title);
    if (unitTitle) texts.add(unitTitle);
    for (const section of unit.sections || []) {
      const sectionTitle = normalizeSourceText(section.title);
      const focusQuestion = normalizeSourceText(section.focusQuestion);
      if (sectionTitle) texts.add(sectionTitle);
      if (focusQuestion) texts.add(focusQuestion);
      for (const block of section.blocks || []) {
        const page = Number(block.page || block.layout?.page || 0);
        if (page > 0) relevantPages.add(page);
        for (const lineId of block.layout?.lineIds || []) lineKeys.add(`${page}:${lineId}`);
        for (const itemId of block.layout?.itemIds || []) itemKeys.add(`${page}:${itemId}`);
        const normalized = normalizeSourceText(block.text);
        if (normalized) texts.add(normalized);
      }
    }
  }

  return { lineKeys, itemKeys, texts, relevantPages };
}

function lineMatchesClassifiedText(lineText: unknown, classifiedTexts: ReadonlySet<string>): boolean {
  const normalized = normalizeSourceText(lineText);
  if (!normalized) return false;
  for (const text of classifiedTexts) {
    if (normalized === text) return true;
    if (normalized.length >= 8 && text.includes(normalized)) return true;
    if (text.length >= 8 && normalized.includes(text)) return true;
  }
  return false;
}

function assessLayoutCoverage(
  layout?: PdfLayout | null,
  structure?: PdfImportStructure | null
): PdfLayoutCoverage | null {
  if (!layout?.pages?.length || !structure) return null;
  const sources = collectStructureSources(structure);
  const pages = [];

  for (const page of layout.pages) {
    if (!sources.relevantPages.has(page.page)) continue;
    let classifiedLines = 0;
    let ignoredLines = 0;
    const unclassified: PdfLayoutCoverage["pages"][number]["unclassified"] = [];

    for (const line of page.lines || []) {
      const lineKey = `${page.page}:${line.id}`;
      const itemMatched = (line.items || []).some((itemId) => sources.itemKeys.has(`${page.page}:${itemId}`));
      const classified = sources.lineKeys.has(lineKey) || itemMatched || lineMatchesClassifiedText(line.text, sources.texts);
      if (classified) {
        classifiedLines += 1;
      } else if (isIgnorableLayoutLine(line.text)) {
        ignoredLines += 1;
      } else {
        unclassified.push({
          id: line.id,
          text: line.text,
          x: line.x,
          top: line.top
        });
      }
    }

    const eligibleLines = classifiedLines + unclassified.length;
    const percent = eligibleLines > 0 ? Math.round((classifiedLines / eligibleLines) * 100) : 100;
    pages.push({
      page: page.page,
      eligibleLines,
      classifiedLines,
      ignoredLines,
      unclassifiedLines: unclassified.length,
      percent,
      unclassified: unclassified.slice(0, 12)
    });
  }

  const eligibleLines = pages.reduce((sum, page) => sum + page.eligibleLines, 0);
  const classifiedLines = pages.reduce((sum, page) => sum + page.classifiedLines, 0);
  const ignoredLines = pages.reduce((sum, page) => sum + page.ignoredLines, 0);
  const unclassifiedLines = pages.reduce((sum, page) => sum + page.unclassifiedLines, 0);
  const lowConfidencePages = pages
    .filter((page) => page.unclassifiedLines >= 2 && page.percent < 80)
    .map((page) => page.page);

  return {
    eligibleLines,
    classifiedLines,
    ignoredLines,
    unclassifiedLines,
    percent: eligibleLines > 0 ? Math.round((classifiedLines / eligibleLines) * 100) : 100,
    lowConfidencePages,
    pages: pages.filter((page) => page.eligibleLines > 0 || page.unclassifiedLines > 0)
  };
}

function assessStructureConsistency(
  chapters: readonly PdfImportChapter[],
  structure?: PdfImportStructure | null
): PdfStructureConsistency | null {
  if (!structure) return null;
  const importedSections = chapters.reduce((sum, chapter) => sum + (chapter.sections || []).length, 0);
  const importedVocabulary = chapters.reduce(
    (sum, chapter) =>
      sum +
      (chapter.sections || []).reduce(
        (sectionSum, section) =>
          sectionSum +
          (section.type === "vocabulary" || section.partKind === "vocabulary" ? (section.sentences || []).length : 0),
        0
      ),
    0
  );
  const sourceVocabulary = (structure.units || []).reduce(
    (sum, unit) =>
      sum +
      (unit.sections || []).reduce(
        (sectionSum, section) =>
          sectionSum +
          (section.partKind === "vocabulary" || section.activityKey === "vocabulary"
            ? (section.blocks || []).filter((block) => block.candidate).length
            : 0),
        0
      ),
    0
  );
  const expectedUnits = structure.toc?.length || structure.units?.length || 0;
  const importedUnits = chapters.length;
  const sourceSections = (structure.units || []).reduce((sum, unit) => sum + (unit.sections || []).length, 0);
  const checks = [
    {
      code: "unit-count",
      label: "单元数量",
      expected: expectedUnits,
      actual: importedUnits,
      passed: expectedUnits === 0 || expectedUnits === importedUnits
    },
    {
      code: "section-count",
      label: "栏目数量",
      expected: sourceSections,
      actual: importedSections,
      passed: sourceSections === importedSections
    },
    {
      code: "vocabulary-count",
      label: "附录词汇",
      expected: sourceVocabulary,
      actual: importedVocabulary,
      passed: sourceVocabulary === importedVocabulary
    }
  ];

  return {
    expectedUnits,
    importedUnits,
    sourceSections,
    importedSections,
    sourceVocabulary,
    importedVocabulary,
    checks
  };
}

function findSentenceSection(chapter: PdfImportChapter, sentenceId: string): PdfImportSection | undefined {
  return (chapter.sections || []).find((section) =>
    (section.sentences || []).some((sentence) => sentence.id === sentenceId)
  );
}

function addIssue(
  issues: PdfQualityIssue[],
  issueSentenceIds: Set<string>,
  input: Omit<PdfQualityIssue, "id">
): void {
  issues.push({
    id: `pdf-quality-${issues.length + 1}`,
    ...input
  });
  issueSentenceIds.add(input.sentenceId);
}

export function assessPdfImportQuality(
  chapters: readonly PdfImportChapter[] = [],
  context: PdfQualityContext = {}
): PdfImportQualityReport {
  const issues: PdfQualityIssue[] = [];
  const issueSentenceIds = new Set<string>();
  let totalSentences = 0;

  chapters.forEach((chapter, chapterIndex) => {
    (chapter.sentences || []).forEach((sentence, sentenceIndex) => {
      const text = String(sentence.text || "").trim();
      if (!text) return;
      totalSentences += 1;
      const words = getWords(text);
      const section = findSentenceSection(chapter, sentence.id);
      const isVocabulary = section?.type === "vocabulary" || section?.partKind === "vocabulary";
      const location = {
        chapterId: chapter.id,
        chapterTitle: chapter.title || `Chapter ${chapterIndex + 1}`,
        chapterIndex,
        sectionId: section?.id,
        sectionTitle: section?.title,
        sentenceId: sentence.id,
        sentenceIndex,
        text
      };

      if (!isVocabulary && danglingFragmentPattern.test(text)) {
        addIssue(issues, issueSentenceIds, {
          ...location,
          code: "dangling-fragment",
          severity: "high"
        });
      }
      if (!isVocabulary && repeatedPunctuationPattern.test(text)) {
        addIssue(issues, issueSentenceIds, {
          ...location,
          code: "repeated-punctuation",
          severity: "medium"
        });
      }
      if (!isVocabulary && !terminalPunctuationPattern.test(text)) {
        addIssue(issues, issueSentenceIds, {
          ...location,
          code: "missing-punctuation",
          severity: "medium"
        });
      }
      if (!isVocabulary && oddStandaloneTokenPattern.test(text)) {
        addIssue(issues, issueSentenceIds, {
          ...location,
          code: "odd-token",
          severity: "medium"
        });
      }
      if (!isVocabulary && (words.length > 18 || text.length > 140)) {
        addIssue(issues, issueSentenceIds, {
          ...location,
          code: "long-sentence",
          severity: "low"
        });
      }
      if (!isVocabulary && words.length === 1 && text.length <= 16) {
        addIssue(issues, issueSentenceIds, {
          ...location,
          code: "short-sentence",
          severity: "low"
        });
      }
    });
  });

  const counts = issues.reduce<Record<PdfQualitySeverity, number>>(
    (result, issue) => ({ ...result, [issue.severity]: result[issue.severity] + 1 }),
    { high: 0, medium: 0, low: 0 }
  );

  const coverage = assessLayoutCoverage(context.layout, context.structure);
  const consistency = assessStructureConsistency(chapters, context.structure);
  const ocr = context.ocr || null;
  const hasCoverageWarning = Boolean(coverage && (coverage.percent < 80 || coverage.lowConfidencePages.length > 0));
  const hasConsistencyWarning = Boolean(consistency?.checks.some((check) => !check.passed));
  const hasOcrWarning = Boolean(ocr && (ocr.status === "warning" || ocr.status === "unavailable" || ocr.truncated));
  const hasOcrReview = Boolean(ocr?.status === "review");
  const sentenceStatus = counts.high > 0 ? "warning" : counts.medium > 0 ? "review" : "good";
  const status = sentenceStatus === "warning" || hasCoverageWarning || hasConsistencyWarning || hasOcrWarning
    ? "warning"
    : sentenceStatus === "review" || hasOcrReview
      ? "review"
      : "good";

  return {
    status,
    totalSentences,
    cleanSentences: Math.max(0, totalSentences - issueSentenceIds.size),
    issueSentences: issueSentenceIds.size,
    counts,
    issues,
    coverage,
    consistency,
    ocr
  };
}

export function getPdfPublicationBlockers(report?: PdfQualityReportLike | null): string[] {
  if (!report) return ["missing-quality-report"];
  const blockers: string[] = [];
  if (Number(report.counts?.high || 0) > 0) blockers.push("high-risk-content");
  if (report.consistency?.checks?.some((check) => !check.passed)) blockers.push("structure-mismatch");
  if (report.ocr?.truncated) blockers.push("ocr-truncated");
  if ((report.ocr?.criticalPages || []).length > 0) blockers.push("ocr-critical-pages");
  const localOcr = report.ocr?.providers?.find((provider) => provider.engine === "tesseract.js-eng");
  if (localOcr?.status === "unavailable" || (!report.ocr?.providers && report.ocr?.status === "unavailable")) {
    blockers.push("local-ocr-unavailable");
  }
  return blockers;
}
