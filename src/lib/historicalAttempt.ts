import type { SentenceProgress } from "./types";

export type HistoricalAttemptSelection = {
  attemptId: string;
  kind: "best" | "latest";
};

export function selectHistoricalAttempt(progress?: SentenceProgress): HistoricalAttemptSelection | null {
  if (progress?.bestAttemptId) {
    return { attemptId: progress.bestAttemptId, kind: "best" };
  }
  if (progress?.latestAttemptId) {
    return { attemptId: progress.latestAttemptId, kind: "latest" };
  }
  return null;
}
