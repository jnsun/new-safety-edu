import type { QuestionType } from "@prisma/client";

export const nextQuestionVersion = (current: number) => current + 1;

export function questionVersionSnapshot(question: { id: string; version: number; type: QuestionType; prompt: string; options: unknown; correct: unknown; explanation: string | null }, score: number) {
  return { id: question.id, questionVersionId: question.id, questionVersion: question.version, type: question.type, prompt: question.prompt, options: question.options, correct: question.correct, score };
}
