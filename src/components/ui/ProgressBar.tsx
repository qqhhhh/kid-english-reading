import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";

export type ProgressBarProps = {
  className?: string;
  value: number;
  chrome?: DesignChrome;
};

export function ProgressBar({ className, value, chrome: chromeProp }: ProgressBarProps) {
  const chrome = useDesignChrome(chromeProp);
  const percent = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

  return (
    <em
      className={cn("ui-progress", "practice-progress-bar", `ui-chrome-${chrome}`, className)}
      data-chrome={chrome}
      aria-hidden="true"
    >
      <i style={{ width: `${percent}%` }} />
    </em>
  );
}
