import {
  documentSchema,
  templateManifestSchema,
  templatePublishRequestSchema,
  templateVersionSchema,
  type Document,
  type TemplateManifest,
  type TemplatePublishRequest,
  type TemplateVersion,
} from "./schema"
import {
  DocumentValidationError,
  assertValidDocument,
  validateDocument,
  type ValidationIssue,
} from "./validation"
import { validateRenderPolicy } from "./render-policy"
import { parseAssetReference } from "./fields"

export type PublishReadiness = {
  blocking: ValidationIssue[]
  warnings: ValidationIssue[]
  localAssetNodeIds: string[]
}

export class PublishValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super(issues[0]?.message ?? "Publishing is blocked")
    this.name = "PublishValidationError"
    this.issues = issues
  }
}

export function validateAssetFieldPublicationIdentities(
  document: Document,
  isApproved: (value: string) => boolean
): ValidationIssue[] {
  return document.fields.flatMap((field) => {
    if (field.type !== "asset") return []
    const values: Array<readonly ["default" | "current", unknown]> = [
      ["default", field.defaultValue],
    ]
    if (Object.hasOwn(document.fieldValues, field.id)) {
      values.push(["current", document.fieldValues[field.id]])
    }
    return values.flatMap(([kind, value]) => {
      if (value === "" && !field.required) return []
      if (typeof value === "string" && isApproved(value)) return []
      return [
        {
          id: `field:${field.id}:${kind}:unmanaged-asset`,
          severity: "error" as const,
          code: "unmanaged_asset" as const,
          message: `${field.label} ${kind} value must use an approved asset before publishing`,
        },
      ]
    })
  })
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) {
      throw new TypeError("Document contains a value that cannot be hashed")
    }
    return encoded
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => (entry === undefined ? "null" : canonicalJson(entry)))
      .join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`
}

export async function deriveDocumentSnapshotId(
  documentInput: Document
): Promise<string> {
  const document = documentSchema.parse(structuredClone(documentInput))
  const bytes = new TextEncoder().encode(canonicalJson(document))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `sha256-${hex}`
}

export function getPublishReadiness(document: Document): PublishReadiness {
  const issues = validateDocument(document)
  const managedAssetNodeIds = new Set(
    document.nodes.flatMap((node) =>
      node.type === "image" && node.src.startsWith("asset:managed/")
        ? [node.id]
        : []
    )
  )
  // Workspace-managed IDs are the canonical persisted publication identity.
  // They are resolved by the authenticated server immediately before render;
  // every other render-policy issue remains a publication blocker.
  const renderPolicyIssues = validateRenderPolicy(document).filter(
    (issue) =>
      !(
        issue.code === "unmanaged_asset" &&
        issue.nodeId &&
        managedAssetNodeIds.has(issue.nodeId)
      )
  )
  const localAssetNodeIds = document.nodes.flatMap((node) =>
    node.type === "image" && node.src.startsWith("asset:local/")
      ? [node.id]
      : []
  )
  const localAssetIssues: ValidationIssue[] = localAssetNodeIds.map(
    (nodeId) => ({
      id: `node:${nodeId}:local-asset`,
      severity: "error",
      code: "missing_asset",
      message: "Upload local images before publishing this template",
      nodeId,
    })
  )
  const imageAccessibilityIssues: ValidationIssue[] = document.nodes.flatMap(
    (node) =>
      node.type === "image" && !node.decorative && node.alt.trim() === ""
        ? [
            {
              id: `node:${node.id}:missing-alt-text`,
              severity: "error" as const,
              code: "missing_alt_text" as const,
              message: `${node.name} needs alternative text or must be marked decorative before publishing`,
              nodeId: node.id,
            },
          ]
        : []
  )
  const unresolvedAssetFieldIssues: ValidationIssue[] = document.fields.flatMap(
    (field) => {
      if (field.type !== "asset") return []
      const values = [
        field.defaultValue,
        ...(document.fieldValues[field.id] === undefined
          ? []
          : [document.fieldValues[field.id]]),
      ]
      const unresolved = values.some((value) => {
        if (value === "") return false
        if (typeof value !== "string") return true
        const parsed = parseAssetReference(value)
        return (
          parsed?.publishRequiresResolution !== false &&
          parsed?.source !== "managed_workspace"
        )
      })
      return unresolved
        ? [
            {
              id: `field:${field.id}:unresolved-asset`,
              severity: "error" as const,
              code: "unmanaged_asset" as const,
              message: `${field.label} must resolve to a network-isolated managed image before publishing`,
            },
          ]
        : []
    }
  )
  return {
    blocking: [
      ...issues.filter((issue) => issue.severity === "error"),
      ...localAssetIssues,
      ...imageAccessibilityIssues,
      ...unresolvedAssetFieldIssues,
      ...renderPolicyIssues,
    ],
    warnings: issues.filter((issue) => issue.severity === "warning"),
    localAssetNodeIds,
  }
}

export function assertRenderableDocument(input: unknown): Document {
  const document = assertValidDocument(input)
  const readiness = getPublishReadiness(document)
  if (readiness.blocking.length) {
    throw new DocumentValidationError(readiness.blocking)
  }
  return document
}

export function createTemplateManifest(document: Document): TemplateManifest {
  const pageByNode = new Map(
    document.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page] as const)
    )
  )
  return templateManifestSchema.parse({
    schemaVersion: 1,
    parameters: document.fields.map((field) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      defaultValue: field.defaultValue,
      exampleValue: document.fieldValues[field.id] ?? field.defaultValue,
      agentDescription: field.agentDescription,
      validation: field.validation,
      bindings: document.bindings.flatMap((binding) => {
        if (binding.fieldId !== field.id) return []
        const page = pageByNode.get(binding.nodeId)
        return page
          ? [
              {
                outputId: page.outputId,
                pageId: page.id,
                nodeId: binding.nodeId,
                property: binding.property,
              },
            ]
          : []
      }),
    })),
    outputs: document.outputs.map((output) => ({
      id: output.id,
      name: output.name,
      kind: output.kind,
      exportFormats: output.exportFormats,
      pages: output.pageIds.flatMap((pageId) => {
        const page = document.pages.find((candidate) => candidate.id === pageId)
        return page
          ? [
              {
                id: page.id,
                name: page.name,
                width: page.width,
                height: page.height,
              },
            ]
          : []
      }),
    })),
  })
}

export function createTemplateVersion(
  documentInput: Document,
  options: {
    id: string
    templateId: string
    version: number
    sourceSnapshotId: string
    publishedAt: string
  }
): TemplateVersion {
  const document = documentSchema.parse(structuredClone(documentInput))
  const readiness = getPublishReadiness(document)
  if (readiness.blocking.length) {
    throw new PublishValidationError(readiness.blocking)
  }
  return templateVersionSchema.parse({
    id: options.id,
    templateId: options.templateId,
    version: options.version,
    sourceRevision: document.revision,
    sourceSnapshotId: options.sourceSnapshotId,
    publishedAt: options.publishedAt,
    document,
    manifest: createTemplateManifest(document),
  })
}

export async function createTemplateVersionFromPublishRequest(
  input: TemplatePublishRequest
): Promise<TemplateVersion> {
  const request = templatePublishRequestSchema.parse(structuredClone(input))
  const sourceSnapshotId = await deriveDocumentSnapshotId(request.document)
  return createTemplateVersion(request.document, {
    id: request.id,
    templateId: request.templateId,
    version: request.version,
    sourceSnapshotId,
    publishedAt: request.publishedAt,
  })
}
