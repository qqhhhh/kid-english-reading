import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { Locale } from "../../lib/i18n";
import {
  layoutPreviewHints,
  layoutPreviewLabels,
  layoutPreviews,
  type LayoutPreview
} from "../../lib/layoutPreview";
import { cn } from "../../lib/cn";

export type LayoutSwitcherProps = {
  locale: Locale;
  value: LayoutPreview;
  onChange: (layout: LayoutPreview) => void;
  className?: string;
  compact?: boolean;
};

const icons: Record<LayoutPreview, typeof Monitor> = {
  desktop: Monitor,
  "tablet-landscape": Tablet,
  "tablet-portrait": Tablet,
  phone: Smartphone
};

export function LayoutSwitcher({ locale, value, onChange, className, compact = true }: LayoutSwitcherProps) {
  const Icon = icons[value] || Monitor;

  return (
    <label className={cn("theme-switcher", "ui-layout-switcher", compact && "ui-theme-switcher--compact", className)}>
      <Icon size={17} />
      <select
        aria-label={locale === "zh" ? "预览布局" : "Layout preview"}
        value={value}
        onChange={(event) => onChange(event.target.value as LayoutPreview)}
      >
        {layoutPreviews.map((item) => (
          <option key={item} value={item}>
            {layoutPreviewLabels[item][locale]} · {layoutPreviewHints[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
