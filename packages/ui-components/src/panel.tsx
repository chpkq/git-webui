import type { PropsWithChildren, ReactNode } from 'react';

interface PanelProps extends PropsWithChildren {
  className?: string;
  title: string;
  action?: ReactNode;
}

export const Panel = ({ className = '', title, action, children }: PanelProps) => (
  <section className={`panel ${className}`.trim()}>
    <div className="panel-header">
      <h2>{title}</h2>
      {action}
    </div>
    <div className="panel-content">{children}</div>
  </section>
);

export const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <div className="empty-state">
    <div className="empty-state-mark">◇</div>
    <strong>{title}</strong>
    <p>{description}</p>
  </div>
);

export const StatusPill = ({
  tone,
  children,
}: PropsWithChildren<{ tone: 'success' | 'muted' }>) => (
  <span className={`status-pill status-pill-${tone}`}>
    <span className="status-dot" />
    {children}
  </span>
);
