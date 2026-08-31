import { z } from "zod"

const catalogIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const normalizedTagPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
const sha256Pattern = /^[a-f0-9]{64}$/
const base64UrlPattern = /^[A-Za-z0-9_-]+$/

const compareText = (left: string, right: string) =>
  left === right ? 0 : left < right ? -1 : 1

const unique = <Value>(values: readonly Value[]) =>
  new Set(values).size === values.length

export const catalogIdSchema = z.string().regex(catalogIdPattern)
const normalizedTagSchema = z.string().regex(normalizedTagPattern)
const sha256Schema = z.string().regex(sha256Pattern)
const dateTimeSchema = z.string().datetime()
const generationSchema = z.string().trim().min(1).max(128)
const publicHttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  }, "Catalog URLs must use HTTP or HTTPS")

const uniqueIdArraySchema = (maximum: number) =>
  z
    .array(catalogIdSchema)
    .max(maximum)
    .superRefine((values, context) => {
      if (!unique(values)) {
        context.addIssue({
          code: "custom",
          message: "Catalog identifiers must be unique",
        })
      }
    })

const normalizedTagsSchema = z
  .array(normalizedTagSchema)
  .max(50)
  .superRefine((values, context) => {
    if (!unique(values)) {
      context.addIssue({
        code: "custom",
        message: "Catalog tags must be unique",
      })
    }
  })

export const libraryOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("studio") }).strict(),
  z.object({ kind: z.literal("workspace") }).strict(),
])

export const libraryPermissionProjectionSchema = z
  .object({
    canView: z.literal(true),
    canUse: z.boolean(),
    canFavorite: z.boolean(),
    canAddToCollection: z.boolean(),
  })
  .strict()

export const libraryProvenanceSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(200),
    sourceUrl: publicHttpUrlSchema.nullable(),
    license: z
      .object({
        id: catalogIdSchema,
        name: z.string().trim().min(1).max(200),
        url: publicHttpUrlSchema.nullable(),
      })
      .strict(),
    attribution: z
      .object({
        required: z.boolean(),
        text: z.string().trim().min(1).max(500).nullable(),
      })
      .strict(),
    contentSha256: sha256Schema.nullable(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.attribution.required && !provenance.attribution.text) {
      context.addIssue({
        code: "custom",
        path: ["attribution", "text"],
        message: "Required attribution must include display text",
      })
    }
  })

const previewResourcePathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .startsWith("/")
  .refine(
    (path) =>
      !path.startsWith("//") &&
      !path.includes("\\") &&
      !path.split(/[?#]/, 1)[0]!.split("/").includes(".."),
    "Preview resources must use a safe same-origin path"
  )

export const libraryPreviewDescriptorSchema = z
  .object({
    kind: z.enum(["raster", "live_fallback"]),
    itemId: catalogIdSchema,
    itemVersion: z.number().int().positive(),
    pageId: catalogIdSchema.nullable(),
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
    resourcePath: previewResourcePathSchema.nullable(),
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]).nullable(),
    contentSha256: sha256Schema.nullable(),
    rendererRevision: catalogIdSchema.nullable(),
  })
  .strict()
  .superRefine((preview, context) => {
    const rasterFields = [
      preview.resourcePath,
      preview.mediaType,
      preview.contentSha256,
      preview.rendererRevision,
    ]
    if (preview.kind === "raster" && rasterFields.some((value) => !value)) {
      context.addIssue({
        code: "custom",
        message:
          "Raster previews require a resource path, media type, checksum, and renderer revision",
      })
    }
    if (
      preview.kind === "live_fallback" &&
      rasterFields.some((value) => value !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Live fallback previews cannot claim raster identity",
      })
    }
  })

export const libraryCompatibilitySchema = z
  .object({
    availability: z.enum(["available", "requires_source", "unavailable"]),
    requirements: z
      .array(z.enum(["quotation_source"]))
      .max(1)
      .refine(unique, "Compatibility requirements must be unique"),
    supportedActions: z
      .array(z.enum(["create", "apply", "insert", "replace", "assign_field"]))
      .min(1)
      .max(5)
      .refine(unique, "Supported actions must be unique"),
    reason: z.string().trim().min(1).max(300).nullable(),
  })
  .strict()
  .superRefine((compatibility, context) => {
    if (
      compatibility.availability === "requires_source" &&
      compatibility.requirements.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["requirements"],
        message: "Source-dependent items must name a requirement",
      })
    }
    if (compatibility.availability === "unavailable" && !compatibility.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Unavailable items must explain why they cannot be used",
      })
    }
  })

export const libraryPreferenceProjectionSchema = z
  .object({
    favorite: z.boolean(),
    lastUsedAt: dateTimeSchema.nullable(),
    collectionIds: uniqueIdArraySchema(100),
  })
  .strict()

export type LibraryOwner = z.infer<typeof libraryOwnerSchema>
export type LibraryPermissionProjection = z.infer<
  typeof libraryPermissionProjectionSchema
>
export type LibraryProvenance = z.infer<typeof libraryProvenanceSchema>
export type LibraryPreviewDescriptor = z.infer<
  typeof libraryPreviewDescriptorSchema
>
export type LibraryPreferenceProjection = z.infer<
  typeof libraryPreferenceProjectionSchema
>

const libraryCatalogCommonFields = {
  schemaVersion: z.literal(1),
  id: catalogIdSchema,
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1_000),
  categoryId: catalogIdSchema,
  useCaseIds: uniqueIdArraySchema(30),
  formatFamily: catalogIdSchema,
  orientation: z.enum(["portrait", "landscape", "square", "mixed"]),
  tags: normalizedTagsSchema,
  owner: libraryOwnerSchema,
  permissions: libraryPermissionProjectionSchema,
  provenance: libraryProvenanceSchema,
  compatibility: libraryCompatibilitySchema,
  preview: libraryPreviewDescriptorSchema,
  preferences: libraryPreferenceProjectionSchema.nullable(),
  catalogStatus: z.enum(["active", "retired"]),
  curatedRank: z.number().int().nonnegative().nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
}

const dimensionSchema = z
  .object({
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
  })
  .strict()

const rawLibraryTemplateSummarySchema = z
  .object({
    ...libraryCatalogCommonFields,
    itemKind: z.literal("template"),
    templateKind: z.enum(["document_starter", "quotation_style"]),
    dimensions: z.array(dimensionSchema).min(1).max(100),
    pageCount: z.number().int().positive().max(100),
  })
  .strict()

export const libraryTemplateSummarySchema =
  rawLibraryTemplateSummarySchema.superRefine((summary, context) => {
    validateCommonSummary(summary, context)
    const orientation = orientationForDimensions(summary.dimensions)
    if (summary.orientation !== orientation) {
      context.addIssue({
        code: "custom",
        path: ["orientation"],
        message: `Template dimensions require ${orientation} orientation`,
      })
    }
    if (summary.pageCount !== summary.dimensions.length) {
      context.addIssue({
        code: "custom",
        path: ["pageCount"],
        message: "Template page count must match its dimension records",
      })
    }
    if (!summary.preview.pageId) {
      context.addIssue({
        code: "custom",
        path: ["preview", "pageId"],
        message: "Template previews require an exact page identity",
      })
    }
    const actions = new Set(summary.compatibility.supportedActions)
    if (
      [...actions].some((action) => action !== "create" && action !== "apply")
    ) {
      context.addIssue({
        code: "custom",
        path: ["compatibility", "supportedActions"],
        message: "Template summaries only support create and apply actions",
      })
    }
    const requiresQuotation =
      summary.compatibility.requirements.includes("quotation_source")
    if ((summary.templateKind === "quotation_style") !== requiresQuotation) {
      context.addIssue({
        code: "custom",
        path: ["compatibility", "requirements"],
        message:
          "Quotation styles must retain their quotation source requirement",
      })
    }
    if (
      summary.templateKind === "quotation_style" &&
      summary.compatibility.availability !== "requires_source"
    ) {
      context.addIssue({
        code: "custom",
        path: ["compatibility", "availability"],
        message: "Quotation styles must require quotation source context",
      })
    }
  })

const rawLibraryMediaSummarySchema = z
  .object({
    ...libraryCatalogCommonFields,
    itemKind: z.literal("media"),
    mediaSource: z.enum(["curated", "managed", "local"]),
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/svg+xml",
    ]),
    dimensions: dimensionSchema,
    bytes: z.number().int().positive().max(100_000_000),
    selectable: z.boolean(),
  })
  .strict()

export const libraryMediaSummarySchema =
  rawLibraryMediaSummarySchema.superRefine((summary, context) => {
    validateCommonSummary(summary, context)
    const orientation = orientationForDimensions([summary.dimensions])
    if (summary.orientation !== orientation) {
      context.addIssue({
        code: "custom",
        path: ["orientation"],
        message: `Media dimensions require ${orientation} orientation`,
      })
    }
    if (summary.orientation === "mixed") {
      context.addIssue({
        code: "custom",
        path: ["orientation"],
        message: "A media item cannot have mixed orientation",
      })
    }
    if (summary.preview.pageId !== null) {
      context.addIssue({
        code: "custom",
        path: ["preview", "pageId"],
        message: "Media previews do not have a document page identity",
      })
    }
    if (
      (summary.mediaSource === "curated") !==
      (summary.owner.kind === "studio")
    ) {
      context.addIssue({
        code: "custom",
        path: ["owner"],
        message:
          "Curated media is Studio-owned; managed and local media is workspace-owned",
      })
    }
    const actions = new Set(summary.compatibility.supportedActions)
    if (
      [...actions].some(
        (action) =>
          action !== "insert" &&
          action !== "replace" &&
          action !== "assign_field"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["compatibility", "supportedActions"],
        message:
          "Media summaries only support insert, replace, and field assignment actions",
      })
    }
    if (summary.compatibility.requirements.length) {
      context.addIssue({
        code: "custom",
        path: ["compatibility", "requirements"],
        message: "Media summaries cannot require template source context",
      })
    }
    const expectedSelectable =
      summary.permissions.canUse &&
      summary.compatibility.availability === "available"
    if (summary.selectable !== expectedSelectable) {
      context.addIssue({
        code: "custom",
        path: ["selectable"],
        message:
          "Media selectable state must agree with permission and compatibility projections",
      })
    }
  })

const rawLibraryCatalogItemSummarySchema = z.discriminatedUnion("itemKind", [
  rawLibraryTemplateSummarySchema,
  rawLibraryMediaSummarySchema,
])

export const libraryCatalogItemSummarySchema = z.union([
  libraryTemplateSummarySchema,
  libraryMediaSummarySchema,
])

export type LibraryTemplateSummary = z.infer<
  typeof libraryTemplateSummarySchema
>
export type LibraryMediaSummary = z.infer<typeof libraryMediaSummarySchema>
export type LibraryCatalogItemSummary = z.infer<
  typeof libraryCatalogItemSummarySchema
>

const templateMaterializationSchema = z
  .object({
    repository: z.literal("design_template"),
    templateId: catalogIdSchema,
    templateVersion: z.number().int().positive(),
    sourceContext: z.enum(["none", "quotation"]),
  })
  .strict()

export const libraryTemplateDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: libraryTemplateSummarySchema,
    materialization: templateMaterializationSchema,
  })
  .strict()
  .superRefine((detail, context) => {
    if (
      detail.materialization.templateId !== detail.summary.id ||
      detail.materialization.templateVersion !== detail.summary.version
    ) {
      context.addIssue({
        code: "custom",
        path: ["materialization"],
        message: "Materialization identity must match the template summary",
      })
    }
    const expectedContext =
      detail.summary.templateKind === "quotation_style" ? "quotation" : "none"
    if (detail.materialization.sourceContext !== expectedContext) {
      context.addIssue({
        code: "custom",
        path: ["materialization", "sourceContext"],
        message: "Materialization must retain the template source context",
      })
    }
  })

const mediaSelectionIdentitySchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("curated"),
      assetId: catalogIdSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      source: z.literal("managed"),
      assetId: catalogIdSchema,
      refetch: z.literal("required"),
    })
    .strict(),
  z
    .object({
      source: z.literal("local"),
      assetId: catalogIdSchema,
      revision: z.number().int().positive(),
    })
    .strict(),
])

export const libraryMediaDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: libraryMediaSummarySchema,
    selectionIdentity: mediaSelectionIdentitySchema,
  })
  .strict()
  .superRefine((detail, context) => {
    if (
      detail.selectionIdentity.source !== detail.summary.mediaSource ||
      detail.selectionIdentity.assetId !== detail.summary.id
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectionIdentity"],
        message: "Selection identity must match the media summary exactly",
      })
    }
    if (
      detail.selectionIdentity.source !== "managed" &&
      (detail.selectionIdentity.source === "curated"
        ? detail.selectionIdentity.version
        : detail.selectionIdentity.revision) !== detail.summary.version
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectionIdentity"],
        message:
          "Curated and local selection versions must match the media summary",
      })
    }
  })

export const libraryCatalogItemDetailSchema = z.union([
  libraryTemplateDetailSchema,
  libraryMediaDetailSchema,
])

export type LibraryTemplateDetail = z.infer<typeof libraryTemplateDetailSchema>
export type LibraryMediaDetail = z.infer<typeof libraryMediaDetailSchema>
export type LibraryCatalogItemDetail = z.infer<
  typeof libraryCatalogItemDetailSchema
>

const normalizedQueryIdArraySchema = <Value extends string>(
  schema: z.ZodType<Value>,
  maximum: number
) =>
  z
    .array(schema)
    .max(maximum)
    .transform((values) => [...new Set(values)].sort(compareText))

export const libraryCatalogQuerySchema = z
  .object({
    generation: generationSchema,
    search: z
      .string()
      .max(200)
      .transform((value) => normalizeSearch(value))
      .default(""),
    itemKinds: normalizedQueryIdArraySchema(
      z.enum(["template", "media"]),
      2
    ).default(["template", "media"]),
    categoryIds: normalizedQueryIdArraySchema(catalogIdSchema, 50).default([]),
    useCaseIds: normalizedQueryIdArraySchema(catalogIdSchema, 50).default([]),
    formatFamilies: normalizedQueryIdArraySchema(catalogIdSchema, 50).default(
      []
    ),
    orientations: normalizedQueryIdArraySchema(
      z.enum(["portrait", "landscape", "square", "mixed"]),
      4
    ).default([]),
    ownerKinds: normalizedQueryIdArraySchema(
      z.enum(["studio", "workspace"]),
      2
    ).default([]),
    favoritesOnly: z.boolean().default(false),
    recentOnly: z.boolean().default(false),
    collectionId: catalogIdSchema.nullable().default(null),
    order: z.enum(["curated", "recent", "newest"]).default("curated"),
    limit: z.number().int().min(1).max(50).default(24),
    cursor: z
      .string()
      .min(1)
      .max(4_096)
      .regex(base64UrlPattern)
      .nullable()
      .default(null),
  })
  .strict()

export type LibraryCatalogQuery = z.infer<typeof libraryCatalogQuerySchema>
export type LibraryCatalogQueryInput = z.input<typeof libraryCatalogQuerySchema>

export const libraryCatalogPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogRevision: catalogIdSchema,
    generation: generationSchema,
    queryIdentity: z.string().regex(/^libq_[a-f0-9]{16}$/),
    items: z.array(libraryCatalogItemSummarySchema).max(50),
    nextCursor: z.string().min(1).max(4_096).regex(base64UrlPattern).nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict()

export type LibraryCatalogPage = z.infer<typeof libraryCatalogPageSchema>

const cursorPayloadSchema = z
  .object({
    version: z.literal(1),
    catalogRevision: catalogIdSchema,
    generation: generationSchema,
    queryIdentity: z.string().regex(/^libq_[a-f0-9]{16}$/),
    offset: z.number().int().nonnegative(),
  })
  .strict()

type CursorFailureReason =
  | "malformed"
  | "catalog_revision_mismatch"
  | "generation_mismatch"
  | "query_mismatch"
  | "offset_out_of_range"

export class LibraryCatalogCursorError extends Error {
  readonly code = "invalid_library_cursor"

  constructor(readonly reason: CursorFailureReason) {
    super(`Library cursor is invalid: ${reason}`)
    this.name = "LibraryCatalogCursorError"
  }
}

export class LibraryCatalogIndex {
  readonly #catalogRevision: string
  readonly #items: readonly LibraryCatalogItemSummary[]

  constructor(
    catalogRevision: string,
    items: readonly LibraryCatalogItemSummary[]
  ) {
    this.#catalogRevision = catalogIdSchema.parse(catalogRevision)
    const identities = new Set<string>()
    this.#items = items.map((item) => {
      const parsed = immutable(
        libraryCatalogItemSummarySchema.parse(structuredClone(item))
      )
      const identity = itemIdentity(parsed)
      if (identities.has(identity)) {
        throw new Error(`Duplicate library catalog item: ${identity}`)
      }
      identities.add(identity)
      return parsed
    })
  }

  get catalogRevision() {
    return this.#catalogRevision
  }

  get(
    itemKind: LibraryCatalogItemSummary["itemKind"],
    id: string,
    version?: number
  ) {
    const parsedId = catalogIdSchema.parse(id)
    const matches = this.#items.filter(
      (item) =>
        item.itemKind === itemKind &&
        item.id === parsedId &&
        (version === undefined || item.version === version)
    )
    return (
      matches.sort((left, right) => right.version - left.version)[0] ?? null
    )
  }

  list(input: LibraryCatalogQueryInput): LibraryCatalogPage {
    const query = libraryCatalogQuerySchema.parse(input)
    const queryIdentity = libraryCatalogQueryIdentity(query)
    const matches = this.#items
      .filter((item) => item.catalogStatus === "active")
      .filter((item) => matchesCatalogQuery(item, query))
      .sort(comparatorFor(query.order))
    const offset = query.cursor
      ? this.#decodeCursor(query.cursor, query, queryIdentity, matches.length)
      : 0
    const items = matches.slice(offset, offset + query.limit)
    const nextOffset = offset + items.length
    const page = libraryCatalogPageSchema.parse({
      schemaVersion: 1,
      catalogRevision: this.#catalogRevision,
      generation: query.generation,
      queryIdentity,
      items,
      nextCursor:
        nextOffset < matches.length
          ? encodeCursor({
              version: 1,
              catalogRevision: this.#catalogRevision,
              generation: query.generation,
              queryIdentity,
              offset: nextOffset,
            })
          : null,
      total: matches.length,
    })
    return immutable(page)
  }

  #decodeCursor(
    cursor: string,
    query: LibraryCatalogQuery,
    queryIdentity: string,
    maximumOffset: number
  ) {
    let payload: z.infer<typeof cursorPayloadSchema>
    try {
      payload = cursorPayloadSchema.parse(
        JSON.parse(decodeBase64Url(cursor)) as unknown
      )
    } catch {
      throw new LibraryCatalogCursorError("malformed")
    }
    if (payload.catalogRevision !== this.#catalogRevision) {
      throw new LibraryCatalogCursorError("catalog_revision_mismatch")
    }
    if (payload.generation !== query.generation) {
      throw new LibraryCatalogCursorError("generation_mismatch")
    }
    if (payload.queryIdentity !== queryIdentity) {
      throw new LibraryCatalogCursorError("query_mismatch")
    }
    if (payload.offset > maximumOffset) {
      throw new LibraryCatalogCursorError("offset_out_of_range")
    }
    return payload.offset
  }
}

function validateCommonSummary(
  summary: z.infer<typeof rawLibraryCatalogItemSummarySchema>,
  context: z.RefinementCtx
) {
  if (
    summary.preview.itemId !== summary.id ||
    summary.preview.itemVersion !== summary.version
  ) {
    context.addIssue({
      code: "custom",
      path: ["preview"],
      message: "Preview identity must match the catalog item exactly",
    })
  }
  if (summary.updatedAt < summary.createdAt) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "Catalog item update time cannot precede creation",
    })
  }
  if (summary.preferences?.favorite && !summary.permissions.canFavorite) {
    context.addIssue({
      code: "custom",
      path: ["preferences", "favorite"],
      message: "Favorite projection requires favorite permission",
    })
  }
  if (
    summary.preferences?.collectionIds.length &&
    !summary.permissions.canAddToCollection
  ) {
    context.addIssue({
      code: "custom",
      path: ["preferences", "collectionIds"],
      message: "Collection projection requires collection permission",
    })
  }
}

function orientationForDimensions(
  dimensions: readonly { width: number; height: number }[]
) {
  const orientations = new Set(
    dimensions.map(({ width, height }) =>
      width === height ? "square" : width > height ? "landscape" : "portrait"
    )
  )
  return orientations.size === 1
    ? ([...orientations][0] as "portrait" | "landscape" | "square")
    : ("mixed" as const)
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function itemIdentity(item: LibraryCatalogItemSummary) {
  return `${item.itemKind}:${item.id}@${item.version}`
}

function matchesCatalogQuery(
  item: LibraryCatalogItemSummary,
  query: LibraryCatalogQuery
) {
  if (!query.itemKinds.includes(item.itemKind)) return false
  if (
    query.categoryIds.length &&
    !query.categoryIds.includes(item.categoryId)
  ) {
    return false
  }
  if (
    query.useCaseIds.length &&
    !query.useCaseIds.some((useCase) => item.useCaseIds.includes(useCase))
  ) {
    return false
  }
  if (
    query.formatFamilies.length &&
    !query.formatFamilies.includes(item.formatFamily)
  ) {
    return false
  }
  if (
    query.orientations.length &&
    !query.orientations.includes(item.orientation)
  ) {
    return false
  }
  if (query.ownerKinds.length && !query.ownerKinds.includes(item.owner.kind)) {
    return false
  }
  if (query.favoritesOnly && !item.preferences?.favorite) return false
  if (query.recentOnly && !item.preferences?.lastUsedAt) return false
  if (
    query.collectionId &&
    !item.preferences?.collectionIds.includes(query.collectionId)
  ) {
    return false
  }
  if (!query.search) return true
  const haystack = normalizeSearch(
    [
      item.name,
      item.description,
      item.categoryId,
      ...item.useCaseIds,
      item.formatFamily,
      ...item.tags,
    ].join(" ")
  )
  return query.search.split(" ").every((term) => haystack.includes(term))
}

function comparatorFor(order: LibraryCatalogQuery["order"]) {
  return (
    left: LibraryCatalogItemSummary,
    right: LibraryCatalogItemSummary
  ) => {
    if (order === "recent") {
      const leftRecent = left.preferences?.lastUsedAt ?? ""
      const rightRecent = right.preferences?.lastUsedAt ?? ""
      const recent = compareText(rightRecent, leftRecent)
      if (recent) return recent
    }
    if (order === "newest") {
      const newest = compareText(right.createdAt, left.createdAt)
      if (newest) return newest
    }
    if (order === "curated" || order === "recent") {
      const leftRank = left.curatedRank ?? Number.MAX_SAFE_INTEGER
      const rightRank = right.curatedRank ?? Number.MAX_SAFE_INTEGER
      if (leftRank !== rightRank) return leftRank - rightRank
    }
    return (
      compareText(left.name.toLowerCase(), right.name.toLowerCase()) ||
      compareText(left.id, right.id) ||
      right.version - left.version ||
      compareText(left.itemKind, right.itemKind)
    )
  }
}

export function libraryCatalogQueryIdentity(
  input: LibraryCatalogQueryInput
): string {
  const query = libraryCatalogQuerySchema.parse(input)
  const identity = JSON.stringify({
    search: query.search,
    itemKinds: query.itemKinds,
    categoryIds: query.categoryIds,
    useCaseIds: query.useCaseIds,
    formatFamilies: query.formatFamilies,
    orientations: query.orientations,
    ownerKinds: query.ownerKinds,
    favoritesOnly: query.favoritesOnly,
    recentOnly: query.recentOnly,
    collectionId: query.collectionId,
    order: query.order,
    limit: query.limit,
  })
  const bytes = new TextEncoder().encode(identity)
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `libq_${hash.toString(16).padStart(16, "0")}`
}

function encodeCursor(payload: z.infer<typeof cursorPayloadSchema>) {
  return encodeBase64Url(JSON.stringify(cursorPayloadSchema.parse(payload)))
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function decodeBase64Url(value: string) {
  if (!base64UrlPattern.test(value)) throw new Error("Invalid base64url")
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  )
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

function immutable<Value>(value: Value): Value {
  const seen = new WeakSet<object>()
  const freeze = (current: unknown) => {
    if (!current || typeof current !== "object" || seen.has(current)) return
    seen.add(current)
    for (const child of Object.values(current)) freeze(child)
    Object.freeze(current)
  }
  freeze(value)
  return value
}
