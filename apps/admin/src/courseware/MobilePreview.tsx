import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { Empty, Typography } from "antd";
import { useState } from "react";
import type { CoursewareBlock, StructuredCoursewareDocument } from "./types";

function BlockPreview({ block }: { block: CoursewareBlock }) {
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  if (block.type === "knowledge") return <section className="preview-knowledge"><h4>{block.title || "知识卡标题"}</h4><p>{block.body || "知识卡正文会显示在这里。"}</p>{block.imageFileId && <img className="preview-image" src={`/api/files/${block.imageFileId}`} alt={block.title || "知识卡图片"} />}</section>;
  if (block.type === "do_dont") return <section><h4>{block.title || "正误对比"}</h4><div className="preview-do-dont"><div><strong><CheckCircleOutlined /> 应该</strong>{block.dos.map((item, index) => <p key={index}>{item || "待填写"}</p>)}</div><div><strong><CloseCircleOutlined /> 不应该</strong>{block.donts.map((item, index) => <p key={index}>{item || "待填写"}</p>)}</div></div></section>;
  if (block.type === "steps") return <section><h4>{block.title || "操作步骤"}</h4><ol>{block.steps.map((step, index) => <li key={index}>{step || "待填写"}</li>)}</ol></section>;
  if (block.type === "checkpoint") return <section><span className="preview-label">随堂题</span><h4>{block.prompt || "题目会显示在这里"}</h4><div className="preview-options">{block.options.map((option, index) => { const selected = selectedAnswers.includes(index); return <button type="button" aria-pressed={selected} className={selected ? "selected" : ""} key={index} onClick={() => setSelectedAnswers(block.questionType === "multiple_choice" ? selected ? selectedAnswers.filter((value) => value !== index) : [...selectedAnswers, index] : [index])}><span>{String.fromCharCode(65 + index)}. {option || "待填写"}</span>{selected && <span className="preview-selected-marker">已选</span>}</button>; })}</div>{selectedAnswers.length > 0 && block.explanation && <p className="preview-explanation">解析：{block.explanation}</p>}</section>;
  if (block.type === "scenario") { const choice = selectedChoice === null ? null : block.choices[selectedChoice]; return <section><span className="preview-label">情境选择</span><h4>{block.prompt || "情境描述会显示在这里"}</h4><div className="preview-options">{block.choices.map((item, index) => { const selected = selectedChoice === index; return <button type="button" aria-pressed={selected} className={selected ? "selected" : ""} key={index} onClick={() => setSelectedChoice(index)}><span>{item.label || `选择 ${index + 1}`}</span>{selected && <span className="preview-selected-marker">已选</span>}</button>; })}</div>{choice && <div className="preview-choice-result"><p><strong>可能后果：</strong>{choice.consequence || "待填写"}</p><p><strong>制度依据：</strong>{choice.basis || "待填写"}</p></div>}</section>; }
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
