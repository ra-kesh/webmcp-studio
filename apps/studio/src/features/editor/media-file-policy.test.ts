import { describe, expect, it } from "vitest"
import {
  MEDIA_UPLOAD_MAX_BYTES,
  validateMediaDimensions,
  validateMediaFile,
} from "./media-file-policy"

describe("media file policy", () => {
  it("accepts the supported raster formats", () => {
    expect(
      validateMediaFile(
        new File(["png"], "portrait.png", { type: "image/png" })
      )
    ).toBeNull()
    expect(
      validateMediaFile(
        new File(["jpeg"], "portrait.jpeg", { type: "image/jpeg" })
      )
    ).toBeNull()
    expect(
      validateMediaFile(
        new File(["webp"], "portrait.webp", { type: "image/webp" })
      )
    ).toBeNull()
  })

  it("rejects empty, oversized, unsupported, and mismatched files", () => {
    expect(
      validateMediaFile(new File([], "empty.png", { type: "image/png" }))
    ).toContain("empty")
    const oversized = new File(["png"], "large.png", { type: "image/png" })
    Object.defineProperty(oversized, "size", {
      value: MEDIA_UPLOAD_MAX_BYTES + 1,
    })
    expect(validateMediaFile(oversized)).toContain("25 MB")
    expect(
      validateMediaFile(new File(["gif"], "motion.gif", { type: "image/gif" }))
    ).toContain("PNG, JPEG, or WebP")
    expect(
      validateMediaFile(
        new File(["png"], "portrait.jpg", { type: "image/png" })
      )
    ).toContain("does not match")
  })

  it("rejects invalid dimensions and pixel bombs", () => {
    expect(validateMediaDimensions({ width: 0, height: 100 })).toContain(
      "invalid dimensions"
    )
    expect(validateMediaDimensions({ width: 16_385, height: 100 })).toContain(
      "16,384"
    )
    expect(
      validateMediaDimensions({ width: 12_000, height: 12_000 })
    ).toContain("100 million")
    expect(validateMediaDimensions({ width: 4_000, height: 4_000 })).toBeNull()
  })
})
