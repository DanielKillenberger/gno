import { z } from "zod";

const FORBIDDEN_POINTER_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)*$/;
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

const JsonPointerSchema = z
  .string()
  .max(512)
  .refine((value) => POINTER_PATTERN.test(value), "Invalid JSON Pointer")
  .refine(
    (value) => value.split("/").length <= 33,
    "JSON Pointer exceeds 32 segments"
  )
  .refine(
    (value) =>
      value
        .split("/")
        .slice(1)
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .every((segment) => !FORBIDDEN_POINTER_SEGMENTS.has(segment)),
    "JSON Pointer contains a forbidden property"
  );

const FieldSelectorSchema = z.union([
  JsonPointerSchema,
  z.array(JsonPointerSchema).min(1).max(8),
]);

export const JsonlFieldMappingSchema = z
  .object({
    id: FieldSelectorSchema.optional(),
    body: FieldSelectorSchema.optional(),
    title: FieldSelectorSchema.optional(),
    author: FieldSelectorSchema.optional(),
    participants: FieldSelectorSchema.optional(),
    categories: FieldSelectorSchema.optional(),
    sessionId: FieldSelectorSchema.optional(),
    threadId: FieldSelectorSchema.optional(),
    dateFields: z
      .record(z.string().regex(FIELD_NAME_PATTERN), FieldSelectorSchema)
      .superRefine((fields, context) => {
        if (Object.keys(fields).length > 16) {
          context.addIssue({
            code: "custom",
            message: "JSONL date-field mapping exceeds 16 entries",
          });
        }
      })
      .optional(),
  })
  .strict();

export type JsonlFieldSelector = z.infer<typeof FieldSelectorSchema>;
export type JsonlFieldMapping = z.infer<typeof JsonlFieldMappingSchema>;

export const parseJsonlFieldMapping = (
  mapping: JsonlFieldMapping | undefined
): JsonlFieldMapping => JsonlFieldMappingSchema.parse(mapping ?? {});

const pointerSegments = (pointer: string): string[] =>
  pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));

export const resolveJsonPointer = (
  value: unknown,
  pointer: string
): unknown => {
  let current = value;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (
      !current ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

export const resolveJsonlField = (
  value: unknown,
  selector: JsonlFieldSelector | undefined
): unknown => {
  if (selector === undefined) return undefined;
  const pointers = Array.isArray(selector) ? selector : [selector];
  for (const pointer of pointers) {
    const resolved = resolveJsonPointer(value, pointer);
    if (resolved !== undefined && resolved !== null) return resolved;
  }
  return undefined;
};
