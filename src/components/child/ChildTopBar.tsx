import { BookOpen, Globe2, Grid3X3, Home, MonitorSmartphone, LibraryBig, Star } from "lucide-react";
import type { Locale } from "../../lib/i18n";
import { localeLabels } from "../../lib/i18n";
import { ThemeSwitcher } from "../ui/ThemeSwitcher";

export type ChildTopBarProps = {
  locale: Locale;
  childName: string;
  totalStars: number;
  parentConsoleLabel: string;
  onLocaleChange: (locale: Locale) => void;
  onOpenParent: () => void;
  onOpenPictureBooks: () => void;
  onOpenSudoku?: () => void;
  onOpenDevicePreview?: () => void;
  showChromeSwitcher?: boolean;
};

export function ChildTopBar({
  locale,
  childName,
  totalStars,
  parentConsoleLabel,
  onLocaleChange,
  onOpenParent,
  onOpenPictureBooks,
  onOpenSudoku,
  onOpenDevicePreview,
  showChromeSwitcher = false
}: ChildTopBarProps) {
  const initial = childName?.slice(0, 1) || "L";

  return (
    <section className="child-player-topbar ui-child-topbar">
      <div className="child-brand-mark ui-brand-mark">
        <BookOpen size={34} />
        <Star size={15} />
      </div>
      <div className="child-profile-chip ui-profile-chip">
        <span>{initial}</span>
        <strong>{childName || "Lily"}</strong>
      </div>
      <div className="child-points-chip ui-points-chip">
        <Star size={18} />
        <strong>{totalStars}</strong>
      </div>
      <div className="child-top-tools">
        <ThemeSwitcher locale={locale} showChrome={showChromeSwitcher} />
        <label className="language-switcher">
          <Globe2 size={17} />
          <select value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
            {Object.entries(localeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {onOpenDevicePreview ? (
          <button className="ghost-button ui-device-preview-button" onClick={onOpenDevicePreview} type="button">
            <MonitorSmartphone size={17} />
            {locale === "zh" ? "设备预览" : "Device preview"}
          </button>
        ) : null}
        <button className="ghost-button ui-picture-square-button" onClick={onOpenPictureBooks} type="button">
          <LibraryBig size={17} />{locale === "zh" ? "绘本广场" : "Storybooks"}
        </button>
        {onOpenSudoku ? <button className="ghost-button ui-sudoku-button" onClick={onOpenSudoku} type="button"><Grid3X3 size={17} />{locale === "zh" ? "数独乐园" : "Sudoku"}</button> : null}
        <button className="ghost-button handback-button ui-btn ui-btn--ghost" onClick={onOpenParent} type="button">
          <Home size={18} />
          {parentConsoleLabel}
        </button>
      </div>
    </section>
  );
}
