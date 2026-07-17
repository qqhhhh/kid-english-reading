import test from "node:test";
import assert from "node:assert/strict";

import { resolveOverlaidTextItems } from "../server/pdfLayout.js";
import type { PdfLayoutItem } from "../server/types/pdf.js";

interface ItemOptions {
  y?: number;
  height?: number;
  fontName?: string;
}

function item(id: string, text: string, x: number, width: number, { y = 402.52, height = 14, fontName = "g_d1_f32" }: ItemOptions = {}): PdfLayoutItem {
  return { id, text, x, y, top: y - height, right: x + width, bottom: y + 2, width, height, fontName };
}

test("keeps the visible first text layer and records an overlaid legacy alternative", () => {
  const visible = item("item-3", "My friends are special.", 255.83, 147.33);
  const legacy = item("item-18", "All friends are special.", 238.82, 147.07);
  const result = resolveOverlaidTextItems([visible, legacy]);

  assert.deepEqual(result.items.map((entry) => entry.text), ["My friends are special."]);
  assert.deepEqual(result.overlays, [{
    keptItemId: "item-3",
    discardedItemId: "item-18",
    keptText: "My friends are special.",
    discardedText: "All friends are special.",
    xOffset: -17.01,
    yOffset: 0
  }]);
});

test("does not remove adjacent text or content on another baseline", () => {
  const first = item("item-1", "Some friends", 80, 82);
  const adjacent = item("item-2", "are short.", 166, 58);
  const nextLine = item("item-3", "Some friends are tall.", 80, 140, { y: 422.52 });
  const result = resolveOverlaidTextItems([first, adjacent, nextLine]);

  assert.equal(result.items.length, 3);
  assert.equal(result.overlays.length, 0);
});
