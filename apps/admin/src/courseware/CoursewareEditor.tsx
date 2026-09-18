import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, InputNumber, Select, Space, Typography } from "antd";
import { useEffect, useReducer, useState } from "react";
import { BlockEditor } from "./BlockEditor";
import { MobilePreview } from "./MobilePreview";
import {
  COURSEWARE_BLOCK_LABELS,
  createBlock,
  createEmptyCoursewareDocument,
  editorReducer,
  validateCoursewareDocument,
  type CoursewareBlock,
  type CoursewareBlockType,
  type EditorAction,
  type StructuredCoursewareDocument
} from "./types";
import "./courseware.css";

type Props = {
  initialDocument?: StructuredCoursewareDocument;
  initiallyDirty?: boolean;
  coursewareTitle: string;
  onSave: (document: StructuredCoursewareDocument) => Promise<void>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
};

const blockOptions = Object.entries(COURSEWARE_BLOCK_LABELS).map(([value, label]) => ({ value, label }));

export function CoursewareEditor({ initialDocument, initiallyDirty = false, coursewareTitle, onSave, onClose, onDirtyChange, onSavingChange }: Props) {
  const [state, dispatch] = useReducer(editorReducer, {
    document: { ...(initialDocument ?? createEmptyCoursewareDocument()), title: coursewareTitle },
    dirty: initiallyDirty || initialDocument === undefined,
    revision: 0,
    savedRevision: initiallyDirty || initialDocument === undefined ? null : 0
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => { onDirtyChange?.(state.dirty); }, [onDirtyChange, state.dirty]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!state.dirty && !saving) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saving, state.dirty]);

  const change = (action: EditorAction) => {
    setSaveError(undefined);
    setValidationErrors([]);
    dispatch(action);
  };
  const blockKeys = state.document.units.flatMap((unit) => unit.blocks.map((block) => block.key));

  const save = async () => {
    const revision = state.revision;
    const parsed = validateCoursewareDocument({ ...state.document, title: coursewareTitle });
    if (!parsed.success) {
      setValidationErrors(parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(" → ") || "课程"}：${issue.message}`));
      return;
    }
    setSaving(true);
    onSavingChange?.(true);
    setSaveError(undefined);
    try {
      await onSave(parsed.data);
      dispatch({ type: "saved", revision });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "课件保存失败，请稍后重试");
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  };

  return <div className="courseware-editor-shell">
    <div className="courseware-editor-toolbar">
      <div>
        <Typography.Title level={4}>结构化课件编辑器</Typography.Title>
        <Typography.Text type="secondary">纵向组织内容块，右侧同步预览员工手机上的阅读效果。</Typography.Text>
      </div>
      <Space wrap>
        <Typography.Text type={state.dirty ? "warning" : "secondary"}>{saving ? "正在保存…" : !state.dirty && state.savedRevision === state.revision ? "修改已保存" : state.dirty ? "有未保存更改" : "没有修改"}</Typography.Text>
        <Button onClick={onClose}>返回课件列表</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>保存修改</Button>
      </Space>
    </div>
    <Alert type="info" showIcon message="直接维护当前课件" description="尚未使用的内容会直接更新；已有学习记录时，系统在后台保留原记录所需内容，日常列表只显示当前课件。" />
    {validationErrors.length > 0 && <Alert type="error" showIcon message="请先修正以下内容" description={<ul className="courseware-error-list">{validationErrors.map((error) => <li key={error}>{error}</li>)}</ul>} />}
    {saveError && <Alert type="error" showIcon message="课件未保存" description={`${saveError}。当前编辑内容仍保留在本页面，可修正后重试。`} />}

    <div className="courseware-editor-layout">
      <main className="courseware-editor-main">
        <section className="courseware-document-fields" aria-labelledby="courseware-basic-heading">
          <div className="courseware-section-heading"><div><Typography.Title level={5} id="courseware-basic-heading">课程基本信息</Typography.Title><Typography.Text type="secondary">用于任务详情和课程封面。</Typography.Text></div></div>
          <label>课程标题<Input value={coursewareTitle} readOnly aria-readonly="true" /></label>
          <Typography.Text type="secondary">课程标题以课件主档为准，当前内容编辑器不会修改课件名称。</Typography.Text>
          <label>课程摘要<Input.TextArea value={state.document.summary} rows={3} maxLength={2000} showCount onChange={(event) => change({ type: "document", patch: { summary: event.target.value } })} /></label>
          <label>学习目标（每行一项）<Input.TextArea value={state.document.learningObjectives.join("\n")} rows={3} onChange={(event) => change({ type: "document", patch: { learningObjectives: event.target.value.split("\n") } })} /></label>
          <label>预计总时长（分钟）<InputNumber min={1} max={480} value={state.document.estimatedMinutes} onChange={(value) => change({ type: "document", patch: { estimatedMinutes: value ?? 1 } })} /></label>
        </section>

        <div className="courseware-units-heading"><div><Typography.Title level={5}>课程单元</Typography.Title><Typography.Text type="secondary">内容按从上到下的顺序呈现，不需要自由拖拽。</Typography.Text></div><Button icon={<PlusOutlined />} onClick={() => change({ type: "add_unit" })}>添加单元</Button></div>
        {state.document.units.length ? state.document.units.map((unit, unitIndex) => <section className="courseware-unit-editor" key={unit.key} aria-labelledby={`${unit.key}-heading`}>
          <header className="courseware-unit-heading">
            <div><Typography.Text type="secondary">单元 {unitIndex + 1}</Typography.Text><Typography.Title level={5} id={`${unit.key}-heading`}>{unit.title || "未命名单元"}</Typography.Title></div>
            <Button danger icon={<DeleteOutlined />} disabled={state.document.units.length === 1} onClick={() => change({ type: "remove_unit", unitKey: unit.key })}>删除单元</Button>
          </header>
          <div className="courseware-unit-meta">
            <label>单元标题<Input value={unit.title} maxLength={160} onChange={(event) => change({ type: "update_unit", unitKey: unit.key, patch: { title: event.target.value } })} /></label>
            <label>预计时长（分钟）<InputNumber min={1} max={120} value={unit.estimatedMinutes} onChange={(value) => change({ type: "update_unit", unitKey: unit.key, patch: { estimatedMinutes: value ?? 1 } })} /></label>
          </div>
          <div className="courseware-block-list">
            {unit.blocks.length ? unit.blocks.map((block, blockIndex) => <BlockEditor
              key={block.key}
              block={block}
              first={blockIndex === 0}
              last={blockIndex === unit.blocks.length - 1}
              onChange={(patch) => change({ type: "update", unitKey: unit.key, key: block.key, patch })}
              onDuplicate={() => change({ type: "duplicate", unitKey: unit.key, key: block.key })}
              onRemove={() => change({ type: "remove", unitKey: unit.key, key: block.key })}
              onMove={(direction) => change({ type: "move", unitKey: unit.key, key: block.key, direction })}
            />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本单元还没有内容块" />}
          </div>
          <Select<CoursewareBlockType>
            aria-label={`为${unit.title || `单元 ${unitIndex + 1}`}添加内容块`}
            className="courseware-add-block"
            placeholder="选择一种内容块添加到本单元"
            value={null}
            options={blockOptions}
            onSelect={(type: CoursewareBlockType) => change({ type: "add", unitKey: unit.key, block: createBlock(type, blockKeys) })}
          />
        </section>) : <Empty description="课程至少需要一个单元" />}
      </main>
      <MobilePreview document={{ ...state.document, title: coursewareTitle }} />
    </div>
  </div>;
}
