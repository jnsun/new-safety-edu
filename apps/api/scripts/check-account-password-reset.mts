import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../src/routes/day1.ts", import.meta.url), "utf8");
const admin = await readFile(new URL("../../admin/src/App.tsx", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

const routeStart = api.indexOf('app.post("/api/accounts/:id/reset-password"');
const routeEnd = api.indexOf('app.post("/api/roles"', routeStart);
assert(routeStart >= 0 && routeEnd > routeStart, "缺少账号密码重置 API");
const route = api.slice(routeStart, routeEnd);
assert.match(route, /isCompanyAdmin\(principal\)/, "密码重置必须限制 company_admin");
assert.match(route, /z\.string\(\)\.min\(12\)/, "临时密码必须至少 12 位");
assert.match(route, /argon2\.hash\(input\.newPassword\)/, "新密码必须使用 Argon2");
assert.match(route, /sessionVersion:\s*\{\s*increment:\s*1\s*\}/, "重置必须使当前 access session 失效");
assert.match(route, /refreshSession\.updateMany/, "重置必须撤销 refresh session");
assert.match(route, /account\.password_reset/, "重置必须写审计事件");
assert.match(server, /body\.newPassword/, "日志配置必须脱敏新密码字段");

const panelStart = admin.indexOf("function AccountsPanel(");
const panelEnd = admin.indexOf("function PeoplePanel(", panelStart);
const panel = admin.slice(panelStart, panelEnd > panelStart ? panelEnd : undefined);
assert.match(panel, /重置密码/, "账号列表缺少重置密码入口");
assert.match(panel, /\/api\/accounts\/\$\{[^}]+\}\/reset-password/, "Admin 未调用密码重置 API");
assert.match(panel, /min:\s*12/, "Admin 未校验临时密码长度");

console.log("ACCOUNT_PASSWORD_RESET_CHECK=PASS");
