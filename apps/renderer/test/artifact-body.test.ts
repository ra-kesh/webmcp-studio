import { describe, expect, it } from "vitest"
import {
  ArtifactSizeError,
  assertArtifactSize,
  MAX_RENDER_ARTIFACT_BYTES,
} from "../src/artifact-body"

describe("renderer artifact size policy", () => {
  it.each([
    ["just below", MAX_RENDER_ARTIFACT_BYTES - 1],
    ["at", MAX_RENDER_ARTIFACT_BYTES],
  ])("accepts an artifact %s the limit", (_label, byteLength) => {
    expect(() => assertArtifactSize(byteLength)).not.toThrow()
  })

  it("rejects an artifact just above the limit without materializing it", () => {
    expect(() => assertArtifactSize(MAX_RENDER_ARTIFACT_BYTES + 1)).toThrow(
      expect.objectContaining<Partial<ArtifactSizeError>>({
        code: "artifact_too_large",
        receivedBytes: MAX_RENDER_ARTIFACT_BYTES + 1,
        maxBytes: MAX_RENDER_ARTIFACT_BYTES,
      })
    )
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid byte length %s",
    (byteLength) => {
      expect(() => assertArtifactSize(byteLength)).toThrow(ArtifactSizeError)
    }
  )
})
