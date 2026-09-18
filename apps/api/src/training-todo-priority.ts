export type TodoPriorityInput = {
  trainingType: "three_level" | "project_induction" | "routine" | "change_update";
  status: string;
  dueAt: Date | null;
  createdAt: Date;
};

export type TodoPriorityResult = {
  isThreeLevelPriority: boolean;
  priorityRank: number;
  priorityReason: "请优先完成三级安全教育" | "已逾期" | "临近截止" | null;
  blocksOtherTraining: false;
};

export function decorateTodoPriority<T extends TodoPriorityInput>(row: T, now: Date): T & TodoPriorityResult {
  const isThreeLevelPriority = row.trainingType === "three_level" && row.status !== "completed" && row.status !== "cancelled";
  const overdue = !!row.dueAt && row.dueAt.getTime() < now.getTime();
  const dueSoon = !!row.dueAt && row.dueAt.getTime() >= now.getTime() && row.dueAt.getTime() - now.getTime() <= 3 * 86_400_000;
  return { ...row, isThreeLevelPriority, priorityRank: isThreeLevelPriority ? 0 : overdue ? 1 : dueSoon ? 2 : 3, priorityReason: isThreeLevelPriority ? "请优先完成三级安全教育" : overdue ? "已逾期" : dueSoon ? "临近截止" : null, blocksOtherTraining: false };
}

export function sortTodoAssignments<T extends TodoPriorityResult>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.priorityRank - right.priorityRank);
}
