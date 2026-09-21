import type { ReactNode } from "react";
import { Button, Result, Spin, Typography } from "antd";

export function ReceivablesPageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="receivables-page-header">
      <div className="receivables-page-heading">
        <Typography.Title level={2}>{title}</Typography.Title>
        {(description || meta) && (
          <div className="receivables-page-subtitle">
            {description && <span>{description}</span>}
            {meta && <span className="receivables-page-meta">{meta}</span>}
          </div>
        )}
      </div>
      {actions && <div className="receivables-page-actions">{actions}</div>}
    </header>
  );
}
export function ReceivablesStatePanel({
  kind,
  title,
  description,
  actionLabel,
  onAction,
}: {
  kind: "loading" | "empty" | "search" | "denied" | "error";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  if (kind === "loading") {
    return (
      <section className="receivables-state-panel" aria-live="polite">
        <Spin size="large" />
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </section>
    );
  }
  const status = kind === "denied" ? "403" : kind === "error" ? "error" : "info";
  return (
    <section className={`receivables-state-panel is-${kind}`}>
      <Result
        status={status}
        title={title}
        subTitle={description}
        extra={
          actionLabel && onAction ? (
            <Button type={kind === "error" ? "primary" : "default"} onClick={onAction}>
              {actionLabel}
            </Button>
          ) : undefined
        }
      />
    </section>
  );
}

export function ReceivablesSectionTitle({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="receivables-section-title">
      <div>
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}
