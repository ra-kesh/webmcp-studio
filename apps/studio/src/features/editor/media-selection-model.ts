import type { DocumentCommand, Page, SceneNode } from "@webmcp/document"

export type ReusableImageAsset = {
  assetId: string
  name: string
  description: string
  src: string
  width: number
  height: number
}

type ImageNode = Extract<SceneNode, { type: "image" }>

export function createReusableImageNode(
  page: Page,
  asset: ReusableImageAsset,
  nodeId: string
): ImageNode {
  const maxWidth = Math.min(640, page.width * 0.64)
  const maxHeight = Math.min(640, page.height * 0.64)
  const scale = Math.min(maxWidth / asset.width, maxHeight / asset.height, 1)
  const width = Math.max(1, Math.round(asset.width * scale))
  const height = Math.max(1, Math.round(asset.height * scale))
  return {
    id: nodeId,
    type: "image",
    name: asset.name,
    assetId: asset.assetId,
    src: asset.src,
    alt: asset.description,
    altProvenance: "generated",
    decorative: false,
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    x: Math.round((page.width - width) / 2),
    y: Math.round((page.height - height) / 2),
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  }
}

export function reusableImageReplacementPatch(
  node: ImageNode,
  asset: ReusableImageAsset
): Pick<ImageNode, "assetId" | "src"> &
  Partial<Pick<ImageNode, "alt" | "altProvenance">> {
  const shouldRefreshDefaultAlt =
    !node.decorative &&
    (node.altProvenance === "generated" || node.alt.trim() === "")
  return {
    assetId: asset.assetId,
    src: asset.src,
    ...(shouldRefreshDefaultAlt
      ? { alt: asset.description, altProvenance: "generated" as const }
      : {}),
  }
}

export function reusableImageReplacementCommand(
  node: ImageNode,
  asset: ReusableImageAsset
): Omit<
  Extract<DocumentCommand, { type: "replace_image_source" }>,
  "id" | "actor" | "at"
> {
  return {
    type: "replace_image_source",
    nodeId: node.id,
    ...reusableImageReplacementPatch(node, asset),
  }
}
