import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

function toPdfData(buffer) {
  return new Uint8Array(buffer);
}

function cleanLayoutText(value = "") {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTextItemGeometry(item, viewport) {
  const transform = item.transform || [1, 0, 0, 1, 0, 0];
  const [x, baselineY] = viewport.convertToViewportPoint(transform[4], transform[5]);
  const height = Math.max(Math.abs(transform[3] || 0), Number(item.height || 0), 1);
  const width = Math.max(Number(item.width || 0), 0);
  const top = baselineY - height;
  const bottom = baselineY + Math.max(1, height * 0.2);

  return {
    x,
    y: baselineY,
    top,
    bottom,
    right: x + width,
    width,
    height
  };
}

function isEnglishTextItem(item) {
  return /[A-Za-z]{3}/.test(cleanLayoutText(item?.text));
}

function isOverlaidAlternative(kept, candidate) {
  if (!isEnglishTextItem(kept) || !isEnglishTextItem(candidate)) return false;
  if (!kept.fontName || kept.fontName !== candidate.fontName) return false;
  const minHeight = Math.min(kept.height, candidate.height);
  const minWidth = Math.min(kept.width, candidate.width);
  if (minHeight <= 0 || minWidth < 18) return false;
  if (Math.abs(kept.y - candidate.y) > Math.max(0.75, minHeight * 0.08)) return false;
  if (Math.abs(kept.height - candidate.height) > Math.max(0.75, minHeight * 0.08)) return false;
  if (Math.abs(kept.x - candidate.x) > Math.max(24, minHeight * 2)) return false;
  const overlap = Math.max(0, Math.min(kept.right, candidate.right) - Math.max(kept.x, candidate.x));
  return overlap / minWidth >= 0.72;
}

export function resolveOverlaidTextItems(items) {
  const keptItems = [];
  const overlays = [];
  for (const item of items) {
    const kept = keptItems.find((candidate) => isOverlaidAlternative(candidate, item));
    if (!kept) {
      keptItems.push(item);
      continue;
    }
    overlays.push({
      keptItemId: kept.id,
      discardedItemId: item.id,
      keptText: kept.text,
      discardedText: item.text,
      xOffset: Number((item.x - kept.x).toFixed(2)),
      yOffset: Number((item.y - kept.y).toFixed(2))
    });
  }
  return { items: keptItems, overlays };
}

function mergeItemIntoLine(line, item) {
  line.items.push(item);
  line.x = Math.min(line.x, item.x);
  line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
  line.top = Math.min(line.top, item.top);
  line.right = Math.max(line.right, item.right);
  line.bottom = Math.max(line.bottom, item.bottom);
  line.height = Math.max(line.height, item.height);
}

function canShareLine(line, item, pageWidth) {
  const tolerance = Math.max(2.5, Math.max(line.height, item.height) * 0.55);
  if (Math.abs(line.y - item.y) > tolerance) return false;

  const horizontalGap = item.x > line.right ? item.x - line.right : line.x - item.right;
  const isSeparatedColumn = horizontalGap > Math.max(64, pageWidth * 0.12);
  return !isSeparatedColumn;
}

function joinLineItems(items, lineHeight) {
  const orderedItems = [...items].sort((a, b) => a.x - b.x);
  let text = "";
  let previous = null;

  for (const item of orderedItems) {
    const value = cleanLayoutText(item.text);
    if (!value) continue;

    if (previous) {
      const gap = item.x - previous.right;
      const shouldInsertSpace =
        gap > Math.max(1.8, lineHeight * 0.18) &&
        !text.endsWith(" ") &&
        !/^[,.;:!?)}\]]/.test(value) &&
        !/[(\[{]$/.test(text);
      if (shouldInsertSpace) text += " ";
    }

    text += value;
    previous = item;
  }

  return cleanLayoutText(text);
}

function groupItemsIntoLines(items, pageWidth) {
  const sortedItems = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];

  for (const item of sortedItems) {
    let targetLine = null;
    for (const line of lines) {
      if (!canShareLine(line, item, pageWidth)) continue;
      targetLine = line;
      break;
    }

    if (targetLine) {
      mergeItemIntoLine(targetLine, item);
    } else {
      lines.push({
        id: `line-${lines.length + 1}`,
        x: item.x,
        y: item.y,
        top: item.top,
        right: item.right,
        bottom: item.bottom,
        height: item.height,
        items: [item]
      });
    }
  }

  return lines
    .map((line) => {
      const text = joinLineItems(line.items, line.height);
      return {
        id: line.id,
        text,
        x: Number(line.x.toFixed(2)),
        y: Number(line.y.toFixed(2)),
        top: Number(line.top.toFixed(2)),
        right: Number(line.right.toFixed(2)),
        bottom: Number(line.bottom.toFixed(2)),
        width: Number((line.right - line.x).toFixed(2)),
        height: Number(line.height.toFixed(2)),
        itemCount: line.items.length,
        items: line.items.map((item) => item.id)
      };
    })
    .filter((line) => line.text)
    .sort((a, b) => a.top - b.top || a.x - b.x)
    .map((line, index) => ({
      ...line,
      id: `line-${index + 1}`
    }));
}

export async function extractPdfLayout(buffer) {
  const loadingTask = getDocument({
    data: toPdfData(buffer),
    disableWorker: true,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS
  });

  const document = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false
      });

      const items = [];
      for (const rawItem of textContent.items || []) {
        if (!("str" in rawItem)) continue;
        const text = cleanLayoutText(rawItem.str);
        if (!text) continue;

        const geometry = getTextItemGeometry(rawItem, viewport);
        items.push({
          id: `item-${items.length + 1}`,
          text,
          x: Number(geometry.x.toFixed(2)),
          y: Number(geometry.y.toFixed(2)),
          top: Number(geometry.top.toFixed(2)),
          right: Number(geometry.right.toFixed(2)),
          bottom: Number(geometry.bottom.toFixed(2)),
          width: Number(geometry.width.toFixed(2)),
          height: Number(geometry.height.toFixed(2)),
          fontName: rawItem.fontName || "",
          hasEOL: Boolean(rawItem.hasEOL)
        });
      }

      const resolved = resolveOverlaidTextItems(items);
      const lines = groupItemsIntoLines(resolved.items, viewport.width);
      pages.push({
        page: pageNumber,
        width: Number(viewport.width.toFixed(2)),
        height: Number(viewport.height.toFixed(2)),
        items: resolved.items,
        overlays: resolved.overlays,
        lines,
        text: lines.map((line) => line.text).join("\n")
      });
      page.cleanup();
    }

    return {
      version: 2,
      pageCount: document.numPages,
      pages,
      stats: {
        pages: document.numPages,
        items: pages.reduce((sum, page) => sum + page.items.length, 0),
        lines: pages.reduce((sum, page) => sum + page.lines.length, 0),
        overlayAlternatives: pages.reduce((sum, page) => sum + page.overlays.length, 0)
      }
    };
  } finally {
    await document.destroy();
  }
}
