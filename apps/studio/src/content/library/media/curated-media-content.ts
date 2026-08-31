import { inspectRasterBytes } from "@webmcp/document"
import type { StudioMediaManifestItem } from "./manifest"
import { studioMediaManifest } from "./manifest"

const CONTENT_ROUTE_PREFIX = "/v1/studio/library/media"
const sha256Pattern = /^[a-f0-9]{64}$/

const legacyCompatibilityDefinitions = [
  {
    id: "olive-botanical",
    contentSha256:
      "85cc8f05bda0255e74a2057f4d27c948eafaa4156bee4bab83f4e725bb056f24",
    bytes: 961,
    width: 1200,
    height: 1500,
  },
  {
    id: "sandstone-arches",
    contentSha256:
      "9d439ee5bbcef006feb158ec818d9f3c69cf4206e8d2d166c29deb9c7c439571",
    bytes: 594,
    width: 1600,
    height: 1200,
  },
  {
    id: "linen-paper",
    contentSha256:
      "af55dfd6f6ed63652ebf6107bb66ec21de4aa0e00b5b52001ac9c017454a594c",
    bytes: 627,
    width: 1400,
    height: 1400,
  },
  {
    id: "dusk-blocks",
    contentSha256:
      "f06daf3c63c4bc03ec13680269d20c068d51f21f8ee838720cb19197cc0c803d",
    bytes: 528,
    width: 1600,
    height: 1000,
  },
  {
    id: "floral-linework",
    contentSha256:
      "c172e192873d1d354685e49c9fb4bef9bf3c4668026255bf76b053ea8d90988a",
    bytes: 680,
    width: 1200,
    height: 1500,
  },
  {
    id: "warm-grain",
    contentSha256:
      "b85dca42ce5c01c6b5d419c127afd5420b313b0e91785eb12ee2bc9984ed3db4",
    bytes: 627,
    width: 1600,
    height: 1200,
  },
] as const

/**
 * Published templates created before the curated manifest gained immutable
 * v2 files still name these exact v1 bytes. They remain approved content
 * identities, but are intentionally excluded from the active catalog.
 */
export const legacyCuratedMediaCompatibilityItems = Object.freeze(
  legacyCompatibilityDefinitions.map((definition) => {
    const active = studioMediaManifest.find(
      (candidate) => candidate.id === definition.id
    )
    if (!active) {
      throw new Error(`Missing active curated media ${definition.id}`)
    }
    return {
      ...active,
      version: 1,
      contentSha256: definition.contentSha256,
      resourcePath: `/library/media/${definition.id}/v1/${definition.contentSha256}.svg`,
      bytes: definition.bytes,
      width: definition.width,
      height: definition.height,
      mimeType: "image/svg+xml",
      formatFamily: "vector",
      provenance: {
        ...active.provenance,
        contentSha256: definition.contentSha256,
      },
    } satisfies StudioMediaManifestItem
  })
)

const approvedCuratedMediaItems = [
  ...studioMediaManifest,
  ...legacyCuratedMediaCompatibilityItems,
]

export type CuratedMediaIdentity = Readonly<{
  assetId: string
  version: number
  contentSha256: string
}>

export type VerifiedCuratedMediaContent = Readonly<{
  identity: CuratedMediaIdentity
  item: StudioMediaManifestItem
  canonicalSource: string
  bytes: Uint8Array
  src: string
}>

export type CuratedMediaResourceFetcher = (
  resourcePath: string,
  signal?: AbortSignal
) => Promise<Response>

export class CuratedMediaContentError extends Error {
  readonly code = "curated_media_content_invalid"

  constructor(
    readonly reason:
      | "identity_invalid"
      | "resource_unavailable"
      | "resource_path_mismatch"
      | "mime_type_mismatch"
      | "byte_length_mismatch"
      | "content_hash_mismatch"
      | "dimensions_mismatch",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "CuratedMediaContentError"
  }
}

const manifestByIdentity = new Map(
  approvedCuratedMediaItems.map(
    (item) => [`${item.id}\0${item.version}`, item] as const
  )
)
const manifestByResourcePath = new Map(
  approvedCuratedMediaItems.map((item) => [item.resourcePath, item] as const)
)

export function curatedMediaManifestItem(
  assetId: string,
  version: number
): StudioMediaManifestItem {
  const item = manifestByIdentity.get(`${assetId}\0${version}`)
  if (!item) {
    throw new CuratedMediaContentError(
      "identity_invalid",
      `Unknown curated media identity ${assetId}@${version}`
    )
  }
  return item
}

export function curatedMediaManifestItemForValue(
  value: unknown
): StudioMediaManifestItem | undefined {
  if (typeof value !== "string") return undefined
  return (
    manifestByResourcePath.get(value) ??
    studioMediaManifest.find((item) => item.id === value)
  )
}

export function curatedMediaContentPath(assetId: string, version: number) {
  const item = curatedMediaManifestItem(assetId, version)
  return `${CONTENT_ROUTE_PREFIX}/${encodeURIComponent(item.id)}/versions/${item.version}/content`
}

const exactMimeType = (response: Response) =>
  response.headers.get("Content-Type")?.split(";", 1)[0]?.trim() ?? null

const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

const svgDimensions = (bytes: Uint8Array) => {
  let source: string
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new CuratedMediaContentError(
      "dimensions_mismatch",
      "Curated SVG bytes are not valid UTF-8",
      { cause: error }
    )
  }
  const root = source.match(/<svg\b[^>]*>/i)?.[0]
  const viewBox = root?.match(
    /\bviewBox\s*=\s*["']\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s*["']/i
  )
  if (!viewBox) {
    throw new CuratedMediaContentError(
      "dimensions_mismatch",
      "Curated SVG has no supported zero-origin viewBox"
    )
  }
  return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
}

const jpegStartOfFrame = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const curatedJpegDimensions = (bytes: Uint8Array) => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const uint16 = (offset: number) =>
    ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const length = uint16(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (jpegStartOfFrame.has(marker)) {
      if (length < 7) return null
      return { width: uint16(offset + 5), height: uint16(offset + 3) }
    }
    offset += length
  }
  return null
}

const dimensionsFor = (item: StudioMediaManifestItem, bytes: Uint8Array) => {
  if (item.mimeType === "image/svg+xml") return svgDimensions(bytes)
  try {
    return inspectRasterBytes(item.mimeType, bytes)
  } catch (error) {
    const curatedJpeg =
      item.mimeType === "image/jpeg" ? curatedJpegDimensions(bytes) : null
    if (curatedJpeg) return curatedJpeg
    throw new CuratedMediaContentError(
      "dimensions_mismatch",
      `Curated media ${item.id}@${item.version} could not be decoded`,
      { cause: error }
    )
  }
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

const rendererSource = (item: StudioMediaManifestItem, bytes: Uint8Array) =>
  item.mimeType === "image/svg+xml"
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new TextDecoder().decode(bytes))}`
    : `data:${item.mimeType};base64,${bytesToBase64(bytes)}`

export async function resolveCuratedMediaContent(
  identity: Readonly<{ assetId: string; version: number }>,
  fetchResource: CuratedMediaResourceFetcher,
  signal?: AbortSignal
): Promise<VerifiedCuratedMediaContent> {
  signal?.throwIfAborted()
  const item = curatedMediaManifestItem(identity.assetId, identity.version)
  let response: Response
  try {
    response = await fetchResource(item.resourcePath, signal)
  } catch (error) {
    signal?.throwIfAborted()
    throw new CuratedMediaContentError(
      "resource_unavailable",
      `Curated media ${item.id}@${item.version} could not be loaded`,
      { cause: error }
    )
  }
  signal?.throwIfAborted()
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new CuratedMediaContentError(
      "resource_unavailable",
      `Curated media ${item.id}@${item.version} is unavailable`
    )
  }
  if (response.url && new URL(response.url).pathname !== item.resourcePath) {
    await response.body?.cancel().catch(() => undefined)
    throw new CuratedMediaContentError(
      "resource_path_mismatch",
      `Curated media ${item.id}@${item.version} resolved from an unexpected path`
    )
  }
  if (exactMimeType(response) !== item.mimeType) {
    await response.body?.cancel().catch(() => undefined)
    throw new CuratedMediaContentError(
      "mime_type_mismatch",
      `Curated media ${item.id}@${item.version} has an unexpected MIME type`
    )
  }
  const declaredLength = response.headers.get("Content-Length")
  if (declaredLength !== null && declaredLength !== String(item.bytes)) {
    await response.body?.cancel().catch(() => undefined)
    throw new CuratedMediaContentError(
      "byte_length_mismatch",
      `Curated media ${item.id}@${item.version} has an unexpected declared length`
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  signal?.throwIfAborted()
  if (bytes.byteLength !== item.bytes) {
    throw new CuratedMediaContentError(
      "byte_length_mismatch",
      `Curated media ${item.id}@${item.version} has an unexpected byte length`
    )
  }
  const contentSha256 = await sha256Hex(bytes)
  if (
    !sha256Pattern.test(contentSha256) ||
    contentSha256 !== item.contentSha256
  ) {
    throw new CuratedMediaContentError(
      "content_hash_mismatch",
      `Curated media ${item.id}@${item.version} failed checksum verification`
    )
  }
  const dimensions = dimensionsFor(item, bytes)
  if (dimensions.width !== item.width || dimensions.height !== item.height) {
    throw new CuratedMediaContentError(
      "dimensions_mismatch",
      `Curated media ${item.id}@${item.version} has unexpected dimensions`
    )
  }
  return {
    identity: {
      assetId: item.id,
      version: item.version,
      contentSha256: item.contentSha256,
    },
    item,
    canonicalSource: item.resourcePath,
    bytes,
    src: rendererSource(item, bytes),
  }
}

export function createCuratedMediaResourceFetcher(assets: Fetcher) {
  return (resourcePath: string, signal?: AbortSignal) =>
    assets.fetch(
      new Request(new URL(resourcePath, "https://curated-media.internal"), {
        signal,
      })
    )
}
