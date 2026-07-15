import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";

export type MetricProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  value: ReactNode;
  chrome?: DesignChrome;
  emphasis?: "default" | "coral" | "mint" | "sun";
};

export function Metric({ label, value, chrome: chromeProp, emphasis = "default", className, ...props }: MetricProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <div
      className={cn("ui-metric", "metric", `ui-metric--${emphasis}`, `ui-chrome-${chrome}`, className)}
      data-chrome={chrome}
      {...props}
    >
      <span className="ui-metric__label">{label}</span>
      <strong className="ui-metric__value">{value}</strong>
    </div>
  );
}
