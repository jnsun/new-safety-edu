export type PersonalScore = { personId: string; name: string; organizationName: string | null; points: number; reachedAt: Date };
export type PersonalRank = PersonalScore & { rank: number; rankChange: number | null };
export type OrganizationScore = { organizationId: string; name: string; type: string; activePersonCount: number; participantCount: number; totalPoints: number };
export type OrganizationRank = OrganizationScore & { averagePoints: number; participationRate: number; rewardEligible: boolean; rank: number };

export function rankPersonalScores(current: readonly PersonalScore[], previousRanks: ReadonlyMap<string, number> = new Map()): PersonalRank[] {
  return [...current]
    .sort((left, right) => right.points - left.points || left.reachedAt.getTime() - right.reachedAt.getTime() || left.personId.localeCompare(right.personId))
    .map((entry, index) => ({ ...entry, rank: index + 1, rankChange: previousRanks.has(entry.personId) ? previousRanks.get(entry.personId)! - (index + 1) : null }));
}

export function personalLeaderboardView(ranked: readonly PersonalRank[], personId: string, limit = 20, radius = 2) {
  const top = ranked.slice(0, limit);
  const ownIndex = ranked.findIndex((entry) => entry.personId === personId);
  const nearby = ownIndex < 0 ? [] : ranked.slice(Math.max(0, ownIndex - radius), ownIndex + radius + 1);
  return { top, nearby, self: ownIndex < 0 ? null : ranked[ownIndex]! };
}

export function rankOrganizationScores(input: readonly OrganizationScore[]): OrganizationRank[] {
  return input
    .filter((entry) => ["department", "business_entity"].includes(entry.type))
    .map((entry) => ({
      ...entry,
      averagePoints: entry.activePersonCount ? entry.totalPoints / entry.activePersonCount : 0,
      participationRate: entry.activePersonCount ? entry.participantCount / entry.activePersonCount : 0,
      rewardEligible: entry.activePersonCount >= 3
    }))
    .sort((left, right) => right.averagePoints - left.averagePoints || right.participationRate - left.participationRate || left.name.localeCompare(right.name, "zh-CN"))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
