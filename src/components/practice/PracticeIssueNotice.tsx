import { AlertCircle } from "lucide-react";
import type { PracticeIssue } from "../../lib/practiceErrors";
import { StatusBanner } from "../ui";

export function PracticeIssueNotice({ issue, className = "" }: { issue: PracticeIssue; className?: string }) {
  return (
    <StatusBanner
      className={`practice-issue-notice ${className}`.trim()}
      icon={<AlertCircle size={20} />}
      role="alert"
      tone={issue.kind.startsWith("recording-") || issue.kind === "audio-blocked" ? "warn" : "bad"}
    >
      <strong>{issue.title}</strong>
      <span>{issue.message}</span>
      <small>{issue.action}</small>
    </StatusBanner>
  );
}
