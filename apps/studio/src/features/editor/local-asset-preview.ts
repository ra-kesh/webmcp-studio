import type { Document } from "@webmcp/document"
import {
  getImageDimensions,
  localAssetIdFromSource,
  localAssetSource,
} from "./local-asset-store"
import type { LocalAssetRecord } from "./local-asset-store"
import { validateMediaDimensions } from "./media-file-policy"
import type { ReusableImageAsset } from "./media-selection-model"

const LOCAL_ASSET_UNAVAILABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#f4f4f5"/><rect x="24" y="24" width="592" height="432" rx="16" fill="none" stroke="#a1a1aa" stroke-width="8"/><path d="m112 368 112-128 80 88 72-72 152 152" fill="none" stroke="#71717a" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><circle cx="448" cy="144" r="36" fill="#d4d4d8"/><path d="m256 176 128 128m0-128L256 304" stroke="#52525b" stroke-width="18" stroke-linecap="round"/></svg>`

export const LOCAL_ASSET_UNAVAILABLE_PREVIEW_SOURCE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOCAL_ASSET_UNAVAILABLE_SVG)}`

const decodeValidatedImageDimensions = async (file: Blob) => {
  const dimensions = await getImageDimensions(file)
  const validationError = validateMediaDimensions(dimensions)
  if (validationError) throw new Error(validationError)
  return dimensions
}

export function projectLocalAssetPreviewSources(
  document: Document,
  previewUrls: ReadonlyMap<string, string>
): Document {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.type === "image") {
        const assetId = localAssetIdFromSource(node.src)
        if (!assetId) return node
        return {
          ...node,
          src:
            previewUrls.get(assetId) ?? LOCAL_ASSET_UNAVAILABLE_PREVIEW_SOURCE,
          alt: previewUrls.has(assetId)
            ? node.alt
            : `${node.alt || node.name}. File missing on this device.`,
        }
      }
      if (!("fills" in node) || !node.fills) return node
      return {
        ...node,
        fills: node.fills.map((paint) => {
          if (paint.type !== "image") return paint
          const assetId = localAssetIdFromSource(paint.src)
          if (!assetId) return paint
          return {
            ...paint,
            src:
              previewUrls.get(assetId) ??
              LOCAL_ASSET_UNAVAILABLE_PREVIEW_SOURCE,
          }
        }),
      }
    }),
  }
}

export async function reusableAssetFromLocalRecord(
  record: LocalAssetRecord,
  decodeDimensions: (blob: Blob) => Promise<{
    width: number
    height: number
  }> = decodeValidatedImageDimensions
): Promise<ReusableImageAsset> {
  const dimensions = await decodeDimensions(record.blob)
  const dimensionError = validateMediaDimensions(dimensions)
  if (dimensionError) throw new Error(dimensionError)
  return {
    assetId: record.id,
    name: record.name.replace(/\.[^.]+$/, "") || "Image",
    description: record.name,
    src: localAssetSource(record.id),
    ...dimensions,
  }
}
