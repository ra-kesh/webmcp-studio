import { defaultImagePlacement } from "@webmcp/document"
import type { SceneNode } from "@webmcp/document"
import { previewImageCropDraft } from "@webmcp/editor/image-crop-session"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"
import { describe, expect, it } from "vitest"

import { projectImageCropInspectorSelection } from "./inspector-sidebar"

const image = {
  id: "inspector-crop-image",
  type: "image",
  name: "Inspector crop image",
  x: 20,
  y: 30,
  width: 320,
  height: 180,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  constraints: { horizontal: "min", vertical: "min" },
  assetId: "inspector-crop-asset",
  src: "https://example.com/inspector-crop.jpg",
  placement: defaultImagePlacement(),
  frameMask: { shape: "rectangle" },
  alt: "Inspector crop fixture",
  decorative: false,
} satisfies Extract<SceneNode, { type: "image" }>

function createSession(): ImageCropSession {
  return {
    target: {
      documentId: "inspector-document",
      pageId: "inspector-page",
      nodeId: image.id,
      assetId: image.assetId,
      src: image.src,
    },
    baseline: image.placement,
    draft: image.placement,
    baselineFrame: image,
    draftFrame: image,
    baselineFrameMask: image.frameMask,
    draftFrameMask: image.frameMask,
    draftRevision: 0,
  }
}

describe("crop preview inspector projection", () => {
  it("shows the live placement, frame, and mask without changing canonical selection", () => {
    const selectedNodes: SceneNode[] = [image]
    const draft = previewImageCropDraft(createSession(), {
      placement: {
        ...image.placement,
        mode: "manual",
        focalX: 0.72,
        zoom: 1.4,
      },
      frame: { x: 44, y: 55, width: 280, height: 160, rotation: 12 },
      frameMask: { shape: "ellipse" },
    })

    const projected = projectImageCropInspectorSelection(selectedNodes, draft)

    expect(projected).not.toBe(selectedNodes)
    expect(projected[0]).toMatchObject({
      id: image.id,
      x: 44,
      y: 55,
      width: 280,
      height: 160,
      rotation: 12,
      placement: { mode: "manual", focalX: 0.72, zoom: 1.4 },
      frameMask: { shape: "ellipse" },
    })
    expect(selectedNodes[0]).toBe(image)
    expect(image).toMatchObject({
      x: 20,
      y: 30,
      width: 320,
      height: 180,
      frameMask: { shape: "rectangle" },
    })
  })
})
