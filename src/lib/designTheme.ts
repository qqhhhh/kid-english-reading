export type DesignTheme = "peach" | "blue" | "ivory" | "mint";

/** Layout / component chrome. Themes map to a chrome; components may override per-instance. */
export type DesignChrome = "classic" | "storybook";

export const designThemes: DesignTheme[] = ["peach", "blue", "ivory", "mint"];

export const designThemeLabels: Record<DesignTheme, Record<"zh" | "en", string>> = {
  peach: {
    zh: "软糖",
    en: "Peach"
  },
  blue: {
    zh: "蓝色",
    en: "Blue"
  },
  ivory: {
    zh: "象牙黄",
    en: "Ivory"
  },
  mint: {
    zh: "薄荷绿",
    en: "Mint"
  }
};

/** Default chrome for each theme. Peach uses the soft storybook layout. */
export const designThemeChrome: Record<DesignTheme, DesignChrome> = {
  peach: "storybook",
  blue: "classic",
  ivory: "classic",
  mint: "classic"
};

export const designChromeLabels: Record<DesignChrome, Record<"zh" | "en", string>> = {
  classic: {
    zh: "经典",
    en: "Classic"
  },
  storybook: {
    zh: "绘本",
    en: "Storybook"
  }
};

const DESIGN_THEME_KEY = "kid-reading-design-theme";
const DESIGN_CHROME_KEY = "kid-reading-design-chrome";
const DEFAULT_DESIGN_THEME: DesignTheme = "peach";

export function isDesignTheme(value: string | null | undefined): value is DesignTheme {
  return Boolean(value && designThemes.includes(value as DesignTheme));
}

export function isDesignChrome(value: string | null | undefined): value is DesignChrome {
  return value === "classic" || value === "storybook";
}

export function getInitialDesignTheme(): DesignTheme {
  try {
    const stored = window.localStorage.getItem(DESIGN_THEME_KEY);
    return isDesignTheme(stored) ? stored : DEFAULT_DESIGN_THEME;
  } catch {
    return DEFAULT_DESIGN_THEME;
  }
}

/**
 * Optional chrome override. If unset, follows the theme's default chrome.
 * Stored only when the user explicitly picks a chrome independent of theme.
 */
export function getInitialDesignChrome(theme: DesignTheme = getInitialDesignTheme()): DesignChrome {
  try {
    const stored = window.localStorage.getItem(DESIGN_CHROME_KEY);
    if (isDesignChrome(stored)) return stored;
  } catch {
    /* ignore */
  }
  return designThemeChrome[theme];
}

export function applyDesignTheme(theme: DesignTheme, chrome: DesignChrome = designThemeChrome[theme]) {
  document.documentElement.dataset.designTheme = theme;
  document.documentElement.dataset.designChrome = chrome;
}

export function storeDesignTheme(theme: DesignTheme) {
  window.localStorage.setItem(DESIGN_THEME_KEY, theme);
  // Switching theme resets chrome to that theme's default unless a manual chrome lock is set.
  let chrome = designThemeChrome[theme];
  try {
    const locked = window.localStorage.getItem(DESIGN_CHROME_KEY);
    if (isDesignChrome(locked)) {
      chrome = locked;
    }
  } catch {
    /* ignore */
  }
  applyDesignTheme(theme, chrome);
  return chrome;
}

export function storeDesignChrome(chrome: DesignChrome, theme: DesignTheme = getInitialDesignTheme()) {
  window.localStorage.setItem(DESIGN_CHROME_KEY, chrome);
  applyDesignTheme(theme, chrome);
}

export function clearDesignChromeOverride(theme: DesignTheme = getInitialDesignTheme()) {
  try {
    window.localStorage.removeItem(DESIGN_CHROME_KEY);
  } catch {
    /* ignore */
  }
  applyDesignTheme(theme, designThemeChrome[theme]);
  return designThemeChrome[theme];
}
