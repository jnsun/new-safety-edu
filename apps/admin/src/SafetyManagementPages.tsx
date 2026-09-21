import { useMemo, useState } from "react";
import type { Key } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Dropdown,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import { api, json } from "./api";

type Organization = { id: string; name: string; type: string };
type Project = {
  id: string;
  name: string;
  code: string;
  responsibleOrganizationId: string;
  status: string;
  projectType?: string | null;
  location?: string | null;
  contractAmount?: string | number | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  managerName?: string | null;
  managerPhone?: string | null;
  responsibleOrganization: { id: string; name: string };
  previousDefaults?: {
    overallProgress?: string;
    onsiteCount?: number;
    onsiteVehicles?: number;
    equipmentModels?: string;
  };
};
type PersonOption = { id: string; name: string; phone: string };
type CertificateType = {
  id: string;
  name: string;
  category: "company" | "personal";
  subtype1Label?: string;
  subtype1Options: string[];
  subtype2Label?: string;
  subtype2Options: string[];
  requiresAnnualTraining: boolean;
  sortOrder: number;
  active: boolean;
};
type Certificate = {
  id: string;
  category: "company" | "personal";
  ownerId: string;
  ownerName: string;
  organizationId?: string;
  organizationName: string;
  holderName?: string;
  holderPosition?: string;
  typeId?: string;
  type?: CertificateType;
  name: string;
  certificateNo?: string;
  subtype1Value?: string;
  subtype2Value?: string;
  issuingAuthority?: string;
  issuedAt?: string;
  validFrom?: string;
  expiresAt?: string;
  isLongTerm: boolean;
  status: "active" | "replaced" | "revoked" | "voided";
  expiryState: "valid" | "expiring" | "expired" | "long_term";
  trainingStatus?: "trained" | "not_required" | "pending";
  scope?: string;
  remark?: string;
  attachments: Array<{
    id: string;
    file: { id: string; originalName: string; mimeType: string; size: number };
  }>;
  trainingRecords?: Array<{
    id: string;
    year: number;
    trainingDate: string;
    content: string;
    trainingOrganization?: string;
    hours?: string;
    result?: string;
    status?: "active" | "voided";
  }>;
};
type MonthlyReport = {
  id: string;
  projectId: string;
  reportingOrganizationId: string;
  reportMonth: string;
  status: "draft" | "submitted" | "withdrawn" | "voided";
  revision: number;
  progressSummary: string;
  projectTypeId?: string;
  projectType?: { id: string; name: string };
  constructionLocation?: string;
  contractAmount: string;
  durationMonths?: number;
  departmentEntity?: string;
  projectManager?: string;
  contactInfo?: string;
  overallProgress?: string;
  monthlyConstructionStatus?: string;
  equipmentModels?: string;
  onsiteCount: number;
  onsiteVehicles: number;
  safetyInspection: boolean;
  safetyHazards: boolean;
  safetyHazardDetail?: string;
  safetyHazardCount: number;
  rectifiedHazardCount: number;
  safetyInvestment: string;
  incidentCount: number;
  projectStatus: "active" | "completed";
  customData: Record<string, unknown>;
  notes?: string;
  submittedAt?: string;
  project: Project;
  reportingOrganization: Organization;
  attachments?: Array<{
    id: string;
    file: { id: string; originalName: string; mimeType: string; size: number };
  }>;
};
type ReportConfig = {
  types: Array<{
    id: string;
    name: string;
    sortOrder: number;
    active: boolean;
  }>;
  fields: Array<{
    id: string;
    fieldKey: string;
    label: string;
    fieldType: "text" | "number" | "textarea" | "select" | "date";
    options: string[];
    required: boolean;
    sortOrder: number;
    active: boolean;
    builtin: boolean;
  }>;
  organizations: Array<{ id: string; name: string; reportingEnabled: boolean }>;
  settings: { deadlineDay: number };
};

const dateText = (value?: string) =>
  value ? value.slice(0, 10) : "长期/未填写";
const expiryTag = (value?: string) => {
  if (!value) return <Tag>长期</Tag>;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  return (
    <Tag color={days < 0 ? "red" : days <= 90 ? "orange" : "green"}>
      {days < 0 ? "已到期" : days <= 90 ? `${days} 天后到期` : "有效"}
    </Tag>
  );
};

export function QualificationsPage({
  canWrite = false,
}: {
  canWrite?: boolean;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [typeForm] = Form.useForm();
  const [trainingForm] = Form.useForm();
  const [category, setCategory] = useState<"all" | "company" | "personal">(
    "all",
  );
  const [filters, setFilters] = useState({
    organizationId: "",
    typeId: "",
    status: "",
    keyword: "",
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Certificate>();
  const [renewing, setRenewing] = useState<Certificate>();
  const [detail, setDetail] = useState<Certificate>();
  const [typeOpen, setTypeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [previewRows, setPreviewRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api<Organization[]>("/api/organizations"),
  });
  const people = useQuery({
    queryKey: ["persons"],
    queryFn: () => api<PersonOption[]>("/api/persons"),
  });
  const types = useQuery({
    queryKey: ["certificate-types"],
    queryFn: () => api<CertificateType[]>("/api/certificate-types"),
  });
  const settings = useQuery({
    queryKey: ["certificate-settings"],
    queryFn: () => api<{ warnDays: number }>("/api/certificate-settings"),
  });
  const params = new URLSearchParams(
    Object.entries({
      ...(category === "all" ? {} : { category }),
      ...filters,
    }).filter(([, value]) => value),
  );
  const ledger = useQuery({
    queryKey: ["certificates", category, filters],
    queryFn: () =>
      api<{
        rows: Certificate[];
        summary: { total: number; expiring: number; expired: number };
        warnDays: number;
      }>(`/api/certificates?${params}`),
  });
  const selectedCategory = (Form.useWatch("category", form) ?? "company") as
    | "company"
    | "personal";
  const selectedTypeId = Form.useWatch("typeId", form) as string | undefined;
  const selectedType = types.data?.find((row) => row.id === selectedTypeId);
  const categoryTypes = useMemo(
    () =>
      (types.data ?? []).filter(
        (row) => row.active && row.category === selectedCategory,
      ),
    [types.data, selectedCategory],
  );
  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["certificates"] });
  const openForm = (row?: Certificate, renew = false) => {
    setEditing(renew ? undefined : row);
    setRenewing(renew ? row : undefined);
    setFiles([]);
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            ...row,
            ownerId: row.ownerId,
            typeId: row.typeId,
            expiresAt: row.expiresAt ?? "",
            issuedAt: row.issuedAt ?? "",
            validFrom: row.validFrom ?? "",
          }
        : { category: "company", isLongTerm: false },
    );
    setOpen(true);
  };
  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const fileIds: string[] = [];
      for (const file of files) {
        if (!file.originFileObj) continue;
        const body = new FormData();
        body.append("file", file.originFileObj);
        const uploaded = await api<{ id: string }>(
          "/api/files?kind=attachment",
          { method: "POST", body },
        );
        fileIds.push(uploaded.id);
      }
      const target = renewing
        ? `/api/certificates/${renewing.category}/${renewing.id}/renew`
        : editing
          ? `/api/certificates/${editing.category}/${editing.id}`
          : "/api/certificates";
      return api(
        target,
        json(editing ? "PATCH" : "POST", { ...values, fileIds }),
      );
    },
    onSuccess: () => {
      message.success(renewing ? "换证记录已建立，旧证已保留" : "证照已保存");
      setOpen(false);
      setEditing(undefined);
      setRenewing(undefined);
      form.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const addType = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api(
        "/api/certificate-types",
        json("POST", {
          ...values,
          subtype1Options: String(values.subtype1Options ?? "")
            .split(/[，,]/)
            .map((v) => v.trim())
            .filter(Boolean),
          subtype2Options: String(values.subtype2Options ?? "")
            .split(/[，,]/)
            .map((v) => v.trim())
            .filter(Boolean),
          active: true,
        }),
      ),
    onSuccess: () => {
      message.success("证照类型已新增");
      typeForm.resetFields();
      void qc.invalidateQueries({ queryKey: ["certificate-types"] });
    },
    onError: (error) => message.error(error.message),
  });
  const importPreview = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    try {
      const data = await api<{
        rows: Array<Record<string, unknown>>;
        summary: { ready: number; conflict: number; invalid: number };
        errors: string[];
      }>("/api/certificates/import/preview", { method: "POST", body });
      setPreviewRows(data.rows);
      if (data.errors.length) message.error(data.errors.join("；"));
      else
        message.success(
          `预检查完成：${data.summary.ready} 条可导入，${data.summary.conflict ?? 0} 条冲突，${data.summary.invalid} 条无效`,
        );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "预检查失败");
    }
    return false;
  };
  const confirmImport = async () => {
    try {
      const data = await api<{
        summary: { success: number; failed: number; skipped: number };
      }>(
        "/api/certificates/import/confirm",
        json("POST", { rows: previewRows }),
      );
      message.success(
        `导入完成：成功 ${data.summary.success}，失败 ${data.summary.failed}，跳过 ${data.summary.skipped}`,
      );
      setImportOpen(false);
      setPreviewRows([]);
      refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入失败");
    }
  };
  const initializeTraining = () =>
    Modal.confirm({
      title: "按规则初始化培训状态？",
      content: "不会覆盖已培训状态。",
      onOk: async () => {
        const result = await api<{ updated: number }>(
          "/api/person-certificates/training-status/initialize",
          { method: "POST" },
        );
        message.success(`已更新 ${result.updated} 条个人证照`);
        refresh();
      },
    });
  const cleanupDuplicates = async () => {
    const preview = await api<{
      groups: Array<{
        category: "company" | "personal";
        keepId: string;
        duplicateIds: string[];
        name: string;
      }>;
      duplicateCount: number;
    }>("/api/certificates/duplicates");
    if (!preview.duplicateCount) {
      message.success("未发现完全重复记录");
      return;
    }
    let correctionReason = "";
    Modal.confirm({
      title: `发现 ${preview.duplicateCount} 条完全重复记录`,
      content: <Space direction="vertical" style={{ width: "100%" }}><div>将保留最早记录，其余作废并保留历史，不物理删除。</div><Input placeholder="请输入更正原因（必填）" onChange={(event) => { correctionReason = event.target.value; }} /></Space>,
      onOk: async () => {
        if (correctionReason.trim().length < 2) throw new Error("请输入至少 2 个字的更正原因");
        await api(
          "/api/certificates/duplicates/cleanup",
          json("POST", { groups: preview.groups, reason: correctionReason.trim() }),
        );
        message.success("重复记录已处理");
        refresh();
      },
    });
  };
  const bulkTraining = () => {
    let status = "pending";
    let reason = "";
    Modal.confirm({
      title: `调整 ${selectedIds.length} 条个人证照的本年度培训状态`,
      content: (
        <Space direction="vertical" style={{ width: "100%", marginTop: 12 }}>
          <Select
            defaultValue="pending"
            style={{ width: "100%" }}
            options={[
              { value: "pending", label: "待培训" },
              { value: "trained", label: "已培训" },
              { value: "not_required", label: "无需培训" },
            ]}
            onChange={(value) => {
              status = value;
            }}
          />
          <Input
            placeholder="设置无需培训时必须填写原因"
            onChange={(event) => {
              reason = event.target.value;
            }}
          />
        </Space>
      ),
      onOk: async () => {
        await api(
          "/api/person-certificates/training-status",
          json("POST", {
            ids: selectedIds,
            status,
            reason: reason || undefined,
          }),
        );
        setSelectedIds([]);
        message.success("本年度培训状态已更新");
        refresh();
      },
    });
  };
  const expiry = (state: Certificate["expiryState"]) => (
    <Tag
      color={
        state === "expired"
          ? "red"
          : state === "expiring"
            ? "orange"
            : state === "valid"
              ? "green"
              : "default"
      }
    >
      {
        {
          expired: "已到期",
          expiring: "即将到期",
          valid: "有效",
          long_term: "长期",
        }[state]
      }
    </Tag>
  );
  const training = (value?: Certificate["trainingStatus"]) =>
    value ? (
      <Tag
        color={
          value === "trained"
            ? "green"
            : value === "pending"
              ? "orange"
              : "default"
        }
      >
        {
          { trained: "已培训", pending: "待培训", not_required: "无需培训" }[
            value
          ]
        }
      </Tag>
    ) : (
      "—"
    );
  const columns = [
    { title: "所属组织", dataIndex: "organizationName" },
    ...(category !== "company"
      ? [
          {
            title: "持证人",
            dataIndex: "holderName",
            render: (v: string) => v || "—",
          },
        ]
      : []),
    {
      title: "证照类型",
      render: (_: unknown, row: Certificate) => (
        <Tag color="blue">{row.type?.name ?? row.category}</Tag>
      ),
    },
    { title: "证照名称", dataIndex: "name" },
    {
      title: "子分类",
      render: (_: unknown, row: Certificate) =>
        [row.subtype1Value, row.subtype2Value].filter(Boolean).join(" / ") ||
        "—",
    },
    { title: "有效期至", dataIndex: "expiresAt", render: dateText },
    {
      title: "到期状态",
      render: (_: unknown, row: Certificate) => expiry(row.expiryState),
    },
    ...(category !== "company"
      ? [{ title: "当年培训", dataIndex: "trainingStatus", render: training }]
      : []),
    {
      title: "操作",
      fixed: "right" as const,
      render: (_: unknown, row: Certificate) => (
        <Space>
          <Button size="small" onClick={() => setDetail(row)}>
            详情
          </Button>
          {canWrite && row.status === "active" ? (
            <>
              <Button size="small" onClick={() => openForm(row)}>
                编辑
              </Button>
              <Button size="small" onClick={() => openForm(row, true)}>
                换证
              </Button>
              <Button
                danger
                size="small"
                onClick={() =>
                  Modal.confirm({
                    title: `注销“${row.name}”？`,
                    content: "历史记录会保留，不会物理删除。",
                    onOk: async () => {
                      await api(
                        `/api/certificates/${row.category}/${row.id}/revoke`,
                        { method: "PATCH" },
                      );
                      refresh();
                    },
                  })
                }
              >
                注销
              </Button>
              <Button
                danger
                size="small"
                onClick={() => {
                  let reason = "";
                  Modal.confirm({
                    title: `作废“${row.name}”？`,
                    content: (
                      <Input.TextArea
                        autoFocus
                        rows={3}
                        placeholder="请输入作废原因"
                        onChange={(event) => {
                          reason = event.target.value;
                        }}
                      />
                    ),
                    onOk: async () => {
                      await api(
                        `/api/certificates/${row.category}/${row.id}/void`,
                        json("POST", { reason }),
                      );
                      message.success("证照已作废并保留历史");
                      refresh();
                    },
                  });
                }}
              >
                作废
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];
  return (
    <div className="admin-workspace qualification-ledger-page">
      <Space className="page-title" wrap>
        <Typography.Title level={3}>资质证照台账</Typography.Title>
        {canWrite && (
          <>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "import",
                    label: "批量导入",
                    onClick: () => setImportOpen(true),
                  },
                  {
                    key: "duplicates",
                    label: "去重清理",
                    onClick: () => void cleanupDuplicates(),
                  },
                  {
                    key: "bulk",
                    label: `批量调整培训状态${selectedIds.length ? `（${selectedIds.length}）` : ""}`,
                    disabled: !selectedIds.length,
                    onClick: bulkTraining,
                  },
                  {
                    key: "initialize",
                    label: "按规则初始化培训状态",
                    onClick: initializeTraining,
                  },
                  { type: "divider" },
                  {
                    key: "types",
                    label: "类型字典",
                    onClick: () => setTypeOpen(true),
                  },
                  {
                    key: "settings",
                    label: "到期预警设置",
                    onClick: () => setSettingsOpen(true),
                  },
                ],
              }}
            >
              <Button>工具 ▾</Button>
            </Dropdown>
            <Button href="/api/certificates.csv">导出 CSV</Button>
            <Button type="primary" onClick={() => openForm()}>
              新增证照
            </Button>
          </>
        )}
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="证照总数"
              value={ledger.data?.summary.total ?? 0}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={`未来 ${ledger.data?.warnDays ?? 90} 天到期`}
              value={ledger.data?.summary.expiring ?? 0}
              valueStyle={{ color: "#d97706" }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="已到期"
              value={ledger.data?.summary.expired ?? 0}
              valueStyle={{ color: "#dc2626" }}
            />
          </Card>
        </Col>
      </Row>
      <Card>
        <Tabs
          activeKey={category}
          onChange={(key) => {
            setCategory(key as typeof category);
            setSelectedIds([]);
          }}
          items={[
            { key: "all", label: "全部" },
            { key: "company", label: "公司证照" },
            { key: "personal", label: "个人证照" },
          ]}
        />
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="所属组织"
            style={{ width: 200 }}
            options={(organizations.data ?? []).map((row) => ({
              value: row.id,
              label: row.name,
            }))}
            onChange={(value) =>
              setFilters({ ...filters, organizationId: value ?? "" })
            }
          />
          <Select
            allowClear
            placeholder="证照类型"
            style={{ width: 220 }}
            options={(types.data ?? [])
              .filter((row) => category === "all" || row.category === category)
              .map((row) => ({ value: row.id, label: row.name }))}
            onChange={(value) =>
              setFilters({ ...filters, typeId: value ?? "" })
            }
          />
          <Select
            allowClear
            placeholder="记录状态"
            style={{ width: 140 }}
            options={[
              { value: "active", label: "有效记录" },
              { value: "replaced", label: "已换证" },
              { value: "revoked", label: "已注销" },
            ]}
            onChange={(value) =>
              setFilters({ ...filters, status: value ?? "" })
            }
          />
          <Input.Search
            allowClear
            placeholder="名称、编号、持证人或子分类"
            style={{ width: 280 }}
            onSearch={(value) => setFilters({ ...filters, keyword: value })}
          />
        </Space>
        <Table
          rowKey={(row) => row.id}
          {...(canWrite
            ? {
                rowSelection: {
                  selectedRowKeys: selectedIds,
                  onChange: setSelectedIds,
                  getCheckboxProps: (row: Certificate) => ({
                    disabled: row.category !== "personal",
                  }),
                },
              }
            : {})}
          loading={ledger.isLoading}
          dataSource={ledger.data?.rows ?? []}
          pagination={false}
          scroll={{ x: 1100 }}
          columns={columns}
        />
      </Card>
      <Modal
        title={renewing ? "办理换证" : editing ? "编辑证照" : "新增证照"}
        open={open}
        footer={null}
        width={760}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="category"
                label="大类"
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!editing || !!renewing}
                  options={[
                    { value: "company", label: "公司证照" },
                    { value: "personal", label: "个人证照" },
                  ]}
                  onChange={() => {
                    form.setFieldValue("ownerId", undefined);
                    form.setFieldValue("typeId", undefined);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="ownerId"
                label={selectedCategory === "company" ? "所属组织" : "持证人"}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  disabled={!!renewing}
                  options={(selectedCategory === "company"
                    ? (organizations.data ?? [])
                    : (people.data ?? [])
                  ).map((row) => ({ value: row.id, label: row.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="typeId"
                label="证照类型"
                rules={[{ required: true }]}
              >
                <Select
                  options={categoryTypes.map((row) => ({
                    value: row.id,
                    label: row.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label="证照名称"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            {selectedType?.subtype1Label && (
              <Col span={12}>
                <Form.Item
                  name="subtype1Value"
                  label={selectedType.subtype1Label}
                  rules={[{ required: true }]}
                >
                  <Select
                    options={selectedType.subtype1Options.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
              </Col>
            )}
            {selectedType?.subtype2Label && (
              <Col span={12}>
                <Form.Item
                  name="subtype2Value"
                  label={selectedType.subtype2Label}
                  rules={[{ required: true }]}
                >
                  <Select
                    options={selectedType.subtype2Options.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
              </Col>
            )}
            <Col span={12}>
              <Form.Item name="certificateNo" label="证照编号">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="issuingAuthority" label="发证机关">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="issuedAt" label="发证日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="validFrom" label="有效期开始">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="expiresAt" label="有效期至">
                <Input
                  type="date"
                  disabled={Form.useWatch("isLongTerm", form)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isLongTerm" valuePropName="checked">
                <Checkbox>长期有效</Checkbox>
              </Form.Item>
            </Col>
            {selectedCategory === "personal" && (
              <>
                <Col span={12}>
                  <Form.Item name="holderPosition" label="持证岗位">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="trainingStatus" label="当年培训状态">
                    <Select
                      allowClear
                      options={[
                        { value: "pending", label: "待培训" },
                        { value: "trained", label: "已培训" },
                        { value: "not_required", label: "无需培训" },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </>
            )}
            {selectedCategory === "company" && (
              <Col span={24}>
                <Form.Item name="scope" label="许可范围">
                  <Input.TextArea rows={2} />
                </Form.Item>
              </Col>
            )}
            <Col span={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="附件（PDF/PNG/JPG/WebP，单个不超过 10MB）">
            <Upload
              multiple
              beforeUpload={(file) => {
                setFiles((current) => [...current, file]);
                return false;
              }}
              onRemove={(file) => {
                setFiles((current) =>
                  current.filter((item) => item.uid !== file.uid),
                );
              }}
              fileList={files}
            >
              {files.length < 20 && <Button>选择附件</Button>}
            </Upload>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            {renewing ? "确认换证" : "保存"}
          </Button>
        </Form>
      </Modal>
      <Modal
        title="证照详情"
        open={!!detail}
        onCancel={() => setDetail(undefined)}
        footer={null}
        width={760}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                {
                  key: "category",
                  label: "大类",
                  children:
                    detail.category === "company" ? "公司证照" : "个人证照",
                },
                {
                  key: "owner",
                  label: detail.category === "company" ? "所属组织" : "持证人",
                  children: detail.ownerName,
                },
                {
                  key: "type",
                  label: "证照类型",
                  children: detail.type?.name ?? "—",
                },
                { key: "name", label: "证照名称", children: detail.name },
                {
                  key: "no",
                  label: "证照编号",
                  children: detail.certificateNo || "—",
                },
                {
                  key: "issuer",
                  label: "发证机关",
                  children: detail.issuingAuthority || "—",
                },
                {
                  key: "valid",
                  label: "有效期",
                  children: detail.isLongTerm
                    ? "长期"
                    : `${detail.validFrom ?? "—"} 至 ${detail.expiresAt ?? "—"}`,
                },
                {
                  key: "status",
                  label: "到期状态",
                  children: expiry(detail.expiryState),
                },
                ...(detail.category === "personal"
                  ? [
                      {
                        key: "training",
                        label: "当年培训",
                        children: training(detail.trainingStatus),
                      },
                    ]
                  : []),
                {
                  key: "remark",
                  label: "备注",
                  children: detail.remark || "—",
                  span: 2,
                },
              ]}
            />
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              附件
            </Typography.Title>
            <Space wrap>
              {detail.attachments.length
                ? detail.attachments.map((item) => (
                    <Button
                      key={item.id}
                      href={`/api/files/${item.file.id}`}
                      target="_blank"
                    >
                      {item.file.originalName}
                    </Button>
                  ))
                : "暂无附件"}
            </Space>
            {detail.category === "personal" && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>
                  历年培训记录
                </Typography.Title>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={detail.trainingRecords ?? []}
                  columns={[
                    { title: "年度", dataIndex: "year" },
                    {
                      title: "日期",
                      dataIndex: "trainingDate",
                      render: dateText,
                    },
                    { title: "内容", dataIndex: "content" },
                    { title: "机构", dataIndex: "trainingOrganization" },
                    { title: "学时", dataIndex: "hours" },
                    { title: "结果", dataIndex: "result" },
                    {
                      title: "状态",
                      dataIndex: "status",
                      render: (value: string) =>
                        value === "voided" ? "已作废" : "有效",
                    },
                    ...(canWrite
                      ? [
                          {
                            title: "操作",
                            render: (
                              _: unknown,
                              record: NonNullable<
                                Certificate["trainingRecords"]
                              >[number],
                            ) =>
                              record.status === "voided" ? null : (
                                <Space>
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      let reason = "";
                                      Modal.confirm({
                                        title: "更正年度培训记录",
                                        content: (
                                          <Input
                                            placeholder="请输入更正原因"
                                            onChange={(event) => {
                                              reason = event.target.value;
                                            }}
                                          />
                                        ),
                                        onOk: async () => {
                                          await api(
                                            `/api/certificate-training-records/${record.id}`,
                                            json("PATCH", {
                                              year: record.year,
                                              trainingDate:
                                                record.trainingDate.slice(
                                                  0,
                                                  10,
                                                ),
                                              content: record.content,
                                              trainingOrganization:
                                                record.trainingOrganization,
                                              hours: record.hours,
                                              result: record.result,
                                              correctionReason: reason,
                                            }),
                                          );
                                          message.success(
                                            "已建立更正记录，原记录保留为作废",
                                          );
                                          setDetail(undefined);
                                          refresh();
                                        },
                                      });
                                    }}
                                  >
                                    更正
                                  </Button>
                                  <Button
                                    danger
                                    size="small"
                                    onClick={() => {
                                      let reason = "";
                                      Modal.confirm({
                                        title: "作废年度培训记录",
                                        content: (
                                          <Input
                                            placeholder="请输入作废原因"
                                            onChange={(event) => {
                                              reason = event.target.value;
                                            }}
                                          />
                                        ),
                                        onOk: async () => {
                                          await api(
                                            `/api/certificate-training-records/${record.id}/void`,
                                            json("POST", { reason }),
                                          );
                                          message.success(
                                            "记录已作废，历史仍保留",
                                          );
                                          setDetail(undefined);
                                          refresh();
                                        },
                                      });
                                    }}
                                  >
                                    作废
                                  </Button>
                                </Space>
                              ),
                          },
                        ]
                      : []),
                  ]}
                />
                {canWrite && (
                  <Form
                    form={trainingForm}
                    layout="inline"
                    style={{ marginTop: 12 }}
                    onFinish={async (values) => {
                      await api(
                        `/api/person-certificates/${detail.id}/training-records`,
                        json("POST", values),
                      );
                      message.success("培训记录已保存");
                      trainingForm.resetFields();
                      setDetail(undefined);
                      refresh();
                    }}
                  >
                    <Form.Item name="year" rules={[{ required: true }]}>
                      <InputNumber placeholder="年度" min={2000} max={9999} />
                    </Form.Item>
                    <Form.Item name="trainingDate" rules={[{ required: true }]}>
                      <Input type="date" />
                    </Form.Item>
                    <Form.Item name="content" rules={[{ required: true }]}>
                      <Input placeholder="培训内容" />
                    </Form.Item>
                    <Button htmlType="submit">新增记录</Button>
                  </Form>
                )}
              </>
            )}
          </>
        )}
      </Modal>
      <Modal
        title="证照类型字典"
        open={typeOpen}
        onCancel={() => setTypeOpen(false)}
        footer={null}
        width={960}
      >
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={types.data ?? []}
          columns={[
            {
              title: "大类",
              dataIndex: "category",
              render: (v: string) => (v === "company" ? "公司" : "个人"),
            },
            { title: "类型", dataIndex: "name" },
            {
              title: "子分类1",
              render: (_: unknown, row: CertificateType) =>
                row.subtype1Label
                  ? `${row.subtype1Label}：${row.subtype1Options.join("/")}`
                  : "—",
            },
            {
              title: "子分类2",
              render: (_: unknown, row: CertificateType) =>
                row.subtype2Label
                  ? `${row.subtype2Label}：${row.subtype2Options.join("/")}`
                  : "—",
            },
            {
              title: "年度培训",
              dataIndex: "requiresAnnualTraining",
              render: (v: boolean) => (v ? "需要" : "无需"),
            },
            {
              title: "状态",
              dataIndex: "active",
              render: (v: boolean) => (v ? "启用" : "停用"),
            },
            {
              title: "操作",
              render: (_: unknown, row: CertificateType) => (
                <Button
                  size="small"
                  onClick={async () => {
                    await api(
                      `/api/certificate-types/${row.id}`,
                      json("PATCH", { active: !row.active }),
                    );
                    void qc.invalidateQueries({
                      queryKey: ["certificate-types"],
                    });
                  }}
                >
                  {row.active ? "停用" : "启用"}
                </Button>
              ),
            },
          ]}
        />
        <Form
          form={typeForm}
          layout="inline"
          style={{ marginTop: 16 }}
          onFinish={(values) => addType.mutate(values)}
        >
          <Form.Item name="category" rules={[{ required: true }]}>
            <Select
              placeholder="大类"
              style={{ width: 110 }}
              options={[
                { value: "company", label: "公司" },
                { value: "personal", label: "个人" },
              ]}
            />
          </Form.Item>
          <Form.Item name="name" rules={[{ required: true }]}>
            <Input placeholder="类型名称" />
          </Form.Item>
          <Form.Item name="subtype1Label">
            <Input placeholder="子分类1名称" />
          </Form.Item>
          <Form.Item name="subtype1Options">
            <Input placeholder="选项，逗号分隔" />
          </Form.Item>
          <Form.Item
            name="requiresAnnualTraining"
            valuePropName="checked"
            initialValue={false}
          >
            <Checkbox>需要年度培训</Checkbox>
          </Form.Item>
          <Button htmlType="submit">新增</Button>
        </Form>
      </Modal>
      <Modal
        title="到期预警设置"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
      >
        <Form
          initialValues={{ warnDays: settings.data?.warnDays ?? 90 }}
          onFinish={async (values) => {
            await api("/api/certificate-settings", json("PATCH", values));
            message.success("预警设置已保存");
            setSettingsOpen(false);
            void qc.invalidateQueries({ queryKey: ["certificate-settings"] });
            refresh();
          }}
        >
          <Form.Item
            name="warnDays"
            label="提前预警天数"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={365} />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            保存
          </Button>
        </Form>
      </Modal>
      <Modal
        title="批量导入证照"
        open={importOpen}
        onCancel={() => {
          setImportOpen(false);
          setPreviewRows([]);
        }}
        width={900}
        onOk={() => void confirmImport()}
        okText="确认导入可用记录"
        okButtonProps={{
          disabled: !previewRows.some((row) => row.status === "ready" || (row.status === "conflict" && row.conflictAction)) || previewRows.some((row) => row.status === "conflict" && !row.conflictAction),
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="先下载模板，填写后上传 XLSX。系统先预检查，不会直接写入。"
          />
          <Button href="/api/certificates/import-template.xlsx">
            下载 XLSX 模板
          </Button>
          <Upload
            accept=".xlsx"
            maxCount={1}
            beforeUpload={(file) => {
              void importPreview(file);
              return false;
            }}
            showUploadList={false}
          >
            <Button>选择 XLSX 并预检查</Button>
          </Upload>
          {previewRows.length > 0 && (
            <Table
              size="small"
              rowKey="rowNumber"
              pagination={{ pageSize: 10 }}
              dataSource={previewRows}
              columns={[
                { title: "Excel 行", dataIndex: "rowNumber" },
                {
                  title: "大类",
                  dataIndex: "category",
                  render: (v: string) =>
                    v === "company" ? "公司" : v === "personal" ? "个人" : "—",
                },
                { title: "归属", dataIndex: "ownerName" },
                { title: "类型", dataIndex: "typeName" },
                { title: "名称", dataIndex: "name" },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (v: string) => (
                    <Tag color={v === "ready" ? "green" : v === "conflict" ? "orange" : "red"}>
                      {v === "ready" ? "可导入" : v === "conflict" ? "冲突待选择" : "无效"}
                    </Tag>
                  ),
                },
                {
                  title: "冲突处理",
                  dataIndex: "conflictAction",
                  render: (value: string, row: Record<string, unknown>) => row.status !== "conflict" ? "—" : <Select style={{ width: 150 }} value={value} placeholder="必须选择" options={[{ value: "skip", label: "跳过" }, { value: "renew", label: "换证" }, { value: "void_and_create", label: "作废后新建" }]} onChange={(next) => setPreviewRows((current) => current.map((item) => item.rowNumber === row.rowNumber ? { ...item, conflictAction: next } : item))} />,
                },
                {
                  title: "原因",
                  dataIndex: "reasons",
                  render: (v: string[]) => v?.join("；") || "—",
                },
              ]}
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}

export function MonthlyReportsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [typeForm] = Form.useForm();
  const [fieldForm] = Form.useForm();
  const today = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(today);
  const [allMonths, setAllMonths] = useState(false);
  const [view, setView] = useState("mine");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MonthlyReport>();
  const [detail, setDetail] = useState<MonthlyReport>();
  const [history, setHistory] = useState<MonthlyReport[]>([]);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [noFieldOrg, setNoFieldOrg] = useState<string>();
  const [reportFiles, setReportFiles] = useState<UploadFile[]>([]);
  const capabilities = useQuery({
    queryKey: ["monthly-report-capabilities"],
    queryFn: () =>
      api<{
        canConfigure: boolean;
        canReview: boolean;
        canSubmit: boolean;
        organizationIds: string[];
      }>("/api/monthly-reports/capabilities"),
  });
  const config = useQuery({
    queryKey: ["report-config"],
    queryFn: () => api<ReportConfig>("/api/report-config"),
  });
  const projects = useQuery({
    queryKey: ["monthly-report-projects", month],
    queryFn: () =>
      api<Array<Project & { responsibleOrganization: Organization }>>(
        `/api/monthly-reports/projects?month=${month}`,
      ),
  });
  const [year, number] = month.split("-");
  const reports = useQuery({
    queryKey: ["monthly-reports", month, allMonths, keyword],
    queryFn: () =>
      api<MonthlyReport[]>(
        `/api/monthly-reports?year=${year}${allMonths ? "" : `&month=${Number(number)}`}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""}`,
      ),
  });
  const completed = useQuery({
    queryKey: ["monthly-reports-completed", year],
    queryFn: () =>
      api<MonthlyReport[]>(
        `/api/monthly-reports?year=${year}&projectStatus=completed`,
      ),
  });
  const summary = useQuery({
    queryKey: ["monthly-report-summary", month],
    queryFn: () =>
      api<{
        stats: {
          departmentTotal: number;
          submittedDepartments: number;
          noFieldDepartments: number;
          missingDepartments: number;
          projectCount: number;
          onsitePeople: number;
          onsiteVehicles: number;
          hazardProjects: number;
          inspectionRate: number;
        };
        departments: Array<{
          id: string;
          name: string;
          status: "draft" | "submitted" | "rejected" | "confirmed" | "locked" | "missing";
          reportType: "projects" | "no_projects";
          returnReason?: string | null;
          submissionId?: string | null;
          reportCount: number;
          latestSubmittedAt?: string;
        }>;
        reports: MonthlyReport[];
        period?: { status: "closed" | "open" | "review" | "locked"; deadlineAt?: string | null } | null;
      }>(`/api/monthly-reports/summary?month=${month}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["monthly-reports"] });
    void qc.invalidateQueries({ queryKey: ["monthly-report-summary"] });
    void qc.invalidateQueries({ queryKey: ["monthly-report-projects"] });
  };
  const openForm = (row?: MonthlyReport) => {
    setEditing(row);
    setReportFiles([]);
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            ...row,
            reportMonth: row.reportMonth.slice(0, 7),
            customData: row.customData,
          }
        : {
            reportMonth: month,
            onsiteCount: 0,
            onsiteVehicles: 0,
            safetyInspection: false,
            safetyHazards: false,
            safetyInvestment: 0,
            incidentCount: 0,
            contractAmount: 0,
            projectStatus: "active",
            customData: {},
          },
    );
    setOpen(true);
  };
  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const fileIds: string[] = [];
      if (!editing) {
        for (const file of reportFiles) {
          if (!file.originFileObj) continue;
          const body = new FormData();
          body.append("file", file.originFileObj);
          const uploaded = await api<{ id: string }>(
            "/api/files?kind=attachment",
            { method: "POST", body },
          );
          fileIds.push(uploaded.id);
        }
      }
      return api(
        editing ? `/api/monthly-reports/${editing.id}` : "/api/monthly-reports",
        json(
          editing ? "PATCH" : "POST",
          editing
            ? { ...values, reason: "撤回后更正并重新提交" }
            : { ...values, fileIds },
        ),
      );
    },
    onSuccess: () => {
      message.success("项目月报草稿已保存；请完成本实体全部项目后统一提交");
      setOpen(false);
      setEditing(undefined);
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const showHistory = async (projectId: string) => {
    try {
      setHistory(
        await api<MonthlyReport[]>(
          `/api/monthly-reports/projects/${projectId}/history`,
        ),
      );
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const reasonedAction = (row: MonthlyReport, action: "withdraw" | "void") => {
    let reason = "";
    Modal.confirm({
      title:
        action === "withdraw" ? "撤回月报后修改？" : "作废月报并永久保留历史？",
      content: (
        <Input.TextArea
          autoFocus
          rows={3}
          placeholder="请填写原因"
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      onOk: async () => {
        await api(
          `/api/monthly-reports/${row.id}/${action}`,
          json("POST", { reason }),
        );
        message.success(action === "withdraw" ? "月报已撤回" : "月报已作废");
        refresh();
      },
    });
  };
  const reportColumns = [
    {
      title: "月份",
      dataIndex: "reportMonth",
      render: (v: string) => v.slice(0, 7),
    },
    {
      title: "经营实体",
      render: (_: unknown, row: MonthlyReport) => (
        <Tag color="blue">{row.reportingOrganization.name}</Tag>
      ),
    },
    {
      title: "项目",
      render: (_: unknown, row: MonthlyReport) => (
        <Button type="link" onClick={() => setDetail(row)}>
          {row.project.name}
        </Button>
      ),
    },
    {
      title: "状态",
      render: (_: unknown, row: MonthlyReport) => (
        <Tag
          color={
            row.status === "submitted"
              ? "green"
              : row.status === "draft"
                ? "blue"
              : row.status === "withdrawn"
                ? "orange"
                : "default"
          }
        >
          {
            { draft: "草稿", submitted: "已提交", withdrawn: "已撤回", voided: "已作废" }[
              row.status
            ]
          }{" "}
          · v{row.revision}
        </Tag>
      ),
    },
    { title: "施工地点", dataIndex: "constructionLocation" },
    {
      title: "负责人/联系方式",
      render: (_: unknown, row: MonthlyReport) =>
        [row.projectManager, row.contactInfo].filter(Boolean).join(" / "),
    },
    {
      title: "现场人数/车辆",
      render: (_: unknown, row: MonthlyReport) =>
        `${row.onsiteCount} / ${row.onsiteVehicles}`,
    },
    {
      title: "安全自检",
      dataIndex: "safetyInspection",
      render: (v: boolean) => (
        <Tag color={v ? "green" : "red"}>{v ? "是" : "否"}</Tag>
      ),
    },
    {
      title: "安全隐患",
      dataIndex: "safetyHazards",
      render: (v: boolean) => (
        <Tag color={v ? "red" : "green"}>{v ? "有" : "无"}</Tag>
      ),
    },
    ...(capabilities.data?.canSubmit
      ? [
          {
            title: "操作",
            render: (_: unknown, row: MonthlyReport) => (
              <Space wrap>
                {["draft", "withdrawn"].includes(row.status) && (
                  <>
                    <Button size="small" onClick={() => openForm(row)}>
                      编辑
                    </Button>
                  </>
                )}
                <Button
                  size="small"
                  onClick={() => void showHistory(row.project.id)}
                >
                  历史
                </Button>
                {capabilities.data?.canReview && row.status !== "voided" && (
                  <Button
                    danger
                    size="small"
                    onClick={() => reasonedAction(row, "void")}
                  >
                    作废
                  </Button>
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];
  const completedRows = useMemo(() => {
    const latest = new Map<string, MonthlyReport>();
    for (const row of completed.data ?? [])
      if (!latest.has(row.projectId)) latest.set(row.projectId, row);
    return [...latest.values()];
  }, [completed.data]);
  const stats = summary.data?.stats;
  const statCards = [
    ["部门总数", stats?.departmentTotal],
    ["已报送部门", stats?.submittedDepartments],
    ["已确认无野外", stats?.noFieldDepartments],
    ["未报送部门", stats?.missingDepartments],
    ["报送项目总数", stats?.projectCount],
    ["现场总人数", stats?.onsitePeople],
    ["现场总车辆数", stats?.onsiteVehicles],
    ["安全隐患项目", stats?.hazardProjects],
    ["安全自检率", `${stats?.inspectionRate ?? 0}%`],
  ];
  const customFields = (config.data?.fields ?? []).filter(
    (field) => field.active && !field.builtin,
  );
  const noFieldOrganizationId =
    noFieldOrg ?? capabilities.data?.organizationIds[0];
  const manage = (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          style={{ width: 160 }}
        />
        <Button
          onClick={() => {
            void summary.refetch();
            void reports.refetch();
          }}
        >
          刷新
        </Button>
        {capabilities.data?.canReview && (
          <Button href={`/api/monthly-reports.xlsx?month=${month}`}>
            导出集团月报 Excel
          </Button>
        )}
        {capabilities.data?.canConfigure && (
          <>
            <Select
              style={{ width: 150 }}
              value={summary.data?.period?.status ?? "closed"}
              options={[
                { value: "closed", label: "未开放" },
                { value: "open", label: "开放填报" },
                { value: "review", label: "复核中" },
                { value: "locked", label: "已锁定" },
              ]}
              onChange={async (status) => {
                try {
                  await api(`/api/reporting-periods/${month}`, json("PUT", { status }));
                  message.success("月份状态已更新");
                  refresh();
                } catch (error) {
                  message.error((error as Error).message);
                }
              }}
            />
          </>
        )}
      </Space>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {statCards.map(([label, value]) => (
          <Col xs={12} md={8} lg={6} xl={4} key={String(label)}>
            <Card size="small">
              <Statistic title={label} value={value ?? 0} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card title="部门报送状态" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button
            size="small"
            type={statusFilter === "all" ? "primary" : "default"}
            onClick={() => setStatusFilter("all")}
          >
            全部
          </Button>
          {[...["draft", "submitted", "rejected", "confirmed", "locked", "missing"]].map((status) => (
            <Button
              key={status}
              size="small"
              type={statusFilter === status ? "primary" : "default"}
              onClick={() => setStatusFilter(status)}
            >
              {
                (
                  {
                    draft: "草稿中",
                    submitted: "待复核",
                    rejected: "已退回",
                    confirmed: "已确认",
                    locked: "已锁定",
                    missing: "未报送",
                  } as Record<string, string>
                )[status]
              }
            </Button>
          ))}
        </Space>
        <div style={{ marginTop: 12 }}>
          <Space wrap>
            {(summary.data?.departments ?? [])
              .filter(
                (row) => statusFilter === "all" || row.status === statusFilter,
              )
              .map((row) => (
                <Tag
                  key={row.id}
                  color={
                    row.status === "confirmed" || row.status === "locked"
                      ? "green"
                      : row.status === "submitted"
                        ? "blue"
                        : row.status === "rejected" || row.status === "missing"
                          ? "red"
                          : "orange"
                  }
                >
                  {row.name} ·{" "}
                  {{ draft: "草稿中", submitted: "待复核", rejected: "已退回", confirmed: "已确认", locked: "已锁定", missing: "未报送" }[row.status]}
                  {row.reportType === "no_projects" ? " · 无在建项目" : ` · ${row.reportCount} 个项目`}
                  {row.returnReason ? ` · ${row.returnReason}` : ""}
                  {capabilities.data?.canReview && row.status === "submitted" && row.submissionId && (
                    <Space size={4} style={{ marginLeft: 8 }}>
                      <Button size="small" type="link" onClick={async () => {
                        await api(`/api/monthly-reports/submissions/${row.submissionId}/review`, json("POST", { action: "confirm" }));
                        message.success("已确认"); refresh();
                      }}>确认</Button>
                      <Button size="small" danger type="link" onClick={() => {
                        let reason = "";
                        Modal.confirm({ title: `退回 ${row.name} 的月报？`, content: <Input.TextArea rows={3} placeholder="填写退回原因" onChange={(event) => { reason = event.target.value; }} />, onOk: async () => {
                          await api(`/api/monthly-reports/submissions/${row.submissionId}/review`, json("POST", { action: "reject", reason }));
                          message.success("已退回"); refresh();
                        } });
                      }}>退回</Button>
                    </Space>
                  )}
                </Tag>
              ))}
          </Space>
        </div>
      </Card>
      <Card title={`${month} 报送汇总`}>
        <Table
          rowKey="id"
          dataSource={summary.data?.reports ?? []}
          pagination={false}
          scroll={{ x: 1350 }}
          columns={reportColumns}
        />
      </Card>
    </>
  );
  const own = (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          type="month"
          value={month}
          disabled={allMonths}
          onChange={(event) => setMonth(event.target.value)}
          style={{ width: 160 }}
        />
        <Checkbox
          checked={allMonths}
          onChange={(event) => setAllMonths(event.target.checked)}
        >
          查看全年全部月份
        </Checkbox>
        <Input.Search
          placeholder="项目名称、类型或地点"
          allowClear
          onSearch={setKeyword}
          style={{ width: 260 }}
        />
        {capabilities.data?.canSubmit && (
          <Button type="primary" onClick={() => openForm()}>
            新建项目报送
          </Button>
        )}
      </Space>
      {!allMonths && capabilities.data?.canSubmit && noFieldOrganizationId && (
        <Alert
          showIcon
          type={summary.data?.period?.status === "open" || summary.data?.period?.status === "review" ? "info" : "warning"}
          style={{ marginBottom: 16 }}
          message={`${month} 部门统一提交`}
          description={
            <Space wrap>
              <Select
                value={noFieldOrganizationId}
                onChange={setNoFieldOrg}
                style={{ width: 200 }}
                options={(config.data?.organizations ?? [])
                  .filter((org) =>
                    capabilities.data?.organizationIds.includes(org.id),
                  )
                  .map((org) => ({ value: org.id, label: org.name }))}
              />
              <Button
                type="primary"
                onClick={() =>
                  Modal.confirm({
                    title: `提交 ${month} 全部项目月报？`,
                    onOk: async () => {
                      try {
                        await api(
                          "/api/monthly-reports/submissions",
                          json("POST", {
                            organizationId: noFieldOrganizationId,
                            month,
                            reportType: "projects",
                          }),
                        );
                        message.success("已统一提交，等待复核");
                        refresh();
                      } catch (error) {
                        message.error((error as Error).message);
                      }
                    },
                  })
                }
              >
                提交本实体全部项目月报
              </Button>
              <Button
                onClick={() =>
                  Modal.confirm({
                    title: `确认 ${month} 无在建或暂停项目？`,
                    onOk: async () => {
                      try {
                        await api(
                          "/api/monthly-reports/submissions",
                          json("POST", {
                          organizationId: noFieldOrganizationId,
                          month,
                            reportType: "no_projects",
                          }),
                        );
                        message.success("无项目月报已提交，等待复核");
                        refresh();
                      } catch (error) {
                        message.error((error as Error).message);
                      }
                    },
                  })
                }
              >
                本月无在建项目
              </Button>
              <Typography.Text type="secondary">部门统一提交后不能自行撤回；需要修改时由管理员退回。</Typography.Text>
            </Space>
          }
        />
      )}
      <Table
        rowKey="id"
        dataSource={reports.data ?? []}
        pagination={false}
        scroll={{ x: 1400 }}
        columns={reportColumns}
      />
    </>
  );
  const completedView = (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button href={`/api/monthly-reports.csv?year=${year}&completed=true`}>
          导出完工项目 CSV
        </Button>
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic title="完工项目数" value={completedRows.length} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="涉及部门"
              value={
                new Set(
                  completedRows.map((row) => row.reportingOrganization.id),
                ).size
              }
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="年度" value={year ?? "—"} />
          </Card>
        </Col>
      </Row>
      <Table
        rowKey="id"
        dataSource={completedRows}
        pagination={false}
        columns={reportColumns}
        scroll={{ x: 1200 }}
      />
    </>
  );
  const configuration = (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Card title="报送时限">
        <Space wrap>
          <Typography.Text>每月报送截止日</Typography.Text>
          <InputNumber
            min={1}
            max={28}
            value={config.data?.settings.deadlineDay ?? 5}
            onChange={async (value) => {
              if (!value) return;
              await api(
                "/api/report-config/settings",
                json("PATCH", { deadlineDay: value }),
              );
              message.success("报送截止日已保存");
              void config.refetch();
            }}
          />
          <Typography.Text type="secondary">
            临近截止提醒一次，逾期按周汇总提醒。
          </Typography.Text>
        </Space>
      </Card>
      <Card title="报送部门">
        <Space wrap>
          {(config.data?.organizations ?? []).map((org) => (
            <Checkbox
              key={org.id}
              checked={org.reportingEnabled}
              onChange={async (event) => {
                await api(
                  `/api/report-config/organizations/${org.id}`,
                  json("PATCH", { reportingEnabled: event.target.checked }),
                );
                void config.refetch();
              }}
            >
              {org.name}
            </Checkbox>
          ))}
        </Space>
      </Card>
      <Card title="项目类型">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={config.data?.types ?? []}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "排序", dataIndex: "sortOrder" },
            {
              title: "状态",
              dataIndex: "active",
              render: (v: boolean) => (v ? "启用" : "停用"),
            },
            {
              title: "操作",
              render: (_: unknown, row: { id: string; active: boolean }) => (
                <Button
                  size="small"
                  onClick={async () => {
                    await api(
                      `/api/report-config/types/${row.id}`,
                      json("PATCH", { active: !row.active }),
                    );
                    void config.refetch();
                  }}
                >
                  {row.active ? "停用" : "启用"}
                </Button>
              ),
            },
          ]}
        />
        <Form
          form={typeForm}
          layout="inline"
          style={{ marginTop: 12 }}
          onFinish={async (values) => {
            await api("/api/report-config/types", json("POST", values));
            typeForm.resetFields();
            void config.refetch();
          }}
        >
          <Form.Item name="name" rules={[{ required: true }]}>
            <Input placeholder="项目类型名称" />
          </Form.Item>
          <Form.Item name="sortOrder" initialValue={0}>
            <InputNumber min={0} placeholder="排序" />
          </Form.Item>
          <Button htmlType="submit">新增</Button>
        </Form>
      </Card>
      <Card title="报送字段">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={config.data?.fields ?? []}
          columns={[
            { title: "字段", dataIndex: "label" },
            { title: "类型", dataIndex: "fieldType" },
            {
              title: "内置",
              dataIndex: "builtin",
              render: (v: boolean) => (v ? "是" : "否"),
            },
            {
              title: "必填",
              render: (_: unknown, row: ReportConfig["fields"][number]) => (
                <Checkbox
                  checked={row.required}
                  onChange={async (event) => {
                    await api(
                      `/api/report-config/fields/${row.id}`,
                      json("PATCH", { required: event.target.checked }),
                    );
                    void config.refetch();
                  }}
                />
              ),
            },
            {
              title: "启用",
              render: (_: unknown, row: ReportConfig["fields"][number]) => (
                <Checkbox
                  checked={row.active}
                  onChange={async (event) => {
                    await api(
                      `/api/report-config/fields/${row.id}`,
                      json("PATCH", { active: event.target.checked }),
                    );
                    void config.refetch();
                  }}
                />
              ),
            },
          ]}
        />
        <Form
          form={fieldForm}
          layout="inline"
          style={{ marginTop: 12 }}
          onFinish={async (values) => {
            await api(
              "/api/report-config/fields",
              json("POST", {
                ...values,
                options: String(values.options ?? "")
                  .split(/[，,]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
                required: false,
                active: true,
              }),
            );
            fieldForm.resetFields();
            void config.refetch();
          }}
        >
          <Form.Item name="label" rules={[{ required: true }]}>
            <Input placeholder="自定义字段名称" />
          </Form.Item>
          <Form.Item name="fieldType" rules={[{ required: true }]}>
            <Select
              style={{ width: 130 }}
              options={["text", "number", "textarea", "select", "date"].map(
                (value) => ({
                  value,
                  label: (
                    {
                      text: "文本",
                      number: "数字",
                      textarea: "多行文本",
                      select: "下拉选择",
                      date: "日期",
                    } as Record<string, string>
                  )[value],
                }),
              )}
            />
          </Form.Item>
          <Form.Item name="options">
            <Input placeholder="下拉选项，逗号分隔" />
          </Form.Item>
          <Form.Item name="sortOrder" initialValue={200}>
            <InputNumber min={0} />
          </Form.Item>
          <Button htmlType="submit">新增字段</Button>
        </Form>
      </Card>
    </Space>
  );
  return (
    <div className="admin-workspace monthly-report-page">
      <Space className="page-title" wrap>
        <Typography.Title level={3}>野外施工项目报送</Typography.Title>
        <Typography.Text type="secondary">
          项目逐项保存草稿，经营实体核对完整后统一提交，管理员复核确认并锁定月份
        </Typography.Text>
      </Space>
      <Tabs
        activeKey={
          view === "mine" && !capabilities.data?.canSubmit ? "manage" : view
        }
        onChange={setView}
        items={[
          ...(capabilities.data?.canSubmit
            ? [{ key: "mine", label: "我的报送", children: own }]
            : []),
          { key: "manage", label: "报送管理", children: manage },
          { key: "completed", label: "完工项目", children: completedView },
          ...(capabilities.data?.canConfigure
            ? [{ key: "config", label: "报送配置", children: configuration }]
            : []),
        ]}
      />
      <Modal
        title={editing ? "编辑项目报送" : "新建项目报送"}
        open={open}
        footer={null}
        width={900}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="projectId"
                label="项目"
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!editing}
                  showSearch
                  optionFilterProp="label"
                  onChange={(projectId) => {
                    const selected = (projects.data ?? []).find((row) => row.id === projectId);
                    if (selected) form.setFieldsValue({
                      constructionLocation: selected.location ?? undefined,
                      contractAmount: selected.contractAmount ?? 0,
                      projectManager: selected.managerName ?? undefined,
                      contactInfo: selected.managerPhone ?? undefined,
                      ...(selected.previousDefaults ?? {}),
                    });
                  }}
                  options={(projects.data ?? [])
                    .filter((row) => row.status !== "ended")
                    .map((row) => ({
                      value: row.id,
                      label: `${row.name}（${row.code}）· ${row.responsibleOrganization.name}`,
                    }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="reportMonth"
                label="报送月份"
                rules={[{ required: true }]}
              >
                <Input disabled={!!editing} type="month" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="projectTypeId" label="项目类型">
                <Select
                  allowClear
                  options={(config.data?.types ?? [])
                    .filter((row) => row.active)
                    .map((row) => ({ value: row.id, label: row.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="constructionLocation"
                label="施工地点"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contractAmount" label="合同额（万元）">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="durationMonths" label="工期（月）">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="departmentEntity" label="归属实体">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="projectManager"
                label="项目负责人"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactInfo" label="联系方式">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="overallProgress" label="项目总体进度">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="monthlyConstructionStatus"
                label="本月施工情况"
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="equipmentModels" label="设备型号">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="onsiteCount"
                label="现场人数"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="onsiteVehicles" label="现场车辆数">
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="safetyInspection"
                label="已安全自检"
                valuePropName="checked"
              >
                <Checkbox>是</Checkbox>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="safetyHazards"
                label="存在安全隐患"
                valuePropName="checked"
              >
                <Checkbox>是</Checkbox>
              </Form.Item>
            </Col>
            {Form.useWatch("safetyHazards", form) && (
              <Col span={24}>
                <Form.Item
                  name="safetyHazardDetail"
                  label="安全隐患详情"
                  rules={[{ required: true }]}
                >
                  <Input.TextArea rows={3} />
                </Form.Item>
              </Col>
            )}
            <Col span={8}>
              <Form.Item name="safetyInvestment" label="安全投入（元）">
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="incidentCount" label="事故数">
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="projectStatus" label="项目状态">
                <Select
                  options={[
                    { value: "active", label: "在建" },
                    { value: "completed", label: "已完工" },
                  ]}
                />
              </Form.Item>
            </Col>
            {customFields.map((field) => (
              <Col
                span={field.fieldType === "textarea" ? 24 : 12}
                key={field.id}
              >
                <Form.Item
                  name={["customData", field.fieldKey]}
                  label={field.label}
                  rules={[{ required: field.required }]}
                >
                  {field.fieldType === "number" ? (
                    <InputNumber min={0} style={{ width: "100%" }} />
                  ) : field.fieldType === "textarea" ? (
                    <Input.TextArea rows={3} />
                  ) : field.fieldType === "select" ? (
                    <Select
                      options={field.options.map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  ) : (
                    <Input
                      type={field.fieldType === "date" ? "date" : "text"}
                    />
                  )}
                </Form.Item>
              </Col>
            ))}
            <Col span={24}>
              <Form.Item name="notes" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            {!editing && (
              <Col span={24}>
                <Form.Item label="附件（可选，最多 20 个）">
                  <Upload
                    multiple
                    fileList={reportFiles}
                    beforeUpload={(file) => {
                      setReportFiles((current) => [...current, file]);
                      return false;
                    }}
                    onRemove={(file) => {
                      setReportFiles((current) =>
                        current.filter((item) => item.uid !== file.uid),
                      );
                    }}
                  >
                    <Button>选择月报附件</Button>
                  </Upload>
                </Form.Item>
              </Col>
            )}
          </Row>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存项目月报草稿
          </Button>
        </Form>
      </Modal>
      <Modal
        title="报送详情"
        open={!!detail}
        footer={null}
        width={800}
        onCancel={() => setDetail(undefined)}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                {
                  key: "project",
                  label: "项目",
                  children: detail.project.name,
                },
                {
                  key: "month",
                  label: "报送月份",
                  children: detail.reportMonth.slice(0, 7),
                },
                {
                  key: "org",
                  label: "报送部门",
                  children: detail.reportingOrganization.name,
                },
                {
                  key: "location",
                  label: "施工地点",
                  children: detail.constructionLocation || "—",
                },
                {
                  key: "manager",
                  label: "负责人",
                  children: [detail.projectManager, detail.contactInfo]
                    .filter(Boolean)
                    .join(" / "),
                },
                {
                  key: "onsite",
                  label: "现场人员/车辆",
                  children: `${detail.onsiteCount} / ${detail.onsiteVehicles}`,
                },
                {
                  key: "progress",
                  label: "总体进度",
                  children: detail.overallProgress || "—",
                  span: 2,
                },
                {
                  key: "monthly",
                  label: "本月施工",
                  children:
                    detail.monthlyConstructionStatus || detail.progressSummary,
                  span: 2,
                },
                {
                  key: "hazard",
                  label: "安全隐患",
                  children: detail.safetyHazards
                    ? detail.safetyHazardDetail || "有"
                    : "无",
                  span: 2,
                },
                ...Object.entries(detail.customData ?? {}).map(
                  ([key, value]) => ({
                    key,
                    label:
                      config.data?.fields.find(
                        (field) => field.fieldKey === key,
                      )?.label ?? key,
                    children: String(value ?? "—"),
                  }),
                ),
              ]}
            />
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              附件
            </Typography.Title>
            <Space wrap>
              {detail.attachments?.length
                ? detail.attachments.map((item) => (
                    <Button
                      key={item.id}
                      href={`/api/files/${item.file.id}`}
                      target="_blank"
                    >
                      {item.file.originalName}
                    </Button>
                  ))
                : "暂无附件"}
            </Space>
          </>
        )}
      </Modal>
      <Modal
        title="项目月报历史对比"
        open={history.length > 0}
        footer={null}
        width={1000}
        onCancel={() => setHistory([])}
      >
        <Table
          rowKey="id"
          pagination={false}
          dataSource={history}
          columns={[
            {
              title: "月份",
              dataIndex: "reportMonth",
              render: (v: string) => v.slice(0, 7),
            },
            { title: "总体进度", dataIndex: "overallProgress" },
            { title: "现场人数", dataIndex: "onsiteCount" },
            { title: "车辆", dataIndex: "onsiteVehicles" },
            {
              title: "安全自检",
              dataIndex: "safetyInspection",
              render: (v: boolean) => (v ? "是" : "否"),
            },
            {
              title: "隐患",
              dataIndex: "safetyHazards",
              render: (v: boolean) => (v ? "有" : "无"),
            },
            { title: "安全投入", dataIndex: "safetyInvestment" },
          ]}
        />
      </Modal>
    </div>
  );
}
