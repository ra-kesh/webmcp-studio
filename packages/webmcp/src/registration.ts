import {
  validateDocument,
  type ChangeSet,
  type Document,
} from "@webmcp/document"
import {
  createCanvasEditChangeSet,
  createFieldUpdateChangeSet,
  createOutputVariantChangeSet,
  type CanvasEditProposalInput,
  type FieldUpdateProposalInput,
  type OutputVariantProposalInput,
} from "./change-sets"

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
  activePageId: string
  selection: { pageId: string; nodeIds: string[] } | null
  pendingChangeSet: ChangeSet | null
  assets: readonly StudioWebMcpAsset[]
}

export type StudioWebMcpAsset = {
  id: string
  name: string
  description: string
  tags: readonly string[]
  width: number
  height: number
  license: string
  src: string
}

export type StudioWebMcpServices = {
  getSnapshot(): StudioWebMcpSnapshot
  proposeChangeSet(changeSet: ChangeSet): ChangeSet
  publishTemplate():
    | import("@webmcp/document").TemplateVersion
    | Promise<import("@webmcp/document").TemplateVersion>
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

const errorResult = (error: unknown): WebMcpToolResult => ({
  content: [
    {
      type: "text",
      text: error instanceof Error ? error.message : "The tool call failed.",
    },
  ],
  isError: true,
})

const publicChangeSet = (changeSet: ChangeSet) => ({
  id: changeSet.id,
  documentId: changeSet.documentId,
  baseRevision: changeSet.baseRevision,
  title: changeSet.title,
  status: changeSet.status,
  operations: changeSet.operations.map((operation) => {
    const command = operation.command
    if (command.type === "set_field") {
      return {
        id: operation.id,
        status: operation.status,
        summary: operation.summary,
        command: {
          type: command.type,
          fieldId: command.fieldId,
          value: command.value,
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
    return {
      id: operation.id,
      status: operation.status,
      summary: operation.summary,
      command: { type: command.type },
    }
  }),
})

function parseFieldProposalInput(input: unknown): FieldUpdateProposalInput {
  if (!input || typeof input !== "object") {
    throw new Error("Expected a field update proposal object.")
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
    documentId: value.documentId,
    baseRevision: value.baseRevision,
    values,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  }
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
  return value
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
    if (
      !edit.patch ||
      typeof edit.patch !== "object" ||
      Array.isArray(edit.patch)
    ) {
      throw new Error(`edits[${index}].patch must be an object.`)
    }
    return {
      nodeId: edit.nodeId,
      patch: edit.patch as Record<string, unknown>,
      summary: typeof edit.summary === "string" ? edit.summary : undefined,
      assetId: typeof edit.assetId === "string" ? edit.assetId : undefined,
    }
  })
  return {
    documentId: value.documentId as string,
    baseRevision: value.baseRevision as number,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    edits,
  }
}

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
    value.kind !== "square"
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

function searchAssets(assets: readonly StudioWebMcpAsset[], input: unknown) {
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
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  return assets
    .flatMap((asset, position) => {
      const normalizedTags = asset.tags.map((tag) => tag.toLowerCase())
      if (orientation && assetOrientation(asset) !== orientation) return []
      if (tags.some((tag) => !normalizedTags.includes(tag))) return []
      const name = asset.name.toLowerCase()
      const description = asset.description.toLowerCase()
      const score = tokens.reduce((total, token) => {
        if (name.includes(token)) return total + 6
        if (normalizedTags.some((tag) => tag.includes(token))) return total + 3
        if (description.includes(token)) return total + 1
        return total
      }, 0)
      if (tokens.length && score === 0) return []
      return [{ asset, position, score }]
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.position - right.position
    )
    .slice(0, limit)
    .map(({ asset }) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      tags: asset.tags,
      width: asset.width,
      height: asset.height,
      orientation: assetOrientation(asset),
      license: asset.license,
    }))
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
      annotations: { readOnlyHint: true },
      execute: () => {
        const current = services.getSnapshot()
        const activePage = current.document.pages.find(
          (page) => page.id === current.activePageId
        )
        const result = {
          document: {
            id: current.document.id,
            name: current.document.name,
            revision: current.document.revision,
          },
          activePage,
          activePageNodes: activePage?.nodeIds.flatMap((nodeId) => {
            const node = current.document.nodes.find(
              (candidate) => candidate.id === nodeId
            )
            return node ? [node] : []
          }),
          selection: current.selection,
          outputs: current.document.outputs,
          fields: current.document.fields.map((field) => ({
            ...field,
            value: current.document.fieldValues[field.id] ?? field.defaultValue,
            bindings: current.document.bindings.filter(
              (binding) => binding.fieldId === field.id
            ).length,
          })),
          pendingChangeSet: current.pendingChangeSet
            ? {
                id: current.pendingChangeSet.id,
                title: current.pendingChangeSet.title,
                baseRevision: current.pendingChangeSet.baseRevision,
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
        },
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        try {
          const matches = searchAssets(services.getSnapshot().assets, input)
          return textResult(
            `Found ${matches.length} approved asset${matches.length === 1 ? "" : "s"}.`,
            { assets: matches }
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
      annotations: { readOnlyHint: true },
      execute: () => {
        const issues = validateDocument(services.getSnapshot().document)
        const errors = issues.filter((issue) => issue.severity === "error")
        const warnings = issues.filter((issue) => issue.severity === "warning")
        return textResult(
          `Validation found ${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`,
          { errors, warnings }
        )
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
          values: {
            type: "object",
            description:
              "Shared-field values keyed by the stable field key returned by inspect_design.",
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
        required: ["documentId", "baseRevision", "values"],
      },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const changeSet = createFieldUpdateChangeSet(
            current.document,
            parseFieldProposalInput(input),
            services
          )
          services.proposeChangeSet(changeSet)
          return textResult(
            `Created change set ${changeSet.id} with ${changeSet.operations.length} operation${changeSet.operations.length === 1 ? "" : "s"}. The design is previewing these changes, but nothing has been applied. Ask the user to review the Review panel.`,
            publicChangeSet(changeSet)
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
          reason: { type: "string" },
          edits: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                nodeId: {
                  type: "string",
                  description: "Stable node ID returned by inspect_design.",
                },
                patch: {
                  type: "object",
                  description:
                    "Allowed geometry, visibility, typography, shape, or crop properties for this node type.",
                  additionalProperties: true,
                },
                assetId: {
                  type: "string",
                  description:
                    "Approved asset ID returned by search_assets. Only valid for image layers.",
                },
                summary: { type: "string" },
              },
              required: ["nodeId", "patch"],
            },
          },
        },
        required: ["documentId", "baseRevision", "edits"],
      },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const proposal = parseCanvasProposalInput(input)
          const edits = proposal.edits.map((edit) => {
            if (!edit.assetId) return edit
            const asset = current.assets.find(
              (candidate) => candidate.id === edit.assetId
            )
            if (!asset) {
              throw new Error(`Unknown approved asset: ${edit.assetId}`)
            }
            return {
              ...edit,
              replacementAsset: {
                id: asset.id,
                src: asset.src,
                alt: asset.description,
              },
            }
          })
          const changeSet = createCanvasEditChangeSet(
            current.document,
            { ...proposal, edits },
            services
          )
          services.proposeChangeSet(changeSet)
          return textResult(
            `Previewing ${changeSet.operations.length} canvas edit${changeSet.operations.length === 1 ? "" : "s"}. Nothing has been applied; ask the user to review the Review panel.`,
            publicChangeSet(changeSet)
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
          sourcePageId: {
            type: "string",
            description: "Page ID returned by inspect_design.",
          },
          name: { type: "string" },
          pageName: { type: "string" },
          kind: {
            type: "string",
            enum: ["proposal", "whatsapp_portrait", "square"],
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
          "sourcePageId",
          "name",
          "kind",
          "width",
          "height",
          "exportFormats",
        ],
      },
      execute: (input) => {
        try {
          const current = services.getSnapshot()
          const changeSet = createOutputVariantChangeSet(
            current.document,
            parseOutputProposalInput(input),
            services
          )
          services.proposeChangeSet(changeSet)
          return textResult(
            "Previewing one complete output adaptation. Nothing has been applied; ask the user to review the Review panel.",
            publicChangeSet(changeSet)
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
        },
        required: ["documentId", "expectedRevision"],
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
