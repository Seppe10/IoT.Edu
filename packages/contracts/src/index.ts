import { z } from "zod";

export const APP_VERSION = "0.1.0";
export const FABRIC_LABEL = "IoT.Edu Management";

export const capabilityStateSchema = z.enum([
  "available",
  "needs_setup",
  "unsupported",
  "mock_only",
  "temporarily_unavailable",
]);
export type CapabilityState = z.infer<typeof capabilityStateSchema>;

export const componentStatusSchema = z.enum([
  "verified",
  "experimental",
  "template",
  "planned",
]);
export type ComponentStatus = z.infer<typeof componentStatusSchema>;

export const componentTypeSchema = z.enum([
  "sensor",
  "actuator",
  "core",
  "template",
]);
export type ComponentType = z.infer<typeof componentTypeSchema>;

export const kconfigPinSchema = z.object({
  key: z.string().min(1),
  pinName: z.string().min(1),
  default: z.number().int(),
});

export const firmwareBindingSchema = z.object({
  idfComponentDir: z.string().min(1),
  registerFunction: z.string().min(1).nullable(),
  requires: z.array(z.string()),
  kconfig: z.array(kconfigPinSchema),
  matter: z.object({
    endpoints: z.array(z.string()),
    clusters: z.array(z.string()),
  }),
});

export const componentManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().min(1),
  type: componentTypeSchema,
  version: z.string().min(1),
  status: componentStatusSchema,
  source: z.literal("local"),
  target: z.literal("esp32h2"),
  idfCompatibility: z.string().min(1),
  selectableForBuild: z.boolean(),
  firmware: firmwareBindingSchema.nullable(),
});
export type ComponentManifest = z.infer<typeof componentManifestSchema>;

export const checkStatusSchema = z.enum(["passed", "failed", "unknown", "warning"]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const preflightCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: checkStatusSchema,
  mandatory: z.boolean(),
  detail: z.string(),
});
export type PreflightCheck = z.infer<typeof preflightCheckSchema>;

export const managedNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  simulated: z.boolean(),
  matterNodeId: z.string().nullable(),
  vendorId: z.number().int().nullable(),
  productId: z.number().int().nullable(),
  softwareVersion: z.number().int().nullable(),
  softwareVersionString: z.string().nullable(),
  hardware: z.string(),
  reachable: z.boolean().nullable(),
  fabricLabel: z.string(),
  commissionedFabricCount: z.number().int().nullable(),
  otherFabricCount: z.number().int().nullable(),
  partitionLayoutId: z.string().nullable(),
  hardwareVersion: z.number().int().nullable().optional(),
  hardwareVersionString: z.string().nullable().optional(),
  connection: z.enum(["commissioned", "reachable", "offline", "unknown"]).optional(),
  lastCommunicationAt: z.string().nullable().optional(),
  firmwareUpdateEligible: z.boolean().nullable().optional(),
  managementFabricId: z.string().nullable().optional(),
  installedComponents: z.array(z.string()),
  history: z.array(
    z.object({
      at: z.string(),
      kind: z.string(),
      detail: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ManagedNode = z.infer<typeof managedNodeSchema>;

export const commissionRequestSchema = z.object({
  path: z.enum(["new_device", "smart_home"]),
  name: z.string().min(1).max(80),
  pairingCode: z.string().max(512).optional(),
  confirm: z.literal(true),
  acknowledgeSimulation: z.literal(true).optional(),
});
export type CommissionRequest = z.infer<typeof commissionRequestSchema>;

export const commissionResultSchema = z.object({
  simulated: z.boolean(),
  matterSessionOpened: z.boolean(),
  node: managedNodeSchema,
  message: z.string(),
  limitation: z.string().nullable(),
}).refine((result) => result.simulated !== result.matterSessionOpened, {
  message: "A simulated record cannot be a live Matter session",
});
export type CommissionResult = z.infer<typeof commissionResultSchema>;

export const controllerStatusSchema = z.object({
  identityLoaded: z.boolean(),
  persisted: z.boolean(),
  fabricLabel: z.string(),
  fabricId: z.string().nullable(),
  credentialId: z.string().nullable(),
  controllerNodeId: z.string().nullable(),
  matterJsVersion: z.string().nullable(),
  regenerationBlocked: z.boolean(),
  message: z.string(),
  backup: z.string(),
});
export type ControllerStatus = z.infer<typeof controllerStatusSchema>;

export const refreshResultSchema = z.object({
  node: managedNodeSchema,
  liveRead: z.enum(["unavailable", "read", "failed"]),
  message: z.string(),
});
export type RefreshResult = z.infer<typeof refreshResultSchema>;

export const commissioningWindowResultSchema = z.object({
  opened: z.boolean(),
  message: z.string(),
  manualPairingCode: z.string().optional(),
  qrPairingCode: z.string().optional(),
});
export type CommissioningWindowResult = z.infer<typeof commissioningWindowResultSchema>;

export const buildModeSchema = z.enum(["mock", "native", "docker"]);
export type BuildMode = z.infer<typeof buildModeSchema>;

export const codeSourceSchema = z.enum(["approved", "upload", "ai_draft"]);

export const pinAssignmentSchema = z.object({
  componentId: z.string(),
  pinName: z.string(),
  gpio: z.number().int(),
});

export const firmwareBuildRequestSchema = z.object({
  mode: buildModeSchema,
  codeSource: codeSourceSchema,
  nodeId: z.string().nullable(),
  hardware: z.literal("esp32h2"),
  baseFirmwareId: z.string(),
  componentIds: z.array(z.string()),
  pins: z.array(pinAssignmentSchema),
  softwareVersion: z.number().int().positive(),
  softwareVersionString: z.string().min(1).max(32),
  uploadId: z.string().nullable(),
  confirm: z.literal(true),
});
export type FirmwareBuildRequest = z.infer<typeof firmwareBuildRequestSchema>;

export const validationIssueSchema = z.object({
  level: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const validationResultSchema = z.object({
  ok: z.boolean(),
  issues: z.array(validationIssueSchema),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const jobStatusSchema = z.enum([
  "simulated",
  "blocked",
  "failed",
  "succeeded",
  "interrupted",
  "running",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const firmwareVerificationSchema = z.enum([
  "simulated",
  "compiled",
  "hardware_verified",
]);
export type FirmwareVerification = z.infer<typeof firmwareVerificationSchema>;

export const buildArtifactSchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative(),
  simulated: z.boolean(),
  deployable: z.boolean(),
});
export type BuildArtifact = z.infer<typeof buildArtifactSchema>;

export const buildJobSchema = z.object({
  id: z.string(),
  simulated: z.boolean(),
  verification: firmwareVerificationSchema.nullable(),
  status: jobStatusSchema,
  request: firmwareBuildRequestSchema,
  validation: validationResultSchema,
  logs: z.array(z.string()),
  artifacts: z.array(buildArtifactSchema),
  partitionLayoutId: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BuildJob = z.infer<typeof buildJobSchema>;

export const otaRequestSchema = z
  .object({
    nodeId: z.string().min(1),
    buildId: z.string().min(1),
    artifactName: z.string().min(1),
    userApproved: z.boolean(),
    confirm: z.literal(true),
  })
  .strict();
export type OtaRequest = z.infer<typeof otaRequestSchema>;

export const preflightResultSchema = z.object({
  allowed: z.boolean(),
  checks: z.array(preflightCheckSchema),
  message: z.string(),
});
export type PreflightResult = z.infer<typeof preflightResultSchema>;

export const otaStageSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(["not_observed", "simulated", "observed_ok", "observed_failed"]),
  detail: z.string(),
});

export const otaJobSchema = z.object({
  id: z.string(),
  simulated: z.boolean(),
  status: jobStatusSchema,
  request: otaRequestSchema,
  preflight: preflightResultSchema,
  stages: z.array(otaStageSchema),
  installedVersionConfirmed: z.boolean(),
  message: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OtaJob = z.infer<typeof otaJobSchema>;

export const capabilityReportSchema = z.object({
  applicationVersion: z.string(),
  matterCommissioning: capabilityStateSchema,
  bleCommissioning: capabilityStateSchema,
  threadDataset: capabilityStateSchema,
  firmwareBuild: capabilityStateSchema,
  otaProvider: capabilityStateSchema,
  usbFlash: capabilityStateSchema,
  ai: capabilityStateSchema,
  notes: z.array(z.string()),
});
export type CapabilityReport = z.infer<typeof capabilityReportSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const renameNodeSchema = z.object({
  name: z.string().min(1).max(80),
  confirm: z.literal(true),
});

export const aiDraftRequestSchema = z.object({
  peripheralName: z.string().min(1),
  interfaceName: z.string().min(1),
  gpioNotes: z.string().min(1),
  behaviour: z.string().min(1),
  matterFunction: z.string().min(1),
  dependencies: z.string(),
});
export type AiDraftRequest = z.infer<typeof aiDraftRequestSchema>;

export interface CatalogRepository {
  list(): Promise<ComponentManifest[]>;
  getById(id: string): Promise<ComponentManifest | null>;
  validate(): Promise<ValidationResult>;
  search(query: string, status?: ComponentStatus): Promise<ComponentManifest[]>;
}

export interface NodeRepository {
  list(): Promise<ManagedNode[]>;
  getById(id: string): Promise<ManagedNode | null>;
  save(node: ManagedNode): Promise<void>;
}

export interface FirmwareBuildService {
  validate(input: FirmwareBuildRequest): Promise<ValidationResult>;
  build(input: FirmwareBuildRequest): Promise<BuildJob>;
  get(id: string): Promise<BuildJob | null>;
  list(): Promise<BuildJob[]>;
}

export interface MatterManagementService {
  getCapabilities(): Promise<CapabilityReport>;
  getControllerStatus(): Promise<ControllerStatus>;
  createIdentity(): Promise<ControllerStatus>;
  restore(): Promise<void>;
  close(): Promise<void>;
  commission(input: CommissionRequest): Promise<CommissionResult>;
  refreshNode(nodeId: string): Promise<RefreshResult>;
  openCommissioningWindow(nodeId: string): Promise<CommissioningWindowResult>;
}

export interface OtaDeploymentService {
  preflight(input: OtaRequest): Promise<PreflightResult>;
  deploy(input: OtaRequest): Promise<OtaJob>;
  get(id: string): Promise<OtaJob | null>;
}

export const programIntentSchema = z.enum(["initial_install", "reflash", "commissioned_maintenance"]);
export type ProgramIntent = z.infer<typeof programIntentSchema>;

export const programRequestSchema = z
  .object({
    buildId: z.string().regex(/^[A-Za-z0-9-]{1,80}$/),
    port: z.string().min(1).max(128),
    intent: programIntentSchema,
    confirm: z.literal(true),
    preserveNvs: z.literal(true),
    acknowledgeCommissioned: z.boolean().optional(),
  })
  .strict();
export type ProgramRequest = z.infer<typeof programRequestSchema>;

export const startupCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["passed", "failed", "unknown"]),
  detail: z.string(),
});
export type StartupCheck = z.infer<typeof startupCheckSchema>;

export const programSessionSchema = z.object({
  id: z.string(),
  buildId: z.string(),
  port: z.string(),
  intent: programIntentSchema,
  status: z.enum(["running", "succeeded", "failed", "interrupted"]),
  stage: z.enum(["writing", "monitoring", "idle"]),
  progressPercent: z.number().int().min(0).max(100).nullable(),
  logs: z.array(z.string()),
  monitorLog: z.string(),
  checks: z.array(startupCheckSchema),
  message: z.string(),
  eraseAll: z.literal(false),
  nvsPreserved: z.literal(true),
  hardwareVerified: z.literal(false),
  softwareVersionString: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProgramSession = z.infer<typeof programSessionSchema>;

export const OTA_LIFECYCLE = [
  { id: "prepare_provider", label: "Preparing the provider" },
  { id: "offer_image", label: "Offering the firmware image" },
  { id: "requestor_ack", label: "Requestor acknowledgement" },
  { id: "transfer", label: "Firmware transfer" },
  { id: "install_reboot", label: "Installation and reboot" },
  { id: "reconnect", label: "Reconnection" },
  { id: "validate", label: "Post-update validation" },
  { id: "complete", label: "Completion" },
] as const;
