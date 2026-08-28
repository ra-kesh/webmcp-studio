import { defaultImagePlacement, projectImagePaint } from "@webmcp/document"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"
import { describe, expect, it } from "vitest"

import { projectNumericImageCropFrameEdit } from "./image-crop-frame-numeric"

const session: ImageCropSession = {
  target: {
    documentId: "document-numeric-frame",
    pageId: "page-numeric-frame",
    nodeId: "image-numeric-frame",
    assetId: "asset-numeric-frame",
    src: "https://example.com/numeric-frame.png",
  },
  baseline: defaultImagePlacement(),
  draft: defaultImagePlacement(),
  baselineFrame: {
    x: 120,
    y: 180,
    width: 400,
    height: 240,
    rotation: 12,
  },
  draftFrame: {
    x: 120,
    y: 180,
    width: 400,
    height: 240,
    rotation: 12,
  },
  baselineFrameMask: { shape: "rounded_rectangle", radius: 0.12 },
  draftFrameMask: { shape: "rounded_rectangle", radius: 0.12 },
  draftRevision: 0,
}

const naturalSize = { width: 1_600, height: 900 }

describe("numeric image crop frame edits", () => {
  it("moves and rotates the complete frame without requiring decoded dimensions", () => {
    expect(
      projectNumericImageCropFrameEdit({
        session,
        naturalSize: null,
        patch: { x: 144, y: 210, rotation: -8 },
      })
    ).toEqual({
      nodeId: session.target.nodeId,
      frame: {
        ...session.draftFrame,
        x: 144,
        y: 210,
        rotation: -8,
      },
      placement: session.draft,
      frameMask: session.draftFrameMask,
    })
  })

  it("resizes from the fixed local origin while preserving the source-to-page affine", () => {
    const before = projectImagePaint({
      frame: session.draftFrame,
      naturalSize,
      placement: session.draft,
      frameMask: session.draftFrameMask,
    }).sourceToFrame
    const preview = projectNumericImageCropFrameEdit({
      session,
      naturalSize,
      patch: { width: 320, height: 180 },
    })
    const after = projectImagePaint({
      frame: preview.frame,
      naturalSize,
      placement: preview.placement,
      frameMask: preview.frameMask,
    }).sourceToFrame

    expect(preview.frame).toMatchObject({
      x: session.draftFrame.x,
      y: session.draftFrame.y,
      width: 320,
      height: 180,
    })
    expect(after).toEqual(before)
  })

  it("refuses a resize until the exact source dimensions are ready", () => {
    expect(() =>
      projectNumericImageCropFrameEdit({
        session,
        naturalSize: null,
        patch: { width: 520 },
      })
    ).toThrow("Verified natural image dimensions")
  })
})
