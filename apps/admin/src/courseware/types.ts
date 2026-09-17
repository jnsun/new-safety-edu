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
};

export type EditorAction =
  | { type: "document"; patch: Partial<Pick<StructuredCoursewareDocument, "title" | "summary" | "learningObjectives" | "estimatedMinutes">> }
  | { type: "add_unit" }
  | { type: "update_unit"; unitKey: string; patch: { title?: string; estimatedMinutes?: number } }
  | { type: "remove_unit"; unitKey: string }
  | { type: "add"; unitKey: string; block: CoursewareBlock; index?: number }
  | { type: "update"; unitKey: string; key: string; patch: Partial<CoursewareBlock> }
  | { type: "duplicate"; unitKey: string; key: string }
  | { type: "remove"; unitKey: string; key: string }
  | { type: "move"; unitKey: string; key: string; direction: -1 | 1 }
  | { type: "saved" };

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
  if (action.type === "saved") return { ...state, dirty: false };
  if (action.type === "document") return { document: { ...state.document, ...action.patch }, dirty: true };
  if (action.type === "add_unit") {
    const key = nextKey("unit", state.document.units.map((unit) => unit.key));
    return { document: { ...state.document, units: [...state.document.units, { key, title: `第${state.document.units.length + 1}单元`, estimatedMinutes: 5, blocks: [] }] }, dirty: true };
  }
  if (action.type === "update_unit") {
    return { document: updateUnit(state.document, action.unitKey, (unit) => ({ ...unit, ...action.patch })), dirty: true };
  }
  if (action.type === "remove_unit") {
    return { document: { ...state.document, units: state.document.units.filter((unit) => unit.key !== action.unitKey) }, dirty: true };
  }

  return {
    document: updateUnit(state.document, action.unitKey, (unit) => {
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
    }),
    dirty: true
  };
}

export function validateCoursewareDocument(input: unknown) {
  return StructuredCoursewareDocumentSchema.safeParse(input);
}
