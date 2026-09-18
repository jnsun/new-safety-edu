import { Alert, Table, Tag, Typography } from "antd";

export type ImportClassification = "create" | "new_version" | "conflict" | "invalid";
export type ImportPreviewItem = { courseCode: string; title: string; classification: ImportClassification; existingCoursewareId: string | null; issueCount: number };
export type ImportIssue = { file: string; sheet: string; row: number; field: string; code: string; message: string; courseCode?: string };

const groups: Array<{ classification: ImportClassification; label: string; color: string }> = [
  { classification: "create", label: "新增课件", color: "green" },
  { classification: "new_version", label: "创建新版本", color: "blue" },
  { classification: "conflict", label: "冲突", color: "orange" },
  { classification: "invalid", label: "无效", color: "red" }
];

export function ImportPreviewTable({ items, issues }: { items: ImportPreviewItem[]; issues: ImportIssue[] }) {
  const globalIssues = issues.filter((issue) => !issue.courseCode);
  return <div className="courseware-import-preview">
    {globalIssues.length > 0 && <Alert type="error" showIcon message="文件级错误" description={globalIssues.map((issue) => `${issue.sheet}${issue.row ? ` 第 ${issue.row} 行` : ""} · ${issue.field}：${issue.message}`).join("；")} />}
    {groups.map((group) => {
      const rows = items.filter((item) => item.classification === group.classification);
      if (!rows.length) return null;
      return <section key={group.classification}>
        <Typography.Title level={5}><Tag color={group.color}>{group.label}</Tag> {rows.length} 项</Typography.Title>
        <Table size="small" rowKey="courseCode" pagination={false} dataSource={rows} columns={[
          { title: "课程编码", dataIndex: "courseCode", width: 180 },
          { title: "课程名称", dataIndex: "title" },
          { title: "问题", dataIndex: "issueCount", width: 80 }
        ]} expandable={{
          rowExpandable: (row) => issues.some((issue) => issue.courseCode === row.courseCode),
          expandedRowRender: (row) => <Table size="small" rowKey={(issue) => `${issue.sheet}-${issue.row}-${issue.field}-${issue.code}`} pagination={false} dataSource={issues.filter((issue) => issue.courseCode === row.courseCode)} columns={[
            { title: "工作表", dataIndex: "sheet", width: 110 },
            { title: "行号", dataIndex: "row", width: 70, render: (value: number) => value || "—" },
            { title: "字段", dataIndex: "field", width: 140 },
            { title: "原因", dataIndex: "message" }
          ]} />
        }} />
      </section>;
    })}
  </div>;
}
