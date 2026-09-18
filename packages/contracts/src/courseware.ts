import { z } from "zod";

export const COURSEWARE_SCHEMA_VERSION = 1 as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const key = text(120);

const checkpointQuestionTypes = ["single_choice", "multiple_choice", "true_false"] as const;

const BaseCoursewareBlockSchema = z.discriminatedUnion("type", [
  z.object({
    key,
    type: z.literal("knowledge"),
    title: text(160),
    body: text(10_000),
    imageFileId: z.string().uuid().nullable()
  }).strict(),
  z.object({
    key,
    type: z.literal("do_dont"),
    title: text(160),
    dos: z.array(text(500)).min(1).max(20),
    donts: z.array(text(500)).min(1).max(20)
  }).strict(),
  z.object({
    key,
    type: z.literal("steps"),
    title: text(160),
    steps: z.array(text(1000)).min(1).max(30)
  }).strict(),
  z.object({
    key,
    type: z.literal("checkpoint"),
    prompt: text(2000),
    questionType: z.enum(checkpointQuestionTypes),
    options: z.array(text(500)).min(2).max(20),
    correctIndexes: z.array(z.number().int().nonnegative()).min(1).max(20),
    explanation: text(4000)
  }).strict(),
  z.object({
    key,
    type: z.literal("scenario"),
    prompt: text(3000),
    choices: z.array(z.object({
      label: text(500),
      consequence: text(3000),
      basis: text(3000)
    }).strict()).min(2).max(20)
  }).strict(),
  z.object({
    key,
    type: z.literal("summary"),
    points: z.array(text(1000)).min(1).max(5)
  }).strict()
]);

export const CoursewareBlockSchema = BaseCoursewareBlockSchema.superRefine((block, context) => {
  if (block.type !== "checkpoint") return;

  const uniqueIndexes = new Set(block.correctIndexes);
  if (uniqueIndexes.size !== block.correctIndexes.length) {
    context.addIssue({ code: "custom", path: ["correctIndexes"], message: "正确选项索引不能重复" });
  }
  if (block.correctIndexes.some((index) => index >= block.options.length)) {
    context.addIssue({ code: "custom", path: ["correctIndexes"], message: "正确选项索引超出选项范围" });
  }
  if (block.questionType !== "multiple_choice" && block.correctIndexes.length !== 1) {
    context.addIssue({ code: "custom", path: ["correctIndexes"], message: "单选和判断题必须且只能有一个正确选项" });
  }
  if (block.questionType === "true_false" && block.options.length !== 2) {
    context.addIssue({ code: "custom", path: ["options"], message: "判断题必须恰好有两个选项" });
  }
});

export const StructuredCoursewareUnitSchema = z.object({
  key,
  title: text(160),
  estimatedMinutes: z.number().int().min(1).max(120),
  blocks: z.array(CoursewareBlockSchema).min(1).max(100)
}).strict();

export const StructuredCoursewareDocumentSchema = z.object({
  schemaVersion: z.literal(COURSEWARE_SCHEMA_VERSION),
  title: text(180),
  summary: text(2000),
  learningObjectives: z.array(text(500)).min(1).max(20),
  estimatedMinutes: z.number().int().min(1).max(480),
  units: z.array(StructuredCoursewareUnitSchema).min(1).max(50)
}).strict().superRefine((document, context) => {
  const unitKeys = new Set<string>();
  const blockKeys = new Set<string>();

  document.units.forEach((unit, unitIndex) => {
    if (unitKeys.has(unit.key)) {
      context.addIssue({ code: "custom", path: ["units", unitIndex, "key"], message: "单元 key 不能重复" });
    }
    unitKeys.add(unit.key);

    unit.blocks.forEach((block, blockIndex) => {
      if (blockKeys.has(block.key)) {
        context.addIssue({ code: "custom", path: ["units", unitIndex, "blocks", blockIndex, "key"], message: "内容块 key 不能重复" });
      }
      blockKeys.add(block.key);
    });
  });
});

export type CoursewareBlock = z.infer<typeof CoursewareBlockSchema>;
export type StructuredCoursewareUnit = z.infer<typeof StructuredCoursewareUnitSchema>;
export type StructuredCoursewareDocument = z.infer<typeof StructuredCoursewareDocumentSchema>;
