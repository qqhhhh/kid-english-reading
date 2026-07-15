import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";

export type StatusBannerTone = "info" | "ok" | "warn" | "bad" | "neutral";

export type StatusBannerProps = HTMLAttributes<HTMLDivElement> & {
  tone?: StatusBannerTone;
  chrome?: DesignChrome;
  icon?: ReactNode;
};

export function StatusBanner({
  tone = "info",
  chrome: chromeProp,
  icon,
  className,
  children,
  ...props
}: StatusBannerProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <div
      className={cn("ui-status-banner", `ui-status-banner--${tone}`, `ui-chrome-${chrome}`, className)}
      data-chrome={chrome}
      data-tone={tone}
      role="status"
      {...props}
    >
      {icon ? <span className="ui-status-banner__icon">{icon}</span> : null}
      <div className="ui-status-banner__body">{children}</div>
    </div>
  );
}
