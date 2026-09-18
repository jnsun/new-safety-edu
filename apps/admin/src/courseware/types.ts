import {
  COURSEWARE_SCHEMA_VERSION,
  StructuredCoursewareDocumentSchema,
  type CoursewareBlock,
  type StructuredCoursewareDocument
} from "@safety/contracts";

export type { CoursewareBlock, StructuredCoursewareDocument };
export type CoursewareBlockType = CoursewareBlock["type"];

export const COURSEWARE_BLOCK_LABELS: Record<CoursewareBlockType, string> = {
  knowledge: "图文知识卡",
  do_dont: "应该 / 不应该",
  steps: "操作步骤",
  checkpoint: "随堂题",
  scenario: "情境选择",
  summary: "三点总结"
};

export type CoursewareEditorState = {
  document: StructuredCoursewareDocument;
  dirty: boolean;
  revision: number;
  savedRevision: number | null;
};

export type EditorAction =
  | { type: "document"; patch: Partial<Pick<StructuredCoursewareDocument, "summary" | "learningObjectives" | "estimatedMinutes">> }
  | { type: "add_unit" }
  | { type: "update_unit"; unitKey: string; patch: { title?: string; estimatedMinutes?: number } }
  | { type: "remove_unit"; unitKey: string }
  | { type: "add"; unitKey: string; block: CoursewareBlock; index?: number }
  | { type: "update"; unitKey: string; key: string; patch: Partial<CoursewareBlock> }
  | { type: "duplicate"; unitKey: string; key: string }
  | { type: "remove"; unitKey: string; key: string }
  | { type: "move"; unitKey: string; key: string; direction: -1 | 1 }
  | { type: "saved"; revision: number };

export function editorDismissalBlockMessage(saving: boolean) {
  return saving ? "正在保存，请稍候" : null;
}

export function coursewareNavigationDecision({ editorOpen, dirty, saving }: { editorOpen: boolean; dirty: boolean; saving: boolean }) {
  if (!editorOpen) return "allow" as const;
  if (saving) return "block_saving" as const;
  if (dirty) return "confirm_discard" as const;
  return "allow" as const;
}

export function replaceSavingEditorIfStillActive<T>(current: T | undefined, savingEditor: T, savedEditor: T): T | undefined {
  return current === savingEditor ? savedEditor : current;
}

type CheckpointBlock = Extract<CoursewareBlock, { type: "checkpoint" }>;

export function normalizeCheckpointQuestionType(block: CheckpointBlock, questionType: CheckpointBlock["questionType"]) {
  const options = questionType === "true_false" ? ["正确", "错误"] : block.options;
  const validIndexes = [...new Set(block.correctIndexes)].filter((index) => index < options.length);
  return {
    questionType,
    options,
    correctIndexes: questionType === "multiple_choice" ? (validIndexes.length ? validIndexes : [0]) : [validIndexes[0] ?? 0]
  };
}

function nextKey(prefix: string, usedKeys: Iterable<string>) {
  const used = new Set(usedKeys);
  if (!used.has(`${prefix}-1`)) return `${prefix}-1`;
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

export function createBlock(type: CoursewareBlockType, usedKeys: Iterable<string>): CoursewareBlock {
  const key = nextKey(type.replace("_", "-"), usedKeys);
  switch (type) {
    case "knowledge": return { key, type, title: "", body: "", imageFileId: null };
    case "do_dont": return { key, type, title: "", dos: [""], donts: [""] };
    case "steps": return { key, type, title: "", steps: [""] };
    case "checkpoint": return { key, type, prompt: "", questionType: "single_choice", options: ["", ""], correctIndexes: [0], explanation: "" };
    case "scenario": return { key, type, prompt: "", choices: [{ label: "", consequence: "", basis: "" }, { label: "", consequence: "", basis: "" }] };
    case "summary": return { key, type, points: [""] };
  }
}

export function createEmptyCoursewareDocument(): StructuredCoursewareDocument {
  return {
    schemaVersion: COURSEWARE_SCHEMA_VERSION,
    title: "",
    summary: "",
    learningObjectives: [""],
    estimatedMinutes: 15,
    units: [{ key: "unit-1", title: "第一单元", estimatedMinutes: 15, blocks: [] }]
  };
}

function allBlockKeys(document: StructuredCoursewareDocument) {
  return document.units.flatMap((unit) => unit.blocks.map((block) => block.key));
}

function updateUnit(
  document: StructuredCoursewareDocument,
  unitKey: string,
  update: (unit: StructuredCoursewareDocument["units"][number]) => StructuredCoursewareDocument["units"][number]
) {
  return { ...document, units: document.units.map((unit) => unit.key === unitKey ? update(unit) : unit) };
}

export function editorReducer(state: CoursewareEditorState, action: EditorAction): CoursewareEditorState {
  if (action.type === "saved") return action.revision === state.revision ? { ...state, dirty: false, savedRevision: action.revision } : state;
  const changed = (document: StructuredCoursewareDocument): CoursewareEditorState => ({ document, dirty: true, revision: state.revision + 1, savedRevision: state.savedRevision });
  if (action.type === "document") return changed({ ...state.document, ...action.patch });
  if (action.type === "add_unit") {
    const key = nextKey("unit", state.document.units.map((unit) => unit.key));
    return changed({ ...state.document, units: [...state.document.units, { key, title: `第${state.document.units.length + 1}单元`, estimatedMinutes: 5, blocks: [] }] });
  }
  if (action.type === "update_unit") {
    return changed(updateUnit(state.document, action.unitKey, (unit) => ({ ...unit, ...action.patch })));
  }
  if (action.type === "remove_unit") {
    return changed({ ...state.document, units: state.document.units.filter((unit) => unit.key !== action.unitKey) });
  }

  return changed(updateUnit(state.document, action.unitKey, (unit) => {
      if (action.type === "add") {
        const blocks = [...unit.blocks];
        blocks.splice(action.index ?? blocks.length, 0, action.block);
        return { ...unit, blocks };
      }
      const index = unit.blocks.findIndex((block) => block.key === action.key);
      if (index < 0) return unit;
      if (action.type === "remove") return { ...unit, blocks: unit.blocks.filter((block) => block.key !== action.key) };
      if (action.type === "move") {
        const target = index + action.direction;
        if (target < 0 || target >= unit.blocks.length) return unit;
        const blocks = [...unit.blocks];
        [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
        return { ...unit, blocks };
      }
      if (action.type === "duplicate") {
        const source = unit.blocks[index]!;
        const copy = { ...structuredClone(source), key: nextKey(`${source.key}-copy`, allBlockKeys(state.document)) } as CoursewareBlock;
        const blocks = [...unit.blocks];
        blocks.splice(index + 1, 0, copy);
        return { ...unit, blocks };
      }
      const current = unit.blocks[index]!;
      const replacement = { ...current, ...action.patch, key: current.key, type: current.type } as CoursewareBlock;
      return { ...unit, blocks: unit.blocks.map((block, blockIndex) => blockIndex === index ? replacement : block) };
    }));
}

export function validateCoursewareDocument(input: unknown) {
  return StructuredCoursewareDocumentSchema.safeParse(input);
}
