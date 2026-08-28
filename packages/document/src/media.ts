import { z } from "zod"

export const MANAGED_ASSET_PREFIX = "asset:managed/"

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

export const managedAssetSourceSchema = z
  .string()
  .regex(/^asset:managed\/asset-[A-Za-z0-9_-]{10,90}$/)

export const managedAssetSource = (assetId: string) =>
  `${MANAGED_ASSET_PREFIX}${mediaAssetIdSchema.parse(assetId)}` as const

export const managedAssetIdFromSource = (source: string) => {
  const parsed = managedAssetSourceSchema.safeParse(source)
  return parsed.success ? parsed.data.slice(MANAGED_ASSET_PREFIX.length) : null
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
export type MediaAssetLookup = z.infer<typeof mediaAssetLookupSchema>
export type MediaAssetReferenceImpact = z.infer<
  typeof mediaAssetReferenceImpactSchema
>
export type MediaAssetDeletionImpact = z.infer<
  typeof mediaAssetDeletionImpactSchema
>
