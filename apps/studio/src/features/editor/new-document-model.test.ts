import { describe, expect, it } from "vitest"
import {
  draftForNewDocumentPreset,
  presetIdForDraftDimensions,
  validateNewDocumentDraft,
  validateNewDocumentOptions,
} from "./new-document-model"

describe("new document model", () => {
  it("normalizes a valid named pixel document", () => {
    expect(
      validateNewDocumentDraft({
        name: "  Campaign cover  ",
        width: "1600",
        height: "900",
      })
    ).toEqual({
      ok: true,
      options: {
        name: "Campaign cover",
        width: 1600,
        height: 900,
        kind: "custom",
        exportFormats: ["png", "pdf"],
      },
    })
  })

  it.each([
    [{ name: " ", width: "1080", height: "1080" }, "name"],
    [{ name: "Design", width: "", height: "1080" }, "width"],
    [{ name: "Design", width: "10.5", height: "1080" }, "width"],
    [{ name: "Design", width: "0", height: "1080" }, "width"],
    [{ name: "Design", width: "8193", height: "1080" }, "width"],
    [{ name: "Design", width: "8192", height: "8192" }, "dimensions"],
    [{ name: "Design", width: "Infinity", height: "1080" }, "width"],
    [{ name: "Design", width: "NaN", height: "1080" }, "width"],
    [{ name: "x".repeat(81), width: "1080", height: "1080" }, "name"],
  ])("rejects invalid input %j at %s", (draft, field) => {
    const result = validateNewDocumentDraft(draft)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toHaveProperty(field)
  })

  it("projects preset dimensions into an editable draft", () => {
    expect(draftForNewDocumentPreset("story")).toEqual({
      name: "Social story",
      width: "1080",
      height: "1920",
    })
  })

  it("retains format identity by dimensions and treats other sizes as custom", () => {
    expect(presetIdForDraftDimensions({ width: "1080", height: "1080" })).toBe(
      "square"
    )
    expect(
      presetIdForDraftDimensions({ width: "1200", height: "1080" })
    ).toBeNull()
  })

  it("enforces render policy again at the numeric creation boundary", () => {
    expect(
      validateNewDocumentOptions({
        name: "Unsafe",
        width: Number.POSITIVE_INFINITY,
        height: 1080,
      }).ok
    ).toBe(false)
    expect(
      validateNewDocumentOptions({ name: "Square", width: 1080, height: 1080 })
    ).toEqual({
      ok: true,
      options: {
        name: "Square",
        width: 1080,
        height: 1080,
        kind: "square",
        exportFormats: ["png", "pdf"],
      },
    })
  })
})
