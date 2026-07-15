import type { ReactNode } from "react";

export type EmptyStateProps = {
  actions?: ReactNode;
  className?: string;
  description: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ actions, className, description, icon, title }: EmptyStateProps) {
  return (
    <section className={["admin-panel course-empty-panel", className].filter(Boolean).join(" ")}>
      {icon}
      <h2>{title}</h2>
      <p>{description}</p>
      {actions}
    </section>
  );
}
