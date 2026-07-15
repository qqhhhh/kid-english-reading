import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyDesignTheme,
  clearDesignChromeOverride,
  designThemeChrome,
  getInitialDesignChrome,
  getInitialDesignTheme,
  storeDesignChrome,
  storeDesignTheme,
  type DesignChrome,
  type DesignTheme
} from "../../lib/designTheme";

type DesignThemeContextValue = {
  theme: DesignTheme;
  chrome: DesignChrome;
  /** Theme's built-in chrome (before manual override). */
  themeDefaultChrome: DesignChrome;
  chromeIsOverridden: boolean;
  setTheme: (theme: DesignTheme) => void;
  setChrome: (chrome: DesignChrome) => void;
  resetChromeToThemeDefault: () => void;
};

const DesignThemeContext = createContext<DesignThemeContextValue | null>(null);

function readChromeOverrideFlag() {
  try {
    return Boolean(window.localStorage.getItem("kid-reading-design-chrome"));
  } catch {
    return false;
  }
}

export function DesignThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<DesignTheme>(() => getInitialDesignTheme());
  const [chrome, setChromeState] = useState<DesignChrome>(() => getInitialDesignChrome());
  const [chromeIsOverridden, setChromeIsOverridden] = useState(() => readChromeOverrideFlag());

  useEffect(() => {
    applyDesignTheme(theme, chrome);
  }, [theme, chrome]);

  const setTheme = useCallback((nextTheme: DesignTheme) => {
    const nextChrome = storeDesignTheme(nextTheme);
    setThemeState(nextTheme);
    setChromeState(nextChrome);
    setChromeIsOverridden(readChromeOverrideFlag());
  }, []);

  const setChrome = useCallback(
    (nextChrome: DesignChrome) => {
      storeDesignChrome(nextChrome, theme);
      setChromeState(nextChrome);
      setChromeIsOverridden(true);
    },
    [theme]
  );

  const resetChromeToThemeDefault = useCallback(() => {
    const nextChrome = clearDesignChromeOverride(theme);
    setChromeState(nextChrome);
    setChromeIsOverridden(false);
  }, [theme]);

  const value = useMemo<DesignThemeContextValue>(
    () => ({
      theme,
      chrome,
      themeDefaultChrome: designThemeChrome[theme],
      chromeIsOverridden,
      setTheme,
      setChrome,
      resetChromeToThemeDefault
    }),
    [theme, chrome, chromeIsOverridden, setTheme, setChrome, resetChromeToThemeDefault]
  );

  return <DesignThemeContext.Provider value={value}>{children}</DesignThemeContext.Provider>;
}

export function useDesignTheme() {
  const ctx = useContext(DesignThemeContext);
  if (!ctx) {
    throw new Error("useDesignTheme must be used within DesignThemeProvider");
  }
  return ctx;
}

/** Safe read for optional chrome prop fallback when outside provider is not expected. */
export function useDesignChrome(override?: DesignChrome): DesignChrome {
  const ctx = useContext(DesignThemeContext);
  if (override) return override;
  return ctx?.chrome ?? "classic";
}
