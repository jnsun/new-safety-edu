import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { Empty, Typography } from "antd";
import type { CoursewareBlock, StructuredCoursewareDocument } from "./types";

function BlockPreview({ block }: { block: CoursewareBlock }) {
  if (block.type === "knowledge") return <section className="preview-knowledge"><h4>{block.title || "知识卡标题"}</h4><p>{block.body || "知识卡正文会显示在这里。"}</p>{block.imageFileId && <img className="preview-image" src={`/api/files/${block.imageFileId}`} alt={block.title || "知识卡图片"} />}</section>;
  if (block.type === "do_dont") return <section><h4>{block.title || "正误对比"}</h4><div className="preview-do-dont"><div><strong><CheckCircleOutlined /> 应该</strong>{block.dos.map((item, index) => <p key={index}>{item || "待填写"}</p>)}</div><div><strong><CloseCircleOutlined /> 不应该</strong>{block.donts.map((item, index) => <p key={index}>{item || "待填写"}</p>)}</div></div></section>;
  if (block.type === "steps") return <section><h4>{block.title || "操作步骤"}</h4><ol>{block.steps.map((step, index) => <li key={index}>{step || "待填写"}</li>)}</ol></section>;
  if (block.type === "checkpoint") return <section><span className="preview-label">随堂题</span><h4>{block.prompt || "题目会显示在这里"}</h4><div className="preview-options">{block.options.map((option, index) => <span key={index}>{String.fromCharCode(65 + index)}. {option || "待填写"}</span>)}</div>{block.explanation && <p className="preview-explanation">解析：{block.explanation}</p>}</section>;
  if (block.type === "scenario") return <section><span className="preview-label">情境选择</span><h4>{block.prompt || "情境描述会显示在这里"}</h4><div className="preview-options">{block.choices.map((choice, index) => <span key={index}>{choice.label || `选择 ${index + 1}`}</span>)}</div></section>;
  return <section className="preview-summary"><h4>课程小结</h4><ul>{block.points.map((point, index) => <li key={index}>{point || "待填写"}</li>)}</ul></section>;
}

export function MobilePreview({ document }: { document: StructuredCoursewareDocument }) {
  return <aside className="courseware-preview-panel" aria-label="手机预览">
    <header><Typography.Text strong>手机预览</Typography.Text><Typography.Text type="secondary">内容会随编辑同步更新</Typography.Text></header>
    <div className="courseware-phone-frame">
      <div className="courseware-phone-screen">
        <div className="preview-cover">
          <span>{document.estimatedMinutes} 分钟</span>
          <h3>{document.title || "未命名课程"}</h3>
          <p>{document.summary || "课程摘要会显示在这里。"}</p>
        </div>
        {document.units.length ? document.units.map((unit) => <div className="preview-unit" key={unit.key}>
          <div className="preview-unit-heading"><h3>{unit.title || "未命名单元"}</h3><span>{unit.estimatedMinutes} 分钟</span></div>
          {unit.blocks.length ? unit.blocks.map((block) => <BlockPreview key={block.key} block={block} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="添加内容块后即可预览" />}
        </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先添加课程单元" />}
      </div>
    </div>
  </aside>;
}
