import type { ReactNode, RefObject } from "react";
import { workspaceViewportClass } from "./workspace-state";

type SplitWorkspaceProps = {
  directoryHeader: ReactNode;
  directory: ReactNode;
  detailHeader?: ReactNode;
  detail: ReactNode;
  mobileSelector?: ReactNode;
  detailRef?: RefObject<HTMLDivElement | null>;
  compact?: boolean;
};

export function SplitWorkspace({
  directoryHeader,
  directory,
  detailHeader,
  detail,
  mobileSelector,
  detailRef,
  compact = false,
}: SplitWorkspaceProps) {
  return (
    <div className={workspaceViewportClass({ compact })}>
      <aside className="master-directory">
        <div className="master-directory-header">{directoryHeader}</div>
        <div className="master-directory-scroll">{directory}</div>
      </aside>
      {mobileSelector && <div className="master-mobile-selector">{mobileSelector}</div>}
      <section className="master-detail">
        {detailHeader && <div className="master-detail-header">{detailHeader}</div>}
        <div className="master-detail-scroll" ref={detailRef}>{detail}</div>
      </section>
    </div>
  );
}
