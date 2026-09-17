import { createHash } from "node:crypto";
import {
  StructuredCoursewareDocumentSchema,
  type StructuredCoursewareDocument
} from "@safety/contracts";

export function canEditCoursewareVersion(version: { status: string }) {
  return version.status === "draft";
}

export function normalizeStructuredCourseware(input: unknown): StructuredCoursewareDocument {
  return StructuredCoursewareDocumentSchema.parse(input);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashStructuredCourseware(input: unknown) {
  return createHash("sha256").update(stableJson(normalizeStructuredCourseware(input))).digest("hex");
}

export function serializeStructuredCoursewareForLearner(input: unknown, resumeState: unknown) {
  const document = normalizeStructuredCourseware(input);
  return {
    schemaVersion: document.schemaVersion,
    estimatedMinutes: document.estimatedMinutes,
    units: document.units,
    resumeState
  };
}
