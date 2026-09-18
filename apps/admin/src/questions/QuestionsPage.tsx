import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tabs, Tag, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import { useEffect, useMemo, useState } from "react";
import { api, json } from "../api";
import { ChallengeQuestionSettings } from "../challenge/ChallengeQuestionSettings";
import { PointLedgerPage } from "../challenge/PointLedgerPage";

type Question = { id: string; bankId: string; prompt: string; type: string; options: string[]; correct: string[]; explanation?: string | null; currentVersion: number; active: boolean };
type Bank = { id: string; name: string; _count: { questions: number } };
type QuestionPage = { items: Question[]; total: number; page: number; pageSize: number };
type Paper = { id: string; name: string; mode: "fixed" | "random"; bankId?: string | null; randomCount?: number | null; items: Array<{ questionId: string; score: number | string; question: Question }> };
type ImportResult = { created: number; valid: number; failed: number; errors: Array<{ rowNumber: number; reason: string }> };

const questionTypeNames: Record<string, string> = { single_choice: "单选题", multiple_choice: "多选题", true_false: "判断题" };
const scope = { scopeType: "company", scopeId: null };
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";
const toQuestionBody = (values: Record<string, unknown>) => ({
  ...values,
  options: String(values.options ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
  correct: String(values.correct ?? "").split(",").map((item) => item.trim()).filter(Boolean)
});

export function QuestionsPage() {
  const qc = useQueryClient();
  const banks = useQuery({ queryKey: ["question-banks"], queryFn: () => api<Bank[]>("/api/question-banks") });
  const papers = useQuery({ queryKey: ["exam-papers"], queryFn: () => api<Paper[]>("/api/exam-papers") });
  const [selectedBankId, setSelectedBankId] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>();
  const [bankOpen, setBankOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank>();
  const [questionOpen, setQuestionOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question>();
  const [paperOpen, setPaperOpen] = useState(false);
  const [editingPaper, setEditingPaper] = useState<Paper>();
  const [paperMode, setPaperMode] = useState<"fixed" | "random">("fixed");
  const [paperBankId, setPaperBankId] = useState<string>();
  const [paperQuestionKeyword, setPaperQuestionKeyword] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importBankId, setImportBankId] = useState<string>();
  const [importResult, setImportResult] = useState<ImportResult>();

  useEffect(() => {
    if (!selectedBankId && banks.data?.[0]) setSelectedBankId(banks.data[0].id);
    if (selectedBankId && banks.data && !banks.data.some(({ id }) => id === selectedBankId)) setSelectedBankId(banks.data[0]?.id);
  }, [banks.data, selectedBankId]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (keyword.trim()) params.set("keyword", keyword.trim());
  if (typeFilter) params.set("type", typeFilter);
  const questions = useQuery({
    queryKey: ["questions", selectedBankId, page, pageSize, keyword, typeFilter],
    queryFn: () => api<QuestionPage>(`/api/question-banks/${selectedBankId}/questions?${params}`),
    enabled: !!selectedBankId
  });

  const optionParams = new URLSearchParams({ page: "1", pageSize: "100" });
  if (paperQuestionKeyword.trim()) optionParams.set("keyword", paperQuestionKeyword.trim());
  const paperQuestions = useQuery({
    queryKey: ["paper-question-options", paperBankId, paperQuestionKeyword],
    queryFn: () => api<QuestionPage>(`/api/question-banks/${paperBankId}/questions?${optionParams}`),
    enabled: paperMode === "fixed" && !!paperBankId && paperOpen
  });
  const paperQuestionOptions = useMemo(() => (paperQuestions.data?.items ?? []).map((question) => ({ value: question.id, label: `${questionTypeNames[question.type] ?? question.type} · ${question.prompt}` })), [paperQuestions.data]);

  async function refreshContent() {
    await Promise.all([qc.invalidateQueries({ queryKey: ["question-banks"] }), qc.invalidateQueries({ queryKey: ["questions"] }), qc.invalidateQueries({ queryKey: ["paper-question-options"] }), qc.invalidateQueries({ queryKey: ["exam-papers"] })]);
  }

  const questionUpload: NonNullable<UploadProps["customRequest"]> = async ({ file, onSuccess, onError }) => {
    if (!importBankId) return;
    try {
      const body = new FormData(); body.append("file", file as Blob);
      const result = await api<ImportResult>(`/api/question-banks/${importBankId}/questions/import`, { method: "POST", body });
      setImportResult(result);
      if (result.failed) message.warning("文件存在错误，本次未写入试题"); else { message.success(`成功导入 ${result.created} 道试题`); await refreshContent(); }
      onSuccess?.(result);
    } catch (error) { message.error((error as Error).message); onError?.(error as Error); }
  };

  const savePaper = async (values: Record<string, unknown>) => {
    try {
      const body = paperMode === "fixed"
        ? { name: values.name, mode: paperMode, items: (values.questionIds as string[]).map((questionId) => ({ questionId, score: 100 / (values.questionIds as string[]).length })) }
        : { name: values.name, mode: paperMode, bankId: values.bankId, randomCount: values.randomCount };
      await api(editingPaper ? `/api/exam-papers/${editingPaper.id}` : "/api/exam-papers", json(editingPaper ? "PATCH" : "POST", body));
      message.success("试卷已保存"); setPaperOpen(false); setEditingPaper(undefined); await refreshContent();
    } catch (error) { message.error(errorText(error)); }
  };

  return <>
    <Space className="page-title" wrap>
      <Typography.Title level={3}>题库与试卷</Typography.Title>
      <Button icon={<PlusOutlined />} onClick={() => { setEditingBank(undefined); setBankOpen(true); }}>新建题库</Button>
      <Button icon={<PlusOutlined />} disabled={!selectedBankId} onClick={() => setQuestionOpen(true)}>新增题目</Button>
      <Button icon={<UploadOutlined />} onClick={() => { setImportResult(undefined); setImportOpen(true); }}>批量导入</Button>
      <Button type="primary" onClick={() => { setEditingPaper(undefined); setPaperMode("fixed"); setPaperBankId(selectedBankId); setPaperOpen(true); }}>新建试卷</Button>
    </Space>
    <Tabs items={[
      { key: "questions", label: "题库与题目", children: <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 16 }}>
        <Table size="small" showHeader={false} rowKey="id" pagination={false} loading={banks.isLoading} dataSource={banks.data ?? []} rowClassName={(row) => row.id === selectedBankId ? "ant-table-row-selected" : ""} onRow={(row) => ({ onClick: () => { setSelectedBankId(row.id); setPage(1); } })} columns={[{ render: (_: unknown, row: Bank) => <div><Typography.Text strong>{row.name}</Typography.Text><div><Typography.Text type="secondary">{row._count.questions} 道题</Typography.Text></div></div> }, { width: 70, render: (_: unknown, row: Bank) => <Space size={0}><Button type="text" size="small" icon={<EditOutlined />} onClick={(event) => { event.stopPropagation(); setEditingBank(row); setBankOpen(true); }} /><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={(event) => { event.stopPropagation(); Modal.confirm({ title: `删除题库“${row.name}”？`, content: "若仍被试卷使用，系统会阻止删除并提示处理。", okText: "删除", okButtonProps: { danger: true }, onOk: async () => { await api(`/api/question-banks/${row.id}`, { method: "DELETE" }); message.success("题库已删除"); await refreshContent(); } }); }} /></Space> }]} />
        <div>
          <Space wrap style={{ marginBottom: 12 }}><Input.Search allowClear placeholder="搜索题干" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} style={{ width: 280 }} /><Select allowClear placeholder="全部题型" value={typeFilter} onChange={(value) => { setTypeFilter(value); setPage(1); }} style={{ width: 140 }} options={Object.entries(questionTypeNames).map(([value, label]) => ({ value, label }))} /></Space>
          <Table rowKey="id" loading={questions.isLoading} dataSource={questions.data?.items ?? []} pagination={{ current: page, pageSize, total: questions.data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 道`, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); } }} columns={[{ title: "题型", dataIndex: "type", width: 90, render: (value: string) => <Tag>{questionTypeNames[value] ?? value}</Tag> }, { title: "题干", dataIndex: "prompt", ellipsis: true }, { title: "操作", width: 140, render: (_: unknown, row: Question) => <Space><Button size="small" onClick={() => setEditingQuestion(row)}>编辑</Button><Button danger size="small" onClick={() => Modal.confirm({ title: "删除该题目？", content: "若仍被固定试卷使用，系统会阻止删除。", okText: "删除", okButtonProps: { danger: true }, onOk: async () => { await api(`/api/questions/${row.id}`, { method: "DELETE" }); message.success("题目已删除"); await refreshContent(); } })}>删除</Button></Space> }]} />
        </div>
      </div> },
      { key: "papers", label: "试卷", children: <Table rowKey="id" dataSource={papers.data ?? []} columns={[{ title: "名称", dataIndex: "name" }, { title: "组卷方式", dataIndex: "mode", render: (value: string) => value === "fixed" ? "固定试卷" : "随机组卷" }, { title: "题量", render: (_: unknown, row: Paper) => row.mode === "fixed" ? row.items.length : row.randomCount ?? 0 }, { title: "操作", width: 150, render: (_: unknown, row: Paper) => <Space><Button size="small" onClick={() => { setEditingPaper(row); setPaperMode(row.mode); setPaperBankId(row.bankId ?? row.items[0]?.question.bankId ?? selectedBankId); setPaperOpen(true); }}>编辑</Button><Button danger size="small" onClick={() => Modal.confirm({ title: `删除试卷“${row.name}”？`, content: "已下发培训保留当时的试卷快照。", okText: "删除", okButtonProps: { danger: true }, onOk: async () => { await api(`/api/exam-papers/${row.id}`, { method: "DELETE" }); message.success("试卷已删除"); await refreshContent(); } })}>删除</Button></Space> }]} /> },
      { key: "challenge", label: "日常挑战", children: <ChallengeQuestionSettings /> },
      { key: "challenge-points", label: "积分流水", children: <PointLedgerPage /> }
    ]} />

    <Modal title={editingBank ? "编辑题库" : "新建题库"} open={bankOpen} footer={null} destroyOnHidden onCancel={() => setBankOpen(false)}><Form key={editingBank?.id ?? "new-bank"} layout="vertical" {...(editingBank ? { initialValues: editingBank } : {})} onFinish={async (values) => { try { await api(editingBank ? `/api/question-banks/${editingBank.id}` : "/api/question-banks", json(editingBank ? "PATCH" : "POST", editingBank ? values : { ...scope, ...values })); message.success("题库已保存"); setBankOpen(false); await refreshContent(); } catch (error) { message.error(errorText(error)); } }}><Form.Item name="name" label="名称" rules={[{ required: true, min: 2 }]}><Input /></Form.Item><Button type="primary" htmlType="submit">保存</Button></Form></Modal>
    <Modal title="新增题目" open={questionOpen} footer={null} destroyOnHidden onCancel={() => setQuestionOpen(false)}><QuestionForm initialValues={{ bankId: selectedBankId, type: "single_choice" }} banks={banks.data ?? []} showBank onFinish={async (values) => { try { await api(`/api/question-banks/${values.bankId}/questions`, json("POST", toQuestionBody(values))); message.success("题目已新增"); setQuestionOpen(false); await refreshContent(); } catch (error) { message.error(errorText(error)); } }} /></Modal>
    <Modal title="编辑题目" open={!!editingQuestion} footer={null} destroyOnHidden onCancel={() => setEditingQuestion(undefined)}>{editingQuestion && <QuestionForm initialValues={{ ...editingQuestion, options: editingQuestion.options.join("\n"), correct: editingQuestion.correct.join(",") }} banks={banks.data ?? []} onFinish={async (values) => { try { await api(`/api/questions/${editingQuestion.id}`, json("PATCH", toQuestionBody(values))); message.success("题目已修改"); setEditingQuestion(undefined); await refreshContent(); } catch (error) { message.error(errorText(error)); } }} />}</Modal>
    <Modal title="批量导入试题" open={importOpen} footer={null} width={720} onCancel={() => setImportOpen(false)}><Space direction="vertical" style={{ width: "100%" }} size="middle"><Alert type="info" showIcon message="先下载模板并按示例填写；任何一行错误都会阻止本次写入。" /><Button icon={<DownloadOutlined />} href="/api/question-import-template.csv">下载导入模板</Button><Select placeholder="选择目标题库" value={importBankId} onChange={setImportBankId} options={(banks.data ?? []).map((bank) => ({ value: bank.id, label: bank.name }))} style={{ width: "100%" }} /><Upload accept=".xlsx,.csv" maxCount={1} showUploadList customRequest={questionUpload}><Button type="primary" icon={<UploadOutlined />} disabled={!importBankId}>选择 XLSX/CSV 并导入</Button></Upload>{importResult && <Alert type={importResult.failed ? "error" : "success"} showIcon message={`成功 ${importResult.created}，错误 ${importResult.failed}`} description={importResult.errors.slice(0, 20).map((row) => `第 ${row.rowNumber} 行：${row.reason}`).join("；")} />}</Space></Modal>
    <Modal title={editingPaper ? "编辑试卷" : "新建试卷"} open={paperOpen} footer={null} destroyOnHidden onCancel={() => { setPaperOpen(false); setEditingPaper(undefined); }}><Form key={editingPaper?.id ?? "new-paper"} layout="vertical" {...(editingPaper ? { initialValues: { name: editingPaper.name, bankId: editingPaper.bankId, randomCount: editingPaper.randomCount, questionIds: editingPaper.items.map(({ questionId }) => questionId) } } : {})} onFinish={savePaper}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="组卷方式"><Select value={paperMode} onChange={(value) => setPaperMode(value)} options={[{ value: "fixed", label: "固定试卷" }, { value: "random", label: "随机组卷" }]} /></Form.Item>{paperMode === "fixed" ? <><Form.Item label="题库"><Select value={paperBankId} onChange={(value) => { setPaperBankId(value); setPaperQuestionKeyword(""); }} options={(banks.data ?? []).map((bank) => ({ value: bank.id, label: bank.name }))} /></Form.Item><Input.Search placeholder="搜索题干后选择，单次显示最多 100 道" onSearch={setPaperQuestionKeyword} style={{ marginBottom: 12 }} /><Form.Item name="questionIds" label="题目" rules={[{ required: true }]}><Select mode="multiple" loading={paperQuestions.isLoading} optionFilterProp="label" options={paperQuestionOptions} /></Form.Item></> : <><Form.Item name="bankId" label="题库" rules={[{ required: true }]}><Select options={(banks.data ?? []).map((bank) => ({ value: bank.id, label: bank.name }))} /></Form.Item><Form.Item name="randomCount" label="题量" rules={[{ required: true }]}><InputNumber min={1} max={200} /></Form.Item></>}<Button type="primary" htmlType="submit">保存试卷</Button></Form></Modal>
  </>;
}

function QuestionForm({ initialValues, banks, showBank = false, onFinish }: { initialValues: Record<string, unknown>; banks: Bank[]; showBank?: boolean; onFinish: (values: Record<string, unknown>) => Promise<void> }) {
  return <Form layout="vertical" initialValues={initialValues} onFinish={onFinish}>{showBank && <Form.Item name="bankId" label="题库" rules={[{ required: true }]}><Select options={banks.map((bank) => ({ value: bank.id, label: bank.name }))} /></Form.Item>}<Form.Item name="type" label="题型" rules={[{ required: true }]}><Select options={Object.entries(questionTypeNames).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="prompt" label="题干" rules={[{ required: true, min: 2 }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="options" label="选项（每行一个）" rules={[{ required: true }]}><Input.TextArea rows={5} /></Form.Item><Form.Item name="correct" label="正确答案（多个用逗号）" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="explanation" label="解析"><Input.TextArea rows={3} /></Form.Item><Button type="primary" htmlType="submit">保存</Button></Form>;
}
