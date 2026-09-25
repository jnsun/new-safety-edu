import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.BASELINE_QA_API_URL ?? "https://test.safety.sx.cn";
assert.equal(process.env.APP_ENV, "test", "Refusing QA login checks unless APP_ENV=test");
assert.equal(baseUrl, "https://test.safety.sx.cn", "Refusing non-test API host");
const localSecrets = await readFile(new URL("../../../.env.qa.local", import.meta.url), "utf8");
const match = localSecrets.match(/^QA_FIXTURE_PASSWORD=(.*)$/m);
assert.ok(match, "Git-ignored .env.qa.local must contain QA_FIXTURE_PASSWORD");
const password = match[1]!.trim().replace(/^(['"])(.*)\1$/, "$2");
assert.ok(password.length >= 24 && password.length <= 128, "QA password must have a strong length");

type Identity = {
  name: string;
  safety: number;
  monthly: number;
  finance: number;
  contracts: number;
};
const identities: Identity[] = [
  { name: "QA_ALL_ACCESS", safety: 200, monthly: 200, finance: 200, contracts: 200 },
  { name: "QA_MONTHLY_REPORT", safety: 200, monthly: 200, finance: 403, contracts: 403 },
  { name: "QA_RECEIVABLE", safety: 403, monthly: 403, finance: 200, contracts: 403 },
  { name: "QA_CONTRACT_GLOBAL", safety: 403, monthly: 403, finance: 403, contracts: 200 },
  { name: "QA_CONTRACT_SCOPED", safety: 403, monthly: 403, finance: 403, contracts: 200 },
  { name: "QA_SAFETY_ONLY", safety: 200, monthly: 403, finance: 403, contracts: 403 },
  { name: "QA_NO_ACCESS", safety: 403, monthly: 403, finance: 403, contracts: 403 },
];

function getCookies(response: Response): string {
  const cookies = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]!);
  assert.ok(cookies.some((value) => value.startsWith("safety_session=")), "Login must issue a session cookie");
  assert.ok(cookies.some((value) => value.startsWith("safety_csrf=")), "Login must issue a CSRF cookie");
  return cookies.join("; ");
}

function csrfToken(cookie: string): string {
  const csrf = cookie.split("; ").find((part) => part.startsWith("safety_csrf="));
  assert.ok(csrf, "Login session must include a CSRF cookie");
  return csrf.slice("safety_csrf=".length);
}

async function call(path: string, cookie: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, baseUrl), { ...init, headers: { cookie, ...(init?.headers ?? {}) } });
}

const results = [];
for (const identity of identities) {
  const login = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify({ username: identity.name.toLowerCase(), password }),
  });
  assert.equal(login.status, 200, `${identity.name} must authenticate through the normal password-login endpoint`);
  const cookie = getCookies(login);
  try {
    assert.equal((await call("/api/auth/me", cookie)).status, 200, `${identity.name} session must be recognized`);
    const checks = [
      ["safety", "/api/projects", identity.safety],
      ["monthly", "/api/monthly-reports/projects?month=2026-09", identity.monthly],
      ["finance", "/api/receivables/ledgers?search=BASELINE-TEST-F02-&page=1&pageSize=25", identity.finance],
      ["contracts", "/api/contracts/projects?q=BASELINE-TEST-PROJECT", identity.contracts],
    ] as const;
    const observed: Record<string, number> = {};
    for (const [key, path, expectedStatus] of checks) {
      const response = await call(path, cookie);
      observed[key] = response.status;
      assert.equal(response.status, expectedStatus, `${identity.name} ${key} authorization expected ${expectedStatus}, received ${response.status}`);
      if (key === "finance" && response.ok) {
        const payload = await response.json() as { data?: { rows?: Array<{ contractNo?: string }>; total?: number } };
        assert.equal(payload.data?.total, 25, "QA finance view must expose exactly its 25 synthetic ledger rows");
        assert.equal(payload.data?.rows?.length, 25, "F02 synthetic sample must fit one full page");
      } else if (key === "contracts" && identity.name === "QA_CONTRACT_SCOPED" && response.ok) {
        const payload = await response.json() as { data?: { items?: Array<{ code?: string }>; total?: number } };
        assert.equal(payload.data?.total, 1, "Scoped contract identity must see only the in-scope QA project");
        assert.ok(payload.data?.items?.every((item) => item.code === "BASELINE-TEST-PROJECT-A"), "Scoped contract list must exclude Entity B");
      } else {
        await response.arrayBuffer();
      }
    }
    const logout = await call("/api/auth/logout-all", cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json", "x-csrf-token": csrfToken(cookie) },
      body: "{}",
    });
    assert.equal(logout.status, 204, `${identity.name} session cleanup must succeed`);
    assert.equal((await call("/api/auth/me", cookie)).status, 401, `${identity.name} session must be invalid after logout-all`);
    results.push({ identity: identity.name, result: "PASS", ...observed, logout: 204, staleSession: 401 });
  } catch (error) {
    await call("/api/auth/logout-all", cookie, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json", "x-csrf-token": csrfToken(cookie) }, body: "{}" }).catch(() => undefined);
    throw error;
  }
}

console.log(JSON.stringify({ result: "BASELINE_QA_LOGIN_MATRIX_PASS", environment: "test", identities: results }));
