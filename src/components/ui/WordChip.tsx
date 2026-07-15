import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";
import type { WordFeedbackKind } from "../../lib/scoring";

export type WordChipTone = WordFeedbackKind | "neutral" | "ok";

export type WordChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: WordChipTone;
  /** Override global chrome for this instance. */
  chrome?: DesignChrome;
  phonetic?: ReactNode;
  detail?: ReactNode;
};

const toneClass: Record<WordChipTone, string> = {
  passed: "ui-word-chip--ok",
  ok: "ui-word-chip--ok",
  misread: "ui-word-chip--bad",
  unclear: "ui-word-chip--bad",
  missed: "ui-word-chip--miss",
  extra: "ui-word-chip--extra",
  unscored: "ui-word-chip--neutral",
  neutral: "ui-word-chip--neutral"
};

/** Maps legacy word-pill kinds for classic chrome CSS that still targets .word-pill */
const legacyToneClass: Record<WordChipTone, string> = {
  passed: "passed",
  ok: "passed",
  misread: "misread",
  unclear: "unclear",
  missed: "missed",
  extra: "extra",
  unscored: "unscored",
  neutral: "unscored"
};

export function WordChip({
  tone = "neutral",
  chrome: chromeProp,
  phonetic,
  detail,
  className,
  children,
  ...props
}: WordChipProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <span
      className={cn(
        "ui-word-chip",
        "word-pill",
        toneClass[tone],
        legacyToneClass[tone],
        `ui-chrome-${chrome}`,
        className
      )}
      data-chrome={chrome}
      data-tone={tone}
      {...props}
    >
      <span className="ui-word-chip__main word-main">
        <strong>{children}</strong>
        {phonetic ? <span className="ui-word-chip__phonetic word-phonetic">{phonetic}</span> : null}
      </span>
      {detail ? <small className="ui-word-chip__detail">{detail}</small> : null}
    </span>
  );
}
