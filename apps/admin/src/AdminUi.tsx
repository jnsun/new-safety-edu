import type { ReactNode } from "react";
import { Alert, Button, Empty, Result, Skeleton, Space, Typography } from "antd";

type AdminPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
};

export function AdminPageHeader({ title, description, actions, meta }: AdminPageHeaderProps) {
  return (
    <header className="admin-page-header">
      <div className="admin-page-heading">
        <Typography.Title level={2}>{title}</Typography.Title>
        {description ? <Typography.Paragraph>{description}</Typography.Paragraph> : null}
        {meta ? <div className="admin-page-meta">{meta}</div> : null}
      </div>
      {actions ? <Space className="admin-page-actions" wrap>{actions}</Space> : null}
    </header>
  );
}

export function AdminToolbar({ children }: { children: ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}

export function AdminState({
  loading,
  error,
  empty,
  emptyTitle = "暂无数据",
  emptyDescription,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) return <div className="admin-state"><Skeleton active paragraph={{ rows: 5 }} /></div>;
  if (error) {
    return (
      <div className="admin-state">
        <Result
          status="error"
          title="内容加载失败"
          subTitle={error.message || "请检查网络后重试"}
          extra={onRetry ? <Button type="primary" onClick={onRetry}>重新加载</Button> : undefined}
        />
      </div>
    );
  }
  if (empty) {
    return <div className="admin-state"><Empty description={<><strong>{emptyTitle}</strong>{emptyDescription ? <span>{emptyDescription}</span> : null}</>} /></div>;
  }
  return <>{children}</>;
}

export function AdminConflict({ message, description }: { message: string; description?: ReactNode }) {
  return <Alert className="admin-conflict" type="warning" showIcon message={message} description={description} />;
}
