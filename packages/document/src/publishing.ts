import {
  documentSchema,
  templateManifestSchema,
  templateVersionSchema,
  type Document,
  type TemplateManifest,
  type TemplateVersion,
} from "./schema"
import { validateDocument, type ValidationIssue } from "./validation"

export type PublishReadiness = {
  blocking: ValidationIssue[]
  warnings: ValidationIssue[]
  localAssetNodeIds: string[]
}

export function getPublishReadiness(document: Document): PublishReadiness {
  const issues = validateDocument(document)
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
  return {
    blocking: [
      ...issues.filter((issue) => issue.severity === "error"),
      ...localAssetIssues,
    ],
    warnings: issues.filter((issue) => issue.severity === "warning"),
    localAssetNodeIds,
  }
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
    publishedAt: string
  }
): TemplateVersion {
  const document = documentSchema.parse(structuredClone(documentInput))
  const readiness = getPublishReadiness(document)
  if (readiness.blocking.length) {
    throw new Error(readiness.blocking[0]?.message ?? "Publishing is blocked")
  }
  return templateVersionSchema.parse({
    id: options.id,
    templateId: options.templateId,
    version: options.version,
    sourceRevision: document.revision,
    publishedAt: options.publishedAt,
    document,
    manifest: createTemplateManifest(document),
  })
}
