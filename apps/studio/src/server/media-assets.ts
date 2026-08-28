import { Buffer } from "node:buffer"
import {
  MEDIA_ASSET_MAX_BYTES,
  MEDIA_ASSET_MAX_DIMENSION,
  MEDIA_ASSET_MAX_PIXEL_AREA,
  MEDIA_ASSET_TYPES,
  managedAssetIdFromSource,
  managedAssetSource,
  MANAGED_ASSET_PREFIX,
  mediaAssetIdSchema,
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

const uint24le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16)

const uint16be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)

const uint16le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)

const uint32le = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true
  )

const uint32be = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    false
  )

function inspectPng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (
    bytes.length < 45 ||
    signature.some((value, index) => bytes[index] !== value) ||
    uint32be(bytes, 8) !== 13 ||
    new TextDecoder().decode(bytes.slice(12, 16)) !== "IHDR"
  ) {
    return null
  }
  let offset = 8
  let sawEnd = false
  let sawData = false
  while (offset + 12 <= bytes.length) {
    const length = uint32be(bytes, offset)
    const end = offset + 12 + length
    if (end > bytes.length) return null
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8))
    if (type === "IDAT") sawData = true
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) return null
      sawEnd = true
      break
    }
    offset = end
  }
  if (!sawData || !sawEnd) return null
  return { width: uint32be(bytes, 16), height: uint32be(bytes, 20) }
}

const jpegStartOfFrame = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function inspectJpeg(bytes: Uint8Array) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return null
  }
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null
    const length = uint16be(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (jpegStartOfFrame.has(marker)) {
      if (length < 7) return null
      return {
        width: uint16be(bytes, offset + 5),
        height: uint16be(bytes, offset + 3),
      }
    }
    offset += length
  }
  return null
}

function inspectWebp(bytes: Uint8Array) {
  if (
    bytes.length < 30 ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" ||
    new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP" ||
    uint32le(bytes, 4) + 8 !== bytes.length
  ) {
    return null
  }
  const chunk = new TextDecoder().decode(bytes.slice(12, 16))
  if (chunk === "VP8X") {
    return {
      width: uint24le(bytes, 24) + 1,
      height: uint24le(bytes, 27) + 1,
    }
  }
  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: uint16le(bytes, 26) & 0x3fff,
      height: uint16le(bytes, 28) & 0x3fff,
    }
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }
  return null
}

function assertDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_MEDIA_ASSET_DIMENSION ||
    height > MAX_MEDIA_ASSET_DIMENSION ||
    width * height > MAX_MEDIA_ASSET_PIXEL_AREA
  ) {
    throw new MediaAssetError(
      "invalid_image_dimensions",
      422,
      `Images must be at most ${MAX_MEDIA_ASSET_DIMENSION} px on each side and ${MAX_MEDIA_ASSET_PIXEL_AREA.toLocaleString()} total pixels`
    )
  }
}

export function inspectMediaAssetDimensions(
  mediaType: SupportedMediaAssetType,
  bytes: Uint8Array
): { width: number; height: number } {
  const inspections: Record<
    SupportedMediaAssetType,
    (value: Uint8Array) => { width: number; height: number } | null
  > = {
    "image/png": inspectPng,
    "image/jpeg": inspectJpeg,
    "image/webp": inspectWebp,
  }
  const dimensions = inspections[mediaType](bytes)
  if (!dimensions) {
    throw new MediaAssetError(
      "media_type_mismatch",
      415,
      `The file bytes do not match ${mediaType}`
    )
  }
  assertDimensions(dimensions.width, dimensions.height)
  return dimensions
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
