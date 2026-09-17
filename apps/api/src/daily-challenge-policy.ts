import { createHmac } from "node:crypto";

export const DAILY_CHALLENGE_LIMIT = 5;
export const POINTS_PER_CORRECT_ANSWER = 2;
export const DAILY_CHALLENGE_POINT_CAP = 10;

export type DailyQuestionCandidate = {
  id: string;
  active: boolean;
  challengeEnabled: boolean;
  scopeAllowed?: boolean;
};

export function selectDailyQuestions<T extends DailyQuestionCandidate>(candidates: readonly T[], seed: string, limit = DAILY_CHALLENGE_LIMIT): T[] {
  const take = Math.max(0, Math.min(DAILY_CHALLENGE_LIMIT, Math.trunc(limit)));
  return candidates
    .filter((candidate) => candidate.active && candidate.challengeEnabled && candidate.scopeAllowed !== false)
    .map((candidate) => ({ candidate, order: createHmac("sha256", seed).update(candidate.id).digest("hex") }))
    .sort((left, right) => left.order.localeCompare(right.order) || left.candidate.id.localeCompare(right.candidate.id))
    .slice(0, take)
    .map(({ candidate }) => candidate);
}

export function scoreFirstAnswer(input: { correct: boolean; alreadyAnswered: boolean; dailyAwarded: number }) {
  if (!input.correct || input.alreadyAnswered || input.dailyAwarded >= DAILY_CHALLENGE_POINT_CAP) return 0;
  return Math.min(POINTS_PER_CORRECT_ANSWER, DAILY_CHALLENGE_POINT_CAP - Math.max(0, input.dailyAwarded));
}

const numberPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);

export function challengeDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${numberPart(parts, "year")}-${String(numberPart(parts, "month")).padStart(2, "0")}-${String(numberPart(parts, "day")).padStart(2, "0")}`;
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string) {
  const localTimestamp = Date.UTC(year, month - 1, day);
  let instant = localTimestamp;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const represented = Date.UTC(numberPart(parts, "year"), numberPart(parts, "month") - 1, numberPart(parts, "day"), numberPart(parts, "hour"), numberPart(parts, "minute"), numberPart(parts, "second"));
    const next = instant - (represented - localTimestamp);
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function challengeMonthRange(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = numberPart(parts, "year");
  const month = numberPart(parts, "month");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { month: `${year}-${String(month).padStart(2, "0")}`, start: zonedMidnight(year, month, 1, timeZone), end: zonedMidnight(nextYear, nextMonth, 1, timeZone) };
}

const normalizedAnswer = (answer: unknown) => Array.isArray(answer) ? answer.map(String).sort() : [String(answer)].sort();
export const challengeAnswersEqual = (actual: unknown, expected: unknown) => JSON.stringify(normalizedAnswer(actual)) === JSON.stringify(normalizedAnswer(expected));
