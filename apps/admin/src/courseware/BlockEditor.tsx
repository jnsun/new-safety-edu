import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Button, Input, message, Select, Space, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import { api } from "../api";
import type { CoursewareBlock } from "./types";
import { COURSEWARE_BLOCK_LABELS } from "./types";

type Props = {
  block: CoursewareBlock;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<CoursewareBlock>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
};

const lines = (value: string) => value.split("\n");

export function BlockEditor({ block, first, last, onChange, onDuplicate, onRemove, onMove }: Props) {
  const uploadImage: NonNullable<UploadProps["customRequest"]> = async ({ file, onSuccess, onError }) => {
    try {
      const body = new FormData();
      body.append("file", file as Blob);
      const result = await api<{ id: string }>("/api/files?kind=attachment", { method: "POST", body });
      onChange({ imageFileId: result.id });
      message.success("图片已上传并关联到知识卡");
      onSuccess?.(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "图片上传失败");
      onError?.(error as Error);
    }
  };
  return <article className="courseware-block-editor" aria-label={COURSEWARE_BLOCK_LABELS[block.type]}>
    <header className="courseware-block-heading">
      <div><Typography.Text strong>{COURSEWARE_BLOCK_LABELS[block.type]}</Typography.Text><Typography.Text type="secondary" className="courseware-block-key">{block.key}</Typography.Text></div>
      <Space size={4} wrap>
        <Button aria-label="上移内容块" title="上移" icon={<ArrowUpOutlined />} disabled={first} onClick={() => onMove(-1)} />
        <Button aria-label="下移内容块" title="下移" icon={<ArrowDownOutlined />} disabled={last} onClick={() => onMove(1)} />
        <Button aria-label="复制内容块" title="复制" icon={<CopyOutlined />} onClick={onDuplicate} />
        <Button aria-label="删除内容块" title="删除" danger icon={<DeleteOutlined />} onClick={onRemove} />
      </Space>
    </header>
    <div className="courseware-block-fields">
      {block.type === "knowledge" && <>
        <label>标题<Input value={block.title} maxLength={160} onChange={(event) => onChange({ title: event.target.value })} /></label>
        <label>正文<Input.TextArea value={block.body} rows={5} maxLength={10_000} showCount onChange={(event) => onChange({ body: event.target.value })} /></label>
        <label>知识卡图片（可选）<Space wrap><Upload accept="image/jpeg,image/png,image/webp" maxCount={1} showUploadList={false} customRequest={uploadImage}><Button icon={<UploadOutlined />}>{block.imageFileId ? "更换图片" : "上传图片"}</Button></Upload>{block.imageFileId && <><Typography.Text type="secondary">已关联私有图片</Typography.Text><Button danger type="link" onClick={() => onChange({ imageFileId: null })}>移除</Button></>}</Space></label>
      </>}

      {block.type === "do_dont" && <>
        <label>标题<Input value={block.title} maxLength={160} onChange={(event) => onChange({ title: event.target.value })} /></label>
        <div className="courseware-two-columns">
          <label>应该做（每行一项）<Input.TextArea value={block.dos.join("\n")} rows={5} onChange={(event) => onChange({ dos: lines(event.target.value) })} /></label>
          <label>不应该做（每行一项）<Input.TextArea value={block.donts.join("\n")} rows={5} onChange={(event) => onChange({ donts: lines(event.target.value) })} /></label>
        </div>
      </>}

      {block.type === "steps" && <>
        <label>标题<Input value={block.title} maxLength={160} onChange={(event) => onChange({ title: event.target.value })} /></label>
        <label>操作步骤（每行一步）<Input.TextArea value={block.steps.join("\n")} rows={6} onChange={(event) => onChange({ steps: lines(event.target.value) })} /></label>
      </>}

      {block.type === "checkpoint" && <>
        <label>题目<Input.TextArea value={block.prompt} rows={3} maxLength={2000} onChange={(event) => onChange({ prompt: event.target.value })} /></label>
        <label>题型<Select value={block.questionType} options={[{ value: "single_choice", label: "单选" }, { value: "multiple_choice", label: "多选" }, { value: "true_false", label: "判断" }]} onChange={(questionType) => onChange(questionType === "true_false" ? { questionType, options: ["正确", "错误"], correctIndexes: [0] } : { questionType })} /></label>
        <label>选项（每行一个）<Input.TextArea value={block.options.join("\n")} rows={4} disabled={block.questionType === "true_false"} onChange={(event) => onChange({ options: lines(event.target.value) })} /></label>
        <label>正确选项<Select mode="multiple" value={block.correctIndexes} options={block.options.map((option, index) => ({ value: index, label: `${index + 1}. ${option || "未填写"}` }))} onChange={(correctIndexes) => onChange({ correctIndexes })} /></label>
        <label>答题解析<Input.TextArea value={block.explanation} rows={3} maxLength={4000} onChange={(event) => onChange({ explanation: event.target.value })} /></label>
      </>}

      {block.type === "scenario" && <>
        <label>情境描述<Input.TextArea value={block.prompt} rows={4} maxLength={3000} onChange={(event) => onChange({ prompt: event.target.value })} /></label>
        <div className="courseware-choice-list">
          {block.choices.map((choice, index) => <div className="courseware-choice-row" key={index}>
            <Typography.Text strong>选择 {index + 1}</Typography.Text>
            <Input aria-label={`选择 ${index + 1} 文案`} placeholder="员工可选择的行动" value={choice.label} onChange={(event) => onChange({ choices: block.choices.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} />
            <Input aria-label={`选择 ${index + 1} 后果`} placeholder="选择后的后果" value={choice.consequence} onChange={(event) => onChange({ choices: block.choices.map((item, itemIndex) => itemIndex === index ? { ...item, consequence: event.target.value } : item) })} />
            <Input aria-label={`选择 ${index + 1} 依据`} placeholder="制度或安全依据" value={choice.basis} onChange={(event) => onChange({ choices: block.choices.map((item, itemIndex) => itemIndex === index ? { ...item, basis: event.target.value } : item) })} />
            <Button aria-label={`删除选择 ${index + 1}`} title="删除选择" danger icon={<MinusCircleOutlined />} onClick={() => onChange({ choices: block.choices.filter((_, itemIndex) => itemIndex !== index) })} />
          </div>)}
          <Button icon={<PlusOutlined />} onClick={() => onChange({ choices: [...block.choices, { label: "", consequence: "", basis: "" }] })}>添加选择</Button>
        </div>
      </>}

      {block.type === "summary" && <label>总结要点（每行一点，最多五点）<Input.TextArea value={block.points.join("\n")} rows={5} onChange={(event) => onChange({ points: lines(event.target.value) })} /></label>}
    </div>
  </article>;
}
