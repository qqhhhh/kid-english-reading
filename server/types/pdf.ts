export interface PdfLayoutItem {
  id: string;
  text: string;
  x: number;
  y: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfOverlayAlternative {
  keptItemId: string;
  discardedItemId: string;
  keptText: string;
  discardedText: string;
  xOffset: number;
  yOffset: number;
}

export interface PdfLayoutLine {
  id: string;
  text: string;
  x: number;
  y: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  fontSize?: number;
  itemCount: number;
  items: string[];
}

export interface PdfLayoutPage {
  page: number;
  width: number;
  height: number;
  items: PdfLayoutItem[];
  overlays: PdfOverlayAlternative[];
  lines: PdfLayoutLine[];
  text: string;
}

export interface PdfLayout {
  version: 2;
  pageCount: number;
  pages: PdfLayoutPage[];
  stats: {
    pages: number;
    items: number;
    lines: number;
    overlayAlternatives: number;
  };
}

export interface OcrDifferenceLine {
  text: string;
  closest: string;
  similarity: number;
}

export interface OcrAuditPage {
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
  pdfTextLines: string[];
  ocrTextLines: string[];
  pdfOnly: OcrDifferenceLine[];
  ocrOnly: OcrDifferenceLine[];
}

export type OcrAuditStatus = "unavailable" | "warning" | "review" | "good";

export interface OcrVisualReviewPage {
  page: number;
  missingLines?: string[];
  incorrectLines?: string[];
  readingOrderIssue?: boolean;
  sectionIssue?: boolean;
  notes?: string;
  [key: string]: unknown;
}

export interface OcrVisualReview {
  engine: string;
  model?: string;
  status: OcrAuditStatus;
  message?: string;
  detail?: string;
  pagesProcessed?: number;
  totalPages?: number;
  pages?: OcrVisualReviewPage[];
}

export interface OcrAudit {
  status: OcrAuditStatus;
  engine: string;
  model?: string;
  message?: string;
  detail?: string;
  advisory?: boolean;
  pagesProcessed: number;
  totalPages: number;
  truncated?: boolean;
  pdfTokens?: number;
  ocrTokens?: number;
  matchedTokens?: number;
  tokenAgreement: number;
  reviewPages: number[];
  criticalPages: number[];
  pages: OcrAuditPage[];
  providers?: OcrAudit[];
  visualReview?: OcrVisualReview | null;
}

export interface PdfSourceBlock {
  text?: string;
  page?: number;
  candidate?: boolean;
  layout?: {
    page?: number;
    lineIds?: string[];
    itemIds?: string[];
  };
}

export interface PdfSourceSection {
  title?: string;
  focusQuestion?: string;
  partKind?: string;
  activityKey?: string;
  blocks?: PdfSourceBlock[];
}

export interface PdfSourceUnit {
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  sections?: PdfSourceSection[];
}

export interface PdfImportStructure {
  toc?: unknown[];
  units?: PdfSourceUnit[];
  frontMatter?: unknown[];
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PdfImportSentence {
  id: string;
  text?: string;
  [key: string]: unknown;
}

export interface PdfImportSection {
  id: string;
  title?: string;
  type?: string;
  partKind?: string;
  sentences?: PdfImportSentence[];
  [key: string]: unknown;
}

export interface PdfImportChapter {
  id: string;
  title?: string;
  text?: string;
  sections?: PdfImportSection[];
  sentences?: PdfImportSentence[];
  [key: string]: unknown;
}

export type PdfQualitySeverity = "high" | "medium" | "low";

export interface PdfQualityIssue {
  id: string;
  code: string;
  severity: PdfQualitySeverity;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  sectionId?: string;
  sectionTitle?: string;
  sentenceId: string;
  sentenceIndex: number;
  text: string;
}

export interface PdfCoveragePage {
  page: number;
  eligibleLines: number;
  classifiedLines: number;
  ignoredLines: number;
  unclassifiedLines: number;
  percent: number;
  unclassified: Array<{ id: string; text: string; x: number; top: number }>;
}

export interface PdfLayoutCoverage {
  eligibleLines: number;
  classifiedLines: number;
  ignoredLines: number;
  unclassifiedLines: number;
  percent: number;
  lowConfidencePages: number[];
  pages: PdfCoveragePage[];
}

export interface PdfConsistencyCheck {
  code: string;
  label: string;
  expected: number;
  actual: number;
  passed: boolean;
}

export interface PdfStructureConsistency {
  expectedUnits: number;
  importedUnits: number;
  sourceSections: number;
  importedSections: number;
  sourceVocabulary: number;
  importedVocabulary: number;
  checks: PdfConsistencyCheck[];
}

export interface PdfImportQualityReport {
  status: "warning" | "review" | "good";
  totalSentences: number;
  cleanSentences: number;
  issueSentences: number;
  counts: Record<PdfQualitySeverity, number>;
  issues: PdfQualityIssue[];
  coverage: PdfLayoutCoverage | null;
  consistency: PdfStructureConsistency | null;
  ocr: OcrAudit | null;
}

export interface PdfImportPageAsset {
  id: string;
  pageNumber: number;
  fileName?: string;
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  uses?: unknown[];
}

export interface PdfImportDifference {
  id: string;
  provider: string;
  pageNumber: number;
  kind: "local-only" | "upstream-only" | "incorrect" | "reading-order" | "section";
  localText: string;
  upstreamText: string;
  similarity: number;
  status: "pending";
}

export interface PdfImportDifferences {
  total: number;
  pending: number;
  pages: number[];
  items: PdfImportDifference[];
}

export interface PdfSnapshotBlock {
  id: string;
  text: string;
  source: string;
  x: number;
  top: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfImportSnapshotInput {
  importId: string;
  householdId: string;
  title: string;
  rule: string;
  layout?: PdfLayout | null;
  structure: PdfImportStructure;
  chapters: PdfImportChapter[];
  quality?: PdfImportQualityReport | null;
  pageAssets: PdfImportPageAsset[];
  extractedAt: string;
}

export interface PdfImportSnapshot {
  schemaVersion: number;
  importId: string;
  householdId: string;
  title: string;
  rule: string;
  extractedAt: string;
  pageAssets: PdfImportPageAsset[];
  layers: {
    local: {
      provider: "local-pdf";
      status: string;
      pages: Array<{
        pageNumber: number;
        imageAssetId: string;
        imageUrl: string;
        width: number;
        height: number;
        blocks: PdfSnapshotBlock[];
      }>;
      structure: PdfImportStructure;
      chapters: PdfImportChapter[];
      validation: OcrAudit | null;
    };
    upstream: {
      providers: unknown[];
      visualReview: unknown;
    };
    differences: PdfImportDifferences;
    final: {
      strategy: "local-base-with-reviewed-upstream";
      reviewStatus: "pending-review" | "verified" | "approved" | "approved-with-pending-differences";
      approvedAt?: string;
      verifiedBy: string[];
      appliedDifferenceIds: string[];
      pendingDifferenceIds: string[];
      structure: PdfImportStructure;
      chapters: PdfImportChapter[];
    };
  };
}
