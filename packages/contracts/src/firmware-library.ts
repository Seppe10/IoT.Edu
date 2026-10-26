import { z } from "zod";

const libraryIssueSchema = z.object({
  level: z.enum(["error", "warning", "info"]),
  code: z.string(),
  message: z.string(),
  file: z.string().min(1).max(240).optional(),
  line: z.number().int().positive().optional(),
});

export const libraryIntegrationSchema = z.object({
  functionName: z.string().min(1).max(80),
  signature: z.string().min(1).max(160),
  endpointOwnedBy: z.enum(["host", "component"]),
});
export type LibraryIntegration = z.infer<typeof libraryIntegrationSchema>;

export const libraryGpioSchema = z.object({
  name: z.string().trim().min(1).max(40),
  gpio: z.number().int(),
  description: z.string().trim().max(120).optional().default(""),
});
export type LibraryGpio = z.infer<typeof libraryGpioSchema>;

export const libraryFileSchema = z.object({
  name: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
});
export type LibraryFile = z.infer<typeof libraryFileSchema>;

export const libraryComponentSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(600),
  type: z.enum(["sensor", "actuator"]),
  provenance: z.enum(["custom", "approved"]),
  target: z.literal("esp32h2"),
  compatibility: z.string().nullable(),
  gpio: z.array(libraryGpioSchema).max(16),
  files: z.array(libraryFileSchema).max(32),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  validation: z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    nativeCompile: z.boolean(),
    validatedAt: z.string(),
    issues: z.array(libraryIssueSchema),
    integration: libraryIntegrationSchema.nullable().default(null),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LibraryComponent = z.infer<typeof libraryComponentSchema>;

export const libraryValidationResponseSchema = z.object({
  ok: z.boolean(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  nativeCompile: z.boolean(),
  integration: libraryIntegrationSchema.nullable(),
  issues: z.array(libraryIssueSchema),
  files: z.array(libraryFileSchema),
});
export type LibraryValidationResponse = z.infer<typeof libraryValidationResponseSchema>;

const libraryBodySchema = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(600),
  type: z.enum(["sensor", "actuator"]),
  gpio: z.array(libraryGpioSchema).max(16),
  retain: z.array(z.string().min(1).max(240)).max(32),
};

export const libraryStageRequestSchema = z.object({
  files: z.array(z.object({
    name: z.string().min(1).max(240),
    contentBase64: z.string().min(1).max(3_000_000),
  })).min(1).max(32),
});
export type LibraryStageRequest = z.infer<typeof libraryStageRequestSchema>;

export const libraryValidateRequestSchema = z.object({
  ...libraryBodySchema,
  stageId: z.string().regex(/^stage-[a-f0-9]{12}$/).nullable(),
  componentId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).nullable(),
});
export type LibraryValidateRequest = z.infer<typeof libraryValidateRequestSchema>;

export const libraryCreateRequestSchema = z.object({
  ...libraryBodySchema,
  stageId: z.string().regex(/^stage-[a-f0-9]{12}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LibraryCreateRequest = z.infer<typeof libraryCreateRequestSchema>;

export const libraryUpdateRequestSchema = z.object({
  ...libraryBodySchema,
  stageId: z.string().regex(/^stage-[a-f0-9]{12}$/).nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  baseRevision: z.number().int().positive(),
});
export type LibraryUpdateRequest = z.infer<typeof libraryUpdateRequestSchema>;
