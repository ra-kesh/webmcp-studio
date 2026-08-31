import { z } from "zod"
import type { Document } from "./schema"

export const MANAGED_ASSET_PREFIX = "asset:managed/"
export const LOCAL_ASSET_PREFIX = "asset:local/"
export const CURATED_ASSET_PATH_PREFIX = "/library/media/"

/**
 * Authoritative upload bounds shared by browser admission and the Worker.
 * The Worker still validates decoded bytes and dimensions independently.
 */
export const MEDIA_ASSET_MAX_BYTES = 25_000_000
export const MEDIA_ASSET_MAX_DIMENSION = 16_384
export const MEDIA_ASSET_MAX_PIXEL_AREA = 100_000_000
export const MEDIA_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

export const mediaAssetIdSchema = z
  .string()
  .regex(/^asset-[A-Za-z0-9_-]{10,90}$/)

export const mediaIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)

export const mediaRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)

export const localAssetIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)

export const localAssetSourceSchema = z
  .string()
  .regex(/^asset:local\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)

export const managedAssetSourceSchema = z
  .string()
  .regex(/^asset:managed\/asset-[A-Za-z0-9_-]{10,90}$/)

export const curatedAssetSourceSchema = z
  .string()
  .regex(
    /^\/library\/media\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})\/v([1-9][0-9]*)\/([a-f0-9]{64})\.(?:svg|jpg|png|webp)$/
  )

export const managedAssetSource = (assetId: string) =>
  `${MANAGED_ASSET_PREFIX}${mediaAssetIdSchema.parse(assetId)}` as const

export const localAssetSource = (assetId: string) =>
  `${LOCAL_ASSET_PREFIX}${localAssetIdSchema.parse(assetId)}` as const

export const localAssetIdFromSource = (source: string) => {
  const parsed = localAssetSourceSchema.safeParse(source)
  return parsed.success ? parsed.data.slice(LOCAL_ASSET_PREFIX.length) : null
}

export const managedAssetIdFromSource = (source: string) => {
  const parsed = managedAssetSourceSchema.safeParse(source)
  return parsed.success ? parsed.data.slice(MANAGED_ASSET_PREFIX.length) : null
}

export const curatedAssetIdentityFromSource = (source: string) => {
  const parsed = curatedAssetSourceSchema.safeParse(source)
  if (!parsed.success) return null
  const match = parsed.data.match(
    /^\/library\/media\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})\/v([1-9][0-9]*)\/([a-f0-9]{64})\./
  )
  if (!match) return null
  return {
    assetId: match[1]!,
    version: Number(match[2]),
    contentSha256: match[3]!,
  }
}

/**
 * A managed image has one identity. `src` is the canonical persisted source,
 * and `assetId` must name that same workspace asset so inspection, reference
 * accounting, and render materialization cannot disagree.
 */
export const managedImageAssetIdentity = (assetId: string, source: string) => {
  const sourceAssetId = managedAssetIdFromSource(source)
  if (!sourceAssetId)
    return { managed: false as const, coherent: true as const }
  return {
    managed: true as const,
    coherent: assetId === sourceAssetId,
    assetId: sourceAssetId,
  }
}

export const localImageAssetIdentity = (assetId: string, source: string) => {
  const sourceAssetId = localAssetIdFromSource(source)
  if (!sourceAssetId) return { local: false as const, coherent: true as const }
  return {
    local: true as const,
    coherent: assetId === sourceAssetId,
    assetId: sourceAssetId,
  }
}

export const curatedImageAssetIdentity = (assetId: string, source: string) => {
  const sourceIdentity = curatedAssetIdentityFromSource(source)
  if (!sourceIdentity)
    return { curated: false as const, coherent: true as const }
  return {
    curated: true as const,
    coherent: assetId === sourceIdentity.assetId,
    ...sourceIdentity,
  }
}

export type InternalAssetReference = Readonly<{
  key: string
  source: string
  identity: "local" | "managed"
  location: "node" | "field_default" | "field_current"
  nodeId: string | null
  fieldId: string | null
  assetId: string | null
  pageIds: readonly string[]
  outputIds: readonly string[]
  projectedByBindingId: string | null
  projectedNodeIds: readonly string[]
  projectionBindingIds: readonly string[]
}>

const compareReferenceKey = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const internalAssetIdentity = (source: string) => {
  const localAssetId = localAssetIdFromSource(source)
  if (localAssetId) {
    return { identity: "local" as const, assetId: localAssetId }
  }
  const managedAssetId = managedAssetIdFromSource(source)
  return managedAssetId
    ? { identity: "managed" as const, assetId: managedAssetId }
    : null
}

/**
 * Canonical inventory for document-owned media identities. Keys are logical
 * paths rather than array positions so reordering pages, nodes, or fields does
 * not invalidate a promotion preflight.
 */
export function extractAssetReferences(
  document: Document
): InternalAssetReference[] {
  const outputIdsByPageId = new Map<string, string[]>()
  for (const output of document.outputs) {
    for (const pageId of output.pageIds) {
      const outputIds = outputIdsByPageId.get(pageId) ?? []
      outputIds.push(output.id)
      outputIdsByPageId.set(pageId, outputIds)
    }
  }
  const pageIdsByNodeId = new Map<string, string[]>()
  for (const page of document.pages) {
    for (const nodeId of page.nodeIds) {
      const pageIds = pageIdsByNodeId.get(nodeId) ?? []
      pageIds.push(page.id)
      pageIdsByNodeId.set(nodeId, pageIds)
    }
  }
  const sourceBindingByNodeId = new Map(
    document.bindings
      .filter((binding) => binding.property === "src")
      .map((binding) => [binding.nodeId, binding] as const)
  )
  const references: InternalAssetReference[] = []

  for (const node of document.nodes) {
    if (node.type !== "image") continue
    const identity = internalAssetIdentity(node.src)
    if (!identity) continue
    const pageIds = [...(pageIdsByNodeId.get(node.id) ?? [])].sort()
    const outputIds = [
      ...new Set(
        pageIds.flatMap((pageId) => outputIdsByPageId.get(pageId) ?? [])
      ),
    ].sort()
    references.push({
      key: `node/${node.id}/src`,
      source: node.src,
      identity: identity.identity,
      location: "node",
      nodeId: node.id,
      fieldId: sourceBindingByNodeId.get(node.id)?.fieldId ?? null,
      assetId: node.assetId,
      pageIds,
      outputIds,
      projectedByBindingId: sourceBindingByNodeId.get(node.id)?.id ?? null,
      projectedNodeIds: [],
      projectionBindingIds: [],
    })
  }

  for (const field of document.fields) {
    if (field.type !== "asset") continue
    const values = [
      ["default", field.defaultValue, "field_default"],
      ["current", document.fieldValues[field.id], "field_current"],
    ] as const
    for (const [slot, value, location] of values) {
      if (typeof value !== "string") continue
      const identity = internalAssetIdentity(value)
      if (!identity) continue
      const projectionBindings =
        slot === "current"
          ? document.bindings.filter(
              (binding) =>
                binding.fieldId === field.id && binding.property === "src"
            )
          : []
      const projectedNodeIds = projectionBindings
        .map((binding) => binding.nodeId)
        .sort(compareReferenceKey)
      const pageIds = [
        ...new Set(
          projectedNodeIds.flatMap(
            (nodeId) => pageIdsByNodeId.get(nodeId) ?? []
          )
        ),
      ].sort(compareReferenceKey)
      const outputIds = [
        ...new Set(
          pageIds.flatMap((pageId) => outputIdsByPageId.get(pageId) ?? [])
        ),
      ].sort(compareReferenceKey)
      references.push({
        key: `field/${field.id}/${slot}`,
        source: value,
        identity: identity.identity,
        location,
        nodeId: null,
        fieldId: field.id,
        assetId: null,
        pageIds,
        outputIds,
        projectedByBindingId: null,
        projectedNodeIds,
        projectionBindingIds: projectionBindings
          .map((binding) => binding.id)
          .sort(compareReferenceKey),
      })
    }
  }

  return references.sort((left, right) =>
    compareReferenceKey(left.key, right.key)
  )
}

export function assetReferenceKeysForSource(
  document: Document,
  source: string
): string[] {
  return extractAssetReferences(document)
    .filter((reference) => reference.source === source)
    .map((reference) => reference.key)
}

export const publicMediaAssetSchema = z
  .object({
    id: mediaAssetIdSchema,
    name: z.string().min(1).max(255),
    mediaType: z.enum(MEDIA_ASSET_TYPES),
    bytes: z.number().int().positive().max(MEDIA_ASSET_MAX_BYTES),
    width: z.number().int().positive().max(MEDIA_ASSET_MAX_DIMENSION),
    height: z.number().int().positive().max(MEDIA_ASSET_MAX_DIMENSION),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime(),
    status: z.literal("ready"),
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.width * asset.height > MEDIA_ASSET_MAX_PIXEL_AREA) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: `Image area must not exceed ${MEDIA_ASSET_MAX_PIXEL_AREA} pixels`,
      })
    }
  })

export const mediaAssetListResponseSchema = z
  .object({
    assets: z.array(publicMediaAssetSchema),
    nextCursor: z.string().min(1).nullable(),
    storage: z
      .object({
        bytes: z.number().int().nonnegative(),
        count: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const mediaAssetUploadResponseSchema = z
  .object({ asset: publicMediaAssetSchema })
  .strict()

export const mediaAssetUseReceiptSchema = z
  .object({
    assetId: mediaAssetIdSchema,
    usedAt: z.iso.datetime(),
    assetRevision: z.number().int().positive(),
  })
  .strict()

export const mediaAssetUseResponseSchema = z
  .object({ receipt: mediaAssetUseReceiptSchema })
  .strict()

export const mediaAssetLookupSchema = z
  .object({
    id: mediaAssetIdSchema,
    name: z.string().min(1).max(255),
    mediaType: z.enum(MEDIA_ASSET_TYPES),
    bytes: z.number().int().positive().max(MEDIA_ASSET_MAX_BYTES),
    width: z.number().int().positive().max(MEDIA_ASSET_MAX_DIMENSION),
    height: z.number().int().positive().max(MEDIA_ASSET_MAX_DIMENSION),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime(),
    status: z.enum(["ready", "archived"]),
    selectable: z.boolean(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.width * asset.height > MEDIA_ASSET_MAX_PIXEL_AREA) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: `Image area must not exceed ${MEDIA_ASSET_MAX_PIXEL_AREA} pixels`,
      })
    }
    if (asset.selectable !== (asset.status === "ready")) {
      context.addIssue({
        code: "custom",
        path: ["selectable"],
        message: "Only ready assets may be selected",
      })
    }
  })

export const mediaAssetPromotionAssetSchema = mediaAssetLookupSchema.extend({
  revision: z.number().int().positive(),
})

export const localAssetPromotionSchema = z
  .object({
    localAssetId: localAssetIdSchema,
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    asset: mediaAssetPromotionAssetSchema,
  })
  .strict()

export const localAssetPromotionResponseSchema = z
  .object({
    promotion: localAssetPromotionSchema,
    storageDeltaBytes: z.number().int().nonnegative(),
  })
  .strict()

export const localAssetPromotionLookupResponseSchema = z
  .object({ promotion: localAssetPromotionSchema })
  .strict()

export const localAssetPromotionResolveRequestSchema = z
  .object({
    localAssetIds: z
      .array(localAssetIdSchema)
      .min(1)
      .max(100)
      .superRefine((ids, context) => {
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: "custom",
            path: ["localAssetIds"],
            message: "Local asset IDs must be distinct",
          })
        }
      }),
  })
  .strict()

export const localAssetPromotionResolutionSchema = z
  .object({
    localAssetId: localAssetIdSchema,
    promotion: localAssetPromotionSchema.nullable(),
  })
  .strict()
  .superRefine((resolution, context) => {
    if (
      resolution.promotion &&
      resolution.promotion.localAssetId !== resolution.localAssetId
    ) {
      context.addIssue({
        code: "custom",
        path: ["promotion", "localAssetId"],
        message: "Promotion identity must match the requested local asset",
      })
    }
  })

export const localAssetPromotionResolveResponseSchema = z
  .object({ results: z.array(localAssetPromotionResolutionSchema).max(100) })
  .strict()

export const mediaAssetLookupResponseSchema = z
  .object({ asset: mediaAssetLookupSchema })
  .strict()

export const mediaAssetReferenceImpactSchema = z
  .object({
    referenceKind: z.enum(["current_document", "published_version"]),
    sourceId: z.string().min(1),
    documentId: z.string().min(1),
    pageId: z.string().min(1).nullable(),
    nodeId: z.string().min(1).nullable(),
    fieldId: z.string().min(1).nullable(),
    property: z.string().min(1).nullable(),
  })
  .strict()

export const mediaAssetDeletionImpactSchema = z
  .object({
    assetId: mediaAssetIdSchema,
    revision: z.number().int().positive(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    canArchive: z.boolean(),
    currentReferences: z.number().int().nonnegative(),
    publishedReferences: z.number().int().nonnegative(),
    references: z.array(mediaAssetReferenceImpactSchema),
  })
  .strict()

export const mediaAssetDeletionImpactResponseSchema = z
  .object({ impact: mediaAssetDeletionImpactSchema })
  .strict()

export const mediaAssetArchiveResponseSchema = z
  .object({
    assetId: mediaAssetIdSchema,
    status: z.literal("archived"),
    revision: z.number().int().positive(),
  })
  .strict()

export type PublicMediaAsset = z.infer<typeof publicMediaAssetSchema>
export type MediaAssetUseReceipt = z.infer<typeof mediaAssetUseReceiptSchema>
export type MediaAssetLookup = z.infer<typeof mediaAssetLookupSchema>
export type MediaAssetPromotionAsset = z.infer<
  typeof mediaAssetPromotionAssetSchema
>
export type LocalAssetPromotion = z.infer<typeof localAssetPromotionSchema>
export type LocalAssetPromotionResolution = z.infer<
  typeof localAssetPromotionResolutionSchema
>
export type MediaAssetReferenceImpact = z.infer<
  typeof mediaAssetReferenceImpactSchema
>
export type MediaAssetDeletionImpact = z.infer<
  typeof mediaAssetDeletionImpactSchema
>
