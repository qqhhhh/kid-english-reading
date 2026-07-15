export type LayoutPreview = "phone" | "tablet-portrait" | "tablet-landscape" | "desktop";

export type LayoutPreviewProfile = {
  width: number;
  height: number;
  kind: "phone" | "tablet" | "desktop";
};

export const layoutPreviews: LayoutPreview[] = ["desktop", "tablet-landscape", "tablet-portrait", "phone"];

export const layoutPreviewLabels: Record<LayoutPreview, Record<"zh" | "en", string>> = {
  desktop: {
    zh: "笔记本",
    en: "Laptop"
  },
  "tablet-landscape": {
    zh: "iPad 横屏",
    en: "iPad landscape"
  },
  "tablet-portrait": {
    zh: "iPad 竖屏",
    en: "iPad portrait"
  },
  phone: {
    zh: "手机",
    en: "Phone"
  }
};

export const layoutPreviewProfiles: Record<LayoutPreview, LayoutPreviewProfile> = {
  desktop: { width: 1366, height: 768, kind: "desktop" },
  "tablet-landscape": { width: 1024, height: 768, kind: "tablet" },
  "tablet-portrait": { width: 768, height: 1024, kind: "tablet" },
  phone: { width: 390, height: 844, kind: "phone" }
};

export const layoutPreviewHints: Record<LayoutPreview, string> = {
  desktop: "1366 × 768",
  "tablet-landscape": "1024 × 768",
  "tablet-portrait": "768 × 1024",
  phone: "390 × 844"
};

const LAYOUT_PREVIEW_KEY = "kid-reading-layout-preview";
const DEFAULT_LAYOUT: LayoutPreview = "desktop";

export function isLayoutPreview(value: string | null | undefined): value is LayoutPreview {
  return value === "phone" || value === "tablet-portrait" || value === "tablet-landscape" || value === "desktop";
}

export function getInitialLayoutPreview(): LayoutPreview {
  try {
    const stored = window.localStorage.getItem(LAYOUT_PREVIEW_KEY);
    if (stored === "tablet") return "tablet-landscape";
    return isLayoutPreview(stored) ? stored : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function storeLayoutPreview(layout: LayoutPreview) {
  try {
    window.localStorage.setItem(LAYOUT_PREVIEW_KEY, layout);
  } catch {
    /* ignore */
  }
}
