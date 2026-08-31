import {
  analyzeFieldDeletion,
  builtInDesignTemplateRepository,
  compileDocumentGenerationRequest,
  componentInstanceMetadataPatchSchema,
  componentOverridePropertySchema,
  componentTransformSchema,
  formatFieldValueForText,
  imageFrameMaskSchema,
  imagePlacementSchema,
  managedAssetIdFromSource,
  managedImageAssetIdentity,
  materializeTemplateVersion,
  mediaAssetIdSchema,
  paintStylePatchSchema,
  paintStyleSchema,
  sceneNodePatchSchema,
  typographyStylePatchSchema,
  typographyStyleSchema,
  designStyleTargetSchema,
  designVariablePatchSchema,
  designVariableSchema,
  documentGenerationRequestSchema,
  generatedDocumentSnapshotId,
  variableBindingTargetSchema,
  validateAssetFieldPublicationIdentities,
  validateRenderPolicy,
  validateDocument,
  type ChangeSet,
  type GeneratedDocumentPlan,
  type Document,
  type TemplateModifications,
  type TemplateVersion,
  type SceneNode,
} from "@webmcp/document"
import {
  productCommandArgumentContract,
  productCommandExecutionPolicy,
  productCommandIds,
  projectProductCommandCapabilities,
  resolveProductCommand,
  type ProductCommandArguments,
  type ProductCommandCategory,
  type ProductCommandId,
  type ProductCommandRuntimeContext,
  type ProductCommandRunResult,
  type ProductCommandScope,
  type ResolvedProductCommand,
} from "@webmcp/editor/product-commands"
import {
  createAssetInsertionChangeSet,
  createCanvasEditChangeSet,
  createComponentChangeSet,
  createDesignStyleChangeSet,
  createDesignVariableChangeSet,
  createFieldUpdateChangeSet,
  createOutputVariantChangeSet,
  type CanvasEditProposalInput,
  type ComponentProposalChange,
  type ComponentProposalInput,
  type DesignStyleProposalChange,
  type DesignStyleProposalInput,
  type DesignVariableProposalChange,
  type DesignVariableProposalInput,
  type FieldUpdateProposalInput,
  type OutputVariantProposalInput,
} from "./change-sets"
import {
  DESIGN_QUERY_MAX_DEPTH,
  DESIGN_QUERY_MAX_LIMIT,
  DesignQueryError,
  readDesignNode,
  readDesignComponents,
  readDesignStyles,
  readDesignVariables,
  readDesignTree,
  searchDesignNodes,
  type DesignNodeSearchQuery,
  type DesignQueryIdentity,
  type DesignTreeQuery,
} from "./design-queries"
import {
  createProductCommandProposal,
  ProductCommandProposalError,
} from "./product-command-proposals"
import {
  readBlankDocumentPresets,
  readDesignPlanSchema,
  readGenerationCapabilities,
  readGenerationTemplate,
  searchGenerationTemplates,
} from "./generation-discovery"

export type WebMcpToolResult = {
  content: Array<{ type: "text"; text: string }>
  structuredContent?: unknown
  isError?: boolean
}

export type WebMcpTool = {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
    untrustedContentHint?: boolean
  }
  execute(
    input: unknown,
    context?: { signal: AbortSignal }
  ): WebMcpToolResult | Promise<WebMcpToolResult>
}

export type WebMcpModelContext = {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] }
  ): Promise<undefined>
}

export type StudioWebMcpSnapshot = {
  document: Document
  snapshotId: string
  operationVersion: number
  activePageId: string
  selection: { pageId: string; nodeIds: string[] } | null
  pendingChangeSet: ChangeSet | null
  assets: readonly StudioWebMcpAsset[]
  publishedVersion: TemplateVersion | null
  renderHistory: readonly StudioWebMcpRenderRecord[]
  /**
   * Public projection of the same typed command policy used by Studio's
   * toolbar, inspector, keyboard, and canvas. Runtime-only reasons such as an
   * image still decoding belong here rather than being guessed from document
   * structure by an automation client.
   */
  commandCapabilities?: readonly StudioWebMcpCommandCapability[]
  /** Private runtime policy input. Never return this object from a tool. */
  productCommandContext?: ProductCommandRuntimeContext | null
}

export type StudioWebMcpCommandCapability = Readonly<{
  id: string
  label: string
  enabled: boolean
  reason?: string
  commandId?: ProductCommandId
  category?: ProductCommandCategory
  subgroup?: string
  scope?: ProductCommandScope
  mutating?: boolean
  destructive?: boolean
  discoverable?: boolean
  stableTargetRequired?: boolean
  disabledReason?: string | null
  checked?: boolean | "mixed"
  target?: unknown
  arguments?: unknown
  argumentContract?: unknown
  execution?:
    | "not_exposed"
    | Readonly<{
        modes: readonly ("dry_run" | "proposal" | "direct")[]
        reason: string | null
        recommendedTool: string | null
      }>
}>

export type StudioWebMcpAsset = {
  id: string
  name: string
  description?: string
  tags: readonly string[]
  width: number
  height: number
  ownership: "built_in" | "workspace"
  selectable: boolean
  license?: string
  /** Private projection used only to build canonical document commands. */
  src: string
}

export type StudioWebMcpAssetSearchInput = {
  query: string
  orientation?: "portrait" | "landscape" | "square"
  tags: readonly string[]
  limit: number
  cursor: string | null
}

export type StudioWebMcpAssetSearchPage = {
  assets: readonly StudioWebMcpAsset[]
  nextCursor: string | null
}

export type StudioWebMcpRenderSelection = {
  outputId: string
  format: "png" | "pdf"
}

export type StudioWebMcpRenderRecord = {
  id: string
  templateId: string
  version: number
  createdAt: string
  completedAt?: string
  status:
    | "queued"
    | "rendering"
    | "retrying"
    | "completed"
    | "failed"
    | "cancelling"
    | "cancelled"
    | "status_unknown"
  modifications: TemplateModifications
  selections: readonly StudioWebMcpRenderSelection[]
  artifacts: readonly {
    id: string
    outputId: string
    pageId?: string
    format: "png" | "pdf"
    filename: string
    bytes: number
    width?: number
    height?: number
  }[]
  error?: string
}

export type StudioWebMcpServices = {
  getSnapshot(): StudioWebMcpSnapshot
  searchAssets(
    input: StudioWebMcpAssetSearchInput,
    signal?: AbortSignal
  ): Promise<StudioWebMcpAssetSearchPage>
  resolveAsset(
    assetId: string,
    signal?: AbortSignal
  ): Promise<StudioWebMcpAsset | null>
  proposeChangeSet(
    changeSet: ChangeSet,
    provenance: StudioWebMcpProposalProvenance
  ): ChangeSet
  proposeDocumentGeneration?(
    plan: GeneratedDocumentPlan,
    provenance: StudioWebMcpProposalProvenance
  ): GeneratedDocumentPlan
  runProductCommand?(
    invocation: import("@webmcp/editor/product-commands").ProductCommandInvocation
  ): ProductCommandRunResult
  publishTemplate(
    expected: {
      documentId: string
      revision: number
      snapshotId: string
    },
    options?: { signal?: AbortSignal }
  ): TemplateVersion | Promise<TemplateVersion>
  renderTemplate(
    version: TemplateVersion,
    modifications: TemplateModifications,
    selections: StudioWebMcpRenderSelection[],
    options?: { signal?: AbortSignal; idempotencyKey?: string }
  ): Promise<StudioWebMcpRenderRecord>
  id(): string
  now(): string
}

export type StudioWebMcpProposalProvenance = Readonly<{
  source: "webmcp"
  actorLabel: string
  toolName: string
  reason: string | null
  requestId: string | null
}>

const webMcpProposalProvenance = (
  toolName: string,
  reason: string | null = null,
  requestId: string | null = null
): StudioWebMcpProposalProvenance => ({
  source: "webmcp",
  actorLabel: "WebMCP agent",
  toolName,
  reason,
  requestId,
})

const textResult = (
  text: string,
  structuredContent?: unknown
): WebMcpToolResult => ({
  content: [{ type: "text", text }],
  structuredContent,
})

const errorResult = (error: unknown): WebMcpToolResult => {
  const message =
    error instanceof Error ? error.message : "The tool call failed."
  const retryable =
    error instanceof DesignQueryError &&
    new Set([
      "stale_context",
      "command_disabled",
      "capabilities_unavailable",
      "transient_state_not_supported",
      "request_in_progress",
      "execution_declined",
      "review_unavailable",
      "execution_cancelled",
      "execution_status_unknown",
    ]).has(error.code)
  return {
    content: [{ type: "text", text: message }],
    ...(error instanceof DesignQueryError
      ? {
          structuredContent: {
            status: "error",
            code: error.code,
            message,
            retryable,
            ...(error.details ?? {}),
          },
        }
      : {}),
    isError: true,
  }
}

export const WEBMCP_TOOL_EXECUTION_TIMEOUT_MS = 60_000

const waitForWebMcpExecution = <T>(
  pending: Promise<T>,
  signal: AbortSignal
) => {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanUp()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    void pending.then(
      (value) => {
        cleanUp()
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        if (!signal.aborted) reject(error)
      }
    )
  })
}

const ownWebMcpToolExecution = (
  tool: WebMcpTool,
  registrationSignal?: AbortSignal
): WebMcpTool => {
  const execute = tool.execute
  return {
    ...tool,
    execute: async (input) => {
      if (registrationSignal?.aborted) {
        return errorResult(
          new DesignQueryError(
            "execution_cancelled",
            "This WebMCP registration is no longer active. Inspect the current Studio session and retry."
          )
        )
      }
      const controller = new AbortController()
      const abortFromRegistration = () =>
        controller.abort(
          registrationSignal?.reason ??
            new DOMException("WebMCP registration ended.", "AbortError")
        )
      registrationSignal?.addEventListener("abort", abortFromRegistration, {
        once: true,
      })
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException("WebMCP tool execution timed out.", "TimeoutError")
          ),
        WEBMCP_TOOL_EXECUTION_TIMEOUT_MS
      )
      try {
        return await waitForWebMcpExecution(
          Promise.resolve(execute(input, { signal: controller.signal })),
          controller.signal
        )
      } catch {
        const statusUnknown =
          tool.name === "publish_template" || tool.name === "render_template"
        return errorResult(
          new DesignQueryError(
            statusUnknown ? "execution_status_unknown" : "execution_cancelled",
            statusUnknown
              ? "Studio stopped waiting, but the server may have committed this request. Inspect publication or render history before retrying with the same identity."
              : "This WebMCP operation stopped before it could be confirmed. Inspect the current Studio session and retry."
          )
        )
      } finally {
        clearTimeout(timer)
        registrationSignal?.removeEventListener("abort", abortFromRegistration)
      }
    },
  }
}

const publicAssetValue = (
  value: unknown,
  assets: readonly StudioWebMcpAsset[]
) => {
  if (typeof value !== "string" || value === "") return value
  const managedId = managedAssetIdFromSource(value)
  if (managedId) return managedId
  if (mediaAssetIdSchema.safeParse(value).success) return value
  const approved = assets.find(
    (asset) => asset.id === value || asset.src === value
  )
  if (approved) return approved.id
  if (value.startsWith("asset:local/")) return "unavailable-local-asset"
  return "unresolved-managed-asset"
}

const publicSceneNode = (node: Document["nodes"][number]) => {
  if (node.type !== "image") return node
  const { src: _privateRendererSource, ...publicNode } = node
  if (node.src.startsWith("asset:local/")) {
    return { ...publicNode, assetId: "unavailable-local-asset" }
  }
  const identity = managedImageAssetIdentity(node.assetId, node.src)
  return identity.managed
    ? { ...publicNode, assetId: identity.assetId }
    : publicNode
}

const publicChangeSet = (
  changeSet: ChangeSet,
  document: Document,
  assets: readonly StudioWebMcpAsset[]
) => ({
  id: changeSet.id,
  documentId: changeSet.documentId,
  baseRevision: changeSet.baseRevision,
  baseSnapshotId: changeSet.baseSnapshotId,
  title: changeSet.title,
  status: changeSet.status,
  operations: changeSet.operations.map((operation) => {
    const command = operation.command
    if (command.type === "set_field") {
      const field = document.fields.find(
        (candidate) => candidate.id === command.fieldId
      )
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          fieldId: command.fieldId,
          value:
            field?.type === "asset"
              ? publicAssetValue(command.value, assets)
              : command.value,
        },
      }
    }
    if (command.type === "update_node") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          nodeId: command.nodeId,
          patch: Object.fromEntries(
            Object.entries(command.patch).filter(([key]) => key !== "src")
          ),
        },
      }
    }
    if (command.type === "add_output_variant") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          output: command.output,
          page: {
            id: command.page.id,
            name: command.page.name,
            width: command.page.width,
            height: command.page.height,
          },
          layerCount: command.nodes.length,
          bindingCount: command.bindings.length,
          variableBindingCount: command.variableBindings.length,
        },
      }
    }
    if (command.type === "add_node") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          pageId: command.pageId,
          node: {
            id: command.node.id,
            type: command.node.type,
            name: command.node.name,
            x: command.node.x,
            y: command.node.y,
            width: command.node.width,
            height: command.node.height,
            ...(command.node.type === "image"
              ? {
                  assetId: command.node.assetId,
                  alt: command.node.alt,
                  decorative: command.node.decorative,
                  placement: command.node.placement,
                  frameMask: command.node.frameMask,
                }
              : {}),
          },
        },
      }
    }
    if (
      command.type === "create_typography_style" ||
      command.type === "create_paint_style"
    ) {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: { type: command.type, style: command.style },
      }
    }
    if (
      command.type === "update_typography_style" ||
      command.type === "update_paint_style"
    ) {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          styleId: command.styleId,
          patch: command.patch,
        },
      }
    }
    if (
      command.type === "apply_typography_style" ||
      command.type === "apply_paint_style"
    ) {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          styleId: command.styleId,
          targets: command.targets,
        },
      }
    }
    if (
      command.type === "detach_typography_style" ||
      command.type === "detach_paint_style"
    ) {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: { type: command.type, targets: command.targets },
      }
    }
    if (
      command.type === "delete_typography_style" ||
      command.type === "delete_paint_style"
    ) {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: { type: command.type, styleId: command.styleId },
      }
    }
    if (command.type === "create_variable") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: { type: command.type, variable: command.variable },
      }
    }
    if (command.type === "update_variable") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          variableId: command.variableId,
          patch: command.patch,
        },
      }
    }
    if (command.type === "bind_variable") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: { type: command.type, binding: command.binding },
      }
    }
    if (command.type === "unbind_variable") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: { type: command.type, bindingId: command.bindingId },
      }
    }
    if (command.type === "delete_variable") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: { type: command.type, variableId: command.variableId },
      }
    }
    return {
      id: operation.id,
      status: operation.status,
      summary: operation.summary,
      command: { type: command.type },
    }
  }),
})

const publicRenderRecord = (
  record: StudioWebMcpRenderRecord,
  version: TemplateVersion | null,
  assets: readonly StudioWebMcpAsset[]
) => ({
  id: record.id,
  templateId: record.templateId,
  version: record.version,
  status: record.status,
  createdAt: record.createdAt,
  completedAt: record.completedAt,
  modifications: Object.fromEntries(
    Object.entries(record.modifications).map(([key, value]) => {
      const parameter = version?.manifest.parameters.find(
        (candidate) => candidate.key === key
      )
      return [
        key,
        parameter?.type === "asset" ? publicAssetValue(value, assets) : value,
      ]
    })
  ),
  selections: record.selections,
  artifacts: record.artifacts.map((artifact) => ({
    id: artifact.id,
    outputId: artifact.outputId,
    pageId: artifact.pageId,
    format: artifact.format,
    filename: artifact.filename,
    bytes: artifact.bytes,
    width: artifact.width,
    height: artifact.height,
    downloadUrl: `/v1/renders/${record.id}/outputs/${artifact.id}`,
  })),
})

function parseFieldProposalInput(input: unknown): FieldUpdateProposalInput {
  const value = parseProposalIdentity(input)
  if (!value.values || typeof value.values !== "object") {
    throw new Error("values must be an object keyed by shared field key.")
  }
  const values = Object.fromEntries(
    Object.entries(value.values as Record<string, unknown>).map(
      ([key, fieldValue]) => {
        if (
          typeof fieldValue !== "string" &&
          typeof fieldValue !== "number" &&
          typeof fieldValue !== "boolean"
        ) {
          throw new Error(`Invalid primitive value for ${key}.`)
        }
        return [key, fieldValue]
      }
    )
  )
  return {
    documentId: value.documentId as string,
    baseRevision: value.baseRevision as number,
    baseSnapshotId: value.baseSnapshotId as string,
    values,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  }
}

const assetIdForValue = (
  value: string,
  builtInAssets: readonly StudioWebMcpAsset[]
) =>
  managedAssetIdFromSource(value) ??
  builtInAssets.find((asset) => asset.id === value || asset.src === value)
    ?.id ??
  value

async function resolveAssetValue(
  value: string,
  services: StudioWebMcpServices,
  options: { selectable: boolean },
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  if (value.startsWith("asset:local/")) return null
  const snapshot = services.getSnapshot()
  const assetId = assetIdForValue(value, snapshot.assets)
  const asset = await services.resolveAsset(assetId, signal)
  signal?.throwIfAborted()
  if (!asset || (options.selectable && !asset.selectable)) return null
  return asset
}

async function requireAsset(
  value: string,
  services: StudioWebMcpServices,
  context: string,
  options: { selectable: boolean },
  signal?: AbortSignal
) {
  const asset = await resolveAssetValue(value, services, options, signal)
  if (!asset) {
    throw new Error(
      options.selectable
        ? `Unknown or unavailable approved asset ${context}: ${value}. Use search_assets first.`
        : `Unknown approved asset ${context}: ${value}.`
    )
  }
  return asset
}

async function resolveFieldAssetIds(
  document: Document,
  services: StudioWebMcpServices,
  input: FieldUpdateProposalInput,
  options: { selectable: boolean } = { selectable: true },
  signal?: AbortSignal
): Promise<{
  input: FieldUpdateProposalInput
  resolvedAssets: StudioWebMcpAsset[]
}> {
  const resolvedAssets: StudioWebMcpAsset[] = []
  const values = await Promise.all(
    Object.entries(input.values).map(async ([key, value]) => {
      const field = document.fields.find((candidate) => candidate.key === key)
      if (!field || field.type !== "asset") return [key, value] as const
      if (typeof value !== "string") {
        throw new Error(`${field.label} must use an approved asset ID.`)
      }
      if (value === "" && !field.required) return [key, value] as const
      const asset = await requireAsset(
        value,
        services,
        `for ${field.label}`,
        options,
        signal
      )
      resolvedAssets.push(asset)
      return [key, asset.src] as const
    })
  )
  return {
    input: { ...input, values: Object.fromEntries(values) },
    resolvedAssets,
  }
}

async function resolveRenderAssetSources(
  document: Document,
  services: StudioWebMcpServices,
  modifications: TemplateModifications,
  signal?: AbortSignal
): Promise<TemplateModifications> {
  const entries = await Promise.all(
    Object.entries(modifications).map(async ([key, value]) => {
      const field = document.fields.find((candidate) => candidate.key === key)
      if (!field || field.type !== "asset") return [key, value] as const
      if (value === "" && !field.required) return [key, value] as const
      if (typeof value !== "string") {
        throw new Error(`${field.label} must use an approved asset ID.`)
      }
      const asset = await requireAsset(
        value,
        services,
        `for ${field.label}`,
        {
          selectable: false,
        },
        signal
      )
      const effectiveValue =
        document.fieldValues[field.id] === undefined
          ? field.defaultValue
          : document.fieldValues[field.id]
      const effectiveAssetId =
        typeof effectiveValue === "string"
          ? assetIdForValue(effectiveValue, services.getSnapshot().assets)
          : null
      if (!asset.selectable && effectiveAssetId !== asset.id) {
        throw new Error(
          `Archived asset ${asset.id} is not available as a new value for ${field.label}.`
        )
      }
      return [key, asset.src] as const
    })
  )
  return Object.fromEntries(entries)
}

function parseProposalIdentity(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("Expected a proposal object.")
  }
  const value = input as Record<string, unknown>
  if (typeof value.documentId !== "string" || !value.documentId) {
    throw new Error("documentId is required.")
  }
  if (
    typeof value.baseRevision !== "number" ||
    !Number.isInteger(value.baseRevision) ||
    value.baseRevision < 0
  ) {
    throw new Error("baseRevision must be a non-negative integer.")
  }
  if (typeof value.baseSnapshotId !== "string" || !value.baseSnapshotId) {
    throw new Error("baseSnapshotId is required.")
  }
  return value
}

function assertCurrentProposalSnapshot(
  input: unknown,
  snapshot: StudioWebMcpSnapshot
) {
  const value = parseProposalIdentity(input)
  if (value.baseSnapshotId !== snapshot.snapshotId) {
    throw new Error(
      `The document snapshot changed from ${value.baseSnapshotId} to ${snapshot.snapshotId}. Inspect the design again before proposing edits.`
    )
  }
}

function parseCanvasProposalInput(input: unknown): CanvasEditProposalInput {
  const value = parseProposalIdentity(input)
  if (!Array.isArray(value.edits)) throw new Error("edits must be an array.")
  const edits = value.edits.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`edits[${index}] must be an object.`)
    }
    const edit = candidate as Record<string, unknown>
    if (typeof edit.nodeId !== "string" || !edit.nodeId) {
      throw new Error(`edits[${index}].nodeId is required.`)
    }
    if (!isSceneNodeType(edit.nodeType)) {
      throw new Error(
        `edits[${index}].nodeType must be text, rect, ellipse, line, icon, or image.`
      )
    }
    const replacementOnly =
      edit.nodeType === "image" &&
      typeof edit.assetId === "string" &&
      edit.assetId.length > 0 &&
      edit.patch === undefined
    if (
      !replacementOnly &&
      (!edit.patch ||
        typeof edit.patch !== "object" ||
        Array.isArray(edit.patch))
    ) {
      throw new Error(`edits[${index}].patch must be an object.`)
    }
    const patch = parseTypedCanvasPatch(
      edit.nodeType,
      replacementOnly ? {} : edit.patch,
      index,
      replacementOnly
    )
    return {
      nodeType: edit.nodeType,
      nodeId: edit.nodeId,
      patch,
      summary: typeof edit.summary === "string" ? edit.summary : undefined,
      assetId: typeof edit.assetId === "string" ? edit.assetId : undefined,
    }
  })
  return {
    documentId: value.documentId as string,
    baseRevision: value.baseRevision as number,
    baseSnapshotId: value.baseSnapshotId as string,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    edits,
  }
}

function parseDesignStyleProposalInput(
  input: unknown
): DesignStyleProposalInput {
  const value = parseProposalIdentity(input)
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new Error("changes must be a non-empty array.")
  }
  if (value.changes.length > 24) {
    throw new Error("changes can contain no more than 24 operations.")
  }
  const changes = value.changes.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`changes[${index}] must be an object.`)
    }
    const change = candidate as Record<string, unknown>
    if (change.kind !== "typography" && change.kind !== "paint") {
      throw new Error(`changes[${index}].kind must be typography or paint.`)
    }
    if (
      change.action !== "create" &&
      change.action !== "update" &&
      change.action !== "apply" &&
      change.action !== "detach" &&
      change.action !== "delete"
    ) {
      throw new Error(
        `changes[${index}].action must be create, update, apply, detach, or delete.`
      )
    }

    const parseTargets = () => {
      if (
        !Array.isArray(change.targets) ||
        change.targets.length === 0 ||
        change.targets.length > 100
      ) {
        throw new Error(
          `changes[${index}].targets must contain 1 to 100 layer targets.`
        )
      }
      return change.targets.map((target, targetIndex) => {
        const parsed = designStyleTargetSchema.safeParse(target)
        if (!parsed.success) {
          throw new Error(
            `changes[${index}].targets[${targetIndex}] is invalid: ${parsed.error.issues[0]?.message ?? "invalid target"}`
          )
        }
        return parsed.data
      })
    }

    if (change.action === "create") {
      if (!change.style || typeof change.style !== "object") {
        throw new Error(`changes[${index}].style is required.`)
      }
      if (change.kind === "typography") {
        const parsed = typographyStyleSchema.safeParse({
          ...(change.style as Record<string, unknown>),
          id: "temporary-style-id",
        })
        if (!parsed.success) {
          throw new Error(
            `changes[${index}].style is invalid: ${parsed.error.issues[0]?.message ?? "invalid typography style"}`
          )
        }
        const { id: _id, ...style } = parsed.data
        return { kind: "typography", action: "create", style } as const
      }
      const parsed = paintStyleSchema.safeParse({
        ...(change.style as Record<string, unknown>),
        id: "temporary-style-id",
      })
      if (!parsed.success) {
        throw new Error(
          `changes[${index}].style is invalid: ${parsed.error.issues[0]?.message ?? "invalid paint style"}`
        )
      }
      const { id: _id, ...style } = parsed.data
      return { kind: "paint", action: "create", style } as const
    }

    if (change.action === "detach") {
      return {
        kind: change.kind,
        action: "detach",
        targets: parseTargets(),
      } as DesignStyleProposalChange
    }

    if (typeof change.styleId !== "string" || !change.styleId) {
      throw new Error(`changes[${index}].styleId is required.`)
    }
    if (change.action === "delete") {
      return {
        kind: change.kind,
        action: "delete",
        styleId: change.styleId,
      } as DesignStyleProposalChange
    }
    if (change.action === "apply") {
      return {
        kind: change.kind,
        action: "apply",
        styleId: change.styleId,
        targets: parseTargets(),
      } as DesignStyleProposalChange
    }

    const parsed =
      change.kind === "typography"
        ? typographyStylePatchSchema.safeParse(change.patch)
        : paintStylePatchSchema.safeParse(change.patch)
    if (!parsed.success) {
      throw new Error(
        `changes[${index}].patch is invalid: ${parsed.error.issues[0]?.message ?? "invalid style patch"}`
      )
    }
    return {
      kind: change.kind,
      action: "update",
      styleId: change.styleId,
      patch: parsed.data,
    } as DesignStyleProposalChange
  })

  return {
    documentId: value.documentId as string,
    baseRevision: value.baseRevision as number,
    baseSnapshotId: value.baseSnapshotId as string,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    changes,
  }
}

function parseDesignVariableProposalInput(
  input: unknown
): DesignVariableProposalInput {
  const value = parseProposalIdentity(input)
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new Error("changes must be a non-empty array.")
  }
  if (value.changes.length > 24) {
    throw new Error("changes can contain no more than 24 operations.")
  }
  const changes = value.changes.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`changes[${index}] must be an object.`)
    }
    const change = candidate as Record<string, unknown>
    if (
      change.action !== "create" &&
      change.action !== "update" &&
      change.action !== "bind" &&
      change.action !== "unbind" &&
      change.action !== "delete"
    ) {
      throw new Error(
        `changes[${index}].action must be create, update, bind, unbind, or delete.`
      )
    }
    if (change.action === "create") {
      if (!change.variable || typeof change.variable !== "object") {
        throw new Error(`changes[${index}].variable is required.`)
      }
      const parsed = designVariableSchema.safeParse({
        ...(change.variable as Record<string, unknown>),
        id: "temporary-variable-id",
      })
      if (!parsed.success) {
        throw new Error(
          `changes[${index}].variable is invalid: ${parsed.error.issues[0]?.message ?? "invalid variable"}`
        )
      }
      const { id: _id, ...variable } = parsed.data
      return { action: "create", variable } as const
    }
    if (change.action === "unbind") {
      if (typeof change.bindingId !== "string" || !change.bindingId) {
        throw new Error(`changes[${index}].bindingId is required.`)
      }
      return { action: "unbind", bindingId: change.bindingId } as const
    }
    if (typeof change.variableId !== "string" || !change.variableId) {
      throw new Error(`changes[${index}].variableId is required.`)
    }
    if (change.action === "delete") {
      return {
        action: "delete",
        variableId: change.variableId,
      } as const
    }
    if (change.action === "bind") {
      const parsed = variableBindingTargetSchema.safeParse(change.target)
      if (!parsed.success) {
        throw new Error(
          `changes[${index}].target is invalid: ${parsed.error.issues[0]?.message ?? "invalid variable target"}`
        )
      }
      return {
        action: "bind",
        variableId: change.variableId,
        target: parsed.data,
      } as const
    }
    const parsed = designVariablePatchSchema.safeParse(change.patch)
    if (!parsed.success) {
      throw new Error(
        `changes[${index}].patch is invalid: ${parsed.error.issues[0]?.message ?? "invalid variable patch"}`
      )
    }
    return {
      action: "update",
      variableId: change.variableId,
      patch: parsed.data,
    } as const
  })

  return {
    documentId: value.documentId as string,
    baseRevision: value.baseRevision as number,
    baseSnapshotId: value.baseSnapshotId as string,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    changes: changes as DesignVariableProposalChange[],
  }
}

function requiredComponentString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} is required.`)
  }
  return value
}

function parseComponentProposalInput(
  input: unknown,
  document: Document
): ComponentProposalInput {
  const value = parseProposalIdentity(input)
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new Error("changes must be a non-empty array.")
  }
  if (value.changes.length > 24) {
    throw new Error("changes can contain no more than 24 operations.")
  }
  const changes = value.changes.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`changes[${index}] must be an object.`)
    }
    const change = candidate as Record<string, unknown>
    const path = `changes[${index}]`
    if (change.action === "create_instance") {
      const parsedTransform = componentTransformSchema.safeParse(
        change.transform
      )
      if (!parsedTransform.success) {
        throw new Error(
          `${path}.transform is invalid: ${parsedTransform.error.issues[0]?.message ?? "invalid transform"}`
        )
      }
      return {
        action: "create_instance",
        componentId: requiredComponentString(
          change.componentId,
          `${path}.componentId`
        ),
        pageId: requiredComponentString(change.pageId, `${path}.pageId`),
        ...(typeof change.parentGroupId === "string" && change.parentGroupId
          ? { parentGroupId: change.parentGroupId }
          : {}),
        ...(typeof change.name === "string" && change.name.trim()
          ? { name: change.name }
          : {}),
        ...(typeof change.variantId === "string" && change.variantId
          ? { variantId: change.variantId }
          : {}),
        transform: parsedTransform.data,
      } satisfies ComponentProposalChange
    }
    if (change.action === "switch_variant") {
      return {
        action: "switch_variant",
        instanceId: requiredComponentString(
          change.instanceId,
          `${path}.instanceId`
        ),
        variantId: requiredComponentString(
          change.variantId,
          `${path}.variantId`
        ),
      } satisfies ComponentProposalChange
    }
    if (change.action === "update_instance") {
      const parsed = componentInstanceMetadataPatchSchema.safeParse(
        change.patch
      )
      if (!parsed.success) {
        throw new Error(
          `${path}.patch is invalid: ${parsed.error.issues[0]?.message ?? "invalid instance patch"}`
        )
      }
      return {
        action: "update_instance",
        instanceId: requiredComponentString(
          change.instanceId,
          `${path}.instanceId`
        ),
        patch: parsed.data,
      } satisfies ComponentProposalChange
    }
    if (change.action === "set_override") {
      const instanceId = requiredComponentString(
        change.instanceId,
        `${path}.instanceId`
      )
      const sourceNodeId = requiredComponentString(
        change.sourceNodeId,
        `${path}.sourceNodeId`
      )
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === instanceId
      )
      if (
        !instance?.nodeMappings.some(
          (mapping) => mapping.sourceNodeId === sourceNodeId
        )
      ) {
        throw new Error(
          `${sourceNodeId} is not part of instance ${instanceId}.`
        )
      }
      const sourceNode = document.nodes.find((node) => node.id === sourceNodeId)
      if (!sourceNode) throw new Error(`Unknown source layer: ${sourceNodeId}`)
      return {
        action: "set_override",
        instanceId,
        sourceNodeId,
        patch: parseTypedCanvasPatch(sourceNode.type, change.patch, index),
      } satisfies ComponentProposalChange
    }
    if (change.action === "reset_override") {
      let properties:
        | NonNullable<
            Extract<
              ComponentProposalChange,
              { action: "reset_override" }
            >["properties"]
          >
        | undefined
      const parsedProperties = change.properties
      if (parsedProperties !== undefined) {
        if (!Array.isArray(parsedProperties) || parsedProperties.length === 0) {
          throw new Error(`${path}.properties must be a non-empty array.`)
        }
        const values = parsedProperties.map((property) => {
          const parsed = componentOverridePropertySchema.safeParse(property)
          if (!parsed.success) {
            throw new Error(`${path}.properties contains an invalid property.`)
          }
          return parsed.data
        })
        if (new Set(values).size !== values.length) {
          throw new Error(`${path}.properties must not contain duplicates.`)
        }
        properties = values
      }
      return {
        action: "reset_override",
        instanceId: requiredComponentString(
          change.instanceId,
          `${path}.instanceId`
        ),
        sourceNodeId: requiredComponentString(
          change.sourceNodeId,
          `${path}.sourceNodeId`
        ),
        ...(properties ? { properties } : {}),
      } satisfies ComponentProposalChange
    }
    if (
      change.action === "reset_all_overrides" ||
      change.action === "detach_instance"
    ) {
      return {
        action: change.action,
        instanceId: requiredComponentString(
          change.instanceId,
          `${path}.instanceId`
        ),
      } satisfies ComponentProposalChange
    }
    throw new Error(
      `${path}.action must be create_instance, switch_variant, update_instance, set_override, reset_override, reset_all_overrides, or detach_instance.`
    )
  })
  return {
    documentId: value.documentId as string,
    baseRevision: value.baseRevision as number,
    baseSnapshotId: value.baseSnapshotId as string,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    changes,
  }
}

const sceneNodeTypes = new Set<SceneNode["type"]>([
  "text",
  "rect",
  "ellipse",
  "line",
  "icon",
  "image",
])

function isSceneNodeType(value: unknown): value is SceneNode["type"] {
  return (
    typeof value === "string" && sceneNodeTypes.has(value as SceneNode["type"])
  )
}

const queryObject = (input: unknown) => {
  if (input === undefined) return {} as Record<string, unknown>
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DesignQueryError("invalid_query", "Expected a query object.")
  }
  return input as Record<string, unknown>
}

const assertQueryKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[]
) => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key))
  if (unexpected) {
    throw new DesignQueryError(
      "invalid_query",
      `Unexpected query property: ${unexpected}.`
    )
  }
}

const optionalQueryString = (
  value: unknown,
  name: string
): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.trim()) {
    throw new DesignQueryError(
      "invalid_query",
      `${name} must be a non-empty string.`
    )
  }
  return value.trim()
}

const queryCursor = (value: unknown) => {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !value) {
    throw new DesignQueryError(
      "invalid_query",
      "cursor must be a non-empty string."
    )
  }
  return value
}

const boundedQueryInteger = (
  value: unknown,
  name: string,
  defaultValue: number,
  maximum: number
) => {
  const resolved = value === undefined ? defaultValue : value
  if (
    typeof resolved !== "number" ||
    !Number.isInteger(resolved) ||
    resolved < 1 ||
    resolved > maximum
  ) {
    throw new DesignQueryError(
      "invalid_query",
      `${name} must be an integer from 1 to ${maximum}.`
    )
  }
  return resolved
}

function parseDesignTreeQuery(input: unknown): DesignTreeQuery {
  const value = queryObject(input)
  assertQueryKeys(value, ["pageId", "depth", "limit", "cursor"])
  return {
    pageId: optionalQueryString(value.pageId, "pageId"),
    depth: boundedQueryInteger(value.depth, "depth", 4, DESIGN_QUERY_MAX_DEPTH),
    limit: boundedQueryInteger(
      value.limit,
      "limit",
      24,
      DESIGN_QUERY_MAX_LIMIT
    ),
    cursor: queryCursor(value.cursor),
  }
}

function parseDesignNodeQuery(input: unknown) {
  const value = queryObject(input)
  assertQueryKeys(value, ["nodeId"])
  const nodeId = optionalQueryString(value.nodeId, "nodeId")
  if (!nodeId) {
    throw new DesignQueryError("invalid_query", "nodeId is required.")
  }
  return nodeId
}

function parseDesignNodeSearchQuery(input: unknown): DesignNodeSearchQuery {
  const value = queryObject(input)
  assertQueryKeys(value, ["query", "pageId", "types", "limit", "cursor"])
  const query = optionalQueryString(value.query, "query")
  if (!query) {
    throw new DesignQueryError("invalid_query", "query is required.")
  }
  if (query.length > 200) {
    throw new DesignQueryError(
      "invalid_query",
      "query must contain at most 200 characters."
    )
  }
  let types: SceneNode["type"][] | undefined
  if (value.types !== undefined) {
    if (!Array.isArray(value.types) || value.types.length === 0) {
      throw new DesignQueryError(
        "invalid_query",
        "types must be a non-empty array of layer types."
      )
    }
    types = value.types.map((type) => {
      if (!isSceneNodeType(type)) {
        throw new DesignQueryError(
          "invalid_query",
          "types contains an unsupported layer type."
        )
      }
      return type
    })
    if (new Set(types).size !== types.length) {
      throw new DesignQueryError(
        "invalid_query",
        "types must not contain duplicates."
      )
    }
  }
  return {
    query,
    pageId: optionalQueryString(value.pageId, "pageId"),
    types,
    limit: boundedQueryInteger(
      value.limit,
      "limit",
      50,
      DESIGN_QUERY_MAX_LIMIT
    ),
    cursor: queryCursor(value.cursor),
  }
}

const designQueryIdentity = (
  snapshot: StudioWebMcpSnapshot
): DesignQueryIdentity => ({
  documentId: snapshot.document.id,
  revision: snapshot.document.revision,
  snapshotId: snapshot.snapshotId,
  operationVersion: snapshot.operationVersion,
})

type CapabilityTargetSelector =
  | Readonly<{ kind: "current" }>
  | Readonly<{ kind: "page"; pageId: string }>
  | Readonly<{ kind: "output"; outputId: string }>

type CapabilityQuery = Readonly<{
  commandIds?: readonly ProductCommandId[]
  arguments?: ProductCommandArguments
  category?: ProductCommandCategory
  scope?: ProductCommandScope
  enabled?: boolean
  target: CapabilityTargetSelector
}>

type ExecuteProductCommandInput = Readonly<{
  capabilityId: string
  mode: "dry_run" | "proposal" | "direct"
  target: CapabilityTargetSelector
  expected: DesignQueryIdentity &
    Readonly<{
      activePageId: string
      selection: Readonly<{
        pageId: string
        nodeIds: readonly string[]
        groupId: string | null
      }> | null
    }>
  idempotencyKey: string
}>

const productCommandIdSet = new Set<string>(productCommandIds)
const productCommandCategories = new Set<ProductCommandCategory>([
  "file",
  "edit",
  "view",
  "object",
  "text",
  "arrange",
  "help",
])
const productCommandScopes = new Set<ProductCommandScope>([
  "global",
  "document",
  "selection",
  "node",
  "group",
  "page",
  "output",
])

function parseCapabilityQuery(input: unknown): CapabilityQuery {
  const value = queryObject(input)
  assertQueryKeys(value, [
    "commandIds",
    "arguments",
    "category",
    "scope",
    "enabled",
    "target",
  ])
  let commandIds: ProductCommandId[] | undefined
  if (value.commandIds !== undefined) {
    if (!Array.isArray(value.commandIds) || value.commandIds.length === 0) {
      throw new DesignQueryError(
        "invalid_query",
        "commandIds must be a non-empty array."
      )
    }
    commandIds = value.commandIds.map((commandId) => {
      if (
        typeof commandId !== "string" ||
        !productCommandIdSet.has(commandId)
      ) {
        throw new DesignQueryError(
          "invalid_query",
          `Unknown product command: ${String(commandId)}.`
        )
      }
      return commandId as ProductCommandId
    })
    if (new Set(commandIds).size !== commandIds.length) {
      throw new DesignQueryError(
        "invalid_query",
        "commandIds must not contain duplicates."
      )
    }
  }
  let argumentsForCommand: ProductCommandArguments | undefined
  if (value.arguments !== undefined) {
    if (commandIds?.length !== 1) {
      throw new DesignQueryError(
        "invalid_query",
        "arguments require exactly one commandId."
      )
    }
    argumentsForCommand = parseProductCommandArguments(
      commandIds[0]!,
      value.arguments
    )
  }
  const category = value.category
  if (
    category !== undefined &&
    (typeof category !== "string" ||
      !productCommandCategories.has(category as ProductCommandCategory))
  ) {
    throw new DesignQueryError("invalid_query", "category is not supported.")
  }
  const scope = value.scope
  if (
    scope !== undefined &&
    (typeof scope !== "string" ||
      !productCommandScopes.has(scope as ProductCommandScope))
  ) {
    throw new DesignQueryError("invalid_query", "scope is not supported.")
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new DesignQueryError("invalid_query", "enabled must be a boolean.")
  }
  const targetValue = value.target
  let target: CapabilityTargetSelector = { kind: "current" }
  if (targetValue !== undefined) {
    if (
      !targetValue ||
      typeof targetValue !== "object" ||
      Array.isArray(targetValue)
    ) {
      throw new DesignQueryError("invalid_query", "target must be an object.")
    }
    const targetObject = targetValue as Record<string, unknown>
    if (targetObject.kind === "current") {
      assertQueryKeys(targetObject, ["kind"])
      target = { kind: "current" }
    } else if (targetObject.kind === "page") {
      assertQueryKeys(targetObject, ["kind", "pageId"])
      const pageId = optionalQueryString(targetObject.pageId, "target.pageId")
      if (!pageId) {
        throw new DesignQueryError(
          "invalid_query",
          "target.pageId is required."
        )
      }
      target = { kind: "page", pageId }
    } else if (targetObject.kind === "output") {
      assertQueryKeys(targetObject, ["kind", "outputId"])
      const outputId = optionalQueryString(
        targetObject.outputId,
        "target.outputId"
      )
      if (!outputId) {
        throw new DesignQueryError(
          "invalid_query",
          "target.outputId is required."
        )
      }
      target = { kind: "output", outputId }
    } else {
      throw new DesignQueryError(
        "invalid_query",
        "target.kind must be current, page, or output."
      )
    }
  }
  return {
    commandIds,
    arguments: argumentsForCommand,
    category: category as ProductCommandCategory | undefined,
    scope: scope as ProductCommandScope | undefined,
    enabled: value.enabled as boolean | undefined,
    target,
  }
}

function parseProductCommandArguments(
  commandId: ProductCommandId,
  input: unknown
): ProductCommandArguments {
  const value = queryObject(input)
  const contract = productCommandArgumentContract(commandId)
  if (contract.kind === "none") {
    assertQueryKeys(value, ["kind"])
    if (value.kind !== "none") {
      throw new DesignQueryError(
        "invalid_query",
        `${commandId} does not accept typed arguments.`
      )
    }
    return { kind: "none" }
  }
  if (contract.kind === "mask-create" || contract.kind === "mask-sources") {
    assertQueryKeys(value, ["kind", "sourceNodeIds"])
    if (value.kind !== contract.kind || !Array.isArray(value.sourceNodeIds)) {
      throw new DesignQueryError(
        "invalid_query",
        `arguments must use kind ${contract.kind} with sourceNodeIds.`
      )
    }
    const ids = value.sourceNodeIds
    const field = contract.fields.sourceNodeIds
    if (
      ids.length < field.minItems ||
      ids.length > field.maxItems ||
      ids.some((id) => typeof id !== "string" || id.length === 0) ||
      new Set(ids).size !== ids.length
    ) {
      throw new DesignQueryError(
        "invalid_query",
        `sourceNodeIds must contain ${field.minItems} to ${field.maxItems} unique non-empty IDs.`
      )
    }
    return {
      kind: contract.kind,
      sourceNodeIds: ids as [string, ...string[]],
    }
  }
  if (contract.kind === "alignment") {
    assertQueryKeys(value, ["kind", "alignment", "relativeTo"])
    if (
      value.kind !== "alignment" ||
      typeof value.alignment !== "string" ||
      !contract.variants.includes(
        value.alignment as (typeof contract.variants)[number]
      ) ||
      (value.relativeTo !== "selection" && value.relativeTo !== "page")
    ) {
      throw new DesignQueryError(
        "invalid_query",
        "Invalid alignment arguments."
      )
    }
    return {
      kind: "alignment",
      alignment: value.alignment as (typeof contract.variants)[number],
      relativeTo: value.relativeTo,
    }
  }
  if (contract.kind === "distribution") {
    assertQueryKeys(value, ["kind", "distribution"])
    if (
      value.kind !== "distribution" ||
      typeof value.distribution !== "string" ||
      !contract.variants.includes(
        value.distribution as (typeof contract.variants)[number]
      )
    ) {
      throw new DesignQueryError(
        "invalid_query",
        "Invalid distribution arguments."
      )
    }
    return {
      kind: "distribution",
      distribution: value.distribution as (typeof contract.variants)[number],
    }
  }
  assertQueryKeys(value, ["kind", "presetId"])
  if (
    value.kind !== "text-preset" ||
    typeof value.presetId !== "string" ||
    value.presetId.length === 0
  ) {
    throw new DesignQueryError(
      "invalid_query",
      "Invalid text preset arguments."
    )
  }
  return { kind: "text-preset", presetId: value.presetId }
}

function parseExecuteProductCommandInput(
  input: unknown
): ExecuteProductCommandInput {
  const value = queryObject(input)
  assertQueryKeys(value, [
    "capabilityId",
    "mode",
    "target",
    "expected",
    "idempotencyKey",
  ])
  const capabilityId = optionalQueryString(value.capabilityId, "capabilityId")
  if (!capabilityId || capabilityId.length > 256) {
    throw new DesignQueryError(
      "invalid_query",
      "capabilityId must be between 1 and 256 characters."
    )
  }
  if (
    value.mode !== "dry_run" &&
    value.mode !== "proposal" &&
    value.mode !== "direct"
  ) {
    throw new DesignQueryError(
      "invalid_query",
      "mode must be dry_run, proposal, or direct."
    )
  }
  const idempotencyKey = optionalQueryString(
    value.idempotencyKey,
    "idempotencyKey"
  )
  if (
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
  ) {
    throw new DesignQueryError(
      "invalid_query",
      "idempotencyKey must use 1-128 letters, numbers, dots, underscores, colons, or hyphens."
    )
  }
  const expectedValue = value.expected
  if (
    !expectedValue ||
    typeof expectedValue !== "object" ||
    Array.isArray(expectedValue)
  ) {
    throw new DesignQueryError("invalid_query", "expected is required.")
  }
  const expected = expectedValue as Record<string, unknown>
  assertQueryKeys(expected, [
    "documentId",
    "revision",
    "snapshotId",
    "operationVersion",
    "activePageId",
    "selection",
  ])
  const documentId = optionalQueryString(expected.documentId, "documentId")
  const snapshotId = optionalQueryString(expected.snapshotId, "snapshotId")
  const activePageId = optionalQueryString(
    expected.activePageId,
    "activePageId"
  )
  let selection: ExecuteProductCommandInput["expected"]["selection"] = null
  if (expected.selection !== null) {
    if (
      !expected.selection ||
      typeof expected.selection !== "object" ||
      Array.isArray(expected.selection)
    ) {
      throw new DesignQueryError(
        "invalid_query",
        "expected.selection must be null or an object."
      )
    }
    const selectionValue = expected.selection as Record<string, unknown>
    assertQueryKeys(selectionValue, ["pageId", "nodeIds", "groupId"])
    const pageId = optionalQueryString(
      selectionValue.pageId,
      "expected.selection.pageId"
    )
    const groupId =
      selectionValue.groupId === null
        ? null
        : optionalQueryString(
            selectionValue.groupId,
            "expected.selection.groupId"
          )
    if (
      !pageId ||
      !Array.isArray(selectionValue.nodeIds) ||
      selectionValue.nodeIds.length === 0 ||
      selectionValue.nodeIds.length > 100 ||
      selectionValue.nodeIds.some(
        (nodeId) => typeof nodeId !== "string" || nodeId.length === 0
      ) ||
      new Set(selectionValue.nodeIds).size !== selectionValue.nodeIds.length ||
      (selectionValue.groupId !== null && !groupId)
    ) {
      throw new DesignQueryError(
        "invalid_query",
        "expected.selection must contain one to 100 unique node IDs and a valid page/group identity."
      )
    }
    selection = {
      pageId,
      nodeIds: selectionValue.nodeIds as string[],
      groupId: groupId ?? null,
    }
  }
  if (
    !documentId ||
    !snapshotId ||
    !activePageId ||
    !Number.isSafeInteger(expected.revision) ||
    (expected.revision as number) < 0 ||
    !Number.isSafeInteger(expected.operationVersion) ||
    (expected.operationVersion as number) < 0
  ) {
    throw new DesignQueryError(
      "invalid_query",
      "expected must contain a valid documentId, revision, snapshotId, and operationVersion."
    )
  }
  const target = parseCapabilityQuery({ target: value.target }).target
  return {
    capabilityId,
    mode: value.mode,
    target,
    expected: {
      documentId,
      revision: expected.revision as number,
      snapshotId,
      operationVersion: expected.operationVersion as number,
      activePageId,
      selection,
    },
    idempotencyKey,
  }
}

function productCommandContextForTarget(
  snapshot: StudioWebMcpSnapshot,
  target: CapabilityTargetSelector
) {
  const context = snapshot.productCommandContext
  if (!context) {
    throw new DesignQueryError(
      "capabilities_unavailable",
      "Canonical product command capabilities are unavailable on this route."
    )
  }
  if (
    context.documentId !== snapshot.document.id ||
    context.snapshotId !== snapshot.snapshotId
  ) {
    throw new DesignQueryError(
      "stale_context",
      "The command policy no longer matches this document snapshot. Inspect again."
    )
  }
  if (target.kind === "current") return context
  if (target.kind === "page") {
    const page = snapshot.document.pages.find(
      (candidate) => candidate.id === target.pageId
    )
    if (!page) {
      throw new DesignQueryError(
        "page_not_found",
        `Page ${target.pageId} does not exist in this document.`
      )
    }
    const output = snapshot.document.outputs.find(
      (candidate) => candidate.id === page.outputId
    )!
    return {
      ...context,
      activePageId: page.id,
      activeOutputId: page.outputId,
      stateByCommandId: {
        ...context.stateByCommandId,
        "output.export-pdf": {
          ...context.stateByCommandId?.["output.export-pdf"],
          label: `${output.pageIds.length}-page PDF`,
        },
      },
    }
  }
  const output = snapshot.document.outputs.find(
    (candidate) => candidate.id === target.outputId
  )
  if (!output) {
    throw new DesignQueryError(
      "output_not_found",
      `Output ${target.outputId} does not exist in this document.`
    )
  }
  const activePageId = output.pageIds.includes(context.activePageId)
    ? context.activePageId
    : output.pageIds[0]!
  return {
    ...context,
    activePageId,
    activeOutputId: output.id,
    stateByCommandId: {
      ...context.stateByCommandId,
      "output.export-pdf": {
        ...context.stateByCommandId?.["output.export-pdf"],
        label: `${output.pageIds.length}-page PDF`,
      },
    },
  }
}

const capabilityInvocationId = (commandId: ProductCommandId, args: unknown) =>
  args === undefined ? commandId : `${commandId}:${JSON.stringify(args)}`

function refinedCapabilityQueryFromId(
  capabilityId: string,
  target: CapabilityTargetSelector
): CapabilityQuery | null {
  const separator = capabilityId.indexOf(":")
  if (separator < 1) return null
  const commandId = capabilityId.slice(0, separator)
  if (!productCommandIdSet.has(commandId)) return null
  try {
    return {
      commandIds: [commandId as ProductCommandId],
      arguments: parseProductCommandArguments(
        commandId as ProductCommandId,
        JSON.parse(capabilityId.slice(separator + 1))
      ),
      target,
    }
  } catch {
    return null
  }
}

function selectResolvedProductCommands(
  snapshot: StudioWebMcpSnapshot,
  query: CapabilityQuery
): readonly ResolvedProductCommand[] {
  const context = productCommandContextForTarget(snapshot, query.target)
  const commandIdFilter = query.commandIds ? new Set(query.commandIds) : null
  const targetScopeAllowed = (scope: ProductCommandScope) =>
    query.target.kind === "current" ||
    scope === "global" ||
    scope === "document" ||
    scope === query.target.kind
  const projected = projectProductCommandCapabilities(context)
  const refinementBase =
    query.arguments && query.commandIds?.length === 1
      ? projected.find(
          (candidate) => candidate.definition.id === query.commandIds![0]
        )
      : undefined
  const refined = refinementBase
    ? [
        resolveProductCommand(
          {
            ...refinementBase.invocation,
            arguments: query.arguments,
          },
          context
        ),
      ]
    : query.arguments
      ? []
      : projected
  return refined.filter(
    ({ definition, enabled }) =>
      targetScopeAllowed(definition.scope) &&
      (!commandIdFilter || commandIdFilter.has(definition.id)) &&
      (query.category === undefined ||
        definition.category === query.category) &&
      (query.scope === undefined || definition.scope === query.scope) &&
      (query.enabled === undefined || enabled === query.enabled)
  )
}

function selectProductCommandCapabilities(
  snapshot: StudioWebMcpSnapshot,
  query: CapabilityQuery
) {
  return selectResolvedProductCommands(snapshot, query).map(
    ({ definition, invocation, label, enabled, disabledReason, checked }) => ({
      id: capabilityInvocationId(definition.id, invocation.arguments),
      commandId: definition.id,
      label,
      category: definition.category,
      subgroup: definition.subgroup,
      scope: definition.scope,
      mutating: definition.mutating,
      destructive: definition.destructive,
      discoverable: definition.discoverable,
      stableTargetRequired: definition.stableTargetRequired,
      enabled,
      disabledReason,
      ...(disabledReason ? { reason: disabledReason } : {}),
      ...(checked !== undefined ? { checked } : {}),
      ...(invocation.target ? { target: invocation.target } : {}),
      ...(invocation.arguments ? { arguments: invocation.arguments } : {}),
      argumentContract: productCommandArgumentContract(definition.id),
      execution: productCommandExecutionPolicy(definition.id),
    })
  )
}

const publicCommonCanvasPatchProperties = new Set([
  "name",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
  "visible",
  "locked",
])

const publicNodeCanvasPatchProperties: Record<
  SceneNode["type"],
  ReadonlySet<string>
> = {
  text: new Set([
    "text",
    "color",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "align",
    "sizingMode",
  ]),
  rect: new Set(["fill", "radius", "stroke", "strokeWidth"]),
  ellipse: new Set(["fill", "stroke", "strokeWidth"]),
  line: new Set(["stroke", "strokeWidth"]),
  icon: new Set(["fill", "stroke", "strokeWidth"]),
  image: new Set(["placement", "frameMask", "alt", "decorative"]),
}

const legacyOrRendererImagePatchProperties = new Set([
  "fit",
  "cropX",
  "cropY",
  "matrix",
  "transformMatrix",
  "sourceToFrame",
])

function parseTypedCanvasPatch(
  nodeType: SceneNode["type"],
  input: unknown,
  index: number,
  allowEmpty = false
): Record<string, unknown> {
  const patch = input as Record<string, unknown>
  if (allowEmpty && Object.keys(patch).length === 0) return {}
  for (const key of Object.keys(patch)) {
    if (legacyOrRendererImagePatchProperties.has(key)) {
      throw new Error(
        `edits[${index}].patch.${key} is not canonical. Use image placement and frameMask properties instead.`
      )
    }
    if (
      !publicCommonCanvasPatchProperties.has(key) &&
      !publicNodeCanvasPatchProperties[nodeType].has(key)
    ) {
      throw new Error(
        `edits[${index}].patch.${key} is not valid for a ${nodeType} layer.`
      )
    }
  }

  const parsed = sceneNodePatchSchema.safeParse(patch)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid node patch."
    throw new Error(`edits[${index}].patch is invalid: ${message}`)
  }
  return parsed.data
}

const imagePlacementInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["fill", "fit", "manual"] },
    focalX: { type: "number", minimum: 0, maximum: 1 },
    focalY: { type: "number", minimum: 0, maximum: 1 },
    zoom: { type: "number", exclusiveMinimum: 0, maximum: 64 },
    rotation: { type: "number", minimum: -180, maximum: 180 },
    flipX: { type: "boolean" },
    flipY: { type: "boolean" },
  },
  required: ["mode", "focalX", "focalY", "zoom", "rotation", "flipX", "flipY"],
} as const

const imageFrameMaskInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: { shape: { const: "rectangle" } },
      required: ["shape"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: { shape: { const: "ellipse" } },
      required: ["shape"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        shape: { const: "rounded_rectangle" },
        radius: { type: "number", minimum: 0, maximum: 0.5 },
      },
      required: ["shape", "radius"],
    },
  ],
} as const

const commonCanvasPatchInputProperties = {
  name: { type: "string", minLength: 1 },
  x: { type: "number" },
  y: { type: "number" },
  width: { type: "number", exclusiveMinimum: 0 },
  height: { type: "number", exclusiveMinimum: 0 },
  rotation: { type: "number" },
  opacity: { type: "number", minimum: 0, maximum: 1 },
  visible: { type: "boolean" },
  locked: { type: "boolean" },
} as const

const typedCanvasEditInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        nodeType: { const: "text" },
        nodeId: { type: "string", minLength: 1 },
        patch: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            ...commonCanvasPatchInputProperties,
            text: { type: "string" },
            color: { type: "string" },
            fontFamily: { type: "string", minLength: 1 },
            fontSize: { type: "number", exclusiveMinimum: 0 },
            fontWeight: {
              type: "integer",
              minimum: 100,
              maximum: 900,
            },
            lineHeight: { type: "number", minimum: 0.5, maximum: 3 },
            letterSpacing: { type: "number", minimum: -20, maximum: 200 },
            align: { type: "string", enum: ["left", "center", "right"] },
            sizingMode: {
              type: "string",
              enum: ["auto_width", "auto_height", "fixed"],
            },
          },
        },
        summary: { type: "string" },
      },
      required: ["nodeType", "nodeId", "patch"],
    },
    ...[
      {
        nodeType: "rect",
        patch: {
          fill: { type: "string" },
          radius: { type: "number", minimum: 0 },
          stroke: { type: "string" },
          strokeWidth: { type: "number", minimum: 0 },
        },
      },
      {
        nodeType: "ellipse",
        patch: {
          fill: { type: "string" },
          stroke: { type: "string" },
          strokeWidth: { type: "number", minimum: 0 },
        },
      },
      {
        nodeType: "line",
        patch: {
          stroke: { type: "string" },
          strokeWidth: { type: "number", exclusiveMinimum: 0 },
        },
      },
      {
        nodeType: "icon",
        patch: {
          fill: { type: "string" },
          stroke: { type: "string" },
          strokeWidth: { type: "number", minimum: 0 },
        },
      },
    ].map(({ nodeType, patch }) => ({
      type: "object",
      additionalProperties: false,
      properties: {
        nodeType: { const: nodeType },
        nodeId: { type: "string", minLength: 1 },
        patch: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: { ...commonCanvasPatchInputProperties, ...patch },
        },
        summary: { type: "string" },
      },
      required: ["nodeType", "nodeId", "patch"],
    })),
    {
      type: "object",
      additionalProperties: false,
      properties: {
        nodeType: { const: "image" },
        nodeId: { type: "string", minLength: 1 },
        patch: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            ...commonCanvasPatchInputProperties,
            placement: imagePlacementInputSchema,
            frameMask: imageFrameMaskInputSchema,
            alt: { type: "string" },
            decorative: { type: "boolean" },
          },
        },
        assetId: {
          type: "string",
          description:
            "Approved asset ID returned by search_assets. Replaces the source while preserving placement, frame mask, alt text, and decorative state unless patch explicitly changes them.",
        },
        summary: { type: "string" },
      },
      anyOf: [{ required: ["patch"] }, { required: ["assetId"] }],
      required: ["nodeType", "nodeId"],
    },
  ],
} as const

const designStyleTargetInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodeId: { type: "string", minLength: 1 },
    range: {
      type: "object",
      additionalProperties: false,
      properties: {
        start: { type: "integer", minimum: 0 },
        end: { type: "integer", minimum: 1 },
      },
      required: ["start", "end"],
    },
  },
  required: ["nodeId"],
} as const

const typographyStyleInputProperties = {
  name: { type: "string", minLength: 1, maxLength: 120 },
  fontFamily: { type: "string", minLength: 1 },
  fontSize: { type: "number", exclusiveMinimum: 0 },
  fontWeight: { type: "integer", minimum: 100, maximum: 900 },
  italic: { type: "boolean" },
  decoration: {
    type: "string",
    enum: ["none", "underline", "line-through"],
  },
  lineHeight: { type: "number", minimum: 0.5, maximum: 3 },
  letterSpacing: { type: "number", minimum: -20, maximum: 200 },
} as const

const paintStyleInputProperties = {
  name: { type: "string", minLength: 1, maxLength: 120 },
  color: { type: "string", minLength: 1 },
  opacity: { type: "number", minimum: 0, maximum: 1 },
} as const

const styleTargetsInputSchema = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: designStyleTargetInputSchema,
} as const

const designStyleChangeInputSchema = {
  oneOf: [
    ...(
      [
        ["typography", typographyStyleInputProperties],
        ["paint", paintStyleInputProperties],
      ] as const
    ).flatMap(([kind, properties]) => [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { const: kind },
          action: { const: "create" },
          style: {
            type: "object",
            additionalProperties: false,
            properties,
            required: Object.keys(properties),
          },
        },
        required: ["kind", "action", "style"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { const: kind },
          action: { const: "update" },
          styleId: { type: "string", minLength: 1 },
          patch: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties,
          },
        },
        required: ["kind", "action", "styleId", "patch"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { const: kind },
          action: { const: "apply" },
          styleId: { type: "string", minLength: 1 },
          targets: styleTargetsInputSchema,
        },
        required: ["kind", "action", "styleId", "targets"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { const: kind },
          action: { const: "detach" },
          targets: styleTargetsInputSchema,
        },
        required: ["kind", "action", "targets"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { const: kind },
          action: { const: "delete" },
          styleId: { type: "string", minLength: 1 },
        },
        required: ["kind", "action", "styleId"],
      },
    ]),
  ],
} as const

const variableTargetInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "node" },
        nodeId: { type: "string", minLength: 1 },
        property: {
          type: "string",
          enum: [
            "text",
            "color",
            "fill",
            "stroke",
            "fontFamily",
            "fontSize",
            "fontWeight",
            "lineHeight",
            "letterSpacing",
            "x",
            "y",
            "width",
            "height",
            "rotation",
            "opacity",
            "strokeWidth",
            "radius",
          ],
        },
      },
      required: ["kind", "nodeId", "property"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "text_range" },
        nodeId: { type: "string", minLength: 1 },
        range: designStyleTargetInputSchema.properties.range,
        property: {
          type: "string",
          enum: [
            "color",
            "fontFamily",
            "fontSize",
            "fontWeight",
            "lineHeight",
            "letterSpacing",
          ],
        },
      },
      required: ["kind", "nodeId", "range", "property"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "typography_style" },
        styleId: { type: "string", minLength: 1 },
        property: {
          type: "string",
          enum: [
            "fontFamily",
            "fontSize",
            "fontWeight",
            "lineHeight",
            "letterSpacing",
          ],
        },
      },
      required: ["kind", "styleId", "property"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "paint_style" },
        styleId: { type: "string", minLength: 1 },
        property: { type: "string", enum: ["color", "opacity"] },
      },
      required: ["kind", "styleId", "property"],
    },
  ],
} as const

const designVariableChangeInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "create" },
        variable: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                type: { const: "color" },
                value: { type: "string", minLength: 1 },
              },
              required: ["name", "type", "value"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                type: { const: "number" },
                value: { type: "number" },
              },
              required: ["name", "type", "value"],
            },
            ...(["string", "font_family"] as const).map((type) => ({
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                type: { const: type },
                value: { type: "string" },
              },
              required: ["name", "type", "value"],
            })),
          ],
        },
      },
      required: ["action", "variable"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "update" },
        variableId: { type: "string", minLength: 1 },
        patch: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            value: { oneOf: [{ type: "string" }, { type: "number" }] },
          },
        },
      },
      required: ["action", "variableId", "patch"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "bind" },
        variableId: { type: "string", minLength: 1 },
        target: variableTargetInputSchema,
      },
      required: ["action", "variableId", "target"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "unbind" },
        bindingId: { type: "string", minLength: 1 },
      },
      required: ["action", "bindingId"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "delete" },
        variableId: { type: "string", minLength: 1 },
      },
      required: ["action", "variableId"],
    },
  ],
} as const

const componentTransformInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    scale: { type: "number", exclusiveMinimum: 0, maximum: 64 },
    rotation: { type: "number", minimum: -360, maximum: 360 },
  },
  required: ["x", "y", "scale", "rotation"],
} as const

const componentOverridePatchInputSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    ...commonCanvasPatchInputProperties,
    text: { type: "string" },
    color: { type: "string" },
    fontFamily: { type: "string", minLength: 1 },
    fontSize: { type: "number", exclusiveMinimum: 0 },
    fontWeight: { type: "integer", minimum: 100, maximum: 900 },
    lineHeight: { type: "number", minimum: 0.5, maximum: 3 },
    letterSpacing: { type: "number", minimum: -20, maximum: 200 },
    align: { type: "string", enum: ["left", "center", "right"] },
    sizingMode: {
      type: "string",
      enum: ["auto_width", "auto_height", "fixed"],
    },
    fill: { type: "string" },
    radius: { type: "number", minimum: 0 },
    stroke: { type: "string" },
    strokeWidth: { type: "number", minimum: 0 },
    placement: imagePlacementInputSchema,
    frameMask: imageFrameMaskInputSchema,
    alt: { type: "string" },
    decorative: { type: "boolean" },
  },
} as const

const componentChangeInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "create_instance" },
        componentId: { type: "string", minLength: 1 },
        pageId: { type: "string", minLength: 1 },
        parentGroupId: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1, maxLength: 120 },
        variantId: { type: "string", minLength: 1 },
        transform: componentTransformInputSchema,
      },
      required: ["action", "componentId", "pageId", "transform"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "switch_variant" },
        instanceId: { type: "string", minLength: 1 },
        variantId: { type: "string", minLength: 1 },
      },
      required: ["action", "instanceId", "variantId"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "update_instance" },
        instanceId: { type: "string", minLength: 1 },
        patch: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            transform: componentTransformInputSchema,
          },
        },
      },
      required: ["action", "instanceId", "patch"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "set_override" },
        instanceId: { type: "string", minLength: 1 },
        sourceNodeId: { type: "string", minLength: 1 },
        patch: componentOverridePatchInputSchema,
      },
      required: ["action", "instanceId", "sourceNodeId", "patch"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: "reset_override" },
        instanceId: { type: "string", minLength: 1 },
        sourceNodeId: { type: "string", minLength: 1 },
        properties: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: {
            type: "string",
            enum: [...componentOverridePropertySchema.options],
          },
        },
      },
      required: ["action", "instanceId", "sourceNodeId"],
    },
    ...(["reset_all_overrides", "detach_instance"] as const).map((action) => ({
      type: "object",
      additionalProperties: false,
      properties: {
        action: { const: action },
        instanceId: { type: "string", minLength: 1 },
      },
      required: ["action", "instanceId"],
    })),
  ],
} as const

function parseOutputProposalInput(input: unknown): OutputVariantProposalInput {
  const value = parseProposalIdentity(input)
  if (typeof value.sourcePageId !== "string" || !value.sourcePageId) {
    throw new Error("sourcePageId is required.")
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("name is required.")
  }
  if (
    value.kind !== "proposal" &&
    value.kind !== "whatsapp_portrait" &&
    value.kind !== "square" &&
    value.kind !== "custom"
  ) {
    throw new Error("kind is invalid.")
  }
  if (typeof value.width !== "number" || typeof value.height !== "number") {
    throw new Error("width and height are required numbers.")
  }
  if (
    !Array.isArray(value.exportFormats) ||
    value.exportFormats.some((format) => format !== "png" && format !== "pdf")
  ) {
    throw new Error("exportFormats must contain png or pdf.")
  }
  return {
    documentId: value.documentId as string,
    baseRevision: value.baseRevision as number,
    baseSnapshotId: value.baseSnapshotId as string,
    sourcePageId: value.sourcePageId,
    name: value.name,
    pageName: typeof value.pageName === "string" ? value.pageName : undefined,
    kind: value.kind,
    width: value.width,
    height: value.height,
    exportFormats: value.exportFormats as Array<"png" | "pdf">,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  }
}

function assetOrientation(asset: StudioWebMcpAsset) {
  const ratio = asset.width / asset.height
  if (Math.abs(ratio - 1) <= 0.08) return "square" as const
  return ratio > 1 ? ("landscape" as const) : ("portrait" as const)
}

function parseAssetSearchInput(input: unknown): StudioWebMcpAssetSearchInput {
  if (!input || typeof input !== "object") {
    throw new Error("Expected an asset search object.")
  }
  const value = input as Record<string, unknown>
  const query = typeof value.query === "string" ? value.query.trim() : ""
  const orientation =
    value.orientation === "portrait" ||
    value.orientation === "landscape" ||
    value.orientation === "square"
      ? value.orientation
      : undefined
  if (value.orientation !== undefined && !orientation) {
    throw new Error("orientation must be portrait, landscape, or square.")
  }
  const tags = Array.isArray(value.tags)
    ? value.tags.map((tag) => {
        if (typeof tag !== "string" || !tag.trim()) {
          throw new Error("Every asset tag must be a non-empty string.")
        }
        return tag.trim().toLowerCase()
      })
    : []
  const limit = value.limit === undefined ? 8 : value.limit
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  ) {
    throw new Error("limit must be an integer from 1 to 20.")
  }
  const cursor = value.cursor === undefined ? null : value.cursor
  if (cursor !== null && (typeof cursor !== "string" || !cursor)) {
    throw new Error("cursor must be a non-empty string.")
  }
  return { query, orientation, tags, limit, cursor }
}

const publicAssetSearchResult = (asset: StudioWebMcpAsset) => ({
  id: asset.id,
  name: asset.name,
  ...(asset.description ? { description: asset.description } : {}),
  tags: asset.tags,
  width: asset.width,
  height: asset.height,
  orientation: assetOrientation(asset),
  ownership: asset.ownership,
  ...(asset.license ? { license: asset.license } : {}),
})

async function parseRenderInput(
  input: unknown,
  version: TemplateVersion,
  services: StudioWebMcpServices,
  signal?: AbortSignal
) {
  if (!input || typeof input !== "object") {
    throw new Error("Expected a render request object.")
  }
  const value = input as Record<string, unknown>
  if (value.templateId !== version.templateId) {
    throw new Error(
      `Only published template ${version.templateId} is available in this Studio session.`
    )
  }
  if (value.version !== version.version) {
    throw new Error(
      `Only published version ${version.version} is available. Inspect the design again before rendering.`
    )
  }
  if (!value.modifications || typeof value.modifications !== "object") {
    throw new Error("modifications must be an object keyed by parameter key.")
  }
  const modifications = Object.fromEntries(
    Object.entries(value.modifications as Record<string, unknown>).map(
      ([key, item]) => {
        if (
          typeof item !== "string" &&
          typeof item !== "number" &&
          typeof item !== "boolean"
        ) {
          throw new Error(`${key} must be a string, number, or boolean.`)
        }
        const parameter = version.manifest.parameters.find(
          (candidate) => candidate.key === key
        )
        if (parameter?.type === "currency" && typeof item !== "string") {
          throw new Error(
            `${parameter.label} must use an exact decimal string to avoid money precision loss.`
          )
        }
        if (parameter?.type !== "asset") return [key, item]
        if (item === "" && !parameter.required) return [key, item]
        if (typeof item !== "string") {
          throw new Error(`${parameter.label} must use an approved asset ID.`)
        }
        return [key, item]
      }
    )
  ) satisfies TemplateModifications
  const validationModifications = await resolveRenderAssetSources(
    version.document,
    services,
    modifications,
    signal
  )
  materializeTemplateVersion(version, validationModifications)

  if (!Array.isArray(value.outputs) || value.outputs.length === 0) {
    throw new Error("Choose at least one published output.")
  }
  if (value.outputs.length > 12) {
    throw new Error("Choose no more than 12 output and format pairs.")
  }
  const seen = new Set<string>()
  const selections = value.outputs.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`outputs[${index}] must be an object.`)
    }
    const selection = candidate as Record<string, unknown>
    if (typeof selection.outputId !== "string" || !selection.outputId) {
      throw new Error(`outputs[${index}].outputId is required.`)
    }
    if (selection.format !== "png" && selection.format !== "pdf") {
      throw new Error(`outputs[${index}].format must be png or pdf.`)
    }
    const output = version.manifest.outputs.find(
      (item) => item.id === selection.outputId
    )
    if (!output)
      throw new Error(`Unknown published output: ${selection.outputId}`)
    if (!output.exportFormats.includes(selection.format)) {
      throw new Error(
        `${output.name} cannot be rendered as ${selection.format.toUpperCase()}.`
      )
    }
    const key = `${output.id}:${selection.format}`
    if (seen.has(key)) throw new Error(`Duplicate render selection: ${key}`)
    seen.add(key)
    return {
      outputId: output.id,
      format: selection.format,
    } satisfies StudioWebMcpRenderSelection
  })
  return { modifications, selections }
}

function selectRenderHistory(
  records: readonly StudioWebMcpRenderRecord[],
  input: unknown,
  version: TemplateVersion | null,
  assets: readonly StudioWebMcpAsset[]
) {
  if (input !== undefined && (!input || typeof input !== "object")) {
    throw new Error("Expected a render history query object.")
  }
  const value = (input ?? {}) as Record<string, unknown>
  const limit = value.limit === undefined ? 10 : value.limit
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 30
  ) {
    throw new Error("limit must be an integer from 1 to 30.")
  }
  const status = value.status
  if (
    status !== undefined &&
    status !== "queued" &&
    status !== "rendering" &&
    status !== "retrying" &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelling" &&
    status !== "cancelled" &&
    status !== "status_unknown"
  ) {
    throw new Error(
      "status must be queued, rendering, retrying, completed, failed, cancelling, cancelled, or status_unknown."
    )
  }
  if (value.templateId !== undefined && typeof value.templateId !== "string") {
    throw new Error("templateId must be a string.")
  }
  return records
    .filter(
      (record) =>
        (status === undefined || record.status === status) &&
        (value.templateId === undefined ||
          record.templateId === value.templateId)
    )
    .slice(0, limit)
    .map((record) => publicRenderRecord(record, version, assets))
}

async function resolveDocumentAssets(
  document: Document,
  snapshot: StudioWebMcpSnapshot,
  services: StudioWebMcpServices,
  signal?: AbortSignal
) {
  const values = new Set<string>()
  for (const field of document.fields) {
    if (field.type !== "asset") continue
    const current = document.fieldValues[field.id]
    if (typeof current === "string" && current) values.add(current)
    if (typeof field.defaultValue === "string" && field.defaultValue) {
      values.add(field.defaultValue)
    }
  }
  for (const node of document.nodes) {
    if (node.type !== "image") continue
    values.add(node.assetId)
    values.add(node.src)
  }
  const resolved = await Promise.all(
    [...values].map(async (value) => {
      if (value.startsWith("asset:local/")) return null
      return services.resolveAsset(
        assetIdForValue(value, snapshot.assets),
        signal
      )
    })
  )
  return [...snapshot.assets, ...resolved.filter((asset) => asset !== null)]
}

async function commandRequestDigest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

const affectedFromResolvedCommand = (resolved: ResolvedProductCommand) => {
  const target = resolved.invocation.target
  return {
    nodes: { added: [], updated: [], removed: [] },
    groups: { added: [], updated: [], removed: [] },
    pages: { added: [], updated: [], removed: [] },
    outputs: { added: [], updated: [], removed: [] },
    fields: { added: [], updated: [], removed: [] },
    bindings: { added: [], updated: [], removed: [] },
    focus:
      target?.kind === "selection"
        ? { pageId: target.pageId, nodeIds: [...target.nodeIds] }
        : target?.kind === "node"
          ? { pageId: target.pageId, nodeIds: [target.nodeId] }
          : null,
  }
}

export function studioWebMcpTools(
  services: StudioWebMcpServices,
  registrationSignal?: AbortSignal
): WebMcpTool[] {
  const commandReceipts = new Map<
    string,
    {
      requestHash: string
      result: Promise<WebMcpToolResult>
      state: "pending" | "settled"
    }
  >()
  const generationReceipts = new Map<
    string,
    {
      requestHash: string
      result: Promise<WebMcpToolResult>
      state: "pending" | "settled"
    }
  >()

  const executeProductCommandRequest = async (
    input: ExecuteProductCommandInput,
    requestHash: string,
    signal?: AbortSignal
  ): Promise<WebMcpToolResult> => {
    try {
      signal?.throwIfAborted()
      const current = services.getSnapshot()
      const actual = designQueryIdentity(current)
      const liveSelection = current.productCommandContext?.selection ?? null
      const expectedSelection = input.expected.selection
      const selectionMatches =
        liveSelection === null && expectedSelection === null
          ? true
          : liveSelection !== null && expectedSelection !== null
            ? liveSelection.pageId === expectedSelection.pageId &&
              liveSelection.nodeIds.length ===
                expectedSelection.nodeIds.length &&
              liveSelection.nodeIds.every(
                (nodeId, index) => nodeId === expectedSelection.nodeIds[index]
              ) &&
              (liveSelection.groupId ?? null) === expectedSelection.groupId
            : false
      if (
        input.expected.documentId !== actual.documentId ||
        input.expected.revision !== actual.revision ||
        input.expected.snapshotId !== actual.snapshotId ||
        input.expected.operationVersion !== actual.operationVersion ||
        input.expected.activePageId !== current.activePageId ||
        !selectionMatches
      ) {
        throw new DesignQueryError(
          "stale_context",
          "The document, operation, active page, or selection changed. Inspect capabilities again."
        )
      }
      const matchesCapabilityId = ({
        definition,
        invocation,
      }: ResolvedProductCommand) =>
        capabilityInvocationId(definition.id, invocation.arguments) ===
        input.capabilityId
      const resolved =
        selectResolvedProductCommands(current, {
          target: input.target,
        }).find(matchesCapabilityId) ??
        (() => {
          const refinedQuery = refinedCapabilityQueryFromId(
            input.capabilityId,
            input.target
          )
          return refinedQuery
            ? selectResolvedProductCommands(current, refinedQuery).find(
                matchesCapabilityId
              )
            : undefined
        })()
      if (!resolved) {
        throw new DesignQueryError(
          "capability_not_found",
          "That capability was not returned for the requested target."
        )
      }
      const policy = productCommandExecutionPolicy(resolved.definition.id)
      if (!policy.modes.includes(input.mode)) {
        throw new DesignQueryError(
          "mode_not_supported",
          policy.reason ??
            `${resolved.label} does not support ${input.mode} execution.`,
          policy.recommendedTool
            ? { recommendedTool: policy.recommendedTool }
            : undefined
        )
      }
      if (input.mode === "direct" && input.target.kind !== "current") {
        throw new DesignQueryError(
          "mode_not_supported",
          "Direct session commands require target.kind current."
        )
      }
      if (!resolved.enabled) {
        throw new DesignQueryError(
          "command_disabled",
          resolved.disabledReason ?? "This command is not available right now."
        )
      }
      if (
        input.mode !== "direct" &&
        policy.modes.includes("proposal") &&
        current.productCommandContext?.editor.imageCropActive
      ) {
        throw new DesignQueryError(
          "transient_state_not_supported",
          "Finish or cancel the active image crop before creating a review proposal."
        )
      }

      const baseResult = {
        status:
          input.mode === "dry_run"
            ? "validated"
            : input.mode === "proposal"
              ? "review_pending"
              : "executed",
        code: "ok",
        commandId: resolved.definition.id,
        capabilityId: input.capabilityId,
        mode: input.mode,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        base: actual,
        replayed: false,
        warnings: [] as string[],
      }
      if (input.mode === "direct") {
        signal?.throwIfAborted()
        if (!services.runProductCommand) {
          throw new DesignQueryError(
            "capabilities_unavailable",
            "Direct command execution is unavailable on this route."
          )
        }
        let runResult: ProductCommandRunResult
        try {
          runResult = services.runProductCommand(resolved.invocation)
        } catch {
          throw new DesignQueryError(
            "execution_declined",
            "Studio could not run the session command."
          )
        }
        if (runResult.status !== "accepted") {
          throw new DesignQueryError(
            runResult.status === "stale"
              ? "stale_context"
              : runResult.status === "disabled"
                ? "command_disabled"
                : "execution_declined",
            "reason" in runResult
              ? runResult.reason
              : "The interface declined the command."
          )
        }
        const result = {
          ...baseResult,
          result: actual,
          session: { accepted: true },
          affected: affectedFromResolvedCommand(resolved),
        }
        return textResult(`Executed ${resolved.label}.`, result)
      }

      if (input.mode === "dry_run" && policy.modes.includes("direct")) {
        return textResult(`Validated ${resolved.label}.`, {
          ...baseResult,
          result: actual,
          affected: affectedFromResolvedCommand(resolved),
        })
      }

      const identitySeed = requestHash.slice(0, 24)
      let identitySequence = 0
      const proposal = createProductCommandProposal(
        current.document,
        resolved,
        {
          id: () => `${identitySeed}-${++identitySequence}`,
          now: services.now,
        }
      )
      const publicProposal = publicChangeSet(
        proposal.changeSet,
        current.document,
        current.assets
      )
      if (input.mode === "dry_run") {
        return textResult(`Validated ${resolved.label}.`, {
          ...baseResult,
          result: null,
          predictedRevision:
            current.document.revision + publicProposal.operations.length,
          affected: proposal.affected,
          proposal: publicProposal,
        })
      }
      try {
        signal?.throwIfAborted()
        services.proposeChangeSet(
          proposal.changeSet,
          webMcpProposalProvenance(
            "execute_product_command",
            resolved.label,
            input.idempotencyKey
          )
        )
      } catch {
        throw new DesignQueryError(
          "review_unavailable",
          "Studio could not open this command in Review."
        )
      }
      return textResult(
        `Previewing ${resolved.label}. Nothing has been applied; ask the user to review the Review panel.`,
        {
          ...baseResult,
          result: null,
          affected: proposal.affected,
          proposal: publicProposal,
          review: {
            changeSetId: proposal.changeSet.id,
            operationIds: proposal.changeSet.operations.map(
              (operation) => operation.id
            ),
            status: "pending",
          },
        }
      )
    } catch (error) {
      if (error instanceof ProductCommandProposalError) {
        return errorResult(new DesignQueryError(error.code, error.message))
      }
      return errorResult(
        error instanceof DesignQueryError
          ? error
          : new DesignQueryError(
              "internal_error",
              "Studio could not complete the command request."
            )
      )
    }
  }

  const runIdempotentProductCommand = async (
    parsed: ExecuteProductCommandInput,
    signal?: AbortSignal
  ) => {
    const requestHash = await commandRequestDigest(parsed)
    signal?.throwIfAborted()
    const receiptKey = `${parsed.expected.documentId}:${parsed.idempotencyKey}`
    const existing = commandReceipts.get(receiptKey)
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return errorResult(
          new DesignQueryError(
            "idempotency_key_reused",
            "That idempotency key was already used for a different command request."
          )
        )
      }
      const replayed = await existing.result
      return {
        ...replayed,
        ...(replayed.structuredContent &&
        typeof replayed.structuredContent === "object" &&
        !Array.isArray(replayed.structuredContent)
          ? {
              structuredContent: {
                ...(replayed.structuredContent as Record<string, unknown>),
                replayed: true,
              },
            }
          : {}),
      }
    }
    if (commandReceipts.size >= 128) {
      const settledKey = [...commandReceipts].find(
        ([, receipt]) => receipt.state === "settled"
      )?.[0]
      if (!settledKey) {
        return errorResult(
          new DesignQueryError(
            "request_in_progress",
            "Too many command requests are still in progress. Retry after one finishes."
          )
        )
      }
      commandReceipts.delete(settledKey)
    }
    let resolveResult!: (result: WebMcpToolResult) => void
    const result = new Promise<WebMcpToolResult>((resolve) => {
      resolveResult = resolve
    })
    const receipt = {
      requestHash,
      result,
      state: "pending" as "pending" | "settled",
    }
    commandReceipts.set(receiptKey, receipt)
    void executeProductCommandRequest(parsed, requestHash, signal).then(
      (value) => {
        receipt.state = "settled"
        resolveResult(value)
      }
    )
    return result
  }

  const publicGeneratedDocumentPlan = async (plan: GeneratedDocumentPlan) => ({
    requestId: plan.requestId,
    replacementForRequestId: plan.replacementForRequestId,
    idempotencyKey: plan.idempotencyKey,
    requestHash: plan.requestHash,
    createdAt: plan.createdAt,
    start: plan.start,
    candidate: {
      id: plan.candidate.id,
      name: plan.candidate.name,
      snapshotId: await generatedDocumentSnapshotId(plan),
    },
    summary: plan.summary,
    provenance: plan.provenance,
    validation: plan.validation,
    warnings: plan.warnings,
    review: {
      status: "pending",
      action: "Create editable document",
      currentDocumentMutated: false,
    },
  })

  const executeDocumentGenerationRequest = async (
    input: unknown,
    signal?: AbortSignal
  ): Promise<WebMcpToolResult> => {
    try {
      signal?.throwIfAborted()
      const parsed = documentGenerationRequestSchema.parse(input)
      if (!services.proposeDocumentGeneration) {
        throw new DesignQueryError(
          "review_unavailable",
          "Document creation Review is unavailable on this Studio route."
        )
      }
      const requestedAssetIds = new Set<string>(
        parsed.references.flatMap((reference) =>
          reference.kind === "asset" ? [reference.assetId] : []
        )
      )
      if (parsed.start.kind === "blank") {
        for (const node of parsed.start.plan.nodes) {
          if (node.type === "image") requestedAssetIds.add(node.assetId)
        }
        for (const field of parsed.start.plan.fields) {
          if (
            field.type === "asset" &&
            typeof field.defaultValue === "string" &&
            field.defaultValue
          ) {
            requestedAssetIds.add(field.defaultValue)
          }
        }
      } else {
        const start = parsed.start
        for (const substitution of start.assetSubstitutions ?? []) {
          requestedAssetIds.add(substitution.assetId)
        }
        for (const command of start.commands ?? []) {
          if (command.type === "insert_image") {
            requestedAssetIds.add(command.assetId)
          }
        }
        const template = builtInDesignTemplateRepository
          .list()
          .find(
            (candidate) =>
              candidate.id === start.template.id &&
              candidate.version === start.template.version
          )
        for (const [key, value] of Object.entries(start.fieldValues ?? {})) {
          const field = template?.previewDocument.fields.find(
            (candidate) => candidate.key === key
          )
          if (field?.type === "asset" && typeof value === "string" && value) {
            requestedAssetIds.add(value)
          }
        }
      }
      const approvedAssets = new Map<
        string,
        {
          id: string
          src: string
          selectable: boolean
        }
      >()
      for (const assetId of requestedAssetIds) {
        signal?.throwIfAborted()
        const asset = await services.resolveAsset(assetId, signal)
        if (!asset || !asset.selectable) {
          throw new Error(
            `Unknown or unavailable approved asset: ${assetId}. Use search_assets first.`
          )
        }
        approvedAssets.set(asset.id, {
          id: asset.id,
          src: asset.src,
          selectable: asset.selectable,
        })
      }
      const plan = compileDocumentGenerationRequest(parsed, {
        now: services.now(),
        approvedAssets,
      })
      signal?.throwIfAborted()
      const proposed = services.proposeDocumentGeneration(
        plan,
        webMcpProposalProvenance(
          "propose_document_generation",
          parsed.prompt,
          parsed.requestId
        )
      )
      return textResult(
        `Prepared ${proposed.candidate.name} as an isolated candidate. Nothing has been persisted; ask the user to choose Create editable document in Review.`,
        { ...(await publicGeneratedDocumentPlan(proposed)), replayed: false }
      )
    } catch (error) {
      return errorResult(error)
    }
  }

  const runIdempotentDocumentGeneration = async (
    input: unknown,
    signal?: AbortSignal
  ) => {
    const parsed = documentGenerationRequestSchema.parse(input)
    const requestHash = await commandRequestDigest(parsed)
    const existing = generationReceipts.get(parsed.idempotencyKey)
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return errorResult(
          new DesignQueryError(
            "idempotency_key_reused",
            "That idempotency key was already used for a different document-generation request."
          )
        )
      }
      const replayed = await existing.result
      return {
        ...replayed,
        ...(replayed.structuredContent &&
        typeof replayed.structuredContent === "object" &&
        !Array.isArray(replayed.structuredContent)
          ? {
              structuredContent: {
                ...(replayed.structuredContent as Record<string, unknown>),
                replayed: true,
              },
            }
          : {}),
      }
    }
    if (generationReceipts.size >= 32) {
      const settledKey = [...generationReceipts].find(
        ([, receipt]) => receipt.state === "settled"
      )?.[0]
      if (!settledKey) {
        return errorResult(
          new DesignQueryError(
            "request_in_progress",
            "Too many document-generation requests are still in progress."
          )
        )
      }
      generationReceipts.delete(settledKey)
    }
    let resolveResult!: (result: WebMcpToolResult) => void
    const result = new Promise<WebMcpToolResult>((resolve) => {
      resolveResult = resolve
    })
    const receipt = {
      requestHash,
      result,
      state: "pending" as "pending" | "settled",
    }
    generationReceipts.set(parsed.idempotencyKey, receipt)
    void executeDocumentGenerationRequest(parsed, signal).then((value) => {
      receipt.state = "settled"
      resolveResult(value)
    })
    return result
  }

  const tools: WebMcpTool[] = [
    {
      name: "search_templates",
      title: "Search generation templates",
      description:
        "Search Studio's current template catalog for a new-document job. Returns compact public summaries and exact template versions, never template bodies or private media locators.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", maxLength: 240 },
          category: { type: "string", minLength: 1, maxLength: 120 },
          formatFamily: { type: "string", minLength: 1, maxLength: 120 },
          useCaseId: { type: "string", minLength: 1, maxLength: 120 },
          cursor: { type: "string", minLength: 1, maxLength: 240 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const value = queryObject(input)
          assertQueryKeys(value, [
            "query",
            "category",
            "formatFamily",
            "useCaseId",
            "cursor",
            "limit",
          ])
          const limit = value.limit === undefined ? 10 : value.limit
          if (
            typeof limit !== "number" ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 20
          ) {
            throw new Error("limit must be an integer from 1 to 20.")
          }
          const category = optionalQueryString(value.category, "category")
          const formatFamily = optionalQueryString(
            value.formatFamily,
            "formatFamily"
          )
          const useCaseId = optionalQueryString(value.useCaseId, "useCaseId")
          const startAfter = optionalQueryString(value.cursor, "cursor")
          const result = searchGenerationTemplates({
            query: optionalQueryString(value.query, "query") ?? "",
            ...(category ? { category } : {}),
            ...(formatFamily ? { formatFamily } : {}),
            ...(useCaseId ? { useCaseId } : {}),
            ...(startAfter ? { startAfter } : {}),
            limit,
          })
          return textResult(
            `Found ${result.templates.length} compatible template${result.templates.length === 1 ? "" : "s"}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "read_template",
      title: "Read generation template",
      description:
        "Read one exact template version's compact manifest, fields, outputs, source requirements, and preview identity without returning its canonical document body.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id", "version"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 200 },
          version: { type: "integer", minimum: 1 },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const value = queryObject(input)
          assertQueryKeys(value, ["id", "version"])
          if (typeof value.id !== "string" || !value.id) {
            throw new Error("id is required.")
          }
          if (
            typeof value.version !== "number" ||
            !Number.isInteger(value.version) ||
            value.version < 1
          ) {
            throw new Error("version must be a positive integer.")
          }
          const result = readGenerationTemplate(value.id, value.version)
          return textResult(`Read ${result.name}@${result.version}.`, result)
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "read_generation_capabilities",
      title: "Read document generation capabilities",
      description:
        "Read the live document-generation version, security limits, available fonts, asset rules, Review behavior, and idempotency contract.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () =>
        textResult(
          "Read Studio's document-generation capabilities.",
          readGenerationCapabilities()
        ),
    },
    {
      name: "read_blank_document_presets",
      title: "Read blank document presets",
      description:
        "Read the exact blank presets supported as starting points for a bounded Studio Design Plan.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () =>
        textResult(
          "Read Studio's blank document presets.",
          readBlankDocumentPresets()
        ),
    },
    {
      name: "read_design_plan_schema",
      title: "Read Studio Design Plan schema",
      description:
        "Read the current request-local Studio Design Plan vocabulary. This data-only boundary rejects JSX, HTML, CSS, scripts, canonical IDs, and renderer-private fields.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () =>
        textResult(
          "Read Studio Design Plan version 1.",
          readDesignPlanSchema()
        ),
    },
    {
      name: "propose_document_generation",
      title: "Propose document generation",
      description:
        "Compile one bounded blank Design Plan or exact template adaptation into an isolated canonical candidate, validate approved assets and provenance, and open a separate human Review. This never mutates or persists the current document.",
      inputSchema: {
        type: "object",
        additionalProperties: true,
        required: [
          "requestId",
          "idempotencyKey",
          "prompt",
          "skill",
          "start",
          "references",
        ],
        properties: {
          requestId: { type: "string", minLength: 1, maxLength: 200 },
          idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
          prompt: { type: "string", minLength: 1, maxLength: 16_000 },
          skill: { type: "object" },
          start: { type: "object" },
          designGuides: { type: "array", maxItems: 4 },
          references: { type: "array", maxItems: 4 },
          requestedName: { type: "string", minLength: 1, maxLength: 80 },
          replacementForRequestId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        untrustedContentHint: true,
      },
      execute: async (input, execution) => {
        try {
          return await runIdempotentDocumentGeneration(input, execution?.signal)
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "inspect_design",
      title: "Inspect active design",
      description:
        "Inspect the live visual document, active page, selection, shared fields, bindings, outputs, and pending review state. Call this before proposing edits.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, execution) => {
        try {
          const current = services.getSnapshot()
          const resolvedAssets = await resolveDocumentAssets(
            current.document,
            current,
            services,
            execution?.signal
          )
          const activePage = current.document.pages.find(
            (page) => page.id === current.activePageId
          )
          const nodesById = new Map(
            current.document.nodes.map((node) => [node.id, node])
          )
          const commandCapabilities = current.productCommandContext
            ? selectProductCommandCapabilities(current, {
                target: { kind: "current" },
              })
            : (current.commandCapabilities ?? [])
          const result = {
            document: {
              id: current.document.id,
              name: current.document.name,
              revision: current.document.revision,
              snapshotId: current.snapshotId,
              operationVersion: current.operationVersion,
            },
            activePage,
            activePageNodes: activePage?.nodeIds.flatMap((nodeId) => {
              const node = nodesById.get(nodeId)
              return node ? [publicSceneNode(node)] : []
            }),
            activePageGroups: current.document.groups.filter(
              (group) => group.pageId === current.activePageId
            ),
            designStyles: readDesignStyles(
              current.document,
              designQueryIdentity(current)
            ).styles,
            designVariables: readDesignVariables(
              current.document,
              designQueryIdentity(current)
            ),
            selection: current.selection,
            commandCapabilities,
            outputs: current.document.outputs,
            fields: current.document.fields.map((field) => {
              const value =
                current.document.fieldValues[field.id] ?? field.defaultValue
              const impact = analyzeFieldDeletion(current.document, field.id)
              const publicValue =
                field.type === "asset"
                  ? publicAssetValue(value, resolvedAssets)
                  : value
              const publicDefaultValue =
                field.type === "asset"
                  ? publicAssetValue(field.defaultValue, resolvedAssets)
                  : field.defaultValue
              return {
                id: field.id,
                key: field.key,
                label: field.label,
                type: field.type,
                required: field.required,
                agentDescription: field.agentDescription,
                validation: field.validation,
                defaultValue: publicDefaultValue,
                value: publicValue,
                displayValue:
                  field.type === "asset"
                    ? (resolvedAssets.find(
                        (asset) =>
                          asset.id === publicValue || asset.src === value
                      )?.name ??
                      (typeof value === "string" &&
                      value.startsWith("asset:local/")
                        ? "Unavailable local asset"
                        : value
                          ? "Unknown managed asset"
                          : "No asset"))
                    : formatFieldValueForText(field, value),
                bindings: impact.bindingCount,
                bindingTargets: impact.bindings,
                affectedPages: impact.pages,
                affectedOutputs: impact.outputs,
              }
            }),
            pendingChangeSet: current.pendingChangeSet
              ? {
                  id: current.pendingChangeSet.id,
                  title: current.pendingChangeSet.title,
                  baseRevision: current.pendingChangeSet.baseRevision,
                  baseSnapshotId: current.pendingChangeSet.baseSnapshotId,
                  status: current.pendingChangeSet.status,
                  operations: current.pendingChangeSet.operations.map(
                    ({ id, summary, status }) => ({ id, summary, status })
                  ),
                }
              : null,
          }
          return textResult(
            `Inspected ${current.document.name} at revision ${current.document.revision}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "read_design_tree",
      title: "Read design tree",
      description:
        "Read the ordered page, group, and layer tree for the complete live document. Use pageId to inspect one page and cursors to paginate large documents.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageId: { type: "string", minLength: 1 },
          depth: {
            type: "integer",
            minimum: 1,
            maximum: DESIGN_QUERY_MAX_DEPTH,
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: DESIGN_QUERY_MAX_LIMIT,
          },
          cursor: { type: "string", minLength: 1 },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const result = readDesignTree(
            current.document,
            designQueryIdentity(current),
            parseDesignTreeQuery(input)
          )
          return textResult(
            `Read ${result.items.length} design tree item${result.items.length === 1 ? "" : "s"} from ${current.document.name}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "get_capabilities",
      title: "Get Studio capabilities",
      description:
        "Read the complete canonical Studio command policy, exact enablement, disabled reasons, targets, and typed arguments for the current document snapshot. This tool does not execute commands.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          commandIds: {
            type: "array",
            minItems: 1,
            maxItems: productCommandIds.length,
            uniqueItems: true,
            items: { type: "string", enum: [...productCommandIds] },
          },
          arguments: {
            description:
              "Typed command arguments. Requires exactly one commandId and is validated against that command's canonical argument contract.",
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                properties: { kind: { const: "none" } },
              },
              ...(["mask-create", "mask-sources"] as const).map((kind) => ({
                type: "object",
                additionalProperties: false,
                required: ["kind", "sourceNodeIds"],
                properties: {
                  kind: { const: kind },
                  sourceNodeIds: {
                    type: "array",
                    minItems: 1,
                    maxItems: 4,
                    uniqueItems: true,
                    items: { type: "string", minLength: 1 },
                  },
                },
              })),
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "alignment", "relativeTo"],
                properties: {
                  kind: { const: "alignment" },
                  alignment: {
                    type: "string",
                    enum: [
                      "left",
                      "horizontal-center",
                      "right",
                      "top",
                      "vertical-center",
                      "bottom",
                    ],
                  },
                  relativeTo: { enum: ["selection", "page"] },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "distribution"],
                properties: {
                  kind: { const: "distribution" },
                  distribution: { enum: ["horizontal", "vertical"] },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "presetId"],
                properties: {
                  kind: { const: "text-preset" },
                  presetId: { type: "string", minLength: 1 },
                },
              },
            ],
          },
          category: {
            type: "string",
            enum: ["file", "edit", "view", "object", "text", "arrange", "help"],
          },
          scope: {
            type: "string",
            enum: [
              "global",
              "document",
              "selection",
              "node",
              "group",
              "page",
              "output",
            ],
          },
          enabled: { type: "boolean" },
          target: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                properties: { kind: { const: "current" } },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "pageId"],
                properties: {
                  kind: { const: "page" },
                  pageId: { type: "string", minLength: 1 },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "outputId"],
                properties: {
                  kind: { const: "output" },
                  outputId: { type: "string", minLength: 1 },
                },
              },
            ],
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const query = parseCapabilityQuery(input)
          const capabilities = selectProductCommandCapabilities(current, query)
          return textResult(
            `Read ${capabilities.length} canonical Studio command capabilit${capabilities.length === 1 ? "y" : "ies"}.`,
            {
              identity: designQueryIdentity(current),
              target: query.target,
              capabilities,
            }
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "execute_product_command",
      title: "Execute Studio command",
      description:
        "Dry-run, create a Review proposal, or directly run an explicitly allowed session command from get_capabilities. Requires exact document identity and an idempotency key.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["capabilityId", "mode", "expected", "idempotencyKey"],
        properties: {
          capabilityId: { type: "string", minLength: 1, maxLength: 256 },
          mode: {
            type: "string",
            enum: ["dry_run", "proposal", "direct"],
          },
          target: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                properties: { kind: { const: "current" } },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "pageId"],
                properties: {
                  kind: { const: "page" },
                  pageId: { type: "string", minLength: 1 },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "outputId"],
                properties: {
                  kind: { const: "output" },
                  outputId: { type: "string", minLength: 1 },
                },
              },
            ],
          },
          expected: {
            type: "object",
            additionalProperties: false,
            required: [
              "documentId",
              "revision",
              "snapshotId",
              "operationVersion",
              "activePageId",
              "selection",
            ],
            properties: {
              documentId: { type: "string", minLength: 1 },
              revision: { type: "integer", minimum: 0 },
              snapshotId: { type: "string", minLength: 1 },
              operationVersion: { type: "integer", minimum: 0 },
              activePageId: { type: "string", minLength: 1 },
              selection: {
                oneOf: [
                  { type: "null" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["pageId", "nodeIds", "groupId"],
                    properties: {
                      pageId: { type: "string", minLength: 1 },
                      nodeIds: {
                        type: "array",
                        minItems: 1,
                        maxItems: 100,
                        uniqueItems: true,
                        items: { type: "string", minLength: 1 },
                      },
                      groupId: {
                        oneOf: [
                          { type: "null" },
                          { type: "string", minLength: 1 },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
          idempotencyKey: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9._:-]+$",
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        untrustedContentHint: true,
      },
      execute: async (input, execution) => {
        try {
          return await runIdempotentProductCommand(
            parseExecuteProductCommandInput(input),
            execution?.signal
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "read_design_node",
      title: "Read design layer",
      description:
        "Read one layer by stable ID with its page, output, group ancestry, and shared-field bindings. Private image source URLs are never returned.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["nodeId"],
        properties: { nodeId: { type: "string", minLength: 1 } },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const result = readDesignNode(
            current.document,
            designQueryIdentity(current),
            parseDesignNodeQuery(input)
          )
          return textResult(`Read layer ${result.node.name}.`, result)
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "read_design_styles",
      title: "Read reusable design styles",
      description:
        "Read document-owned typography and paint styles with exact whole-layer and text-range attachment usage.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["typography", "paint"] },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const value = queryObject(input)
          assertQueryKeys(value, ["kind"])
          if (
            value.kind !== undefined &&
            value.kind !== "typography" &&
            value.kind !== "paint"
          ) {
            throw new DesignQueryError(
              "invalid_query",
              "kind must be typography or paint."
            )
          }
          const current = services.getSnapshot()
          const result = readDesignStyles(
            current.document,
            designQueryIdentity(current),
            value.kind
          )
          return textResult(
            `Read ${result.styles.length} reusable design style${result.styles.length === 1 ? "" : "s"}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "read_design_variables",
      title: "Read design variables",
      description:
        "Read typed document variables, their resolved values, exact node/range/style targets, and protected-deletion usage.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["color", "number", "string", "font_family"],
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const value = queryObject(input)
          assertQueryKeys(value, ["type"])
          if (
            value.type !== undefined &&
            value.type !== "color" &&
            value.type !== "number" &&
            value.type !== "string" &&
            value.type !== "font_family"
          ) {
            throw new DesignQueryError(
              "invalid_query",
              "type must be color, number, string, or font_family."
            )
          }
          const current = services.getSnapshot()
          const result = readDesignVariables(
            current.document,
            designQueryIdentity(current),
            value.type
          )
          return textResult(
            `Read ${result.variables.length} design variable${result.variables.length === 1 ? "" : "s"}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "read_design_components",
      title: "Read reusable components",
      description:
        "Read document-owned components, variants, instances, source mappings, public override-property names, and supported component actions. Private layer values and image source URLs are never returned.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          componentId: { type: "string", minLength: 1 },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const value = queryObject(input)
          assertQueryKeys(value, ["componentId"])
          const current = services.getSnapshot()
          const result = readDesignComponents(
            current.document,
            designQueryIdentity(current),
            optionalQueryString(value.componentId, "componentId")
          )
          return textResult(
            `Read ${result.components.length} reusable component${result.components.length === 1 ? "" : "s"} and ${result.instances.length} instance${result.instances.length === 1 ? "" : "s"}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "search_design_nodes",
      title: "Search design layers",
      description:
        "Search layer names and text across every page of the live document, optionally restricted by page or layer type.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          pageId: { type: "string", minLength: 1 },
          types: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: {
              type: "string",
              enum: ["text", "rect", "ellipse", "line", "icon", "image"],
            },
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: DESIGN_QUERY_MAX_LIMIT,
          },
          cursor: { type: "string", minLength: 1 },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const result = searchDesignNodes(
            current.document,
            designQueryIdentity(current),
            parseDesignNodeSearchQuery(input)
          )
          return textResult(
            `Found ${result.matches.length} matching layer${result.matches.length === 1 ? "" : "s"}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "search_assets",
      title: "Search approved assets",
      description:
        "Search the renderer-safe Studio asset catalog by text, tags, and orientation. Returns stable asset IDs and licensing metadata without exposing source URLs. Use an asset ID with propose_canvas_edits to replace an image safely.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          orientation: {
            type: "string",
            enum: ["portrait", "landscape", "square"],
          },
          tags: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          limit: { type: "integer", minimum: 1, maximum: 20 },
          cursor: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, execution) => {
        try {
          const page = await services.searchAssets(
            parseAssetSearchInput(input),
            execution?.signal
          )
          const matches = page.assets.map(publicAssetSearchResult)
          return textResult(
            `Found ${matches.length} approved asset${matches.length === 1 ? "" : "s"}.`,
            { assets: matches, nextCursor: page.nextCursor }
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "validate_design",
      title: "Validate design",
      description:
        "Run deterministic document validation and return blocking errors and warnings without changing the design.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, execution) => {
        try {
          const snapshot = services.getSnapshot()
          const document = snapshot.document
          const resolvedAssets = await resolveDocumentAssets(
            document,
            snapshot,
            services,
            execution?.signal
          )
          const approvedAssetIds = new Set(
            resolvedAssets.map((asset) => asset.id)
          )
          const managedNodeIssues = document.nodes.flatMap((node) => {
            if (node.type !== "image") return []
            const managedId = managedAssetIdFromSource(node.src)
            if (!managedId || approvedAssetIds.has(managedId)) return []
            const page = document.pages.find((candidate) =>
              candidate.nodeIds.includes(node.id)
            )
            return [
              {
                code: "unmanaged_asset",
                severity: "error" as const,
                message: `Image layer ${node.name} references an unknown workspace asset`,
                pageId: page?.id,
                nodeId: node.id,
              },
            ]
          })
          const renderPolicyIssues = validateRenderPolicy(document).filter(
            (issue) => {
              if (issue.code !== "unmanaged_asset" || !issue.nodeId) return true
              const node = document.nodes.find(
                (candidate) => candidate.id === issue.nodeId
              )
              if (node?.type !== "image") return true
              const managedId = managedAssetIdFromSource(node.src)
              return !managedId || !approvedAssetIds.has(managedId)
            }
          )
          const issues = [
            ...validateDocument(document),
            ...renderPolicyIssues,
            ...managedNodeIssues,
            ...validateAssetFieldPublicationIdentities(document, (value) =>
              resolvedAssets.some(
                (asset) => asset.id === value || asset.src === value
              )
            ),
          ]
          const errors = issues.filter((issue) => issue.severity === "error")
          const warnings = issues.filter(
            (issue) => issue.severity === "warning"
          )
          return textResult(
            `Validation found ${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`,
            { errors, warnings }
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "propose_asset_insertion",
      title: "Propose asset insertion",
      description:
        "Create one coordinated review containing shared-field updates and an approved search_assets result inserted as an image layer. Geometry must fit inside the page, and Studio privately resolves the renderer source.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string" },
          baseRevision: { type: "integer", minimum: 0 },
          baseSnapshotId: { type: "string" },
          pageId: { type: "string" },
          assetId: { type: "string" },
          x: { type: "number", minimum: 0 },
          y: { type: "number", minimum: 0 },
          width: { type: "number", exclusiveMinimum: 0 },
          height: { type: "number", exclusiveMinimum: 0 },
          placement: imagePlacementInputSchema,
          frameMask: imageFrameMaskInputSchema,
          decorative: { type: "boolean" },
          values: {
            type: "object",
            description:
              "Optional shared-field values keyed by stable field key, combined into the same human review.",
            additionalProperties: {
              oneOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
              ],
            },
          },
          reason: { type: "string" },
        },
        required: [
          "documentId",
          "baseRevision",
          "baseSnapshotId",
          "pageId",
          "assetId",
          "x",
          "y",
          "width",
          "height",
          "placement",
        ],
      },
      annotations: { untrustedContentHint: true },
      execute: async (input, execution) => {
        try {
          const value = parseProposalIdentity(input)
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          if (typeof value.assetId !== "string" || !value.assetId) {
            throw new Error("assetId is required.")
          }
          const asset = await requireAsset(
            value.assetId,
            services,
            "for insertion",
            { selectable: true },
            execution?.signal
          )
          const number = (key: string) => {
            const candidate = value[key]
            if (typeof candidate !== "number") {
              throw new Error(`${key} must be a number.`)
            }
            return candidate
          }
          if (typeof value.pageId !== "string" || !value.pageId) {
            throw new Error("pageId is required.")
          }
          const placement = imagePlacementSchema.parse(value.placement)
          const frameMask =
            value.frameMask === undefined
              ? undefined
              : imageFrameMaskSchema.parse(value.frameMask)
          if (
            value.decorative !== undefined &&
            typeof value.decorative !== "boolean"
          ) {
            throw new Error("decorative must be a boolean.")
          }
          const resolvedFields =
            value.values === undefined
              ? null
              : await resolveFieldAssetIds(
                  current.document,
                  services,
                  parseFieldProposalInput({
                    documentId: value.documentId,
                    baseRevision: value.baseRevision,
                    baseSnapshotId: value.baseSnapshotId,
                    values: value.values,
                  }),
                  { selectable: true },
                  execution?.signal
                )
          const changeSet = createAssetInsertionChangeSet(
            current.document,
            {
              documentId: value.documentId as string,
              baseRevision: value.baseRevision as number,
              baseSnapshotId: value.baseSnapshotId as string,
              pageId: value.pageId,
              asset: {
                id: asset.id,
                src: asset.src,
                alt: asset.description ?? asset.name,
                name: asset.name,
              },
              x: number("x"),
              y: number("y"),
              width: number("width"),
              height: number("height"),
              placement,
              frameMask,
              decorative: value.decorative,
              values: resolvedFields?.input.values,
              reason:
                typeof value.reason === "string" ? value.reason : undefined,
            },
            services
          )
          execution?.signal.throwIfAborted()
          services.proposeChangeSet(
            changeSet,
            webMcpProposalProvenance(
              "propose_asset_insertion",
              typeof value.reason === "string" ? value.reason : null
            )
          )
          return textResult(
            `Previewing ${asset.name} on ${value.pageId}. Nothing has been applied; ask the user to review the Review panel.`,
            publicChangeSet(changeSet, current.document, [
              ...current.assets,
              asset,
              ...(resolvedFields?.resolvedAssets ?? []),
            ])
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "propose_field_updates",
      title: "Propose shared field updates",
      description:
        "Create a reviewable, non-destructive preview of coordinated shared-field changes against the exact document revision returned by inspect_design. Values are keyed by field key. A human must accept and apply the operations in the Review panel.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: {
            type: "string",
            description: "Document ID returned by inspect_design.",
          },
          baseRevision: {
            type: "integer",
            minimum: 0,
            description: "Exact revision returned by inspect_design.",
          },
          baseSnapshotId: {
            type: "string",
            description:
              "Immutable snapshot ID returned by inspect_design. This disambiguates undo branches that reuse a revision number.",
          },
          values: {
            type: "object",
            description:
              "Typed shared-field values keyed by the stable field key returned by inspect_design. Respect each field's validation metadata. Use strings for text and configured choices, safe CSS color strings for colors, ISO YYYY-MM-DD strings for dates, decimal strings for INR currency, approved asset IDs returned by search_assets for assets, finite numbers for number fields, and booleans for boolean fields.",
            additionalProperties: {
              oneOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
              ],
            },
          },
          reason: {
            type: "string",
            description: "Short title explaining the coordinated change.",
          },
        },
        required: ["documentId", "baseRevision", "baseSnapshotId", "values"],
      },
      annotations: { untrustedContentHint: true },
      execute: async (input, execution) => {
        try {
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          const parsedInput = parseFieldProposalInput(input)
          const resolved = await resolveFieldAssetIds(
            current.document,
            services,
            parsedInput,
            { selectable: true },
            execution?.signal
          )
          const changeSet = createFieldUpdateChangeSet(
            current.document,
            resolved.input,
            services
          )
          execution?.signal.throwIfAborted()
          services.proposeChangeSet(
            changeSet,
            webMcpProposalProvenance(
              "propose_field_updates",
              parsedInput.reason ?? null
            )
          )
          return textResult(
            `Created change set ${changeSet.id} with ${changeSet.operations.length} operation${changeSet.operations.length === 1 ? "" : "s"}. The design is previewing these changes, but nothing has been applied. Ask the user to review the Review panel.`,
            publicChangeSet(changeSet, current.document, [
              ...current.assets,
              ...resolved.resolvedAssets,
            ])
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "propose_canvas_edits",
      title: "Propose canvas edits",
      description:
        "Create a non-destructive visual preview of precise layout, style, crop, and approved asset-replacement edits to existing layers on the inspected document revision. Bound content must be changed with propose_field_updates. A human reviews every layer operation before applying it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string" },
          baseRevision: { type: "integer", minimum: 0 },
          baseSnapshotId: { type: "string" },
          reason: { type: "string" },
          edits: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: typedCanvasEditInputSchema,
          },
        },
        required: ["documentId", "baseRevision", "baseSnapshotId", "edits"],
      },
      annotations: { untrustedContentHint: true },
      execute: async (input, execution) => {
        try {
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          const proposal = parseCanvasProposalInput(input)
          const resolvedAssets: StudioWebMcpAsset[] = []
          const edits = await Promise.all(
            proposal.edits.map(async (edit) => {
              if (!edit.assetId) return edit
              const asset = await requireAsset(
                edit.assetId,
                services,
                `for image layer ${edit.nodeId}`,
                { selectable: true },
                execution?.signal
              )
              resolvedAssets.push(asset)
              return {
                ...edit,
                replacementAsset: {
                  id: asset.id,
                  src: asset.src,
                },
              }
            })
          )
          const changeSet = createCanvasEditChangeSet(
            current.document,
            { ...proposal, edits },
            services
          )
          execution?.signal.throwIfAborted()
          services.proposeChangeSet(
            changeSet,
            webMcpProposalProvenance(
              "propose_canvas_edits",
              proposal.reason ?? null
            )
          )
          return textResult(
            `Previewing ${changeSet.operations.length} canvas edit${changeSet.operations.length === 1 ? "" : "s"}. Nothing has been applied; ask the user to review the Review panel.`,
            publicChangeSet(changeSet, current.document, [
              ...current.assets,
              ...resolvedAssets,
            ])
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "propose_design_style_changes",
      title: "Propose reusable design style changes",
      description:
        "Create a non-destructive reviewed proposal to create, update, apply, detach, or delete document typography and paint styles. Call read_design_styles first and use exact layer IDs and UTF-16 text ranges.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string", minLength: 1 },
          baseRevision: { type: "integer", minimum: 0 },
          baseSnapshotId: { type: "string", minLength: 1 },
          reason: { type: "string" },
          changes: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: designStyleChangeInputSchema,
          },
        },
        required: ["documentId", "baseRevision", "baseSnapshotId", "changes"],
      },
      annotations: { untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          const proposal = parseDesignStyleProposalInput(input)
          const changeSet = createDesignStyleChangeSet(
            current.document,
            proposal,
            services
          )
          services.proposeChangeSet(
            changeSet,
            webMcpProposalProvenance(
              "propose_design_style_changes",
              proposal.reason ?? null
            )
          )
          return textResult(
            `Previewing ${changeSet.operations.length} reusable-style change${changeSet.operations.length === 1 ? "" : "s"}. Nothing has been applied; ask the user to review the Review panel.`,
            publicChangeSet(changeSet, current.document, current.assets)
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "propose_design_variable_changes",
      title: "Propose design variable changes",
      description:
        "Create a reviewed proposal to create, update, bind, unbind, or delete typed document variables. Call read_design_variables first and use exact target IDs and ranges.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string", minLength: 1 },
          baseRevision: { type: "integer", minimum: 0 },
          baseSnapshotId: { type: "string", minLength: 1 },
          reason: { type: "string" },
          changes: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: designVariableChangeInputSchema,
          },
        },
        required: ["documentId", "baseRevision", "baseSnapshotId", "changes"],
      },
      annotations: { untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          const proposal = parseDesignVariableProposalInput(input)
          const changeSet = createDesignVariableChangeSet(
            current.document,
            proposal,
            services
          )
          services.proposeChangeSet(
            changeSet,
            webMcpProposalProvenance(
              "propose_design_variable_changes",
              proposal.reason ?? null
            )
          )
          return textResult(
            `Previewing ${changeSet.operations.length} variable change${changeSet.operations.length === 1 ? "" : "s"}. Nothing has been applied; ask the user to review the Review panel.`,
            publicChangeSet(changeSet, current.document, current.assets)
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "propose_component_changes",
      title: "Propose component changes",
      description:
        "Create a non-destructive reviewed proposal to insert component instances, switch variants, update instance metadata, set or reset controlled layer overrides, or detach instances. Call read_design_components first and use exact component, instance, page, and source-layer IDs.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string", minLength: 1 },
          baseRevision: { type: "integer", minimum: 0 },
          baseSnapshotId: { type: "string", minLength: 1 },
          reason: { type: "string" },
          changes: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: componentChangeInputSchema,
          },
        },
        required: ["documentId", "baseRevision", "baseSnapshotId", "changes"],
      },
      annotations: { untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          const proposal = parseComponentProposalInput(input, current.document)
          const changeSet = createComponentChangeSet(
            current.document,
            proposal,
            services
          )
          services.proposeChangeSet(
            changeSet,
            webMcpProposalProvenance(
              "propose_component_changes",
              proposal.reason ?? null
            )
          )
          return textResult(
            `Previewing ${changeSet.operations.length} component change${changeSet.operations.length === 1 ? "" : "s"}. Nothing has been applied; ask the user to review the Review panel.`,
            publicChangeSet(changeSet, current.document, current.assets)
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "propose_output_variant",
      title: "Propose output variant",
      description:
        "Adapt one inspected source page into a new output size as one atomic, reviewable operation. The proposal clones its layers, groups, and shared-field bindings, scales geometry deterministically, and does not change saved state until a human accepts it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string" },
          baseRevision: { type: "integer", minimum: 0 },
          baseSnapshotId: { type: "string" },
          sourcePageId: {
            type: "string",
            description: "Page ID returned by inspect_design.",
          },
          name: { type: "string" },
          pageName: { type: "string" },
          kind: {
            type: "string",
            enum: ["proposal", "whatsapp_portrait", "square", "custom"],
          },
          width: { type: "integer", minimum: 256, maximum: 4096 },
          height: { type: "integer", minimum: 256, maximum: 4096 },
          exportFormats: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", enum: ["png", "pdf"] },
          },
          reason: { type: "string" },
        },
        required: [
          "documentId",
          "baseRevision",
          "baseSnapshotId",
          "sourcePageId",
          "name",
          "kind",
          "width",
          "height",
          "exportFormats",
        ],
      },
      annotations: { untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          const parsedInput = parseOutputProposalInput(input)
          const changeSet = createOutputVariantChangeSet(
            current.document,
            parsedInput,
            services
          )
          services.proposeChangeSet(
            changeSet,
            webMcpProposalProvenance(
              "propose_output_variant",
              parsedInput.reason ?? null
            )
          )
          return textResult(
            "Previewing one complete output adaptation. Nothing has been applied; ask the user to review the Review panel.",
            publicChangeSet(changeSet, current.document, current.assets)
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "publish_template",
      title: "Publish immutable template version",
      description:
        "Publish the exact current document revision as an immutable API template version. Only call this consequential tool after the user explicitly asks to publish and after all pending change sets are resolved.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: {
            type: "string",
            description: "Document ID returned by inspect_design.",
          },
          expectedRevision: {
            type: "integer",
            minimum: 0,
            description: "Exact revision the user approved for publishing.",
          },
          expectedSnapshotId: {
            type: "string",
            description:
              "Exact immutable snapshot ID returned by inspect_design for the version the user approved.",
          },
        },
        required: ["documentId", "expectedRevision", "expectedSnapshotId"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        untrustedContentHint: true,
      },
      execute: async (input, execution) => {
        try {
          if (!input || typeof input !== "object") {
            throw new Error("Expected publishing confirmation input.")
          }
          const value = input as Record<string, unknown>
          const current = services.getSnapshot()
          if (value.documentId !== current.document.id) {
            throw new Error("The approved document ID no longer matches.")
          }
          if (value.expectedRevision !== current.document.revision) {
            throw new Error(
              `The document changed to revision ${current.document.revision}. Inspect it again before publishing.`
            )
          }
          if (value.expectedSnapshotId !== current.snapshotId) {
            throw new Error(
              "The document branch changed. Inspect the current snapshot again before publishing."
            )
          }
          execution?.signal.throwIfAborted()
          const version = await services.publishTemplate(
            {
              documentId: current.document.id,
              revision: current.document.revision,
              snapshotId: current.snapshotId,
            },
            { signal: execution?.signal }
          )
          execution?.signal.throwIfAborted()
          return textResult(
            `Published ${version.templateId} version ${version.version} from revision ${version.sourceRevision}.`,
            {
              id: version.id,
              templateId: version.templateId,
              version: version.version,
              sourceRevision: version.sourceRevision,
              publishedAt: version.publishedAt,
              manifest: version.manifest,
            }
          )
        } catch (error) {
          const errorName =
            error &&
            typeof error === "object" &&
            "name" in error &&
            typeof error.name === "string"
              ? error.name
              : null
          if (
            execution?.signal.aborted ||
            errorName === "AbortError" ||
            errorName === "TimeoutError"
          ) {
            return errorResult(
              new DesignQueryError(
                "execution_status_unknown",
                "Studio stopped waiting, but the server may have committed this publication. Inspect publication history before retrying the same immutable snapshot."
              )
            )
          }
          return errorResult(error)
        }
      },
    },
    {
      name: "inspect_render_history",
      title: "Inspect render history",
      description:
        "Inspect recent persisted render jobs and their downloadable artifacts without starting another render. Results contain product-level metadata, not storage keys or database records.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          templateId: { type: "string" },
          status: {
            type: "string",
            enum: [
              "queued",
              "rendering",
              "retrying",
              "completed",
              "failed",
              "cancelling",
              "cancelled",
              "status_unknown",
            ],
          },
          limit: { type: "integer", minimum: 1, maximum: 30 },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const records = selectRenderHistory(
            current.renderHistory,
            input,
            current.publishedVersion,
            current.assets
          )
          return textResult(
            `Found ${records.length} render job${records.length === 1 ? "" : "s"}.`,
            { renders: records }
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "render_template",
      title: "Render published template",
      description:
        "Render the exact immutable template version currently published by Studio with typed parameter modifications and explicit output formats. This creates a persisted render job visible in the API playground history.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          templateId: {
            type: "string",
            description: "Published template ID returned by publish_template.",
          },
          version: {
            type: "integer",
            minimum: 1,
            description: "Exact immutable published version.",
          },
          modifications: {
            type: "object",
            description:
              "Typed values keyed by parameter keys in the published manifest.",
            additionalProperties: {
              oneOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
              ],
            },
          },
          outputs: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                outputId: { type: "string" },
                format: { type: "string", enum: ["png", "pdf"] },
              },
              required: ["outputId", "format"],
            },
          },
          idempotencyKey: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9._:-]+$",
          },
        },
        required: [
          "templateId",
          "version",
          "modifications",
          "outputs",
          "idempotencyKey",
        ],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        untrustedContentHint: true,
      },
      execute: async (input, execution) => {
        try {
          const current = services.getSnapshot()
          if (!current.publishedVersion) {
            throw new Error(
              "No server-synced published version is available. Publish the design before rendering."
            )
          }
          const { modifications, selections } = await parseRenderInput(
            input,
            current.publishedVersion,
            services,
            execution?.signal
          )
          const renderInput = input as Record<string, unknown>
          const idempotencyKey = renderInput.idempotencyKey
          if (
            typeof idempotencyKey !== "string" ||
            idempotencyKey.length > 128 ||
            !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
          ) {
            throw new Error("A valid idempotencyKey is required.")
          }
          execution?.signal.throwIfAborted()
          const record = await services.renderTemplate(
            current.publishedVersion,
            modifications,
            selections,
            { signal: execution?.signal, idempotencyKey }
          )
          execution?.signal.throwIfAborted()
          const result = publicRenderRecord(
            record,
            current.publishedVersion,
            current.assets
          )
          if (
            record.status === "failed" ||
            record.status === "cancelled" ||
            record.status === "status_unknown"
          ) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    record.status === "status_unknown"
                      ? `Render ${record.id} has unknown server status. Inspect render history before retrying with the same idempotency key.`
                      : record.status === "cancelled"
                        ? `Render ${record.id} was cancelled.`
                        : `Render ${record.id} failed. Inspect render history in Studio for the user-facing failure detail.`,
                },
              ],
              structuredContent: result,
              isError: true,
            }
          }
          return textResult(
            `Completed render ${record.id} with ${record.artifacts.length} artifact${record.artifacts.length === 1 ? "" : "s"}.`,
            result
          )
        } catch (error) {
          return errorResult(error)
        }
      },
    },
  ]
  return tools.map((tool) => ownWebMcpToolExecution(tool, registrationSignal))
}

export async function registerStudioWebMcpTools(
  modelContext: WebMcpModelContext,
  services: StudioWebMcpServices,
  signal: AbortSignal
) {
  const tools = studioWebMcpTools(services, signal)
  await Promise.all(
    tools.map((tool) => modelContext.registerTool(tool, { signal }))
  )
  return tools.length
}
