export type LearningResumeState = { blockKey: string; progressPercent: number };

const validResumeState = (value: unknown): value is LearningResumeState => {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.blockKey === "string" && !!state.blockKey && Number.isInteger(state.progressPercent) && Number(state.progressPercent) >= 0 && Number(state.progressPercent) <= 100;
};

export function latestLearningProgress<T extends { remediationRound: number }>(rows: T[]) {
  return rows.reduce<T | undefined>((latest, row) => !latest || row.remediationRound > latest.remediationRound ? row : latest, undefined);
}

export function resumeUpdateData(current: unknown, incoming: LearningResumeState) {
  return { resumeState: validResumeState(current) && current.progressPercent >= incoming.progressPercent ? current : incoming };
}

export function completionEvidenceError(progress: { openedAt: Date | null; reachedEndAt: Date | null }) {
  if (!progress.openedAt) return "COURSEWARE_NOT_OPENED" as const;
  if (!progress.reachedEndAt) return "COURSEWARE_END_NOT_REACHED" as const;
  return null;
}
