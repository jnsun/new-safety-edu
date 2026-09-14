import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";

const baseUrl = process.env.SMOKE_API_URL ?? "http://127.0.0.1:3101";
const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]; const checks = "10X98765432"; const base = "1".repeat(17);
const nationalId = `${base}${checks[base.split("").reduce((sum, digit, index) => sum + Number(digit) * weights[index]!, 0) % 11]}`;
const root = await mkdtemp(join(tmpdir(), "safety-person-import-"));

async function request<T>(path: string, init?: RequestInit, cookie?: string): Promise<{ data: T; response: Response }> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init?.body === undefined || init.body instanceof FormData ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...init?.headers } });
  const body = await response.json() as { data?: T; error?: { message: string } };
  assert.equal(response.ok, true, body.error?.message ?? `${path} failed`); assert.ok(body.data);
  return { data: body.data, response };
}

async function sendFile<T>(path: string, filename: string, bytes: Buffer, cookie: string) {
  const form = new FormData(); form.append("file", new Blob([bytes]), filename);
  return (await request<T>(path, { method: "POST", body: form }, cookie)).data;
}

try {
  const login = await request<{ accountId: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "isolated_admin", password: "isolated-admin-password" }) });
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
  const suffix = Date.now().toString(36); const departmentName = `匿名部门${suffix}`; const company = (await request<{ id: string }>("/api/organizations", { method: "POST", body: JSON.stringify({ name: `匿名公司${suffix}`, type: "company" }) }, cookie)).data;
  const department = (await request<{ id: string }>("/api/organizations", { method: "POST", body: JSON.stringify({ name: departmentName, type: "department", parentId: company.id }) }, cookie)).data;

  const sourceBook = new ExcelJS.Workbook(); const sourceSheet = sourceBook.addWorksheet("人员"); sourceSheet.addRow(["姓名", "身份证号码", "手机号码", "工作部门", "来源部门"]); sourceSheet.addRow(["匿名人员", nationalId, "13000000000", departmentName, "匿名来源"]); sourceSheet.addRow(["资料待补人员", "", "错误手机号", departmentName, "匿名来源"]); sourceSheet.addRow(["仅姓名手机号", "", "13100000001", "", departmentName]);
  let preview = await sendFile<any>("/api/person-imports/preview", "source.xlsx", Buffer.from(await sourceBook.xlsx.writeBuffer()), cookie);
  assert.equal(preview.counts.total, 3); assert.equal(preview.counts.ready, 2); assert.equal(preview.counts.failed, 1);
  assert.equal(preview.phoneStats.matched, 2); assert.equal(preview.phoneStats.failed, 1); assert.equal(preview.phoneIssues.length, 1);
  assert.equal(preview.departments[0].organizationId, department.id, JSON.stringify({ departmentName, departments: preview.departments, organizations: preview.organizations }));

  const photoDir = join(root, "photos"); await mkdir(photoDir); const photoName = `${nationalId}+匿名人员.png`; const photoPath = join(photoDir, photoName); const unmatchedPhotoName = "未包含身份证+无人匹配.png";
  await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  await writeFile(join(photoDir, unmatchedPhotoName), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const zipPath = join(root, "photos.zip"); execFileSync("tar", ["-a", "-c", "-f", zipPath, "-C", root, "photos"]);
  preview = await sendFile<any>(`/api/person-imports/${preview.id}/photos`, "photos.zip", await import("node:fs/promises").then(({ readFile }) => readFile(zipPath)), cookie);
  assert.equal(preview.photoStats.matched, 1); assert.equal(preview.photoStats.unmatched, 1); assert.equal(preview.photoIssues.length, 1);
  assert.equal(JSON.stringify(preview).includes(nationalId), false);
  const photoAssignments = Object.fromEntries(preview.rows.filter((row: any) => row.photoId).map((row: any) => [String(row.rowNumber), row.photoId]));
  preview = (await request<any>(`/api/person-imports/${preview.id}/config`, { method: "PUT", body: JSON.stringify({ mappings: {}, excludedRows: [], photoAssignments }) }, cookie)).data;
  assert.equal(preview.counts.ready, 2); assert.equal(preview.counts.failed, 1);
  const result = (await request<any>(`/api/person-imports/${preview.id}/confirm`, { method: "POST" }, cookie)).data;
  assert.deepEqual(result.counts, { success: 2, failed: 1, conflict: 0, pendingData: 0 }, JSON.stringify(result));
  const people = (await request<any[]>("/api/persons", undefined, cookie)).data;
  assert.equal(people.length, 2); assert.ok(people.some((person) => person.nationalIdLast4 === null && person.photoFileId === null));

  const wx = (await request<any>("/api/wechat/login", { method: "POST", body: JSON.stringify({ code: "dev:anonymous-binding" }) })).data;
  const first = (await request<any>("/api/wechat/bind-phone", { method: "POST", body: JSON.stringify({ code: "dev:13100000000" }), headers: { authorization: `Bearer ${wx.accessToken}` } })).data;
  const second = (await request<any>("/api/wechat/bind-phone", { method: "POST", body: JSON.stringify({ code: "dev:13100000000" }), headers: { authorization: `Bearer ${wx.accessToken}` } })).data;
  assert.equal(first.status, "pending_review"); assert.equal(second.requestId, first.requestId);
  const options = (await request<any>("/api/wechat/registration-options", { headers: { authorization: `Bearer ${wx.accessToken}` } })).data;
  assert.ok(options.departments.some((organization: any) => organization.id === department.id));
  await request<any>(`/api/wechat/binding-requests/${first.requestId}/profile`, { method: "PUT", body: JSON.stringify({ name: "匿名申请人", organizationId: department.id, reason: "匿名手机号变更" }), headers: { authorization: `Bearer ${wx.accessToken}` } });
  const requests = (await request<any[]>("/api/binding-requests", undefined, cookie)).data;
  const binding = requests.find((row) => row.id === first.requestId); assert.equal(binding.payload.organizationName, departmentName); assert.equal(binding.payload.name, "匿名申请人");
  console.log("person_import_api_smoke=PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
