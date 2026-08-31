import {
  builtInDesignTemplateRepository,
  projectDesignTemplateDetail,
  projectDesignTemplateSummary,
  studioBlankDocumentPresets,
  studioDesignPlanVocabulary,
  studioGenerationCapabilities,
  type Document,
  type DesignTemplateCatalogItem,
} from "@webmcp/document"

export type GenerationTemplateQuery = Readonly<{
  query: string
  category?: string
  formatFamily?: string
  useCaseId?: string
  startAfter?: string
  limit: number
}>

const publicSummary = (template: DesignTemplateCatalogItem) => {
  const summary = projectDesignTemplateSummary(template)
  return {
    id: summary.id,
    version: summary.version,
    name: summary.name,
    description: summary.description,
    templateKind: summary.templateKind,
    categoryId: summary.categoryId,
    useCaseIds: summary.useCaseIds,
    formatFamily: summary.formatFamily,
    orientation: summary.orientation,
    dimensions: summary.dimensions,
    pageCount: summary.pageCount,
    tags: summary.tags,
    compatibility: summary.compatibility,
    preview: summary.preview,
    contentSha256: summary.provenance.contentSha256,
  }
}

export function projectGenerationEditableNodes(document: Document) {
  const fieldById = new Map(document.fields.map((field) => [field.id, field]))
  const nodeBindings = new Map<
    string,
    Array<{ property: string; fieldKey: string }>
  >()
  for (const binding of document.bindings) {
    const field = fieldById.get(binding.fieldId)
    if (!field) continue
    const current = nodeBindings.get(binding.nodeId) ?? []
    current.push({ property: binding.property, fieldKey: field.key })
    nodeBindings.set(binding.nodeId, current)
  }
  const pageByNodeId = new Map(
    document.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.id] as const)
    )
  )
  return document.nodes.map((node) => {
    const pageId = pageByNodeId.get(node.id)
    if (!pageId) {
      throw new Error(`Template node ${node.id} has no public page identity.`)
    }
    const fieldBindings = (nodeBindings.get(node.id) ?? []).sort(
      (left, right) => left.property.localeCompare(right.property)
    )
    const boundProperties = new Set(
      fieldBindings.map((binding) => binding.property)
    )
    return {
      id: node.id,
      pageId,
      name: node.name,
      type: node.type,
      allowedChanges: [
        ...(!boundProperties.has("visible") ? ["set_visibility" as const] : []),
        ...(node.type === "text" && !boundProperties.has("text")
          ? ["set_text" as const]
          : []),
        ...(node.type === "image" && !boundProperties.has("src")
          ? ["asset_substitution" as const]
          : []),
      ],
      fieldBindings,
    }
  })
}

export function searchGenerationTemplates(query: GenerationTemplateQuery) {
  const normalized = query.query.trim().toLowerCase()
  const templates = builtInDesignTemplateRepository
    .list({ category: query.category })
    .filter((template) => {
      if (
        query.formatFamily &&
        template.manifest.formatFamily !== query.formatFamily
      ) {
        return false
      }
      if (
        query.useCaseId &&
        !template.manifest.useCaseIds.includes(query.useCaseId)
      ) {
        return false
      }
      if (!normalized) return true
      return [
        template.name,
        template.description,
        template.category,
        template.manifest.job,
        ...template.tags,
        ...template.manifest.useCaseIds,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    })
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) || right.version - left.version
    )
  const cursorIndex = query.startAfter
    ? templates.findIndex(
        (template) => `${template.id}@${template.version}` === query.startAfter
      )
    : -1
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0
  const page = templates.slice(start, start + query.limit)
  const last = page.at(-1)
  return {
    templates: page.map(publicSummary),
    nextCursor:
      start + page.length < templates.length && last
        ? `${last.id}@${last.version}`
        : null,
  }
}

export function readGenerationTemplate(id: string, version: number) {
  const template = builtInDesignTemplateRepository
    .list()
    .find((candidate) => candidate.id === id && candidate.version === version)
  if (!template) throw new Error(`Unknown design template: ${id}@${version}`)
  const detail = projectDesignTemplateDetail(template)
  return {
    ...publicSummary(template),
    job: template.manifest.job,
    sourceRequirements: detail.summary.compatibility.requirements,
    materialization: detail.materialization,
    manifest: {
      formatFamily: template.manifest.formatFamily,
      useCaseIds: template.manifest.useCaseIds,
      documentProfile: template.manifest.documentProfile,
      provenance: template.manifest.provenance,
    },
    fields: template.previewDocument.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      agentDescription: field.agentDescription,
      validation: field.validation,
    })),
    editableNodes: projectGenerationEditableNodes(template.previewDocument),
    outputs: template.previewDocument.outputs.map((output) => ({
      name: output.name,
      kind: output.kind,
      exportFormats: output.exportFormats,
      pages: output.pageIds.flatMap((pageId) => {
        const page = template.previewDocument.pages.find(
          (candidate) => candidate.id === pageId
        )
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
  }
}

export const readGenerationCapabilities = () => studioGenerationCapabilities
export const readBlankDocumentPresets = () => ({
  presets: studioBlankDocumentPresets,
})
export const readDesignPlanSchema = () => studioDesignPlanVocabulary
