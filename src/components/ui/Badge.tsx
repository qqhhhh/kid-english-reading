import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";

export type BadgeTone = "todo" | "doing" | "done" | "mint" | "sun" | "neutral";

export type BadgeProps = HTMLAttributes<HTMLElement> & {
  tone?: BadgeTone;
  chrome?: DesignChrome;
  as?: "strong" | "span" | "em";
};

export function Badge({ className, tone = "neutral", chrome: chromeProp, as: Tag = "strong", ...props }: BadgeProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <Tag
      className={cn("ui-badge", `ui-badge--${tone}`, `ui-chrome-${chrome}`, className)}
      data-chrome={chrome}
      data-tone={tone}
      {...props}
    />
  );
}
