import {
  validateDocument,
  type ChangeSet,
  type Document,
} from "@webmcp/document"
import {
  createFieldUpdateChangeSet,
  type FieldUpdateProposalInput,
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
}

export type StudioWebMcpServices = {
  getSnapshot(): StudioWebMcpSnapshot
  proposeChangeSet(changeSet: ChangeSet): ChangeSet
  publishTemplate(): import("@webmcp/document").TemplateVersion
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
            changeSet
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
      execute: (input) => {
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
          const version = services.publishTemplate()
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
