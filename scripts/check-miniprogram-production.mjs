import { readFile, readdir } from "node:fs/promises";

const root = new URL("../apps/miniprogram/", import.meta.url);
const project = JSON.parse(await readFile(new URL("project.config.json", root), "utf8"));
const files = (await readdir(root, { recursive: true })).filter((name) => /\.(js|json|wxml|wxss)$/.test(name));
const source = (await Promise.all(files.map((name) => readFile(new URL(name.replaceAll("\\", "/"), root), "utf8")))).join("\n");
const profileWxml = await readFile(new URL("pages/profile/index.wxml", root), "utf8");
const requiredBase = "https://www.safety.sx.cn/api";
const failures = [];

if (!source.includes(requiredBase)) failures.push("正式 API base 未配置");
if (/http:\/\/|140\.143\.247\.55|dev:/.test(source)) failures.push("仍包含 HTTP、IP 或 Mock 标记");
if (/WECHAT_APP_SECRET/.test(source)) failures.push("小程序包包含 AppSecret 配置");
if (project.setting?.urlCheck !== true) failures.push("合法域名校验未开启");
if (!project.appid || project.appid === "touristappid") failures.push("尚未写入正式 AppID");
if (/wx:if="\{\{security\.roles\.length\}\}"[^>]*wx:for=/.test(profileWxml)) failures.push("个人页角色列表不能在同一节点混用 wx:if 与 wx:for，否则相邻 wx:else 无法配对");
if (!source.includes("/api/identity-binding-requests/") || !source.includes("/review")) failures.push("身份绑定审核仍未使用专用接口");
for (const action of ["bind_existing", "update_phone_and_bind", "create_employee_and_bind", "repair_membership_and_bind", "escalate_company", "reject"]) {
  if (!source.includes(action)) failures.push(`身份绑定审核缺少动作 ${action}`);
}
for (const statusText of ["待部门审核", "已升级公司处理", "已驳回", "已通过"]) {
  if (!source.includes(statusText)) failures.push(`申请状态页缺少状态 ${statusText}`);
}

if (failures.length) throw new Error(failures.join("；"));
console.log("MINIPROGRAM_PRODUCTION_CHECK=PASS");
