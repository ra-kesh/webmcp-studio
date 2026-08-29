import {
  analyzeFieldDeletion,
  formatFieldValueForText,
  imageFrameMaskSchema,
  imagePlacementSchema,
  managedAssetIdFromSource,
  managedImageAssetIdentity,
  materializeTemplateVersion,
  mediaAssetIdSchema,
  sceneNodePatchSchema,
  validateAssetFieldPublicationIdentities,
  validateRenderPolicy,
  validateDocument,
  type ChangeSet,
  type Document,
  type TemplateModifications,
  type TemplateVersion,
  type SceneNode,
} from "@webmcp/document"
import {
  productCommandArgumentContract,
  productCommandIds,
  projectProductCommandCapabilities,
  type ProductCommandCategory,
  type ProductCommandId,
  type ProductCommandRuntimeContext,
  type ProductCommandScope,
} from "@webmcp/editor/product-commands"
import {
  createAssetInsertionChangeSet,
  createCanvasEditChangeSet,
  createFieldUpdateChangeSet,
  createOutputVariantChangeSet,
  type CanvasEditProposalInput,
  type FieldUpdateProposalInput,
  type OutputVariantProposalInput,
} from "./change-sets"
import {
  DESIGN_QUERY_MAX_DEPTH,
  DESIGN_QUERY_MAX_LIMIT,
  DesignQueryError,
  readDesignNode,
  readDesignTree,
  searchDesignNodes,
  type DesignNodeSearchQuery,
  type DesignQueryIdentity,
  type DesignTreeQuery,
} from "./design-queries"

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
  execute(input: unknown): WebMcpToolResult | Promise<WebMcpToolResult>
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
  execution?: "not_exposed"
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
  status: "rendering" | "completed" | "failed"
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
    input: StudioWebMcpAssetSearchInput
  ): Promise<StudioWebMcpAssetSearchPage>
  resolveAsset(assetId: string): Promise<StudioWebMcpAsset | null>
  proposeChangeSet(changeSet: ChangeSet): ChangeSet
  publishTemplate(): TemplateVersion | Promise<TemplateVersion>
  renderTemplate(
    version: TemplateVersion,
    modifications: TemplateModifications,
    selections: StudioWebMcpRenderSelection[]
  ): Promise<StudioWebMcpRenderRecord>
  id(): string
  now(): string
}

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
  return {
    content: [{ type: "text", text: message }],
    ...(error instanceof DesignQueryError
      ? {
          structuredContent: {
            status: "error",
            code: error.code,
            message,
            retryable: false,
          },
        }
      : {}),
    isError: true,
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
  options: { selectable: boolean }
) {
  if (value.startsWith("asset:local/")) return null
  const snapshot = services.getSnapshot()
  const assetId = assetIdForValue(value, snapshot.assets)
  const asset = await services.resolveAsset(assetId)
  if (!asset || (options.selectable && !asset.selectable)) return null
  return asset
}

async function requireAsset(
  value: string,
  services: StudioWebMcpServices,
  context: string,
  options: { selectable: boolean }
) {
  const asset = await resolveAssetValue(value, services, options)
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
  options: { selectable: boolean } = { selectable: true }
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
        options
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
  modifications: TemplateModifications
): Promise<TemplateModifications> {
  const entries = await Promise.all(
    Object.entries(modifications).map(async ([key, value]) => {
      const field = document.fields.find((candidate) => candidate.key === key)
      if (!field || field.type !== "asset") return [key, value] as const
      if (value === "" && !field.required) return [key, value] as const
      if (typeof value !== "string") {
        throw new Error(`${field.label} must use an approved asset ID.`)
      }
      const asset = await requireAsset(value, services, `for ${field.label}`, {
        selectable: false,
      })
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
  category?: ProductCommandCategory
  scope?: ProductCommandScope
  enabled?: boolean
  target: CapabilityTargetSelector
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
    category: category as ProductCommandCategory | undefined,
    scope: scope as ProductCommandScope | undefined,
    enabled: value.enabled as boolean | undefined,
    target,
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

function selectProductCommandCapabilities(
  snapshot: StudioWebMcpSnapshot,
  query: CapabilityQuery
) {
  const context = productCommandContextForTarget(snapshot, query.target)
  const commandIdFilter = query.commandIds ? new Set(query.commandIds) : null
  const targetScopeAllowed = (scope: ProductCommandScope) =>
    query.target.kind === "current" ||
    scope === "global" ||
    scope === "document" ||
    scope === query.target.kind
  return projectProductCommandCapabilities(context)
    .filter(
      ({ definition, enabled }) =>
        targetScopeAllowed(definition.scope) &&
        (!commandIdFilter || commandIdFilter.has(definition.id)) &&
        (query.category === undefined ||
          definition.category === query.category) &&
        (query.scope === undefined || definition.scope === query.scope) &&
        (query.enabled === undefined || enabled === query.enabled)
    )
    .map(
      ({
        definition,
        invocation,
        label,
        enabled,
        disabledReason,
        checked,
      }) => ({
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
        execution: "not_exposed" as const,
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
  services: StudioWebMcpServices
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
    modifications
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
    status !== "rendering" &&
    status !== "completed" &&
    status !== "failed"
  ) {
    throw new Error("status must be rendering, completed, or failed.")
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
  services: StudioWebMcpServices
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
      return services.resolveAsset(assetIdForValue(value, snapshot.assets))
    })
  )
  return [...snapshot.assets, ...resolved.filter((asset) => asset !== null)]
}

export function studioWebMcpTools(
  services: StudioWebMcpServices
): WebMcpTool[] {
  return [
    {
      name: "inspect_design",
      title: "Inspect active design",
      description:
        "Inspect the live visual document, active page, selection, shared fields, bindings, outputs, and pending review state. Call this before proposing edits.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        try {
          const current = services.getSnapshot()
          const resolvedAssets = await resolveDocumentAssets(
            current.document,
            current,
            services
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
      execute: async (input) => {
        try {
          const page = await services.searchAssets(parseAssetSearchInput(input))
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
      execute: async () => {
        try {
          const snapshot = services.getSnapshot()
          const document = snapshot.document
          const resolvedAssets = await resolveDocumentAssets(
            document,
            snapshot,
            services
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
      execute: async (input) => {
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
            { selectable: true }
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
                  })
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
          services.proposeChangeSet(changeSet)
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
      execute: async (input) => {
        try {
          const current = services.getSnapshot()
          assertCurrentProposalSnapshot(input, current)
          const parsedInput = parseFieldProposalInput(input)
          const resolved = await resolveFieldAssetIds(
            current.document,
            services,
            parsedInput
          )
          const changeSet = createFieldUpdateChangeSet(
            current.document,
            resolved.input,
            services
          )
          services.proposeChangeSet(changeSet)
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
      execute: async (input) => {
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
                { selectable: true }
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
          services.proposeChangeSet(changeSet)
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
          const changeSet = createOutputVariantChangeSet(
            current.document,
            parseOutputProposalInput(input),
            services
          )
          services.proposeChangeSet(changeSet)
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
      execute: async (input) => {
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
          const version = await services.publishTemplate()
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
            enum: ["rendering", "completed", "failed"],
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
        },
        required: ["templateId", "version", "modifications", "outputs"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        untrustedContentHint: true,
      },
      execute: async (input) => {
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
            services
          )
          const record = await services.renderTemplate(
            current.publishedVersion,
            modifications,
            selections
          )
          const result = publicRenderRecord(
            record,
            current.publishedVersion,
            current.assets
          )
          if (record.status === "failed") {
            return {
              content: [
                {
                  type: "text",
                  text: `Render ${record.id} failed. Inspect render history in Studio for the user-facing failure detail.`,
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
}

export async function registerStudioWebMcpTools(
  modelContext: WebMcpModelContext,
  services: StudioWebMcpServices,
  signal: AbortSignal
) {
  const tools = studioWebMcpTools(services)
  await Promise.all(
    tools.map((tool) => modelContext.registerTool(tool, { signal }))
  )
  return tools.length
}
