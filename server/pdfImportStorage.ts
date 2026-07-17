import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { PDFParse } from "pdf-parse";
import { buildPdfImportSnapshot, renderPdfPageAssets } from "./pdfImportArtifacts.js";
import { repairPossiblyMojibake, type ParsedPdfStructure, type PdfImportParserResult } from "./pdfImportParser.js";
import type { PdfImportPageAsset, PdfImportQualityReport, PdfLayout } from "./types/pdf.js";
export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number; pageTexts: Array<{ num?: number; page?: number; text: string }> }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    return {
      text: textResult.text || "",
      pages: Number(textResult.total || textResult.pages?.length || 0),
      pageTexts: textResult.pages || []
    };
  } finally {
    await parser.destroy();
  }
}

function sanitizeArtifactFileName(fileName: string = ""): string {
  const safeName = repairPossiblyMojibake(fileName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return safeName || "source.pdf";
}

export async function savePdfImportArtifacts({
  buffer,
  originalName,
  title,
  rule,
  text,
  lines,
  layout,
  structure,
  importResult,
  quality,
  warnings,
  householdId,
  totalPages,
  pdfImportsDir
}: {
  buffer: Buffer;
  originalName: string;
  title: string;
  rule: string;
  text: string;
  lines: string[];
  layout: PdfLayout | null;
  structure: ParsedPdfStructure;
  importResult: PdfImportParserResult;
  quality?: PdfImportQualityReport | null;
  warnings: string[];
  householdId: string;
  totalPages: number;
  pdfImportsDir: string;
}) {
  const importId = `pdf-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${nanoid(8)}`;
  const importDir = path.join(pdfImportsDir, importId);
  const extractedAt = new Date().toISOString();
  const sourceName = sanitizeArtifactFileName(originalName).toLowerCase().endsWith(".pdf")
    ? sanitizeArtifactFileName(originalName)
    : `${sanitizeArtifactFileName(originalName)}.pdf`;

  await fs.mkdir(importDir, { recursive: true });
  await fs.writeFile(path.join(importDir, sourceName), buffer);
  await fs.writeFile(
    path.join(importDir, "layout.json"),
    JSON.stringify(
      {
        importId,
        originalName: repairPossiblyMojibake(originalName),
        title,
        rule,
        extractedAt,
        householdId,
        layout
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(importDir, "result.json"),
    JSON.stringify(
      {
        importId,
        originalName: repairPossiblyMojibake(originalName),
        title,
        rule,
        extractedAt,
        householdId,
        text,
        lines,
        warnings,
        quality: quality || null,
        structure,
        chapters: importResult?.chapters || [],
        stats: {
          pages: layout?.stats?.pages || 0,
          layoutItems: layout?.stats?.items || 0,
          layoutLines: layout?.stats?.lines || 0,
          detectedSentences: importResult?.totalDetectedSentences || 0
        }
      },
      null,
      2
    )
  );

  let pageAssets: PdfImportPageAsset[] = [];
  try {
    pageAssets = await renderPdfPageAssets(buffer, {
      importDir,
      importId,
      totalPages: Number(totalPages || layout?.stats?.pages || quality?.ocr?.totalPages || 0)
    });
  } catch (error) {
    warnings?.push(`PDF 页面图片保存未完成：${error instanceof Error ? error.message : String(error || "unknown")}`);
  }
  const snapshot = buildPdfImportSnapshot({
    importId,
    householdId,
    title,
    rule,
    layout,
    structure,
    chapters: importResult?.chapters || [],
    quality,
    pageAssets,
    extractedAt
  });
  await fs.writeFile(path.join(importDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));

  return {
    importId,
    importDir,
    snapshot
  };
}
