import {
  MEDIA_ASSET_MAX_BYTES,
  MEDIA_ASSET_MAX_DIMENSION,
  MEDIA_ASSET_MAX_PIXEL_AREA,
  MEDIA_ASSET_TYPES,
} from "@webmcp/document"

export const MEDIA_UPLOAD_MAX_BYTES = MEDIA_ASSET_MAX_BYTES
export const MEDIA_UPLOAD_MAX_DIMENSION = MEDIA_ASSET_MAX_DIMENSION
export const MEDIA_UPLOAD_MAX_PIXELS = MEDIA_ASSET_MAX_PIXEL_AREA
export const MEDIA_UPLOAD_TYPES = MEDIA_ASSET_TYPES
export const MEDIA_UPLOAD_ACCEPT = MEDIA_UPLOAD_TYPES.join(",")

const EXTENSIONS_BY_TYPE: Record<
  (typeof MEDIA_UPLOAD_TYPES)[number],
  string[]
> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
}

export function validateMediaFile(file: File): string | null {
  if (file.size === 0) return `${file.name || "This file"} is empty.`
  if (!MEDIA_UPLOAD_TYPES.some((mediaType) => mediaType === file.type)) {
    return "Choose a PNG, JPEG, or WebP image."
  }
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    return "Images must be 25 MB or smaller."
  }
  const extension = file.name.split(".").at(-1)?.toLowerCase()
  const allowedExtensions =
    EXTENSIONS_BY_TYPE[file.type as (typeof MEDIA_UPLOAD_TYPES)[number]]
  if (extension && !allowedExtensions.includes(extension)) {
    return `The .${extension} extension does not match the file’s ${file.type} type.`
  }
  return null
}

export function validateMediaDimensions({
  width,
  height,
}: {
  width: number
  height: number
}): string | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return "The image has invalid dimensions."
  }
  if (
    width > MEDIA_UPLOAD_MAX_DIMENSION ||
    height > MEDIA_UPLOAD_MAX_DIMENSION
  ) {
    return `Images must be ${MEDIA_UPLOAD_MAX_DIMENSION.toLocaleString("en-US")} px or smaller on each edge.`
  }
  if (width * height > MEDIA_UPLOAD_MAX_PIXELS) {
    return "Images must contain 100 million pixels or fewer."
  }
  return null
}
