import { nanoid } from "nanoid";
import path from "node:path";
import type { PdfLayout, PdfLayoutItem, PdfLayoutLine } from "./types/pdf.js";

interface PdfTextPage {
  num?: number;
  page?: number;
  text: string;
}

interface PdfTocEntry {
  id: string;
  unitNumber: number;
  unitLabel: string;
  title: string;
  shortTitle: string;
  page: number;
}

interface TargetActivity {
  key: string;
  label: string;
  pattern: RegExp;
}

interface SourceLayoutReference {
  page: number;
  x?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  lineIds?: string[];
  itemIds?: string[];
}

interface StructureBlock {
  id: string;
  type: string;
  text: string;
  page: number;
  candidate: boolean;
  reason?: string;
  sentences: string[];
  activity?: string;
  targetActivity?: boolean;
  source?: string;
  itemType?: string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
  layout?: SourceLayoutReference;
}

interface StructureSection {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  blocks: StructureBlock[];
  activityKey?: string;
  source?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
}

interface StructureUnit {
  id: string;
  title: string;
  toc?: PdfTocEntry | null;
  pageStart: number;
  pageEnd: number;
  sections: StructureSection[];
  source?: string;
}

interface PdfStructureStats extends Record<string, unknown> {
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
}

export interface ParsedPdfStructure extends Record<string, unknown> {
  version: number;
  title: string;
  toc: PdfTocEntry[];
  units: StructureUnit[];
  frontMatter: StructureBlock[];
  stats: PdfStructureStats;
  source?: string;
  rule?: string;
}

interface StructureBlockContext {
  preserveAsUtterance?: boolean;
  activity?: string;
  targetActivity?: boolean;
}

interface PendingDialogue {
  activity: TargetActivity;
  unit: StructureUnit;
  section: StructureSection;
  page: number;
  lines: string[];
}

interface LayoutText {
  id: string;
  text: string;
  x: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  page: number;
  pageWidth: number;
  pageHeight: number;
  fontName?: string;
}

interface LayoutDialogueBlock {
  top: number;
  bottom: number;
  x: number;
  right: number;
  lines: LayoutText[];
}

interface LayoutUtterance {
  text: string;
  page: number;
  panelNumber?: number;
  layout: SourceLayoutReference & Required<Pick<SourceLayoutReference, "x" | "top" | "right" | "bottom">>;
}

interface LayoutUnitStart {
  key: string;
  page: number;
  title: string;
  tocEntry: PdfTocEntry | null;
  inferred?: boolean;
}

interface LayoutLineStart {
  index: number;
  line: LayoutText;
  heading: string;
  tocEntry: PdfTocEntry | null;
}

interface LayoutActivityRange {
  activity: TargetActivity;
  page: number;
  lines: LayoutText[];
}

interface PartHeading {
  kind: "part";
  label: string;
  focusQuestion: string;
}

interface ExcludedPartHeading {
  kind: "excluded";
}

type CurrentPartHeading = PartHeading | ExcludedPartHeading;

interface ReadingPanelMarker {
  number: number;
  x: number;
  top: number;
}

interface VocabularyRow {
  top: number;
  items: PdfLayoutItem[];
}

interface VocabularySeed {
  text: string;
  required: boolean;
}

interface PendingVocabularyEntry extends VocabularySeed {
  page: number;
  phoneticParts: string[];
  translationParts: string[];
  layoutItems: PdfLayoutItem[];
}

interface VocabularyEntry extends VocabularySeed {
  page: number;
  phonetic: string;
  translation: string;
  layout: SourceLayoutReference;
}

interface ImportedSentence extends Record<string, unknown> {
  id: string;
  text: string;
  itemType?: string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
  panelNumber?: number;
}

interface ImportedSection extends Record<string, unknown> {
  id: string;
  title: string;
  type: string;
  sentences: ImportedSentence[];
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
}

interface ImportedPart {
  id: string;
  label: string;
  focusQuestion: string;
  activities: ImportedSection[];
}

interface ImportedChapter extends Record<string, unknown> {
  id: string;
  title: string;
  text: string;
  sections?: ImportedSection[];
  sentences: ImportedSentence[];
  leadIn?: ImportedPart;
  parts?: ImportedPart[];
}

export interface PdfImportParserResult {
  chapters: ImportedChapter[];
  foundHeading: boolean;
  wasLimited: boolean;
  totalDetectedSentences: number;
  sourceMode: string;
}

interface RawChapter {
  title: string;
  lines: string[];
}

export const maxPdfImportSentences = 480;
const pdfNoisePhrasePattern =
  /\b(?:listen and (?:chant|sing|repeat|circle|write|number|choose|match)|look(?:, listen)? and (?:think|write|say)|read(?:, listen)? and (?:circle|number|tick|write)|(?:let['’]?s|lets)\s+(?:chant|sing|talk|learn|spell)|draw and say|match and say|choose and write|make a list and talk|talk about your best friend|do a survey|self-check|project:|activity name|big question)\b/gi;
const pdfNoisePhraseMatcher = new RegExp(pdfNoisePhrasePattern.source, "i");
const pdfNoiseSentencePattern =
  /\b(?:listen|circle|number|tick|match|choose|draw|survey|self-check|project|activity|contents|revision|picture|big question)\b/i;
const pdfGuidingQuestionPattern =
  /\b(?:what do family do together|what makes .+ special|how are these children|how do these children|how special are your friends)\b/i;
const pdfTargetActivityPatterns = [
  {
    key: "listen-and-chant",
    label: "Listen and chant",
    pattern: /listen\s+and\s+chant/i
  },
  {
    key: "lets-talk",
    label: "Let's talk",
    pattern: /(?:let['’]?s|lets)\s+talk/i
  }
];
export const pdfImportRuleLabels: Record<string, string> = {
  default: "通用PDF",
  "pep-textbook": "PEP课本"
};
export function normalizePdfImportRule(rule: unknown): string {
  const normalized = String(rule || "pep-textbook").trim();
  return Object.hasOwn(pdfImportRuleLabels, normalized) ? normalized : "pep-textbook";
}

export function repairPossiblyMojibake(value: unknown = ""): string {
  const text = String(value || "");
  if (!text) return text;

  const repaired = Buffer.from(text, "latin1").toString("utf8");
  const score = (candidate: string): number => {
    const cjk = candidate.match(/[\u4e00-\u9fff]/g)?.length || 0;
    const mojibake = candidate.match(/[ÃÂÄÅÆÇÈÉåèéæçï¼]/g)?.length || 0;
    const replacement = candidate.match(/\uFFFD/g)?.length || 0;
    return cjk * 3 - mojibake * 2 - replacement * 4;
  };

  return score(repaired) > score(text) ? repaired : text;
}

export function sanitizeImportTitle(fileName: string = ""): string {
  const repairedFileName = repairPossiblyMojibake(fileName);
  const baseName = path.basename(repairedFileName, path.extname(repairedFileName));
  const title = baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || "PDF 导入课程";
}

function isLikelyPdfPageMarker(line: string): boolean {
  const value = line.trim();
  if (!value) return false;
  if (/^pep\s*\.?\s*com\.?$/i.test(value)) return true;
  if (/^contents$/i.test(value)) return true;
  if (/^致\s*同\s*学$/.test(value)) return true;
  if (/^[-–—]{2,}\s*\d+\s+of\s+\d+\s*[-–—]*$/i.test(value)) return true;
  if (/^\d{1,4}$/.test(value)) return true;
  if (/^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(value)) return true;
  if (/^page\s+\d{1,4}(\s+of\s+\d{1,4})?$/i.test(value)) return true;
  return false;
}

function getImportHeading(line: string): string | false {
  const value = line.trim();
  if (!value || value.length > 96) return false;
  if (/^unit\s+\d+\s+.+\s+\d{1,3}$/i.test(value)) return false;
  if (/^(unit|module|chapter|lesson|part|story)\s+[\w\d]+(?:\b|[:：.-])/i.test(value)) {
    return value.replace(/\s+/g, " ");
  }
  if (/^第\s*[\d一二三四五六七八九十]+\s*(单元|章|课)\b/.test(value)) {
    return value.replace(/\s+/g, " ");
  }
  return "";
}

function isImportHeading(line: string): boolean {
  return Boolean(getImportHeading(line));
}

function normalizeImportKey(value: unknown = ""): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStructureLines(text: unknown): string[] {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[◆●■]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isTocEntry(line: string): boolean {
  return /^unit\s+\d+\s+.+\s+\d{1,3}$/i.test(line.trim());
}

function parseTocEntry(line: string): PdfTocEntry | null {
  const match = line.trim().match(/^unit\s+(\d+)\s+(.+?)\s+(\d{1,3})$/i);
  if (!match) return null;
  const unitNumber = Number(match[1]);
  const title = match[2].trim().replace(/\s+/g, " ");
  return {
    id: `pdf-toc-${nanoid(8)}`,
    unitNumber,
    unitLabel: `Unit ${unitNumber}`,
    title: `Unit ${unitNumber} ${title}`,
    shortTitle: title,
    page: Number(match[3])
  };
}

function extractPdfTocEntries(pages: PdfTextPage[]): PdfTocEntry[] {
  const entries = [];
  const seen = new Set();
  for (const page of pages) {
    for (const line of normalizeStructureLines(page.text)) {
      const entry = parseTocEntry(line);
      if (!entry) continue;
      const key = `${entry.unitNumber}:${normalizeImportKey(entry.shortTitle)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => a.unitNumber - b.unitNumber || a.page - b.page);
}

function findTocEntryForHeading(heading: string, tocEntries: PdfTocEntry[]): PdfTocEntry | null {
  const match = String(heading || "").match(/^unit\s+(\d+)/i);
  if (!match) return null;
  const unitNumber = Number(match[1]);
  return tocEntries.find((entry) => entry.unitNumber === unitNumber) || null;
}

function getTargetActivity(text: unknown): TargetActivity | null {
  const value = String(text || "");
  return pdfTargetActivityPatterns.find((activity) => activity.pattern.test(value)) || null;
}

function removeTargetActivityText(text: unknown): string {
  return pdfTargetActivityPatterns
    .reduce((nextText, activity) => nextText.replace(activity.pattern, " "), String(text || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function isDialogueActivity(activity: TargetActivity | null): activity is TargetActivity {
  return activity?.key === "lets-talk";
}

function isLikelyUtteranceEnd(line: unknown): boolean {
  return /[.!?。！？]["'”’)]?$/.test(String(line || "").trim());
}

function isRepeatedUnitTitle(line: string, unit: StructureUnit | null): boolean {
  if (!unit) return false;
  const lineKey = normalizeImportKey(line);
  if (!lineKey) return false;
  const titleKey = normalizeImportKey(unit.title);
  const unitLabelKey = normalizeImportKey(unit.toc?.unitLabel || unit.title);
  const shortTitleKey = normalizeImportKey(unit.toc?.shortTitle || "");
  return lineKey === titleKey || (Boolean(shortTitleKey) && lineKey === shortTitleKey) || lineKey === unitLabelKey;
}

function findExistingPdfUnit(units: StructureUnit[], tocEntry: PdfTocEntry | null, heading: string): StructureUnit | null {
  if (tocEntry) {
    return units.find((unit) => unit.toc?.unitNumber === tocEntry.unitNumber) || null;
  }

  const headingKey = normalizeImportKey(heading);
  return units.find((unit) => normalizeImportKey(unit.title) === headingKey) || null;
}

function extractSectionPrefix(line: string): { title: string; rest: string } | null {
  const match = line.trim().match(/^([ABC])(?:\s+|$)(.*)$/);
  if (!match) return null;
  const rest = (match[2] || "").trim();
  return {
    title: `Part ${match[1].toUpperCase()}`,
    rest
  };
}

function hasVocabularyLeadIn(text: unknown): boolean {
  const value = String(text || "")
    .replace(/^\d+\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:[a-z]+(?:['’][a-z]+)?\s+){3,}[A-Z]/.test(value);
}

function classifyStructureBlock(rawText: string, page: number, context: StructureBlockContext = {}): StructureBlock | null {
  const text = cleanImportedSentence(rawText);
  const sentences = splitImportedSentences(text, {
    preserveAsUtterance: Boolean(context.preserveAsUtterance)
  });
  const activity = context.activity || "";
  const targetActivity = Boolean(context.targetActivity);

  const withActivity = (block: StructureBlock): StructureBlock => ({
    ...block,
    ...(activity ? { activity } : {}),
    ...(targetActivity ? { targetActivity: true } : {})
  });

  if (!text || isLikelyPdfPageMarker(text)) {
    return null;
  }

  if (isTocEntry(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "note",
      text,
      page,
      candidate: false,
      reason: "目录项",
      sentences: []
    });
  }

  if (pdfNoisePhraseMatcher.test(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "activity",
      text,
      page,
      candidate: false,
      reason: "教材活动指令",
      sentences: []
    });
  }

  if (hasVocabularyLeadIn(rawText) || hasVocabularyLeadIn(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "vocabulary",
      text,
      page,
      candidate: false,
      reason: "词汇表或单词练习块",
      sentences: []
    });
  }

  if (sentences.length > 0) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: /[?？]$/.test(text) ? "question" : "reading",
      text,
      page,
      candidate: true,
      sentences
    });
  }

  if (/[?？]$/.test(text) || pdfGuidingQuestionPattern.test(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "question",
      text,
      page,
      candidate: false,
      reason: "教材引导问题",
      sentences: []
    });
  }

  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  const hasPunctuation = /[.!?。！？]/.test(text);
  if (!hasPunctuation && words.length >= 2 && words.length <= 16) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "vocabulary",
      text,
      page,
      candidate: false,
      reason: "词汇或短语块",
      sentences: []
    });
  }

  return withActivity({
    id: `pdf-block-${nanoid(8)}`,
    type: "note",
    text,
    page,
    candidate: false,
    reason: "非跟读文本",
    sentences: []
  });
}

function createPdfSection(title: string, page: number): StructureSection {
  return {
    id: `pdf-section-${nanoid(8)}`,
    title,
    pageStart: page,
    pageEnd: page,
    blocks: []
  };
}

function createPdfUnit(title: string, page: number, toc: PdfTocEntry | null = null): StructureUnit {
  return {
    id: `pdf-unit-${nanoid(8)}`,
    title,
    ...(toc ? { toc } : {}),
    pageStart: page,
    pageEnd: page,
    sections: [createPdfSection("正文", page)]
  };
}

function appendStructureBlock(target: StructureSection, block: StructureBlock | null): void {
  if (!block) return;
  target.blocks.push(block);
  target.pageEnd = Math.max(target.pageEnd, block.page);
}

export function buildPdfStructure({ title, pages }: { title: string; pages: PdfTextPage[] }): ParsedPdfStructure {
  const toc = extractPdfTocEntries(pages);
  const units: StructureUnit[] = [];
  const frontMatter: StructureBlock[] = [];
  let currentUnit: StructureUnit | null = null;
  let currentSection: StructureSection | null = null;
  let currentActivity: TargetActivity | null = null;
  let pendingDialogue: PendingDialogue | null = null;

  const addFrontMatter = (block: StructureBlock | null): void => {
    if (block) frontMatter.push(block);
  };

  const flushPendingDialogue = (): void => {
    if (!pendingDialogue?.lines.length) {
      pendingDialogue = null;
      return;
    }

    const block = classifyStructureBlock(pendingDialogue.lines.join(" "), pendingDialogue.page, {
      activity: pendingDialogue.activity.label,
      targetActivity: true,
      preserveAsUtterance: true
    });
    appendStructureBlock(pendingDialogue.section, block);
    pendingDialogue.unit.pageEnd = Math.max(pendingDialogue.unit.pageEnd, block?.page || pendingDialogue.page);
    pendingDialogue = null;
  };

  for (const page of pages) {
    const pageNumber = Number(page.num || page.page || 0) || pages.indexOf(page) + 1;
    for (const rawLine of normalizeStructureLines(page.text)) {
      const heading = getImportHeading(rawLine);
      if (heading) {
        flushPendingDialogue();
        const tocEntry = findTocEntryForHeading(heading, toc);
        const unitTitle = tocEntry?.title || heading;
        const existingUnit = findExistingPdfUnit(units, tocEntry, unitTitle);
        if (existingUnit) {
          currentUnit = existingUnit;
          currentUnit.pageEnd = Math.max(currentUnit.pageEnd, pageNumber);
          currentSection = createPdfSection("正文", pageNumber);
          currentUnit.sections.push(currentSection);
        } else {
          currentUnit = createPdfUnit(unitTitle, pageNumber, tocEntry);
          units.push(currentUnit);
          currentSection = currentUnit.sections[0];
        }
        currentActivity = null;
        continue;
      }

      if (currentUnit && isRepeatedUnitTitle(rawLine, currentUnit)) {
        flushPendingDialogue();
        appendStructureBlock(currentSection!, {
          id: `pdf-block-${nanoid(8)}`,
          type: "heading",
          text: rawLine,
          page: pageNumber,
          candidate: false,
          reason: "重复章节名",
          sentences: []
        });
        continue;
      }

      const sectionPrefix = extractSectionPrefix(rawLine);
      let line = rawLine;
      if (sectionPrefix && currentUnit) {
        flushPendingDialogue();
        currentSection = createPdfSection(sectionPrefix.title, pageNumber);
        currentUnit.sections.push(currentSection);
        currentActivity = null;
        line = sectionPrefix.rest;
        if (!line) continue;
      }

      const targetActivity = getTargetActivity(line);
      if (targetActivity && currentUnit) {
        flushPendingDialogue();
        currentActivity = targetActivity;
        currentSection = createPdfSection(targetActivity.label, pageNumber);
        currentUnit.sections.push(currentSection);
        appendStructureBlock(currentSection, {
          id: `pdf-block-${nanoid(8)}`,
          type: "activity",
          text: targetActivity.label,
          page: pageNumber,
          candidate: false,
          reason: "目标听读栏目",
          activity: targetActivity.label,
          targetActivity: true,
          sentences: []
        });
        line = removeTargetActivityText(line);
        if (!line) {
          continue;
        }
      } else if (pdfNoisePhraseMatcher.test(line)) {
        flushPendingDialogue();
        currentActivity = null;
      }

      if (currentUnit && currentSection && isDialogueActivity(currentActivity)) {
        if (!pendingDialogue) {
          pendingDialogue = {
            activity: currentActivity,
            unit: currentUnit,
            section: currentSection,
            page: pageNumber,
            lines: []
          };
        }
        pendingDialogue!.lines.push(line);
        if (isLikelyUtteranceEnd(line)) {
          flushPendingDialogue();
        }
        continue;
      }

      const block = classifyStructureBlock(line, pageNumber, {
        activity: currentActivity?.label || "",
        targetActivity: Boolean(currentActivity)
      });
      if (currentUnit && currentSection) {
        appendStructureBlock(currentSection, block);
        currentUnit.pageEnd = Math.max(currentUnit.pageEnd, block?.page || pageNumber);
      } else {
        addFrontMatter(block);
      }
    }
  }
  flushPendingDialogue();

  for (const entry of toc) {
    const hasUnit = units.some((unit) => unit.toc?.unitNumber === entry.unitNumber || normalizeImportKey(unit.title).startsWith(normalizeImportKey(entry.unitLabel)));
    if (!hasUnit) {
      units.push({
        id: `pdf-unit-${nanoid(8)}`,
        title: entry.title,
        toc: entry,
        pageStart: entry.page,
        pageEnd: entry.page,
        sections: []
      });
    }
  }

  units.sort((a, b) => {
    const unitA = a.toc?.unitNumber || Number.MAX_SAFE_INTEGER;
    const unitB = b.toc?.unitNumber || Number.MAX_SAFE_INTEGER;
    return unitA - unitB || a.pageStart - b.pageStart;
  });

  const sections = units.flatMap((unit) => unit.sections);
  const blocks = [...frontMatter, ...sections.flatMap((section) => section.blocks)];
  const candidateBlocks = blocks.filter((block) => block.candidate);
  const targetBlocks = candidateBlocks.filter((block) => block.targetActivity);
  return {
    version: 1,
    title,
    toc,
    units,
    frontMatter,
    stats: {
      pages: pages.length,
      tocEntries: toc.length,
      units: units.length,
      sections: sections.length,
      blocks: blocks.length,
      candidateBlocks: candidateBlocks.length,
      candidateSentences: candidateBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
      targetBlocks: targetBlocks.length,
      targetSentences: targetBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
      ignoredBlocks: blocks.filter((block) => !block.candidate).length
    }
  };
}

function buildPdfStructureStats({ pages, toc, units, frontMatter }: { pages: number; toc: PdfTocEntry[]; units: StructureUnit[]; frontMatter: StructureBlock[] }): PdfStructureStats {
  const sections = units.flatMap((unit) => unit.sections || []);
  const blocks = [...frontMatter, ...sections.flatMap((section) => section.blocks || [])];
  const candidateBlocks = blocks.filter((block) => block.candidate);
  const targetBlocks = candidateBlocks.filter((block) => block.targetActivity);

  return {
    pages,
    tocEntries: toc.length,
    units: units.length,
    sections: sections.length,
    blocks: blocks.length,
    candidateBlocks: candidateBlocks.length,
    candidateSentences: candidateBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
    targetBlocks: targetBlocks.length,
    targetSentences: targetBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
    ignoredBlocks: blocks.filter((block) => !block.candidate).length
  };
}

function layoutToPageTexts(layout: PdfLayout): PdfTextPage[] {
  return (layout?.pages || []).map((page) => ({
    num: page.page,
    text: (page.lines || []).map((line) => line.text).join("\n")
  }));
}

function createLayoutTocEntry({ unitNumber, title, page }: { unitNumber: number; title: string; page: number }): PdfTocEntry | null {
  const shortTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (!unitNumber || !shortTitle || !page) return null;
  return {
    id: `pdf-toc-${nanoid(8)}`,
    unitNumber,
    unitLabel: `Unit ${unitNumber}`,
    title: `Unit ${unitNumber} ${shortTitle}`,
    shortTitle,
    page
  };
}

function extractLayoutTocEntries(layout: PdfLayout): PdfTocEntry[] {
  const entries = [];
  const seen = new Set();
  const contentPages = (layout?.pages || []).filter((page) =>
    (page.lines || []).some((line) => /^contents$/i.test(normalizeLayoutHeadingText(line.text)))
  );
  const pagesToScan = contentPages.length > 0 ? contentPages : (layout?.pages || []).slice(0, 8);

  for (const page of pagesToScan) {
    const lines = page.lines || [];
    for (let index = 0; index < lines.length; index += 1) {
      const text = normalizeLayoutHeadingText(lines[index].text);
      let entry = null;

      const inlineWithPageMatch = text.match(/^unit\s+(\d+)\s+(.+?)\s+(\d{1,3})$/i);
      if (inlineWithPageMatch) {
        entry = createLayoutTocEntry({
          unitNumber: Number(inlineWithPageMatch[1]),
          title: inlineWithPageMatch[2],
          page: Number(inlineWithPageMatch[3])
        });
      } else {
        const inlineTitleMatch = text.match(/^unit\s+(\d+)\s+(.+)$/i);
        if (inlineTitleMatch) {
          const pageNumber = Number(normalizeLayoutHeadingText(lines[index + 1]?.text || ""));
          entry = createLayoutTocEntry({
            unitNumber: Number(inlineTitleMatch[1]),
            title: inlineTitleMatch[2],
            page: pageNumber
          });
        }
      }

      if (!entry) {
        const splitMatch = text.match(/^unit\s+(\d+)$/i);
        const nextText = normalizeLayoutHeadingText(lines[index + 1]?.text || "");
        const splitTitleMatch = nextText.match(/^(.+?)\s+(\d{1,3})$/);
        if (splitMatch && splitTitleMatch) {
          entry = createLayoutTocEntry({
            unitNumber: Number(splitMatch[1]),
            title: splitTitleMatch[1],
            page: Number(splitTitleMatch[2])
          });
        }
      }

      if (!entry) continue;
      const key = `${entry.unitNumber}:${normalizeImportKey(entry.shortTitle)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  return entries.sort((a, b) => a.unitNumber - b.unitNumber || a.page - b.page);
}

function flattenLayoutLines(layout: PdfLayout): LayoutText[] {
  return (layout?.pages || []).flatMap((page) =>
    (page.lines || []).map((line, index) => ({
      ...line,
      id: `${page.page}-${line.id || index + 1}`,
      page: page.page,
      pageWidth: page.width,
      pageHeight: page.height
    }))
  );
}

function isLayoutTextNoise(text: unknown): boolean {
  const value = String(text || "").trim();
  if (!value) return true;
  if (isLikelyPdfPageMarker(value) || isTocEntry(value) || getImportHeading(value)) return true;
  if (getTargetActivity(value)) return true;
  if (pdfNoisePhraseMatcher.test(value)) return true;
  if (/^(?:unit|part)\s+\d+$/i.test(value)) return true;
  if (/^[A-Z]\s*$/.test(value)) return true;
  if (/[\u4e00-\u9fff]/.test(value)) return true;
  return false;
}

function isLayoutPracticeLine(text: string, mode: string): boolean {
  const value = cleanImportedSentence(text);
  if (isLayoutTextNoise(value)) return false;
  if (pdfGuidingQuestionPattern.test(value)) return false;
  if (/^['’](?:s|t|re|ve|ll|d|m)\b/i.test(value)) return false;
  if (/\b(?:isn|aren|wasn|weren|don|doesn|didn|hasn|haven|hadn|couldn|wouldn|shouldn|mustn|won)$/i.test(value)) return false;

  const words = value.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (words.length > 22) return false;

  if (mode === "listen-and-chant") {
    return words.length >= 2 && value.length <= 150;
  }

  return words.length >= 1 && (/[.!?。！？]$/.test(value) || words.length <= 10);
}

function isLayoutActivityBoundary(text: unknown): boolean {
  const value = String(text || "").trim();
  if (!value || getTargetActivity(value)) return false;
  if (/^look[!?.]/i.test(value)) return false;
  const key = normalizeImportKey(value);
  if (
    key.includes("listen and sing") ||
    key.includes("let s sing") ||
    key.includes("lets sing") ||
    key.includes("let s learn") ||
    key.includes("lets learn") ||
    key.includes("draw and say") ||
    key.includes("match and say") ||
    key.includes("share and say") ||
    key.includes("read and write") ||
    key.includes("reading time")
  ) {
    return true;
  }
  if (/^(?:look|listen|read|write|chant|sing|circle|match|choose|tick|number|role[-\s]?play|draw and say|match and say|share and say|say and draw|listen and sing|let['’]?s sing|let['’]?s learn|let['’]?s spell|read and write|reading time|self-check|project\b|big question)\b/i.test(value)) {
    return true;
  }
  return value.length < 72 && pdfNoisePhraseMatcher.test(value);
}

function isAnyLayoutActivityLine(text: unknown): boolean {
  const value = String(text || "").trim();
  if (!value) return false;
  return Boolean(getTargetActivity(value)) || isLayoutActivityBoundary(value);
}

function getPepLayoutPartHeading(text: string, page: PdfLayout["pages"][number], sourceLine: PdfLayoutLine): PartHeading | null {
  const value = normalizeLayoutHeadingText(text);
  const match = value.match(/^([AB])\s+(.{4,})$/i);
  if (!match) return null;
  const sourceLineIndex = (page?.lines || []).indexOf(sourceLine);
  const nextActivityLine = (page?.lines || [])
    .slice(Math.max(0, sourceLineIndex + 1))
    .find((line) => line.top > sourceLine.top && isAnyLayoutActivityLine(line.text));
  const headingBottom = Math.min(sourceLine.top + 72, nextActivityLine?.top ?? Number.POSITIVE_INFINITY);
  const itemFocusQuestion = (page?.items || [])
    .filter(
      (item) =>
        item.top >= sourceLine.top - 2 &&
        item.top < headingBottom &&
        !/^[AB]$/i.test(normalizeLayoutHeadingText(item.text))
    )
    .sort((a, b) => a.top - b.top || a.x - b.x)
    .map((item) => normalizeLayoutHeadingText(item.text))
    .filter(Boolean)
    .join(" ")
    .replace(/^[AB]\s+/i, "");
  const focusQuestion = normalizeLayoutHeadingText(itemFocusQuestion || match[2]);
  if (!focusQuestion || !/[A-Za-z]/.test(focusQuestion)) return null;
  return {
    kind: "part",
    label: match[1].toUpperCase(),
    focusQuestion
  };
}

function isPepLayoutExcludedPartHeading(text: unknown): boolean {
  return /^C\s+(?:project\b|reading\s+time\b)/i.test(normalizeLayoutHeadingText(text));
}

function normalizeRepeatedSentenceSequence(text: unknown): string {
  const value = String(text || "")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  if (parts.length < 2) return value;

  const result = [];
  const seen = new Set();
  for (const part of parts) {
    const cleaned = part.replace(/\s+/g, " ").trim();
    const key = normalizeSentenceKey(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result.length > 0 ? result.join(" ") : value;
}

function normalizeLayoutHeadingText(text: unknown): string {
  let value = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return "";

  const compact = value.replace(/\s+/g, "");
  if (compact.length % 2 === 0) {
    const halfLength = compact.length / 2;
    const firstHalf = compact.slice(0, halfLength);
    const secondHalf = compact.slice(halfLength);
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      value = value.slice(0, Math.ceil(value.length / 2)).trim();
    }
  }

  return value;
}

function normalizeRepeatedOverlayText(text: string): string {
  let value = cleanImportedSentence(text)
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return "";

  const compact = value.replace(/\s+/g, "");
  if (compact.length % 2 === 0) {
    const halfLength = compact.length / 2;
    const firstHalf = compact.slice(0, halfLength);
    const secondHalf = compact.slice(halfLength);
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      value = value.slice(0, Math.ceil(value.length / 2)).trim();
    }
  }

  return normalizeRepeatedSentenceSequence(value);
}

function getLineVerticalGap(previous: LayoutText, current: LayoutText): number {
  return Math.max(0, current.top - previous.bottom);
}

function getHorizontalOverlapRatio(a: LayoutText, b: LayoutText): number {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const width = Math.max(1, Math.min(a.width || 0, b.width || 0));
  return overlap / width;
}

function compareLayoutReadingOrder(a: LayoutText, b: LayoutText): number {
  const rowTolerance = Math.max(3, Math.min(a.height || 0, b.height || 0) * 0.35);
  if (Math.abs(a.top - b.top) <= rowTolerance) {
    return a.x - b.x || a.top - b.top;
  }
  return a.top - b.top || a.x - b.x;
}

function canJoinDialogueBlock(block: LayoutDialogueBlock, line: LayoutText): boolean {
  const previous = block.lines.at(-1);
  if (!previous) return false;
  if (/[.!?。！？]["'”’)]?$/.test(String(previous.text || "").trim()) && /^[A-Z]/.test(String(line.text || "").trim())) {
    return false;
  }
  const verticalGap = getLineVerticalGap(previous, line);
  const alignedLeft = Math.abs(previous.x - line.x) <= 42;
  const overlaps = getHorizontalOverlapRatio(previous, line) >= 0.24;
  const sameRow = Math.abs(previous.top - line.top) <= Math.max(4, Math.max(previous.height || 0, line.height || 0) * 0.45);
  const horizontalGap = line.x - previous.right;
  const touchesPrevious = horizontalGap >= -1 && horizontalGap <= Math.max(8, Math.max(previous.height || 0, line.height || 0) * 0.65);
  const close = verticalGap <= Math.max(28, Math.max(previous.height || 0, line.height || 0) * 2.2);
  return close && (alignedLeft || overlaps || (sameRow && touchesPrevious));
}

function normalizeLayoutUtterance(lines: LayoutText[]): string {
  return normalizeRepeatedOverlayText(
    lines
      .sort(compareLayoutReadingOrder)
      .map((line) => line.text)
      .join(" ")
  );
}

function isPepReadingPracticeText(text: unknown): boolean {
  const value = String(text || "").trim();
  if (!value || /[\u4e00-\u9fff]/.test(value) || isLikelyPdfPageMarker(value)) return false;
  const words = value.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  return words.length > 0 && words.length <= 28 && value.length <= 220;
}

function extractDialogueUtterancesFromLayoutLines(lines: LayoutText[], options: { mode?: string } = {}): LayoutUtterance[] {
  const readingMode = options.mode === "reading";
  const blocks = [];
  const candidates = lines
    .map((line) => ({
      ...line,
      text: normalizeRepeatedOverlayText(line.text)
    }))
    .filter((line) => {
      if (readingMode ? !isPepReadingPracticeText(line.text) : isLayoutTextNoise(line.text)) return false;
      if (/^['’]$/.test(line.text)) return true;
      const words = line.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
      return words.length > 0 && line.text.length <= 180;
    })
    .sort(compareLayoutReadingOrder);

  for (const line of candidates) {
    const target = blocks
      .filter((block) => canJoinDialogueBlock(block, line))
      .sort((a, b) => getLineVerticalGap(a.lines.at(-1)!, line) - getLineVerticalGap(b.lines.at(-1)!, line))[0];

    if (target) {
      target.lines.push(line);
      target.top = Math.min(target.top, line.top);
      target.bottom = Math.max(target.bottom, line.bottom);
      target.x = Math.min(target.x, line.x);
      target.right = Math.max(target.right, line.right);
    } else {
      blocks.push({
        top: line.top,
        bottom: line.bottom,
        x: line.x,
        right: line.right,
        lines: [line]
      });
    }
  }

  const seen = new Set();
  return blocks
    .sort((a, b) => a.top - b.top || a.x - b.x)
    .map((block) => ({
      text: normalizeLayoutUtterance(block.lines),
      page: block.lines[0]?.page || 1,
      layout: {
        page: block.lines[0]?.page || 1,
        x: Number(block.x.toFixed(2)),
        top: Number(block.top.toFixed(2)),
        right: Number(block.right.toFixed(2)),
        bottom: Number(block.bottom.toFixed(2)),
        lineIds: block.lines.map((line) => line.id)
      }
    }))
    .filter((utterance) => {
      if (readingMode ? !isPepReadingPracticeText(utterance.text) : !isLayoutPracticeLine(utterance.text, "lets-talk")) return false;
      const key = normalizeSentenceKey(utterance.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function createLayoutCandidateBlock({ text, page, activity, layout }: { text: string; page: number; activity: TargetActivity; layout?: SourceLayoutReference }): StructureBlock {
  const cleanedText = normalizeRepeatedOverlayText(text);
  return {
    id: `pdf-block-${nanoid(8)}`,
    type: /[?？]$/.test(cleanedText) ? "question" : "reading",
    text: cleanedText,
    page,
    candidate: true,
    activity: activity.label,
    targetActivity: true,
    source: "layout",
    ...(layout ? { layout } : {}),
    sentences: [cleanedText]
  };
}

function findPepLayoutUnitStarts(layout: PdfLayout, toc: PdfTocEntry[]): LayoutUnitStart[] {
  const starts = [];
  const seen = new Set();

  for (const page of layout?.pages || []) {
    if ((page.lines || []).some((line) => /^contents$/i.test(normalizeLayoutHeadingText(line.text)))) {
      continue;
    }
    const normalizedLines = (page.lines || []).map((line) => normalizeImportKey(normalizeLayoutHeadingText(line.text)));
    const compactLines = normalizedLines.map((line) => line.replace(/\s+/g, ""));
    const normalizedPageText = normalizeImportKey(normalizedLines.join(" "));
    const compactPageText = normalizedPageText.replace(/\s+/g, "");

    for (const entry of toc) {
      const key = `toc-${entry.unitNumber}`;
      if (seen.has(key)) continue;

      const titleKey = normalizeImportKey(entry.shortTitle);
      const compactTitleKey = titleKey.replace(/\s+/g, "");
      const hasTitle =
        normalizedLines.some((line) => line.includes(titleKey)) ||
        normalizedPageText.includes(titleKey) ||
        compactPageText.includes(compactTitleKey);
      const hasUnitMarker = compactLines.some(
        (line) => line.includes(`unit${entry.unitNumber}`) || line.includes(`unitunit${entry.unitNumber}${entry.unitNumber}`)
      );

      if (!hasTitle || !hasUnitMarker) continue;
      seen.add(key);
      starts.push({
        key,
        page: page.page,
        title: entry.title,
        tocEntry: entry
      });
    }
  }

  if (starts.length > 0 && starts.length < toc.length) {
    const offsetCounts = new Map();
    for (const start of starts) {
      const offset = start.page - start.tocEntry.page;
      offsetCounts.set(offset, (offsetCounts.get(offset) || 0) + 1);
    }
    const inferredOffset = [...offsetCounts.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]?.[0];

    if (Number.isFinite(inferredOffset)) {
      for (const entry of toc) {
        const key = `toc-${entry.unitNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        starts.push({
          key,
          page: Math.max(1, entry.page + inferredOffset),
          title: entry.title,
          tocEntry: entry,
          inferred: true
        });
      }
    }
  }

  return starts.sort((a, b) => a.page - b.page || a.tocEntry.unitNumber - b.tocEntry.unitNumber);
}

function findPepLayoutContentEndPage(layout: PdfLayout, unitStarts: LayoutUnitStart[]): number {
  const lastUnitPage = unitStarts.at(-1)?.page || 0;
  const backMatterPage = (layout?.pages || []).find((page) => {
    if (page.page <= lastUnitPage) return false;
    return (page.lines || []).some((line) => /^(?:revision\b|appendix\b)/i.test(normalizeLayoutHeadingText(line.text)));
  });
  return backMatterPage?.page || Number.POSITIVE_INFINITY;
}

function findPepLayoutUnitForPage(pageNumber: number, unitStarts: LayoutUnitStart[], toc: PdfTocEntry[]): LayoutUnitStart {
  const start = [...unitStarts].reverse().find((unit) => unit.page <= pageNumber);
  if (start) return start;

  const firstToc = toc[0];
  if (firstToc) {
    return {
      key: `toc-${firstToc.unitNumber}`,
      page: pageNumber,
      title: firstToc.title,
      tocEntry: firstToc
    };
  }

  return {
    key: `page-${pageNumber}`,
    page: pageNumber,
    title: `Chapter ${pageNumber}`,
    tocEntry: null
  };
}

function collectPepLayoutActivityLines(page: PdfLayout["pages"][number], headingIndex: number): LayoutText[] {
  const heading = page.lines[headingIndex];
  const collected = [];

  for (let index = headingIndex + 1; index < page.lines.length; index += 1) {
    const line = page.lines[index];
    if (line.top <= heading.top) continue;
    if (isAnyLayoutActivityLine(line.text)) break;

    const text = normalizeRepeatedOverlayText(line.text);
    if (!text) continue;
    collected.push({
      ...line,
      text,
      page: page.page,
      pageWidth: page.width,
      pageHeight: page.height
    });
  }

  return collected;
}

function collectPepLayoutActivityItems(page: PdfLayout["pages"][number], headingIndex: number): LayoutText[] {
  const heading = page.lines[headingIndex];
  const boundary = page.lines.slice(headingIndex + 1).find((line) => line.top > heading.top && isAnyLayoutActivityLine(line.text));
  const boundaryTop = boundary?.top ?? Number.POSITIVE_INFINITY;

  return (page.items || [])
    .filter((item) => item.top > heading.top && item.top < boundaryTop)
    .map((item) => ({
      ...item,
      text: normalizeRepeatedOverlayText(item.text),
      page: page.page,
      pageWidth: page.width,
      pageHeight: page.height
    }))
    .filter((item) => item.text);
}

function getPepVocabularyAppendixPages(layout: PdfLayout): PdfLayout["pages"] {
  const pages = layout?.pages || [];
  const startIndex = pages.findIndex((page) => {
    const headings = (page.lines || []).map((line) => normalizeLayoutHeadingText(line.text));
    return headings.some((text) => /^appendix\s+2$/i.test(text)) && headings.some((text) => /\bwords\s+in\s+each\s+unit\b/i.test(text));
  });
  if (startIndex < 0) return [];

  const appendixPages = [];
  for (let index = startIndex; index < pages.length; index += 1) {
    const page = pages[index];
    const isNextAppendix =
      index > startIndex &&
      (page.lines || []).some((line) => /^appendix\s+(?!2\b)\d+\b/i.test(normalizeLayoutHeadingText(line.text)));
    if (isNextAppendix) break;
    appendixPages.push(page);
  }
  return appendixPages;
}

function groupPepVocabularyRows(items: PdfLayoutItem[]): VocabularyRow[] {
  const rows: VocabularyRow[] = [];
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);

  for (const item of sorted) {
    const currentRow = rows.at(-1);
    if (currentRow && Math.abs(currentRow.top - item.top) <= 1.2) {
      currentRow.items.push(item);
      continue;
    }
    rows.push({ top: item.top, items: [item] });
  }

  return rows.map((row) => ({
    ...row,
    items: row.items.sort((a, b) => a.x - b.x)
  }));
}

function getPepVocabularyStart(rowItems: PdfLayoutItem[]): VocabularySeed | null {
  const orderedItems = [...rowItems].sort((a, b) => a.x - b.x);
  const bareStar = orderedItems.find((item) => /^\*$/.test(String(item.text || "").trim()));
  const combinedStar = orderedItems.find((item) => /^\*{1,2}[A-Za-z]/.test(String(item.text || "").trim()));
  if (!bareStar && !combinedStar) return null;

  const chineseStart = orderedItems.findIndex((item) => /[\u4e00-\u9fff]/.test(String(item.text || "")));
  const lexicalItems = orderedItems
    .slice(0, chineseStart < 0 ? orderedItems.length : chineseStart)
    .map((item) => ({
      item,
      text: String(item.text || "").trim().replace(/^\*+/, "")
    }))
    .filter(
      ({ text }) =>
        text.toLowerCase() !== "p" &&
        /^[A-Za-z]+(?:[-'’][A-Za-z]+)*(?:\s+[A-Za-z]+(?:[-'’][A-Za-z]+)*)*$/.test(text)
    );
  if (lexicalItems.length === 0) return null;

  const wordFont = lexicalItems[0].item.fontName;
  const wordParts = lexicalItems.filter(({ item }) => item.fontName === wordFont).map(({ text }) => text);
  const text = wordParts.join(" ").replace(/\s+/g, " ").trim();
  const words = text.match(/[A-Za-z]+(?:[-'’][A-Za-z]+)*/g) || [];
  if (words.length < 1 || words.length > 4 || text.length > 60) return null;

  return {
    text,
    required: Boolean(bareStar && wordFont && bareStar.fontName && wordFont !== bareStar.fontName)
  };
}

function getPepVocabularyPhonetics(rowItems: PdfLayoutItem[]): string[] {
  return rowItems
    .map((item) => String(item.text || "").trim())
    .filter((text) => /^\/.+\/$/.test(text));
}

function getPepVocabularyTranslations(rowItems: PdfLayoutItem[]): string[] {
  return rowItems
    .map((item) => String(item.text || "").trim().replace(/^\*+/, ""))
    .filter((text) => /[\u4e00-\u9fff]/.test(text) && !/^（?复数/.test(text));
}

function extractPepVocabulary(layout: PdfLayout): Map<number, VocabularyEntry[]> {
  const vocabularyByUnit = new Map<number, VocabularyEntry[]>();
  const seenByUnit = new Map<number, Set<string>>();
  let currentUnitNumber = 0;

  const addEntry = (entry: PendingVocabularyEntry | null): void => {
    if (!entry || !currentUnitNumber) return;
    const key = normalizeImportKey(entry.text);
    if (!key || seenByUnit.get(currentUnitNumber)?.has(key)) return;
    seenByUnit.get(currentUnitNumber)!.add(key);
    const layoutItems = entry.layoutItems;
    vocabularyByUnit.get(currentUnitNumber)!.push({
      text: entry.text,
      phonetic: [...new Set(entry.phoneticParts)].join(" "),
      translation: entry.translationParts.join("").replace(/^[；;，,\s]+|[\s]+$/g, ""),
      required: entry.required,
      page: entry.page,
      layout: {
        page: entry.page,
        x: Math.min(...layoutItems.map((item) => item.x)),
        top: Math.min(...layoutItems.map((item) => item.top)),
        right: Math.max(...layoutItems.map((item) => item.right)),
        bottom: Math.max(...layoutItems.map((item) => item.bottom)),
        itemIds: layoutItems.map((item) => item.id)
      }
    });
  };

  for (const page of getPepVocabularyAppendixPages(layout)) {
    const columnSplit = page.width / 2;
    for (const column of ["left", "right"]) {
      let currentEntry: PendingVocabularyEntry | null = null;
      const columnItems = (page.items || []).filter((item) =>
        column === "left" ? item.x < columnSplit : item.x >= columnSplit
      );

      for (const row of groupPepVocabularyRows(columnItems)) {
        const rowText = row.items.map((item) => item.text).join(" ");
        const unitMatch = rowText.match(/\bunit\s*([1-9]\d*)\b/i);
        if (unitMatch) {
          addEntry(currentEntry);
          currentEntry = null;
          currentUnitNumber = Number(unitMatch[1]);
          if (!vocabularyByUnit.has(currentUnitNumber)) vocabularyByUnit.set(currentUnitNumber, []);
          if (!seenByUnit.has(currentUnitNumber)) seenByUnit.set(currentUnitNumber, new Set());
          continue;
        }

        if (!currentUnitNumber) continue;
        const start = getPepVocabularyStart(row.items);
        if (start) {
          addEntry(currentEntry);
          currentEntry = {
            ...start,
            page: page.page,
            phoneticParts: getPepVocabularyPhonetics(row.items),
            translationParts: getPepVocabularyTranslations(row.items),
            layoutItems: [...row.items]
          };
          continue;
        }

        if (!currentEntry) continue;
        currentEntry.phoneticParts.push(...getPepVocabularyPhonetics(row.items));
        currentEntry.translationParts.push(...getPepVocabularyTranslations(row.items));
        currentEntry.layoutItems.push(...row.items);
      }
      addEntry(currentEntry);
    }
  }

  return vocabularyByUnit;
}

function prependPepVocabularySections(units: StructureUnit[], layout: PdfLayout): void {
  const vocabularyByUnit = extractPepVocabulary(layout);

  for (const unit of units) {
    const unitNumber = Number(unit.toc?.unitNumber || unit.title.match(/\bunit\s+(\d+)\b/i)?.[1] || 0);
    const vocabulary = vocabularyByUnit.get(unitNumber) || [];
    if (vocabulary.length === 0) continue;

    const section = createPdfSection("Words", vocabulary[0].page);
    section.activityKey = "vocabulary";
    section.source = "layout";
    section.partKind = "vocabulary";
    section.partLabel = "";
    section.focusQuestion = "";

    for (const entry of vocabulary) {
      appendStructureBlock(section, {
        id: `pdf-block-${nanoid(8)}`,
        type: "vocabulary",
        text: entry.text,
        page: entry.page,
        candidate: true,
        activity: "Words",
        targetActivity: true,
        source: "layout",
        itemType: "word",
        phonetic: entry.phonetic,
        translation: entry.translation,
        required: entry.required,
        layout: entry.layout,
        sentences: [entry.text]
      });
    }

    unit.sections.unshift(section);
  }
}

function getPepReadingPanelMarkers(page: PdfLayout["pages"][number]): ReadingPanelMarker[] {
  return (page.lines || [])
    .map((line) => {
      const text = normalizeLayoutHeadingText(line.text);
      const match = text.match(/^([1-6])(?:\s+|$)/);
      if (!match) return null;
      return {
        number: Number(match[1]),
        x: line.x,
        top: line.top
      };
    })
    .filter((marker): marker is ReadingPanelMarker => Boolean(marker));
}

function getPepReadingPanelNumber(utterance: LayoutUtterance, markers: ReadingPanelMarker[], pageWidth: number): number {
  const eligible = markers.filter((marker) => marker.top <= utterance.layout.top + 28);
  const candidates = eligible.length > 0 ? eligible : markers;
  if (candidates.length === 0) return 0;
  const utteranceSide = utterance.layout.x < pageWidth / 2 ? "left" : "right";
  return [...candidates]
    .sort((a, b) => {
      const aSide = a.x < pageWidth / 2 ? "left" : "right";
      const bSide = b.x < pageWidth / 2 ? "left" : "right";
      const aScore = Math.abs(utterance.layout.top - a.top) + (aSide === utteranceSide ? 0 : 90);
      const bScore = Math.abs(utterance.layout.top - b.top) + (bSide === utteranceSide ? 0 : 90);
      return aScore - bScore || b.number - a.number;
    })[0].number;
}

function collapsePepReadingRepeatedWords(text: string): string {
  const tokens = String(text || "").match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (tokens.length < 4) return text;
  let changed = false;
  let searching = true;

  while (searching) {
    searching = false;
    for (let start = 0; start < tokens.length; start += 1) {
      const maxLength = Math.min(8, Math.floor((tokens.length - start) / 2));
      for (let length = maxLength; length >= 2; length -= 1) {
        const first = tokens.slice(start, start + length).map((token) => token.toLowerCase());
        const second = tokens.slice(start + length, start + length * 2).map((token) => token.toLowerCase());
        if (!first.every((token, index) => token === second[index])) continue;
        tokens.splice(start + length, length);
        changed = true;
        searching = true;
        break;
      }
      if (searching) break;
    }
  }

  if (!changed) return text;
  let result = tokens.join(" ");
  if (/[,，]\s*but\b/i.test(text)) result = result.replace(/\s+but\b/i, ", but");
  const terminal = String(text || "").trim().match(/[.!?]$/)?.[0] || ".";
  return `${result}${terminal}`;
}

function removePepReadingOverlayDuplicates(utterances: LayoutUtterance[]): LayoutUtterance[] {
  const cleaned = utterances.map((utterance) => ({
    ...utterance,
    text: normalizeRepeatedSentenceSequence(collapsePepReadingRepeatedWords(utterance.text))
  }));

  return cleaned.filter((utterance, index) => {
    const key = normalizeImportKey(utterance.text);
    if (!key) return false;
    return !cleaned.some((other, otherIndex) => {
      if (otherIndex === index || other.panelNumber !== utterance.panelNumber) return false;
      const otherKey = normalizeImportKey(other.text);
      return otherKey.length > key.length + 5 && otherKey.includes(key);
    });
  });
}

export function mergePepReadingParagraphs(utterances: LayoutUtterance[]): LayoutUtterance[] {
  const groups = new Map();
  utterances.forEach((utterance, index) => {
    const panelNumber = Number(utterance.panelNumber || 0);
    const key = panelNumber > 0 ? `panel-${panelNumber}` : `unassigned-${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(utterance);
  });

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort(
      (a, b) => a.page - b.page || a.layout.top - b.layout.top || a.layout.x - b.layout.x
    );
    const first = ordered[0];
    const layouts = ordered.map((item) => item.layout);
    const x = Math.min(...layouts.map((layout) => layout.x));
    const top = Math.min(...layouts.map((layout) => layout.top));
    const right = Math.max(...layouts.map((layout) => layout.right ?? layout.x + layout.width));
    const bottom = Math.max(...layouts.map((layout) => layout.bottom ?? layout.top + layout.height));
    return {
      ...first,
      text: ordered.map((item) => String(item.text || "").trim()).filter(Boolean).join(" "),
      layout: {
        ...first.layout,
        x,
        top,
        right,
        bottom,
        width: right - x,
        height: bottom - top
      }
    };
  });
}

function extractPepReadingTimeUtterances(pages: PdfLayout["pages"], headingPageNumber: number): LayoutUtterance[] {
  const utterances = [];

  for (const page of pages) {
    const heading = (page.lines || []).find((line) => /^reading\s+time/i.test(normalizeLayoutHeadingText(line.text)));
    const markers = getPepReadingPanelMarkers(page);
    const items = (page.items || [])
      .filter((item) => page.page !== headingPageNumber || !heading || item.top > heading.bottom)
      .filter((item) => item.top < page.height - 45)
      .filter((item) => !/^reading\s+time/i.test(normalizeLayoutHeadingText(item.text)))
      .filter((item) => !/^[1-6]$/.test(String(item.text || "").trim()))
      .map((item) => ({
        ...item,
        page: page.page,
        pageWidth: page.width,
        pageHeight: page.height
      }));

    for (const utterance of extractDialogueUtterancesFromLayoutLines(items, { mode: "reading" })) {
      utterances.push({
        ...utterance,
        panelNumber: getPepReadingPanelNumber(utterance, markers, page.width)
      });
    }
  }

  const cleaned = removePepReadingOverlayDuplicates(utterances).sort(
    (a, b) => Number(a.panelNumber || 0) - Number(b.panelNumber || 0) || a.page - b.page || a.layout.top - b.layout.top || a.layout.x - b.layout.x
  );
  return mergePepReadingParagraphs(cleaned);
}

function appendPepReadingTimeSections(units: StructureUnit[], layout: PdfLayout, unitStarts: LayoutUnitStart[], contentEndPage: number): void {
  const pages = layout?.pages || [];

  units.forEach((unit, unitIndex) => {
    const unitStart = unitStarts[unitIndex];
    const unitEndPage = unitStarts[unitIndex + 1]?.page || contentEndPage;
    const unitPages = pages.filter((page) => page.page >= unitStart.page && page.page < unitEndPage);
    const headingPage = [...unitPages].reverse().find((page) =>
      (page.lines || []).some((line) => /^reading\s+time/i.test(normalizeLayoutHeadingText(line.text)))
    );
    if (!headingPage) return;

    const readingPages = unitPages.filter((page) => page.page >= headingPage.page && page.page <= headingPage.page + 1);
    const utterances = extractPepReadingTimeUtterances(readingPages, headingPage.page);
    if (utterances.length === 0) return;

    const section = createPdfSection("Reading time", headingPage.page);
    section.activityKey = "reading-time";
    section.source = "layout";
    section.partKind = "reading-time";
    section.partLabel = "";
    section.focusQuestion = "";

    for (const utterance of utterances) {
      appendStructureBlock(section, {
        id: `pdf-block-${nanoid(8)}`,
        type: "reading",
        text: utterance.text,
        page: utterance.page,
        candidate: true,
        activity: "Reading time",
        targetActivity: true,
        source: "layout",
        itemType: "reading",
        required: true,
        panelNumber: utterance.panelNumber,
        layout: utterance.layout,
        sentences: [utterance.text]
      });
    }

    unit.sections.push(section);
  });
}

function buildPdfStructureFromPepLayout({ title, layout }: { title: string; layout: PdfLayout }): ParsedPdfStructure {
  const pages = layoutToPageTexts(layout);
  const toc = extractLayoutTocEntries(layout);
  const unitStarts = findPepLayoutUnitStarts(layout, toc);
  const contentEndPage = findPepLayoutContentEndPage(layout, unitStarts);
  const frontMatter: StructureBlock[] = [];
  const units: StructureUnit[] = [];
  const unitByKey = new Map<string, StructureUnit>();
  const currentPartByUnitId = new Map<string, CurrentPartHeading>();

  const getUnit = (pageNumber: number): StructureUnit => {
    const unitStart = findPepLayoutUnitForPage(pageNumber, unitStarts, toc);
    if (!unitByKey.has(unitStart.key)) {
      const unit = createPdfUnit(unitStart.title, unitStart.page, unitStart.tocEntry);
      unit.source = "layout";
      unit.sections = [];
      unitByKey.set(unitStart.key, unit);
      units.push(unit);
    }
    return unitByKey.get(unitStart.key)!;
  };

  for (const unitStart of unitStarts) {
    getUnit(unitStart.page);
  }

  for (const page of layout?.pages || []) {
    if (page.page >= contentEndPage) continue;
    if (page.page < (unitStarts[0]?.page || 1)) continue;
    const pageUnit = getUnit(page.page);
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const partHeading = getPepLayoutPartHeading(line.text, page, line);
      if (partHeading) {
        currentPartByUnitId.set(pageUnit.id, partHeading);
        continue;
      }
      if (isPepLayoutExcludedPartHeading(line.text)) {
        currentPartByUnitId.set(pageUnit.id, { kind: "excluded" });
        continue;
      }
      const activity = getTargetActivity(line.text);
      if (!activity) continue;

      const targetLines =
        activity.key === "lets-talk"
          ? collectPepLayoutActivityItems(page, index)
          : collectPepLayoutActivityLines(page, index);
      if (targetLines.length === 0) continue;

      const unit = pageUnit;
      const currentPart = currentPartByUnitId.get(unit.id);
      if (currentPart?.kind === "excluded") continue;
      const section = createPdfSection(activity.label, page.page);
      section.activityKey = activity.key;
      section.source = "layout";
      section.partKind = currentPart ? "part" : "lead-in";
      section.partLabel = currentPart?.label || "Lead-in";
      section.focusQuestion = currentPart?.focusQuestion || "";
      appendLayoutActivityBlocks(section, activity, targetLines);
      if (section.blocks.length === 0) continue;

      unit.sections.push(section);
      unit.pageEnd = Math.max(unit.pageEnd, section.pageEnd);
    }
  }

  prependPepVocabularySections(units, layout);
  appendPepReadingTimeSections(units, layout, unitStarts, contentEndPage);

  return {
    version: 2,
    title,
    toc,
    units,
    frontMatter,
    source: "layout",
    rule: "pep-textbook",
    stats: buildPdfStructureStats({ pages: layout?.pageCount || pages.length, toc, units, frontMatter })
  };
}

function appendLayoutActivityBlocks(section: StructureSection, activity: TargetActivity, lines: LayoutText[]): void {
  if (activity.key === "lets-talk") {
    for (const utterance of extractDialogueUtterancesFromLayoutLines(lines)) {
      appendStructureBlock(
        section,
        createLayoutCandidateBlock({
          text: utterance.text,
          page: utterance.page,
          activity,
          layout: utterance.layout
        })
      );
    }
    return;
  }

  const seen = new Set();
  for (const line of lines.sort((a, b) => a.top - b.top || a.x - b.x)) {
    const text = normalizeRepeatedOverlayText(line.text);
    if (!isLayoutPracticeLine(text, "listen-and-chant")) continue;
    const key = normalizeSentenceKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    appendStructureBlock(
      section,
      createLayoutCandidateBlock({
        text,
        page: line.page,
        activity,
        layout: {
          page: line.page,
          x: line.x,
          top: line.top,
          right: line.right,
          bottom: line.bottom,
          lineIds: [line.id]
        }
      })
    );
  }
}

function findLayoutUnitStarts(lines: LayoutText[], toc: PdfTocEntry[]): LayoutLineStart[] {
  const starts = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = getImportHeading(line.text);
    if (!heading || isTocEntry(line.text)) continue;
    const tocEntry = findTocEntryForHeading(heading, toc);
    const key = tocEntry ? `toc-${tocEntry.unitNumber}` : normalizeImportKey(heading);
    if (seen.has(key)) continue;
    seen.add(key);
    starts.push({
      index,
      line,
      heading: tocEntry?.title || heading,
      tocEntry
    });
  }

  if (starts.length > 0 || toc.length === 0) {
    return starts;
  }

  return toc
    .map((entry) => {
      const index = lines.findIndex((line) => line.page >= entry.page);
      if (index < 0) return null;
      return {
        index,
        line: lines[index],
        heading: entry.title,
        tocEntry: entry
      };
    })
    .filter((start): start is NonNullable<typeof start> => start !== null);
}

function buildLayoutUnitSections(unit: StructureUnit, unitLines: LayoutText[]): StructureSection[] {
  const ranges: LayoutActivityRange[] = [];
  let currentRange: LayoutActivityRange | null = null;

  for (const line of unitLines) {
    const activity = getTargetActivity(line.text);
    if (activity) {
      currentRange = {
        activity,
        page: line.page,
        lines: []
      };
      ranges.push(currentRange);

      const remainder = removeTargetActivityText(line.text);
      if (remainder) {
        currentRange.lines.push({ ...line, text: remainder });
      }
      continue;
    }

    if (!currentRange) continue;
    if (isRepeatedUnitTitle(line.text, unit) || isLayoutActivityBoundary(line.text)) {
      currentRange = null;
      continue;
    }
    currentRange.lines.push(line);
  }

  return ranges.map((range) => {
    const section = createPdfSection(range.activity.label, range.page);
    section.activityKey = range.activity.key;
    appendLayoutActivityBlocks(section, range.activity, range.lines);
    return section;
  });
}

export function buildPdfStructureFromLayout({ title, layout, rule = "default" }: { title: string; layout: PdfLayout; rule?: string }): ParsedPdfStructure {
  if (rule === "pep-textbook") {
    return buildPdfStructureFromPepLayout({ title, layout });
  }

  const pages = layoutToPageTexts(layout);
  const toc = extractPdfTocEntries(pages);
  const lines = flattenLayoutLines(layout);
  const unitStarts = findLayoutUnitStarts(lines, toc);
  const frontMatter: StructureBlock[] = [];
  const units: StructureUnit[] = [];

  if (unitStarts.length === 0) {
    return {
      version: 2,
      title,
      toc,
      units,
      frontMatter,
      source: "layout",
      stats: buildPdfStructureStats({ pages: layout?.pageCount || pages.length, toc, units, frontMatter })
    };
  }

  const firstUnitIndex = unitStarts[0]?.index || 0;
  for (const line of lines.slice(0, firstUnitIndex)) {
    const block = classifyStructureBlock(line.text, line.page);
    if (block) frontMatter.push(block);
  }

  for (let startIndex = 0; startIndex < unitStarts.length; startIndex += 1) {
    const start = unitStarts[startIndex];
    const end = unitStarts[startIndex + 1]?.index ?? lines.length;
    const unit = createPdfUnit(start.heading, start.line.page, start.tocEntry);
    unit.source = "layout";
    unit.sections = buildLayoutUnitSections(unit, lines.slice(start.index + 1, end));
    unit.pageEnd = Math.max(unit.pageStart, ...unit.sections.map((section) => section.pageEnd));
    units.push(unit);
  }

  return {
    version: 2,
    title,
    toc,
    units,
    frontMatter,
    source: "layout",
    stats: buildPdfStructureStats({ pages: layout?.pageCount || pages.length, toc, units, frontMatter })
  };
}

function preparePdfTextForImport(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[-–—]{2,}\s*\d+\s+of\s+\d+\s*[-–—]*/gi, "\n")
    .replace(/\(picture\)/gi, "\n")
    .replace(/[◆●■]+/g, "\n")
    .replace(pdfNoisePhrasePattern, "\n")
    .replace(/\bpep\s*\.?\s*com\.?\b/gi, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function isIgnoredPdfLine(line: string): boolean {
  const value = line.trim();
  if (!value || isLikelyPdfPageMarker(value)) return true;
  if (/^unit\s+\d+\s+.+\s+\d{1,3}$/i.test(value)) return true;

  const cjk = value.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const letters = value.match(/[A-Za-z]/g)?.length || 0;
  if (cjk > letters) return true;

  return false;
}

function shouldJoinPdfLine(previous: string, current: string): boolean {
  if (!previous || !current) return false;
  if (getImportHeading(current)) return false;
  if (/^[-•*]\s+/.test(current)) return false;
  if (/^\d+[\).、]\s+/.test(current)) return false;
  if (/[.!?。！？]$/.test(previous)) return false;
  if (/[:：]$/.test(previous) && previous.length <= 24) return false;
  return true;
}

export function normalizePdfLines(text: string): string[] {
  const rawLines = preparePdfTextForImport(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isIgnoredPdfLine(line));

  const lines: string[] = [];
  for (const line of rawLines) {
    const previous = lines.at(-1);
    if (previous && /-\s*$/.test(previous)) {
      lines[lines.length - 1] = previous.replace(/-\s*$/, "") + line;
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function mergePdfParagraphLines(lines: string[]): string[] {
  const paragraphs: string[] = [];
  for (const line of lines) {
    const previous = paragraphs.at(-1);
    if (previous && shouldJoinPdfLine(previous, line)) {
      paragraphs[paragraphs.length - 1] = `${previous} ${line}`;
    } else {
      paragraphs.push(line);
    }
  }
  return paragraphs;
}

function splitImportedSentences(text: string, options: { preserveAsUtterance?: boolean } = {}): string[] {
  const compactNormalized = text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  const hasTightSentenceJoin = /[.!?。！？](?=[A-Z])/.test(compactNormalized);
  const normalized = compactNormalized
    .replace(/([.!?。！？])(?=[A-Z])/g, "$1 ")
    .trim();
  if (options.preserveAsUtterance && !hasTightSentenceJoin) {
    const utterance = cleanImportedSentence(normalized);
    return isPracticeSentence(utterance) ? [utterance] : [];
  }

  const parts = normalized.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [];

  return parts
    .map(cleanImportedSentence)
    .filter(isPracticeSentence);
}

function cleanImportedSentence(sentence: string): string {
  return sentence
    .replace(/[-–—]{2,}\s*\d+\s+of\s+\d+\s*[-–—]*/gi, " ")
    .replace(/[◆●■]+/g, " ")
    .replace(/\(picture\)/gi, " ")
    .replace(/\b[ABC]\s+(?=[A-Z])/g, "")
    .replace(/^\d+\s+(?=[A-Za-z])/, "")
    .replace(/\b\d+\s+(?=[A-Z])/g, "")
    .replace(/\s*(['’])\s*/g, "$1")
    .replace(/[!！]+/g, "!")
    .replace(/[?？]+/g, "?")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isPracticeSentence(sentence: string): boolean {
  const value = sentence.trim();
  if (!value || !/[A-Za-z]/.test(value)) return false;
  if (value.length < 6 || value.length > 120) return false;
  if (/[\u4e00-\u9fff]/.test(value)) return false;
  if (/[◆●■]/.test(value)) return false;
  if (/\.\.\.|\.{2,}|\/|\ba\/an\b/i.test(value)) return false;
  if (hasVocabularyLeadIn(value)) return false;
  if (pdfNoiseSentencePattern.test(value)) return false;
  if (pdfGuidingQuestionPattern.test(value)) return false;

  const words = value.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (words.length < 2 || words.length > 16) return false;
  const hasTerminalPunctuation = /[.!?。！？]$/.test(value);
  if (!hasTerminalPunctuation && value === value.toLowerCase()) return false;
  if (!hasTerminalPunctuation && words.length > 8) return false;
  if (words.filter((word) => word.length === 1 && !/^[AI]$/i.test(word)).length >= 3) return false;

  const letters = value.match(/[A-Za-z]/g)?.length || 0;
  if (letters < Math.max(2, Math.floor(value.length * 0.35))) return false;

  if (/\b(?:a|an|the|and|or|with|in|of|for|to|can|is|are|am|have|has|do|does)\.$/i.test(value)) {
    if (!/^(?:yes|no),\s+\w+\s+can\.$/i.test(value)) return false;
  }

  return true;
}

export function normalizeSentenceKey(sentence: string): string {
  return sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function limitPdfImportChapters(normalizedChapters: ImportedChapter[]): { chapters: ImportedChapter[]; wasLimited: boolean; totalDetectedSentences: number } {
  const limitedChapters = [];
  let sentenceCount = 0;
  let wasLimited = false;
  for (const chapter of normalizedChapters) {
    if (sentenceCount >= maxPdfImportSentences) {
      wasLimited = true;
      break;
    }
    const remaining = maxPdfImportSentences - sentenceCount;
    const nextSentences = chapter.sentences.slice(0, remaining);
    if (nextSentences.length < chapter.sentences.length) wasLimited = true;
    const nextSentenceIds = new Set(nextSentences.map((sentence) => sentence.id));
    limitedChapters.push({
      ...chapter,
      sentences: nextSentences,
      sections: Array.isArray(chapter.sections)
        ? chapter.sections
            .map((section) => ({
              ...section,
              sentences: section.sentences.filter((sentence) => nextSentenceIds.has(sentence.id))
            }))
        : undefined,
      text: nextSentences.map((sentence) => sentence.text).join(" ")
    });
    sentenceCount += nextSentences.length;
  }

  return {
    chapters: limitedChapters,
    wasLimited,
    totalDetectedSentences: normalizedChapters.reduce((sum, chapter) => sum + chapter.sentences.length, 0)
  };
}

function buildChapterTitle(chapter: RawChapter, index: number): string {
  const firstLine = chapter.lines[0] || "";
  const topicMatch = firstLine.match(/^(.+?)\s+big question\b/i);
  if (topicMatch?.[1]) {
    return `${chapter.title} ${topicMatch[1].trim()}`;
  }
  return chapter.title || `Chapter ${index + 1}`;
}

export function buildPdfImportChapters({ title, lines }: { title: string; lines: string[] }): PdfImportParserResult {
  const chapters: RawChapter[] = [];
  const hasHeading = lines.some((line) => Boolean(getImportHeading(line)));
  let currentChapter: RawChapter | null = hasHeading ? null : { title: "Chapter 1", lines: [] };
  let foundHeading = hasHeading;

  for (const line of lines) {
    const heading = getImportHeading(line);
    if (heading) {
      if (currentChapter?.title === heading) {
        continue;
      }
      if (currentChapter && currentChapter.lines.length > 0) {
        chapters.push(currentChapter);
      }
      currentChapter = { title: heading, lines: [] };
      continue;
    }

    if (!currentChapter) {
      continue;
    }
    currentChapter.lines.push(line);
  }

  if (currentChapter && currentChapter.lines.length > 0) {
    chapters.push(currentChapter);
  }

  const seenSentences = new Set();
  const normalizedChapters = chapters
    .map((chapter, index) => {
      const paragraphs = mergePdfParagraphLines(chapter.lines);
      const chapterText = paragraphs.join("\n");
      const sentences = splitImportedSentences(chapterText).filter((sentenceText) => {
        const key = normalizeSentenceKey(sentenceText);
        if (!key || seenSentences.has(key)) return false;
        seenSentences.add(key);
        return true;
      });
      return {
        id: `import-chapter-${index + 1}-${nanoid(6)}`,
        title: buildChapterTitle(chapter, index),
        text: chapterText,
        sentences: sentences.map((sentenceText) => ({
          id: `import-sentence-${nanoid(10)}`,
          text: sentenceText
        }))
      };
    })
    .filter((chapter) => chapter.sentences.length > 0);

  const limitedResult = limitPdfImportChapters(normalizedChapters);

  return {
    chapters: limitedResult.chapters,
    foundHeading,
    wasLimited: limitedResult.wasLimited,
    totalDetectedSentences: limitedResult.totalDetectedSentences,
    sourceMode: "fallback"
  };
}

function getPdfImportSectionType(section: StructureSection, block: StructureBlock): string {
  const activityKey = normalizeImportKey(block.activity || section.title);
  if (activityKey === "words" || activityKey.includes("vocabulary")) return "vocabulary";
  if (activityKey.includes("reading time")) return "reading-time";
  if (activityKey.includes("lets talk") || activityKey.includes("let s talk")) return "lets-talk";
  if (activityKey.includes("listen and chant")) return "listen-and-chant";
  return "listen-and-chant";
}

function getPdfImportSectionTitle(type: string): string {
  if (type === "vocabulary") return "Words";
  if (type === "reading-time") return "Reading time";
  if (type === "lets-talk") return "Let's talk";
  return "Listen and chant";
}

function getPdfImportBlockSentences(block: StructureBlock, type: string): string[] {
  if (type === "vocabulary") {
    const text = String(block.text || "").replace(/\s+/g, " ").trim();
    return /^[A-Za-z]+(?:[-'’][A-Za-z]+)*(?:\s+[A-Za-z]+(?:[-'’][A-Za-z]+)*){0,3}$/.test(text) ? [text] : [];
  }
  if (type === "listen-and-chant") {
    const text = cleanImportedSentence(block.text);
    return isPracticeSentence(text) ? [text] : block.sentences || [];
  }
  return block.sentences && block.sentences.length > 0 ? block.sentences : [cleanImportedSentence(block.text)].filter(isPracticeSentence);
}

function createPdfImportSentence(block: StructureBlock, type: string, text: string): ImportedSentence {
  return {
    id: `import-sentence-${nanoid(10)}`,
    text,
    ...(type === "vocabulary"
      ? {
          itemType: "word",
          phonetic: String(block.phonetic || "").trim(),
          translation: String(block.translation || "").trim(),
          required: block.required !== false
        }
      : type === "reading-time"
        ? {
            itemType: "reading",
            required: true,
            panelNumber: Number(block.panelNumber || 0)
          }
        : {})
  };
}

export function buildPdfImportHierarchy(sections: ImportedSection[], chapterIndex: number): { leadIn?: ImportedPart; parts: ImportedPart[] } {
  const leadInActivities = sections.filter((section) => section.partKind === "lead-in");
  const partMap = new Map();

  for (const section of sections) {
    if (section.partKind !== "part" || !section.partLabel) continue;
    if (!partMap.has(section.partLabel)) {
      partMap.set(section.partLabel, {
        id: `import-part-${chapterIndex + 1}-${section.partLabel.toLowerCase()}-${nanoid(6)}`,
        label: section.partLabel,
        focusQuestion: section.focusQuestion || "",
        activities: []
      });
    }
    partMap.get(section.partLabel).activities.push(section);
  }

  return {
    ...(leadInActivities.length > 0
      ? {
          leadIn: {
            id: `import-part-${chapterIndex + 1}-lead-in-${nanoid(6)}`,
            label: "Lead-in",
            focusQuestion: "",
            activities: leadInActivities
          }
        }
      : {}),
    parts: [...partMap.values()]
  };
}

export function buildPdfImportChaptersFromStructure({ structure, sourceMode = "structure" }: { structure: ParsedPdfStructure; sourceMode?: string }): PdfImportParserResult {
  const preserveSourceSectionOrder = structure.source === "layout" || sourceMode === "layout-structure";
  const normalizedChapters = structure.units
    .map((unit, index) => {
      if (preserveSourceSectionOrder) {
        const sections = [];

        for (const sourceSection of unit.sections || []) {
          const sourceBlocks = (sourceSection.blocks || []).filter((block) => block.candidate);
          if (sourceBlocks.length === 0) continue;

          const firstBlock = sourceBlocks[0];
          const sectionType = sourceSection.activityKey || getPdfImportSectionType(sourceSection, firstBlock);
          const targetSection: ImportedSection = {
            id: `import-section-${index + 1}-${sectionType}-${nanoid(6)}`,
            title: getPdfImportSectionTitle(sectionType),
            type: sectionType,
            partKind: sourceSection.partKind,
            partLabel: sourceSection.partLabel,
            focusQuestion: sourceSection.focusQuestion,
            sentences: []
          };
          const seenSectionSentences = new Set();
          for (const block of sourceBlocks) {
            for (const sentenceText of getPdfImportBlockSentences(block, sectionType)) {
              const key = `${sectionType === "reading-time" ? `${Number(block.panelNumber || 0)}:` : ""}${normalizeSentenceKey(sentenceText)}`;
              if (!key || seenSectionSentences.has(key)) continue;
              seenSectionSentences.add(key);
              targetSection.sentences.push(createPdfImportSentence(block, sectionType, sentenceText));
            }
          }

          if (targetSection.sentences.length > 0) {
            sections.push(targetSection);
          }
        }

        const sentences = sections.flatMap((section) => section.sentences);
        const hierarchy = buildPdfImportHierarchy(sections, index);
        return {
          id: `import-chapter-${index + 1}-${nanoid(6)}`,
          title: unit.title || `Chapter ${index + 1}`,
          text: sentences.map((sentence) => sentence.text).join(" "),
          ...hierarchy,
          sections,
          sentences
        };
      }

      const sectionMap = new Map<string, ImportedSection>();
      const getSection = (type: string): ImportedSection => {
        if (!sectionMap.has(type)) {
          sectionMap.set(type, {
            id: `import-section-${index + 1}-${type}-${nanoid(6)}`,
            title: getPdfImportSectionTitle(type),
            type,
            sentences: []
          });
        }
        return sectionMap.get(type)!;
      };
      getSection("listen-and-chant");
      getSection("lets-talk");
      const seenSectionSentences = new Map([
        ["listen-and-chant", new Set()],
        ["lets-talk", new Set()]
      ]);

      for (const section of unit.sections || []) {
        for (const block of section.blocks || []) {
          if (!block.candidate) continue;
          const sectionType = getPdfImportSectionType(section, block);
          const targetSection = getSection(sectionType);
          for (const sentenceText of getPdfImportBlockSentences(block, sectionType)) {
            const key = `${sectionType === "reading-time" ? `${Number(block.panelNumber || 0)}:` : ""}${normalizeSentenceKey(sentenceText)}`;
            const seen = seenSectionSentences.get(sectionType) || new Set();
            seenSectionSentences.set(sectionType, seen);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            targetSection.sentences.push(createPdfImportSentence(block, sectionType, sentenceText));
          }
        }
      }
      const sections = ["listen-and-chant", "lets-talk"].map((type) => getSection(type));
      const sentences = sections.flatMap((section) => section.sentences);

      return {
        id: `import-chapter-${index + 1}-${nanoid(6)}`,
        title: unit.title || `Chapter ${index + 1}`,
        text: sentences.map((sentence) => sentence.text).join(" "),
        sections,
        sentences
      };
    })
    .filter((chapter) => chapter.sentences.length > 0);

  const limitedResult = limitPdfImportChapters(normalizedChapters);

  return {
    chapters: limitedResult.chapters,
    foundHeading: structure.units.length > 0,
    wasLimited: limitedResult.wasLimited,
    totalDetectedSentences: limitedResult.totalDetectedSentences,
    sourceMode
  };
}
