import { z } from "zod"
import {
  composeQuotationDocument,
  QUOTATION_COMPOSER_VERSION,
} from "./quotation-composer"
import type { QuotationTemplateId } from "./quotation-composer"
import type { QuotationRenderPayloadV1 } from "./quotation-contract"
import { documentSchema } from "./schema"
import type { Document } from "./schema"
import { assertValidDocument } from "./validation"

const designTemplateSourceSchema = z
  .object({
    name: z.string().min(1),
    license: z.string().min(1),
    url: z.string().url().optional(),
  })
  .strict()

const designTemplateCommonSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  createdAt: z.string().datetime(),
  source: designTemplateSourceSchema,
  catalogStatus: z.enum(["active", "retired"]).optional(),
})

export const documentStarterTemplateSchema = designTemplateCommonSchema
  .extend({
    kind: z.literal("document_starter"),
    document: documentSchema,
  })
  .strict()

export const quotationStyleTemplateSchema = designTemplateCommonSchema
  .extend({
    kind: z.literal("quotation_style"),
    quotationTemplateId: z.enum([
      "editorial-olive",
      "warm-paper",
      "midnight-film",
    ]),
    composerVersion: z.number().int().positive(),
  })
  .strict()

export const designTemplateDefinitionSchema = z.discriminatedUnion("kind", [
  documentStarterTemplateSchema,
  quotationStyleTemplateSchema,
])

export type DesignTemplateDefinition = z.infer<
  typeof designTemplateDefinitionSchema
>
export type DocumentStarterTemplate = z.infer<
  typeof documentStarterTemplateSchema
>
export type QuotationStyleTemplate = z.infer<
  typeof quotationStyleTemplateSchema
>

type DesignTemplateCatalogMetadata<T> = T extends unknown
  ? Omit<T, "document">
  : never

export type DesignTemplateCatalogItem =
  DesignTemplateCatalogMetadata<DesignTemplateDefinition> & {
    previewDocument: Document
    previewPageId: string
    pageCount: number
    dimensions: Array<{ width: number; height: number }>
    requiresQuotationSource: boolean
  }

export type DesignTemplateQuery = {
  search?: string
  category?: string
  kind?: DesignTemplateDefinition["kind"]
}

export type DesignTemplateMaterializeOptions = {
  quotation?: QuotationRenderPayloadV1
  identity?: "fresh" | "canonical"
  name?: string
  now?: string
  createId?: (kind: string, sourceId: string) => string
}

export type TemplateApplicationImpact = {
  pages: { before: number; after: number }
  outputs: { before: number; after: number }
  nodes: { before: number; after: number }
  groups: { before: number; after: number }
  fields: { before: number; after: number }
  bindings: { before: number; after: number }
  imageAssets: { before: number; after: number }
  disconnectsQuotationSource: boolean
  rebuildsFromQuotationSource: boolean
}

const quotationTemplateIds: readonly QuotationTemplateId[] = [
  "editorial-olive",
  "warm-paper",
  "midnight-film",
]

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

const immutableDefinition = (definition: DesignTemplateDefinition) => {
  const parsed = designTemplateDefinitionSchema.parse(
    structuredClone(definition)
  )
  if (parsed.kind === "document_starter") {
    assertValidDocument(parsed.document)
  }
  return deepFreeze(parsed)
}

const normalizeSearch = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ")

const matchesQuery = (
  definition: DesignTemplateDefinition,
  query: DesignTemplateQuery
) => {
  if (query.kind && definition.kind !== query.kind) return false
  if (
    query.category &&
    normalizeSearch(definition.category) !== normalizeSearch(query.category)
  ) {
    return false
  }
  const search = normalizeSearch(query.search ?? "")
  if (!search) return true
  return normalizeSearch(
    [
      definition.name,
      definition.description,
      definition.category,
      ...definition.tags,
    ].join(" ")
  ).includes(search)
}

const defaultCreateId = (kind: string) => `${kind}-${crypto.randomUUID()}`

export function cloneTemplateDocument(
  source: Document,
  options: Pick<
    DesignTemplateMaterializeOptions,
    "name" | "now" | "createId"
  > = {}
) {
  const now = options.now ?? new Date().toISOString()
  const createId = options.createId ?? defaultCreateId
  const ids = {
    output: new Map(
      source.outputs.map((output) => [output.id, createId("output", output.id)])
    ),
    page: new Map(
      source.pages.map((page) => [page.id, createId("page", page.id)])
    ),
    node: new Map(
      source.nodes.map((node) => [node.id, createId("node", node.id)])
    ),
    group: new Map(
      source.groups.map((group) => [group.id, createId("group", group.id)])
    ),
    field: new Map(
      source.fields.map((field) => [field.id, createId("field", field.id)])
    ),
    binding: new Map(
      source.bindings.map((binding) => [
        binding.id,
        createId("binding", binding.id),
      ])
    ),
  }
  const requiredId = (map: Map<string, string>, id: string, kind: string) => {
    const next = map.get(id)
    if (!next) throw new Error(`Template ${kind} reference is missing: ${id}`)
    return next
  }

  return assertValidDocument(
    documentSchema.parse({
      ...structuredClone(source),
      id: createId("document", source.id),
      name: options.name?.trim() || source.name,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      outputs: source.outputs.map((output) => ({
        ...output,
        id: requiredId(ids.output, output.id, "output"),
        pageIds: output.pageIds.map((pageId) =>
          requiredId(ids.page, pageId, "page")
        ),
      })),
      pages: source.pages.map((page) => ({
        ...page,
        id: requiredId(ids.page, page.id, "page"),
        outputId: requiredId(ids.output, page.outputId, "output"),
        nodeIds: page.nodeIds.map((nodeId) =>
          requiredId(ids.node, nodeId, "node")
        ),
      })),
      nodes: source.nodes.map((node) => ({
        ...node,
        id: requiredId(ids.node, node.id, "node"),
      })),
      groups: source.groups.map((group) => ({
        ...group,
        id: requiredId(ids.group, group.id, "group"),
        pageId: requiredId(ids.page, group.pageId, "page"),
        parentGroupId: group.parentGroupId
          ? requiredId(ids.group, group.parentGroupId, "group")
          : undefined,
        nodeIds: group.nodeIds.map((nodeId) =>
          requiredId(ids.node, nodeId, "node")
        ),
      })),
      fields: source.fields.map((field) => ({
        ...field,
        id: requiredId(ids.field, field.id, "field"),
      })),
      fieldValues: Object.fromEntries(
        Object.entries(source.fieldValues).map(([fieldId, value]) => [
          requiredId(ids.field, fieldId, "field"),
          value,
        ])
      ),
      bindings: source.bindings.map((binding) => ({
        ...binding,
        id: requiredId(ids.binding, binding.id, "binding"),
        fieldId: requiredId(ids.field, binding.fieldId, "field"),
        nodeId: requiredId(ids.node, binding.nodeId, "node"),
      })),
    })
  )
}

const imageAssetCount = (document: Document) =>
  new Set(
    document.nodes.flatMap((node) =>
      node.type === "image" ? [node.assetId] : []
    )
  ).size

export function templateApplicationImpact(
  current: Document,
  next: Document,
  options: {
    currentHasQuotationSource: boolean
    nextHasQuotationSource: boolean
    rebuildsFromQuotationSource?: boolean
  }
): TemplateApplicationImpact {
  return {
    pages: { before: current.pages.length, after: next.pages.length },
    outputs: { before: current.outputs.length, after: next.outputs.length },
    nodes: { before: current.nodes.length, after: next.nodes.length },
    groups: { before: current.groups.length, after: next.groups.length },
    fields: { before: current.fields.length, after: next.fields.length },
    bindings: { before: current.bindings.length, after: next.bindings.length },
    imageAssets: {
      before: imageAssetCount(current),
      after: imageAssetCount(next),
    },
    disconnectsQuotationSource:
      options.currentHasQuotationSource && !options.nextHasQuotationSource,
    rebuildsFromQuotationSource: options.rebuildsFromQuotationSource ?? false,
  }
}

export class DesignTemplateRepository {
  readonly #definitions: readonly DesignTemplateDefinition[]
  readonly #previewQuotation: QuotationRenderPayloadV1

  constructor(
    definitions: readonly DesignTemplateDefinition[],
    previewQuotation: QuotationRenderPayloadV1
  ) {
    const unique = new Set<string>()
    this.#definitions = definitions
      .map(immutableDefinition)
      .sort(
        (left, right) =>
          left.category.localeCompare(right.category) ||
          left.name.localeCompare(right.name) ||
          right.version - left.version
      )
      .map((definition) => {
        const key = `${definition.id}@${definition.version}`
        if (unique.has(key)) {
          throw new Error(`Duplicate design template version: ${key}`)
        }
        unique.add(key)
        return definition
      })
    this.#previewQuotation = structuredClone(previewQuotation)
  }

  list(query: DesignTemplateQuery = {}): DesignTemplateCatalogItem[] {
    return this.#definitions
      .filter((definition) => definition.catalogStatus !== "retired")
      .filter((definition) => matchesQuery(definition, query))
      .map((definition) => this.#catalogItem(definition))
  }

  categories() {
    return [
      ...new Set(
        this.#definitions
          .filter((item) => item.catalogStatus !== "retired")
          .map((item) => item.category)
      ),
    ]
  }

  get(id: string, version?: number) {
    const matches = this.#definitions.filter(
      (definition) =>
        definition.id === id &&
        (version === undefined || definition.version === version)
    )
    const definition = matches.sort(
      (left, right) => right.version - left.version
    )[0]
    if (!definition) {
      throw new Error(
        `Unknown design template: ${id}${version ? `@${version}` : ""}`
      )
    }
    return definition
  }

  materialize(
    id: string,
    version: number | undefined,
    options: DesignTemplateMaterializeOptions = {}
  ) {
    const definition = this.get(id, version)
    if (definition.kind === "document_starter") {
      if (options.identity === "canonical") {
        return structuredClone(definition.document)
      }
      return cloneTemplateDocument(definition.document, options)
    }
    if (!options.quotation) {
      throw new Error(
        `Template ${definition.id} requires quotation source data.`
      )
    }
    if (!quotationTemplateIds.includes(definition.quotationTemplateId)) {
      throw new Error(
        `Unsupported quotation template: ${definition.quotationTemplateId}`
      )
    }
    if (definition.composerVersion !== QUOTATION_COMPOSER_VERSION) {
      throw new Error(
        `Template ${definition.id}@${definition.version} requires retired quotation composer ${definition.composerVersion}; use a current template version or explicitly upgrade the saved document.`
      )
    }
    const document = composeQuotationDocument(
      options.quotation,
      definition.quotationTemplateId
    )
    return options.identity === "canonical"
      ? document
      : cloneTemplateDocument(document, options)
  }

  #catalogItem(
    definition: DesignTemplateDefinition
  ): DesignTemplateCatalogItem {
    if (
      definition.kind === "quotation_style" &&
      definition.composerVersion !== QUOTATION_COMPOSER_VERSION
    ) {
      throw new Error(
        `Retired quotation template ${definition.id}@${definition.version} cannot be projected into the active catalog.`
      )
    }
    const previewDocument =
      definition.kind === "document_starter"
        ? definition.document
        : composeQuotationDocument(
            this.#previewQuotation,
            definition.quotationTemplateId
          )
    const previewPageId = previewDocument.pages[0]?.id
    if (!previewPageId) {
      throw new Error(`Template ${definition.id} has no preview page.`)
    }
    const { document: _document, ...metadata } =
      definition.kind === "document_starter"
        ? definition
        : { ...definition, document: undefined }
    return deepFreeze({
      ...metadata,
      previewDocument,
      previewPageId,
      pageCount: previewDocument.pages.length,
      dimensions: previewDocument.pages.map(({ width, height }) => ({
        width,
        height,
      })),
      requiresQuotationSource: definition.kind === "quotation_style",
    }) as DesignTemplateCatalogItem
  }
}
