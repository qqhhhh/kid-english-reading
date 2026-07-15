import { Palette, Shapes } from "lucide-react";
import type { Locale } from "../../lib/i18n";
import {
  designChromeLabels,
  designThemeLabels,
  designThemes,
  type DesignChrome,
  type DesignTheme
} from "../../lib/designTheme";
import { useDesignTheme } from "../design/DesignThemeContext";
import { cn } from "../../lib/cn";

export type ThemeSwitcherProps = {
  locale: Locale;
  className?: string;
  /** Show independent chrome switcher (绘本 / 经典). */
  showChrome?: boolean;
  compact?: boolean;
};

export function ThemeSwitcher({ locale, className, showChrome = false, compact = true }: ThemeSwitcherProps) {
  const { theme, chrome, setTheme, setChrome, chromeIsOverridden, resetChromeToThemeDefault, themeDefaultChrome } =
    useDesignTheme();

  return (
    <div className={cn("ui-theme-switcher-group", className)}>
      <label className={cn("theme-switcher", "ui-theme-switcher", compact && "ui-theme-switcher--compact")}>
        <Palette size={17} />
        <select
          aria-label={locale === "zh" ? "主题风格" : "Theme"}
          value={theme}
          onChange={(event) => setTheme(event.target.value as DesignTheme)}
        >
          {designThemes.map((item) => (
            <option key={item} value={item}>
              {designThemeLabels[item][locale]}
            </option>
          ))}
        </select>
      </label>

      {showChrome ? (
        <label className={cn("theme-switcher", "ui-theme-switcher", "ui-chrome-switcher", compact && "ui-theme-switcher--compact")}>
          <Shapes size={17} />
          <select
            aria-label={locale === "zh" ? "组件风格" : "Component style"}
            value={chromeIsOverridden ? chrome : "auto"}
            onChange={(event) => {
              const next = event.target.value as DesignChrome | "auto";
              if (next === "auto") {
                resetChromeToThemeDefault();
                return;
              }
              setChrome(next);
            }}
          >
            <option value="auto">
              {locale === "zh"
                ? `跟随主题（${designChromeLabels[themeDefaultChrome].zh}）`
                : `Match theme (${designChromeLabels[themeDefaultChrome].en})`}
            </option>
            <option value="storybook">{designChromeLabels.storybook[locale]}</option>
            <option value="classic">{designChromeLabels.classic[locale]}</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}
