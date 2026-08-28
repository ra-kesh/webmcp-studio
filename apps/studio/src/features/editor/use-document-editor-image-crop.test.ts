import { describe, expect, it } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import { startImageCropSession } from "@webmcp/editor"
import {
  IMAGE_CROP_UNAVAILABLE_MESSAGE,
  resolveUnavailableImageCrop,
} from "./image-crop-unavailable"

const image = renderConformanceDocument.nodes.find(
  (node) => node.id === "image-cover"
)
const page = renderConformanceDocument.pages.find((candidate) =>
  candidate.nodeIds.includes(image?.id ?? "")
)

if (image?.type !== "image" || !page) {
  throw new Error("Expected an image crop fixture")
}

const started = startImageCropSession(
  renderConformanceDocument,
  page.id,
  image.id
)
if (started.status !== "started") {
  throw new Error(`Crop fixture was rejected: ${started.reason}`)
}

describe("unavailable image crop handling", () => {
  it("closes only the matching crop session with a useful error", () => {
    expect(resolveUnavailableImageCrop(started.session, image.id)).toEqual({
      handled: true,
      session: null,
      error: IMAGE_CROP_UNAVAILABLE_MESSAGE,
    })
    expect(IMAGE_CROP_UNAVAILABLE_MESSAGE).toContain(
      "image could not be loaded"
    )
  })

  it("does not close a newer or unrelated crop session", () => {
    expect(
      resolveUnavailableImageCrop(started.session, "another-image")
    ).toEqual({
      handled: false,
      session: started.session,
      error: null,
    })
  })
})
