import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";
import argon2 from "argon2";
import { PrismaClient, type RoleName } from "@prisma/client";

const root = resolve(import.meta.dirname, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "";
const apiOrigin = "http://127.0.0.1:55453";
const marker = `challenge-e2e-${randomUUID().slice(0, 8)}`;

function assertEnvironment() {
  let database: URL;
  try { database = new URL(databaseUrl); } catch { throw new Error("DAILY_CHALLENGE_E2E_DATABASE_URL_REQUIRED"); }
  const name = decodeURIComponent(database.pathname.replace(/^\//, ""));
  if (process.env.SAFETY_ENV !== "test" || database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.port !== "55432" || database.username !== "postgres" || !name.includes("daily_challenge_e2e_test")) {
    throw new Error("DAILY_CHALLENGE_E2E_DATABASE_URL_UNSAFE");
  }
}

assertEnvironment();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let server: ChildProcess | null = null;
let serverOutput = "";

const ids = {
  organizations: [] as string[], memberships: [] as string[], people: [] as string[], accounts: [] as string[], roles: [] as string[],
  banks: [] as string[], questions: [] as string[], versions: [] as string[], attempts: [] as string[], ledgers: [] as string[]
};

type ApiBody<T> = { data?: T; error?: { code?: string; message?: string } };
type Session = { bearer: string };
type ChallengeAttempt = { id: string; questions: Array<{ questionVersionId: string }>; answers: unknown[]; todayPoints: number };

const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function startServer() {
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      PORT: "55453",
      RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: apiOrigin,
      COOKIE_SECRET: randomBytes(48).toString("base64url"),
      JWT_SECRET: randomBytes(48).toString("base64url"),
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      UPLOAD_SIGNING_SECRET: randomBytes(48).toString("base64url"),
      UPLOAD_ROOT: resolve(root, "var/daily-challenge-e2e-test")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`DAILY_CHALLENGE_E2E_API_EXITED\n${serverOutput}`);
    try { if ((await fetch(`${apiOrigin}/api/health`, { signal: AbortSignal.timeout(500) })).status === 200) return; } catch {}
    await delay(50);
  }
  throw new Error(`DAILY_CHALLENGE_E2E_API_NOT_READY\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  server.kill();
  const force = setTimeout(() => { if (server?.exitCode === null) server.kill("SIGKILL"); }, 5_000);
  force.unref();
  await exited;
  clearTimeout(force);
}

async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${apiOrigin}/api/auth/login`, json("POST", { username, password }));
  assert.equal(response.status, 200, await response.text());
  const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const access = cookies.find((cookie) => cookie.startsWith("safety_session="));
  assert.ok(access, "login did not issue safety_session");
  return { bearer: access.split(";", 1)[0]!.slice("safety_session=".length) };
}

async function request<T>(session: Session, path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { ...init, headers: { authorization: `Bearer ${session.bearer}`, ...init.headers } });
  const text = await response.text();
  const body = text ? JSON.parse(text) as ApiBody<T> : {};
  return { response, body, text };
}

async function createOrganization(name: string) {
  const organization = await prisma.organization.create({ data: { name: `${marker}-${name}`, type: "department" } });
  ids.organizations.push(organization.id);
  return organization;
}

async function createIdentity(input: { suffix: string; organizationId?: string; role?: RoleName; scopeId?: string }) {
  const password = `Dc!${randomBytes(18).toString("base64url")}9a`;
  const username = `${marker}-${input.suffix}`;
  const person = await prisma.person.create({ data: { name: username, phone: `193${String(ids.people.length + 1).padStart(8, "0")}`, type: "employee", status: "active" } });
  ids.people.push(person.id);
  if (input.organizationId) {
    const membership = await prisma.organizationMembership.create({ data: { personId: person.id, organizationId: input.organizationId, primary: true } });
    ids.memberships.push(membership.id);
  }
  const account = await prisma.account.create({ data: { personId: person.id, username, usernameNormalized: username.toLowerCase(), passwordHash: await argon2.hash(password), passwordLoginEnabled: true, status: "active" } });
  ids.accounts.push(account.id);
  if (input.role) {
    const role = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role: input.role, scopeType: input.role === "company_admin" ? "company" : "organization", scopeId: input.scopeId ?? null } });
    ids.roles.push(role.id);
  }
  return { person, account, username, password };
}

async function cleanup() {
  await stopServer();
  if (ids.accounts.length) {
    await prisma.refreshSession.deleteMany({ where: { accountId: { in: ids.accounts } } });
    await prisma.authSecurityEvent.deleteMany({ where: { accountId: { in: ids.accounts } } });
  }
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids.accounts } }, { objectId: { in: [...ids.attempts, ...ids.ledgers, ...ids.questions] } }] } });
  if (ids.people.length) await prisma.challengePointLedger.deleteMany({ where: { personId: { in: ids.people } } });
  if (ids.people.length) {
    const attempts = await prisma.challengeAttempt.findMany({ where: { personId: { in: ids.people } }, select: { id: true } });
    await prisma.challengeAnswer.deleteMany({ where: { attemptId: { in: attempts.map(({ id }) => id) } } });
    await prisma.challengeAttempt.deleteMany({ where: { personId: { in: ids.people } } });
  }
  if (ids.versions.length) await prisma.questionVersion.deleteMany({ where: { id: { in: ids.versions } } });
  if (ids.questions.length) await prisma.question.deleteMany({ where: { id: { in: ids.questions } } });
  if (ids.banks.length) await prisma.questionBank.deleteMany({ where: { id: { in: ids.banks } } });
  await prisma.challengeMonthlyOrganizationSnapshot.deleteMany({ where: { organizationId: { in: ids.organizations } } });
  if (ids.roles.length) await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roles } } });
  if (ids.memberships.length) await prisma.organizationMembership.deleteMany({ where: { id: { in: ids.memberships } } });
  if (ids.accounts.length) await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } });
  if (ids.people.length) await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
  if (ids.organizations.length) await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
  await prisma.$disconnect();
}

async function answer(session: Session, attemptId: string, questionVersionId: string, value: boolean) {
  return request<{ correct: boolean; pointsAwarded: number; todayPoints: number; repeated: boolean }>(session, "/api/me/daily-challenge/answers", json("POST", { attemptId, questionVersionId, answer: value }));
}

try {
  const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.ok(Number(migrations[0]?.count ?? 0) > 0, "migrations are not applied");

  const organizationA = await createOrganization("organization-a");
  const organizationB = await createOrganization("organization-b-small-sample");
  const learnerA = await createIdentity({ suffix: "learner-a", organizationId: organizationA.id });
  const managerA = await createIdentity({ suffix: "manager-a", organizationId: organizationA.id, role: "org_admin", scopeId: organizationA.id });
  await createIdentity({ suffix: "member-a", organizationId: organizationA.id });
  const learnerB = await createIdentity({ suffix: "learner-b", organizationId: organizationB.id });
  await createIdentity({ suffix: "member-b", organizationId: organizationB.id });
  const companyAdmin = await createIdentity({ suffix: "company-admin", role: "company_admin" });

  const bank = await prisma.questionBank.create({ data: { name: `${marker}-bank`, scopeType: "company", scopeId: null } });
  ids.banks.push(bank.id);
  for (let index = 0; index < 6; index += 1) {
    const question = await prisma.question.create({
      data: {
        bankId: bank.id, type: "true_false", prompt: `${marker}-question-${index}`, options: [true, false], correct: true,
        explanation: `${marker}-explanation-${index}`, challengeEnabled: true, challengeCategory: "smoke", challengeDifficulty: "easy",
        versions: { create: { version: 1, type: "true_false", prompt: `${marker}-question-${index}`, options: [true, false], correct: true, explanation: `${marker}-explanation-${index}` } }
      },
      include: { versions: true }
    });
    ids.questions.push(question.id);
    ids.versions.push(question.versions[0]!.id);
  }

  await startServer();
  const learnerASession = await login(learnerA.username, learnerA.password);
  const learnerBSession = await login(learnerB.username, learnerB.password);
  const managerASession = await login(managerA.username, managerA.password);
  const companyAdminSession = await login(companyAdmin.username, companyAdmin.password);

  const first = await request<ChallengeAttempt>(learnerASession, "/api/me/daily-challenge");
  assert.equal(first.response.status, 200, first.text);
  assert.equal(first.body.data!.questions.length, 5);
  ids.attempts.push(first.body.data!.id);
  const restored = await request<ChallengeAttempt>(learnerASession, "/api/me/daily-challenge");
  assert.deepEqual(restored.body.data!.questions, first.body.data!.questions, "same-day question snapshot changed");
  assert.equal(JSON.stringify(first.body.data).includes('"correct"'), false, "correct answers leaked before submission");

  for (const question of first.body.data!.questions) {
    const result = await answer(learnerASession, first.body.data!.id, question.questionVersionId, true);
    assert.equal(result.response.status, 200, result.text);
    assert.equal(result.body.data!.pointsAwarded, 2);
  }
  const repeated = await answer(learnerASession, first.body.data!.id, first.body.data!.questions[0]!.questionVersionId, true);
  assert.equal(repeated.body.data!.repeated, true);
  assert.equal(repeated.body.data!.pointsAwarded, 0);
  assert.equal(repeated.body.data!.todayPoints, 10, "daily point cap changed");

  const bAttempt = await request<ChallengeAttempt>(learnerBSession, "/api/me/daily-challenge");
  assert.equal(bAttempt.response.status, 200, bAttempt.text);
  ids.attempts.push(bAttempt.body.data!.id);
  const wrong = await answer(learnerBSession, bAttempt.body.data!.id, bAttempt.body.data!.questions[0]!.questionVersionId, false);
  assert.equal(wrong.body.data!.correct, false);
  assert.equal(wrong.body.data!.pointsAwarded, 0);
  for (const question of bAttempt.body.data!.questions.slice(1)) await answer(learnerBSession, bAttempt.body.data!.id, question.questionVersionId, true);

  const points = await request<{ todayPoints: number; monthPoints: number }>(learnerASession, "/api/me/challenge-points");
  assert.equal(points.body.data!.todayPoints, 10);
  const personRanking = await request<{ top: Array<{ personId: string; points: number }> }>(learnerASession, "/api/challenge/leaderboards?type=person");
  assert.equal(personRanking.response.status, 200, personRanking.text);
  assert.equal(personRanking.body.data!.top[0]!.personId, learnerA.person.id);
  const organizationRanking = await request<{ rows: Array<{ organizationId: string; averagePoints: number; rewardEligible: boolean }> }>(learnerASession, "/api/challenge/leaderboards?type=organization");
  assert.equal(organizationRanking.response.status, 200, organizationRanking.text);
  const rankA = organizationRanking.body.data!.rows.find(({ organizationId }) => organizationId === organizationA.id)!;
  const rankB = organizationRanking.body.data!.rows.find(({ organizationId }) => organizationId === organizationB.id)!;
  assert.equal(rankA.averagePoints, 10 / 3);
  assert.equal(rankA.rewardEligible, true);
  assert.equal(rankB.averagePoints, 8 / 2);
  assert.equal(rankB.rewardEligible, false);

  const forbidden = await request(managerASession, `/api/challenge/admin/points?organizationId=${organizationB.id}`);
  assert.equal(forbidden.response.status, 403, "organization manager read another scope");
  const ledgers = await prisma.challengePointLedger.findMany({ where: { personId: learnerA.person.id }, orderBy: { occurredAt: "asc" } });
  ids.ledgers.push(...(await prisma.challengePointLedger.findMany({ where: { personId: { in: ids.people } }, select: { id: true } })).map(({ id }) => id));
  const target = ledgers[0]!;
  const voided = await request<{ voided: boolean }>(companyAdminSession, `/api/challenge/admin/points/${target.id}/void`, json("POST", { reason: "匿名 smoke 异常积分更正" }));
  assert.equal(voided.response.status, 200, voided.text);
  const retained = await prisma.challengePointLedger.findUniqueOrThrow({ where: { id: target.id } });
  assert.ok(retained.voidedAt);
  assert.equal(retained.voidReason, "匿名 smoke 异常积分更正");
  assert.ok(await prisma.auditLog.findFirst({ where: { actorId: companyAdmin.account.id, action: "challenge.point_void", objectId: target.id } }), "point void audit missing");

  console.log("DAILY_CHALLENGE_SMOKE=PASS");
} finally {
  await cleanup();
}
