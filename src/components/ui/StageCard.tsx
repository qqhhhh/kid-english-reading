import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";

export type StageCardProps = HTMLAttributes<HTMLElement> & {
  chrome?: DesignChrome;
  badge?: ReactNode;
  changing?: boolean;
  passGlow?: boolean;
};

export function StageCard({
  chrome: chromeProp,
  badge,
  changing = false,
  passGlow = false,
  className,
  children,
  ...props
}: StageCardProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <div
      className={cn(
        "ui-stage-card",
        "sentence-stage-card",
        "live-sentence-card",
        changing && "sentence-changing",
        passGlow && "ui-stage-card--pass",
        `ui-chrome-${chrome}`,
        className
      )}
      data-chrome={chrome}
      {...props}
    >
      {chrome === "storybook" ? (
        <div className="ui-stage-card__dots" aria-hidden="true">
          <i />
          <i />
        </div>
      ) : null}
      {badge ? <div className="ui-stage-card__badge">{badge}</div> : null}
      {children}
    </div>
  );
}
