import {
  MEDIA_ASSET_MAX_DIMENSION,
  MEDIA_ASSET_MAX_PIXEL_AREA,
  MEDIA_ASSET_TYPES,
} from "./media"

export type RasterMediaType = (typeof MEDIA_ASSET_TYPES)[number]
export type RasterDimensions = { width: number; height: number }
export type RasterInspectionErrorCode =
  "raster_type_mismatch" | "raster_dimensions_exceeded"

export class RasterInspectionError extends Error {
  constructor(readonly code: RasterInspectionErrorCode) {
    super(
      code === "raster_dimensions_exceeded"
        ? `Images must be at most ${MEDIA_ASSET_MAX_DIMENSION} px on each side and ${MEDIA_ASSET_MAX_PIXEL_AREA.toLocaleString()} total pixels`
        : "Image bytes do not match the declared media type"
    )
    this.name = "RasterInspectionError"
  }
}

const uint24le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16)
const uint16be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
const uint16le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
const uint32 = (bytes: Uint8Array, offset: number, littleEndian = false) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian
  )

const inspectPng = (bytes: Uint8Array): RasterDimensions | null => {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (
    bytes.length < 45 ||
    signature.some((value, index) => bytes[index] !== value) ||
    uint32(bytes, 8) !== 13 ||
    new TextDecoder().decode(bytes.slice(12, 16)) !== "IHDR"
  ) {
    return null
  }
  let offset = 8
  let sawData = false
  let sawEnd = false
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset)
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
  return { width: uint32(bytes, 16), height: uint32(bytes, 20) }
}

const jpegStartOfFrame = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const inspectJpeg = (bytes: Uint8Array): RasterDimensions | null => {
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
    if (marker === undefined) return null
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

const inspectWebp = (bytes: Uint8Array): RasterDimensions | null => {
  if (
    bytes.length < 30 ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" ||
    new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP" ||
    uint32(bytes, 4, true) + 8 !== bytes.length
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
      (bytes[21] ?? 0) |
      ((bytes[22] ?? 0) << 8) |
      ((bytes[23] ?? 0) << 16) |
      ((bytes[24] ?? 0) << 24)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }
  return null
}

export function inspectRasterBytes(
  mediaType: RasterMediaType,
  bytes: Uint8Array
): RasterDimensions {
  const inspectors: Record<
    RasterMediaType,
    (value: Uint8Array) => RasterDimensions | null
  > = {
    "image/png": inspectPng,
    "image/jpeg": inspectJpeg,
    "image/webp": inspectWebp,
  }
  const dimensions = inspectors[mediaType](bytes)
  if (!dimensions) throw new RasterInspectionError("raster_type_mismatch")
  if (
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MEDIA_ASSET_MAX_DIMENSION ||
    dimensions.height > MEDIA_ASSET_MAX_DIMENSION ||
    dimensions.width * dimensions.height > MEDIA_ASSET_MAX_PIXEL_AREA
  ) {
    throw new RasterInspectionError("raster_dimensions_exceeded")
  }
  return dimensions
}

const inlineRasterSource =
  /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/]+=*)$/i

export function inspectInlineRasterSource(
  source: string
):
  | (RasterDimensions & { mediaType: RasterMediaType; bytes: Uint8Array })
  | null {
  if (!/^data:image\/(?:png|jpeg|webp);/i.test(source)) return null
  const match = inlineRasterSource.exec(source)
  if (!match?.[1] || !match[2]) {
    throw new RasterInspectionError("raster_type_mismatch")
  }
  let bytes: Uint8Array
  try {
    const decoded = atob(match[2])
    bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  } catch {
    throw new RasterInspectionError("raster_type_mismatch")
  }
  const mediaType = match[1].toLowerCase() as RasterMediaType
  return { mediaType, bytes, ...inspectRasterBytes(mediaType, bytes) }
}
