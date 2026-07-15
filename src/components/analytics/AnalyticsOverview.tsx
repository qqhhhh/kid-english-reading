import type { CSSProperties } from "react";
import { ProgressBar } from "../ui";

export type AnalyticsLessonStat = {
  attempts: number;
  averageBestScore: number | null;
  id: string;
  passed: number;
  percent: number;
  title: string;
  total: number;
};

export type AnalyticsRecentScore = {
  dateLabel: string;
  id: string;
  lessonTitle: string;
  score: number;
  sentenceText: string;
};

type AnalyticsOverviewProps = {
  averageBestScore: number | null;
  copy: {
    attempts: string;
    averageBestScore: string;
    completed: string;
    courseComparison: string;
    inProgress: string;
    noAssignedCourses: string;
    noAttempts: string;
    notStarted: string;
    overallProgress: string;
    recentScores: string;
    sentenceCount: string;
  };
  lessonStats: AnalyticsLessonStat[];
  overallPercent: number;
  recentScores: AnalyticsRecentScore[];
  statusCounts: {
    completed: number;
    inProgress: number;
    notStarted: number;
  };
  totalAttempts: number;
};

export function AnalyticsOverview({
  averageBestScore,
  copy,
  lessonStats,
  overallPercent,
  recentScores,
  statusCounts,
  totalAttempts
}: AnalyticsOverviewProps) {
  const donutStyle = {
    "--analytics-progress-angle": `${Math.min(100, Math.max(0, overallPercent)) * 3.6}deg`
  } as CSSProperties;

  return (
    <>
      <div className="analytics-visual-grid">
        <section className="admin-panel analytics-overview-card">
          <div className="compact-panel-title">
            <h2>{copy.overallProgress}</h2>
            <span>{lessonStats.length}</span>
          </div>
          <div className="analytics-overview-body">
            <div
              className="analytics-donut"
              style={donutStyle}
              role="img"
              aria-label={`${copy.overallProgress}: ${overallPercent}%`}
            >
              <div>
                <strong>{overallPercent}%</strong>
                <span>{copy.overallProgress}</span>
              </div>
            </div>
            <div className="analytics-status-list">
              <span className="completed">
                <i />
                {copy.completed}
                <strong>{statusCounts.completed}</strong>
              </span>
              <span className="in-progress">
                <i />
                {copy.inProgress}
                <strong>{statusCounts.inProgress}</strong>
              </span>
              <span className="not-started">
                <i />
                {copy.notStarted}
                <strong>{statusCounts.notStarted}</strong>
              </span>
            </div>
          </div>
        </section>

        <section className="admin-panel analytics-score-card">
          <div className="compact-panel-title">
            <h2>{copy.recentScores}</h2>
            <span>{totalAttempts} {copy.attempts}</span>
          </div>
          <div className="analytics-score-summary">
            <span>{copy.averageBestScore}</span>
            <strong>{averageBestScore ?? "-"}</strong>
          </div>
          {recentScores.length === 0 ? (
            <p className="admin-muted">{copy.noAttempts}</p>
          ) : (
            <div className="analytics-score-list">
              {recentScores.map((item) => (
                <div className="analytics-score-row" key={item.id} title={item.sentenceText}>
                  <span>
                    <strong>{item.lessonTitle}</strong>
                    <small>{item.dateLabel}</small>
                  </span>
                  <em className="analytics-score-track" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, Math.max(0, item.score))}%` }} />
                  </em>
                  <b>{item.score}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="admin-panel analytics-detail-panel">
        <div className="compact-panel-title">
          <h2>{copy.courseComparison}</h2>
          <span>{overallPercent}%</span>
        </div>
        {lessonStats.length === 0 ? (
          <p className="admin-muted">{copy.noAssignedCourses}</p>
        ) : (
          <div className="analytics-progress-list">
            {lessonStats.map((lesson) => (
              <article className="analytics-progress-row" key={lesson.id}>
                <div className="analytics-course-title">
                  <strong title={lesson.title}>{lesson.title}</strong>
                  <small>
                    {lesson.passed} / {lesson.total} {copy.sentenceCount}
                  </small>
                </div>
                <strong className="analytics-course-percent">{lesson.percent}%</strong>
                <ProgressBar value={lesson.percent} />
                <div className="analytics-course-meta">
                  <span>{lesson.attempts} {copy.attempts}</span>
                  <span>{copy.averageBestScore}: {lesson.averageBestScore ?? "-"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
