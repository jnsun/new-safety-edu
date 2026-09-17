import { Prisma, type QuestionType } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { challengeAnswersEqual, challengeDayRange, challengeMonthRange, challengeMonthRangeFromKey, scoreFirstAnswer, selectDailyQuestions } from "../daily-challenge-policy.js";
import { personalLeaderboardView, rankOrganizationScores, rankPersonalScores, type OrganizationRank, type PersonalScore } from "../challenge-leaderboard.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type SnapshotQuestion = { questionId: string; questionVersionId: string; type: QuestionType; prompt: string; options: unknown; category: string | null; difficulty: string | null };
type Snapshot = { version: 1; date: string; questions: SnapshotQuestion[] };
const TIME_ZONE = "Asia/Shanghai";

const principalOf = (request: FastifyRequest) => {
  const principal = request.principal;
  if (!principal?.personId) throw Object.assign(new Error("账号尚未绑定在用人员档案"), { statusCode: 403, code: "PERSON_REQUIRED" });
  return { ...principal, personId: principal.personId };
};

const answerSchema = z.object({
  attemptId: z.string().uuid(),
  questionVersionId: z.string().uuid(),
  answer: z.union([z.string().max(500), z.boolean(), z.array(z.string().max(500)).min(1).max(20)])
}).strict();

function snapshotOf(value: Prisma.JsonValue): Snapshot {
  return z.object({
    version: z.literal(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    questions: z.array(z.object({ questionId: z.string().uuid(), questionVersionId: z.string().uuid(), type: z.enum(["single_choice", "multiple_choice", "true_false"]), prompt: z.string(), options: z.unknown(), category: z.string().nullable(), difficulty: z.string().nullable() }).strict())
  }).strict().parse(value) as Snapshot;
}

async function primaryInternalOrganization(personId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.organizationMembership.findFirst({
    where: { personId, active: true, primary: true, organization: { type: { in: ["department", "business_entity"] } } },
    orderBy: { createdAt: "desc" },
    select: { organizationId: true }
  });
}

async function serializeAttempt(attemptId: string) {
  const attempt = await prisma.challengeAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { answers: { orderBy: { submittedAt: "asc" }, include: { questionVersion: { select: { explanation: true } } } } } });
  const snapshot = snapshotOf(attempt.questionSnapshot);
  const todayPoints = attempt.answers.reduce((total, answer) => total + answer.pointsAwarded, 0);
  return {
    id: attempt.id,
    date: snapshot.date,
    questions: snapshot.questions,
    answers: attempt.answers.map((answer) => ({ questionVersionId: answer.questionVersionId, answer: answer.answer, correct: answer.correct, explanation: answer.questionVersion.explanation, pointsAwarded: answer.pointsAwarded, submittedAt: answer.submittedAt })),
    answeredCount: attempt.answers.length,
    totalCount: snapshot.questions.length,
    todayPoints,
    completedAt: attempt.completedAt
  };
}

type MonthRange = { month: string; start: Date; end: Date };

async function personalScores(range: MonthRange): Promise<PersonalScore[]> {
  const ledgers = await prisma.challengePointLedger.findMany({
    where: { voidedAt: null, occurredAt: { gte: range.start, lt: range.end } },
    orderBy: { occurredAt: "asc" },
    select: { personId: true, points: true, occurredAt: true, person: { select: { name: true } }, organizationSnapshot: { select: { name: true } } }
  });
  const scores = new Map<string, PersonalScore>();
  for (const ledger of ledgers) {
    const current = scores.get(ledger.personId);
    scores.set(ledger.personId, {
      personId: ledger.personId,
      name: ledger.person.name,
      organizationName: ledger.organizationSnapshot?.name ?? current?.organizationName ?? null,
      points: (current?.points ?? 0) + ledger.points,
      reachedAt: ledger.occurredAt
    });
  }
  return [...scores.values()];
}

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function currentOrganizationRanks(range: MonthRange): Promise<OrganizationRank[]> {
  const [organizations, ledgers] = await Promise.all([
    prisma.organization.findMany({
      where: { type: { in: ["department", "business_entity"] } },
      select: { id: true, name: true, type: true, memberships: { where: { active: true, primary: true, person: { status: "active" } }, select: { personId: true } } }
    }),
    prisma.challengePointLedger.findMany({ where: { voidedAt: null, organizationIdSnapshot: { not: null }, occurredAt: { gte: range.start, lt: range.end } }, select: { organizationIdSnapshot: true, personId: true, points: true } })
  ]);
  const points = new Map<string, number>();
  const participants = new Map<string, Set<string>>();
  for (const ledger of ledgers) {
    const organizationId = ledger.organizationIdSnapshot!;
    points.set(organizationId, (points.get(organizationId) ?? 0) + ledger.points);
    if (!participants.has(organizationId)) participants.set(organizationId, new Set());
    participants.get(organizationId)!.add(ledger.personId);
  }
  return rankOrganizationScores(organizations.map((organization) => ({
    organizationId: organization.id,
    name: organization.name,
    type: organization.type,
    activePersonCount: new Set(organization.memberships.map(({ personId }) => personId)).size,
    participantCount: participants.get(organization.id)?.size ?? 0,
    totalPoints: points.get(organization.id) ?? 0
  })));
}

async function finalizedOrganizationRanks(range: MonthRange) {
  let snapshots = await prisma.challengeMonthlyOrganizationSnapshot.findMany({ where: { month: new Date(`${range.month}-01T00:00:00.000Z`) }, include: { organization: { select: { name: true, type: true } } }, orderBy: { rank: "asc" } });
  if (!snapshots.length) {
    const ranks = await currentOrganizationRanks(range);
    await prisma.challengeMonthlyOrganizationSnapshot.createMany({ data: ranks.map((entry) => ({ month: new Date(`${range.month}-01T00:00:00.000Z`), organizationId: entry.organizationId, activePersonCount: entry.activePersonCount, participantCount: entry.participantCount, totalPoints: entry.totalPoints, averagePoints: entry.averagePoints, rank: entry.rank, rewardEligible: entry.rewardEligible, finalizedAt: new Date() })), skipDuplicates: true });
    snapshots = await prisma.challengeMonthlyOrganizationSnapshot.findMany({ where: { month: new Date(`${range.month}-01T00:00:00.000Z`) }, include: { organization: { select: { name: true, type: true } } }, orderBy: { rank: "asc" } });
  }
  return snapshots.map((entry) => ({ organizationId: entry.organizationId, name: entry.organization.name, type: entry.organization.type, activePersonCount: entry.activePersonCount, participantCount: entry.participantCount, totalPoints: entry.totalPoints, averagePoints: Number(entry.averagePoints), participationRate: entry.activePersonCount ? entry.participantCount / entry.activePersonCount : 0, rewardEligible: entry.rewardEligible, rank: entry.rank }));
}

export async function finalizePreviousChallengeMonth(now = new Date()) {
  const current = challengeMonthRange(now, TIME_ZONE);
  return finalizedOrganizationRanks(challengeMonthRangeFromKey(previousMonth(current.month), TIME_ZONE));
}

export async function registerDailyChallengeRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard }) {
  const authenticated = { preHandler: deps.authenticate };

  app.get("/api/me/daily-challenge", authenticated, async (request) => {
    const principal = principalOf(request);
    const now = new Date();
    const day = challengeDayRange(now, TIME_ZONE);
    const challengeDate = new Date(`${day.date}T00:00:00.000Z`);
    let attempt = await prisma.challengeAttempt.findUnique({ where: { personId_challengeDate: { personId: principal.personId, challengeDate } }, select: { id: true } });
    if (!attempt) {
      const [memberships, projects] = await Promise.all([
        prisma.organizationMembership.findMany({ where: { personId: principal.personId, active: true }, select: { organizationId: true } }),
        prisma.projectMember.findMany({ where: { personId: principal.personId, status: "active" }, select: { projectId: true } })
      ]);
      const organizationIds = memberships.map(({ organizationId }) => organizationId);
      const projectIds = projects.map(({ projectId }) => projectId);
      const questions = await prisma.question.findMany({
        where: { active: true, challengeEnabled: true, OR: [
          { bank: { scopeType: "company", scopeId: null } },
          ...(organizationIds.length ? [{ bank: { scopeType: "organization" as const, scopeId: { in: organizationIds } } }] : []),
          ...(projectIds.length ? [{ bank: { scopeType: "project" as const, scopeId: { in: projectIds } } }] : [])
        ] },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } }
      });
      const selected = selectDailyQuestions(questions.flatMap((question) => question.versions[0] ? [{
        id: question.versions[0].id,
        active: question.active,
        challengeEnabled: question.challengeEnabled,
        question,
        version: question.versions[0]
      }] : []), `${deps.env.JWT_SECRET}:${principal.personId}:${day.date}`);
      const snapshot: Snapshot = { version: 1, date: day.date, questions: selected.map(({ question, version }) => ({ questionId: question.id, questionVersionId: version.id, type: version.type, prompt: version.prompt, options: version.options, category: question.challengeCategory, difficulty: question.challengeDifficulty })) };
      try {
        attempt = await prisma.challengeAttempt.create({ data: { personId: principal.personId, challengeDate, questionSnapshot: snapshot as unknown as Prisma.InputJsonValue }, select: { id: true } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        attempt = await prisma.challengeAttempt.findUniqueOrThrow({ where: { personId_challengeDate: { personId: principal.personId, challengeDate } }, select: { id: true } });
      }
    }
    return { data: await serializeAttempt(attempt.id) };
  });

  app.post("/api/me/daily-challenge/answers", authenticated, async (request) => {
    const principal = principalOf(request);
    const input = answerSchema.parse(request.body);
    const response = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM challenge_attempts WHERE id = ${input.attemptId}::uuid AND person_id = ${principal.personId}::uuid FOR UPDATE`;
      const attempt = await tx.challengeAttempt.findFirstOrThrow({ where: { id: input.attemptId, personId: principal.personId }, include: { answers: true } });
      const snapshot = snapshotOf(attempt.questionSnapshot);
      if (!snapshot.questions.some(({ questionVersionId }) => questionVersionId === input.questionVersionId)) throw Object.assign(new Error("题目不属于本次挑战"), { statusCode: 403, code: "CHALLENGE_QUESTION_FORBIDDEN" });
      const existing = attempt.answers.find(({ questionVersionId }) => questionVersionId === input.questionVersionId);
      const version = await tx.questionVersion.findUniqueOrThrow({ where: { id: input.questionVersionId }, select: { correct: true, explanation: true } });
      if (existing) {
        const awarded = attempt.answers.reduce((sum, answer) => sum + answer.pointsAwarded, 0);
        return { questionVersionId: existing.questionVersionId, correct: existing.correct, explanation: version.explanation, pointsAwarded: 0, originalPointsAwarded: existing.pointsAwarded, todayPoints: awarded, repeated: true };
      }
      const correct = challengeAnswersEqual(input.answer, version.correct);
      const awardedBefore = attempt.answers.reduce((sum, answer) => sum + answer.pointsAwarded, 0);
      const pointsAwarded = scoreFirstAnswer({ correct, alreadyAnswered: false, dailyAwarded: awardedBefore });
      const answer = await tx.challengeAnswer.create({ data: { attemptId: attempt.id, questionVersionId: input.questionVersionId, answer: input.answer as Prisma.InputJsonValue, correct, pointsAwarded } });
      if (pointsAwarded > 0) {
        const organization = await primaryInternalOrganization(principal.personId, tx);
        await tx.challengePointLedger.create({ data: { personId: principal.personId, organizationIdSnapshot: organization?.organizationId ?? null, answerId: answer.id, sourceType: "challenge_answer", sourceKey: `challenge-answer:${answer.id}`, points: pointsAwarded } });
      }
      const answeredCount = attempt.answers.length + 1;
      if (answeredCount >= snapshot.questions.length && !attempt.completedAt) await tx.challengeAttempt.update({ where: { id: attempt.id }, data: { completedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "challenge.answer", objectType: "challenge_attempt", objectId: attempt.id, result: "success", metadata: { questionVersionId: input.questionVersionId, correct, pointsAwarded } } });
      return { questionVersionId: input.questionVersionId, correct, explanation: version.explanation, pointsAwarded, originalPointsAwarded: pointsAwarded, todayPoints: awardedBefore + pointsAwarded, repeated: false };
    });
    return { data: response };
  });

  app.get("/api/me/challenge-points", authenticated, async (request) => {
    const principal = principalOf(request);
    const now = new Date();
    const day = challengeDayRange(now, TIME_ZONE);
    const month = challengeMonthRange(now, TIME_ZONE);
    const [total, monthTotal, today] = await Promise.all([
      prisma.challengePointLedger.aggregate({ where: { personId: principal.personId, voidedAt: null }, _sum: { points: true } }),
      prisma.challengePointLedger.aggregate({ where: { personId: principal.personId, voidedAt: null, occurredAt: { gte: month.start, lt: month.end } }, _sum: { points: true } }),
      prisma.challengePointLedger.aggregate({ where: { personId: principal.personId, voidedAt: null, occurredAt: { gte: day.start, lt: day.end } }, _sum: { points: true } })
    ]);
    return { data: { total: total._sum.points ?? 0, month: month.month, monthPoints: monthTotal._sum.points ?? 0, todayPoints: today._sum.points ?? 0 } };
  });

  app.get("/api/challenge/leaderboards", authenticated, async (request) => {
    const principal = principalOf(request);
    const query = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), type: z.enum(["person", "organization"]) }).strict().parse(request.query);
    const current = challengeMonthRange(new Date(), TIME_ZONE);
    const range = query.month ? challengeMonthRangeFromKey(query.month, TIME_ZONE) : current;
    if (range.start >= current.end) throw Object.assign(new Error("不能查询未来月份"), { statusCode: 400, code: "FUTURE_CHALLENGE_MONTH" });
    if (query.type === "organization") {
      const rows = range.end <= current.start ? await finalizedOrganizationRanks(range) : await currentOrganizationRanks(range);
      return { data: { month: range.month, type: query.type, rows } };
    }
    const priorRange = challengeMonthRangeFromKey(previousMonth(range.month), TIME_ZONE);
    const [scores, previousScores] = await Promise.all([personalScores(range), personalScores(priorRange)]);
    const previousRanks = new Map(rankPersonalScores(previousScores).map((entry) => [entry.personId, entry.rank]));
    const view = personalLeaderboardView(rankPersonalScores(scores, previousRanks), principal.personId);
    return { data: { month: range.month, type: query.type, ...view, self: view.self ?? { personId: principal.personId, rank: null, rankChange: null, points: 0 } } };
  });
}
