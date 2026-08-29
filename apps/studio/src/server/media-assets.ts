import { Buffer } from "node:buffer"
import {
  MEDIA_ASSET_MAX_BYTES,
  MEDIA_ASSET_MAX_DIMENSION,
  MEDIA_ASSET_MAX_PIXEL_AREA,
  MEDIA_ASSET_TYPES,
  inspectRasterBytes,
  managedAssetIdFromSource,
  managedAssetSource,
  MANAGED_ASSET_PREFIX,
  mediaAssetIdSchema,
  RasterInspectionError,
  renderPolicyLimits,
} from "@webmcp/document"
import type {
  MediaAssetDeletionImpact,
  MediaAssetReferenceImpact,
  PublicMediaAsset,
} from "@webmcp/document"

export { managedAssetIdFromSource, managedAssetSource, MANAGED_ASSET_PREFIX }
export type {
  MediaAssetDeletionImpact,
  MediaAssetReferenceImpact,
  PublicMediaAsset,
}

export const MAX_MEDIA_ASSET_BYTES = MEDIA_ASSET_MAX_BYTES
export const MAX_MEDIA_ASSET_DIMENSION = MEDIA_ASSET_MAX_DIMENSION
export const MAX_MEDIA_ASSET_PIXEL_AREA = MEDIA_ASSET_MAX_PIXEL_AREA
export const MAX_MEDIA_ASSET_NAME_LENGTH = 255
export const MAX_MEDIA_LIST_LIMIT = 100

export const supportedMediaAssetTypes = MEDIA_ASSET_TYPES

export type SupportedMediaAssetType = (typeof supportedMediaAssetTypes)[number]
export type MediaAssetStatus = "ready" | "archived"

export type MediaAssetReferenceKind = "current_document" | "published_version"

export type MediaAssetReference = {
  assetId: string
  referenceKind: MediaAssetReferenceKind
  sourceId: string
  referenceKey: string
  documentId: string
  pageId: string | null
  nodeId: string | null
  fieldId: string | null
  property: string | null
}

export type ValidatedMediaUpload = {
  name: string
  mediaType: SupportedMediaAssetType
  bytes: Uint8Array
  byteLength: number
  width: number
  height: number
  contentHash: string
  requestHash: string
}

/**
 * Private, renderer-only resource produced after the stored bytes have been
 * checked against the authoritative managed-asset row. This shape must never
 * be serialized by the public asset metadata endpoints because `src` contains
 * the network-isolated renderer data URI.
 */
export type VerifiedManagedAssetResource = {
  assetId: string
  src: string
  width: number
  height: number
  contentHash: string
  revision: number
}

export class MediaAssetError extends Error {
  readonly code:
    | "asset_not_found"
    | "asset_content_missing"
    | "asset_dimension_mismatch"
    | "asset_archived"
    | "asset_referenced"
    | "asset_revision_mismatch"
    | "asset_impact_stale"
    | "asset_not_renderable"
    | "idempotency_key_reused"
    | "invalid_asset_id"
    | "invalid_asset_name"
    | "invalid_collection"
    | "invalid_cursor"
    | "invalid_idempotency_key"
    | "invalid_image"
    | "invalid_image_dimensions"
    | "invalid_multipart_request"
    | "media_type_mismatch"
    | "missing_content_length"
    | "unsupported_media_type"
    | "upload_too_large"
  readonly status: 400 | 404 | 409 | 411 | 412 | 413 | 415 | 422

  constructor(
    code: MediaAssetError["code"],
    status: MediaAssetError["status"],
    message: string
  ) {
    super(message)
    this.name = "MediaAssetError"
    this.code = code
    this.status = status
  }
}

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{1,128}$/

export function assertMediaAssetId(value: string): string {
  if (!mediaAssetIdSchema.safeParse(value).success) {
    throw new MediaAssetError("invalid_asset_id", 400, "Asset ID is malformed")
  }
  return value
}

export function assertMediaIdempotencyKey(value: string | null): string | null {
  const normalized = value?.trim() || null
  if (normalized && !idempotencyKeyPattern.test(normalized)) {
    throw new MediaAssetError(
      "invalid_idempotency_key",
      400,
      "Idempotency-Key must contain 1-128 letters, numbers, dots, colons, underscores, or hyphens"
    )
  }
  return normalized
}

export function normalizeMediaAssetName(value: string): string {
  const normalized = value.trim()
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  if (
    !normalized ||
    normalized.length > MAX_MEDIA_ASSET_NAME_LENGTH ||
    hasControlCharacter
  ) {
    throw new MediaAssetError(
      "invalid_asset_name",
      400,
      `Asset names must contain 1-${MAX_MEDIA_ASSET_NAME_LENGTH} visible characters`
    )
  }
  return normalized
}

export async function sha256Hex(value: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export function inspectMediaAssetDimensions(
  mediaType: SupportedMediaAssetType,
  bytes: Uint8Array
): { width: number; height: number } {
  try {
    return inspectRasterBytes(mediaType, bytes)
  } catch (error) {
    if (
      error instanceof RasterInspectionError &&
      error.code === "raster_dimensions_exceeded"
    ) {
      throw new MediaAssetError("invalid_image_dimensions", 422, error.message)
    }
    throw new MediaAssetError(
      "media_type_mismatch",
      415,
      `The file bytes do not match ${mediaType}`
    )
  }
}

export async function validateMediaUpload(
  file: Blob & { name?: string },
  suppliedName?: string
): Promise<ValidatedMediaUpload> {
  if (file.size < 1) {
    throw new MediaAssetError("invalid_image", 422, "Image file is empty")
  }
  if (file.size > MAX_MEDIA_ASSET_BYTES) {
    throw new MediaAssetError(
      "upload_too_large",
      413,
      `Images must be ${MAX_MEDIA_ASSET_BYTES.toLocaleString()} bytes or smaller`
    )
  }
  if (
    !supportedMediaAssetTypes.includes(file.type as SupportedMediaAssetType)
  ) {
    throw new MediaAssetError(
      "unsupported_media_type",
      415,
      "Only PNG, JPEG, and WebP images are supported"
    )
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mediaType = file.type as SupportedMediaAssetType
  const dimensions = inspectMediaAssetDimensions(mediaType, bytes)
  const name = normalizeMediaAssetName(suppliedName ?? file.name ?? "Upload")
  const contentHash = await sha256Hex(bytes)
  // The initial authoritative repository keeps the validated original as its
  // rendition. Reject inputs that cannot fit the existing network-isolated
  // renderer contract; a future image pipeline may add a derived rendition
  // without changing the public asset identity.
  mediaAssetDataUri(mediaType, bytes)
  const requestHash = await sha256Hex(
    new TextEncoder().encode(`${name}\0${mediaType}\0${contentHash}`)
  )
  return {
    name,
    mediaType,
    bytes,
    byteLength: bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    contentHash,
    requestHash,
  }
}

export function mediaAssetDataUri(
  mediaType: SupportedMediaAssetType,
  bytes: Uint8Array
): string {
  const source = `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`
  if (source.length > renderPolicyLimits.maxInlineImageCharacters) {
    throw new MediaAssetError(
      "asset_not_renderable",
      422,
      "The original image is too large for the network-isolated renderer"
    )
  }
  return source
}

export function createOpaqueMediaAssetId(): string {
  return `asset-${crypto.randomUUID().replaceAll("-", "")}`
}
