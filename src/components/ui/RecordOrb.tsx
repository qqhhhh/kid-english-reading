import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";

export type RecordOrbProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  chrome?: DesignChrome;
  recording?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  wave?: boolean;
};

export function RecordOrb({
  chrome: chromeProp,
  recording = false,
  icon,
  label,
  wave = false,
  className,
  type = "button",
  ...props
}: RecordOrbProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <button
      className={cn("ui-record-orb", "record-orb-button", recording && "recording", `ui-chrome-${chrome}`, className)}
      data-chrome={chrome}
      data-recording={recording ? "true" : "false"}
      type={type}
      {...props}
    >
      {icon}
      {wave ? (
        <span className="record-wave ui-record-orb__wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : null}
      <span className="record-label ui-record-orb__label">{label}</span>
    </button>
  );
}
