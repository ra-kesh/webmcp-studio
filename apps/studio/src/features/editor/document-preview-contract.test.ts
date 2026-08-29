import { describe, expect, it } from "vitest"
import {
  createDocumentPreviewIdentity,
  createDocumentPreviewKey,
  DOCUMENT_PREVIEW_RASTER_BOUNDS,
  DOCUMENT_PREVIEW_RENDERER_REVISION,
  isSameDocumentPreviewKey,
  serializeDocumentPreviewKey,
} from "./document-preview-contract"

const identity = () =>
  createDocumentPreviewIdentity({
    documentId: "document-a",
    recordVersion: 7,
    contentSnapshotId: "content-a",
    documentRevision: 3,
    firstPageId: "page-a",
    firstPageWidth: 1240,
    firstPageHeight: 1754,
  })

describe("document preview contract", () => {
  it("projects an immutable exact identity and one fixed portrait raster size", () => {
    const projected = identity()
    const key = createDocumentPreviewKey(projected)

    expect(projected).toEqual({
      documentId: "document-a",
      recordVersion: 7,
      contentSnapshotId: "content-a",
      documentRevision: 3,
      pageId: "page-a",
      pageWidth: 1240,
      pageHeight: 1754,
    })
    expect(Object.isFrozen(projected)).toBe(true)
    expect(key).toMatchObject({
      ...projected,
      rendererRevision: DOCUMENT_PREVIEW_RENDERER_REVISION,
      pixelWidth: 170,
      pixelHeight: 240,
    })
    expect(Object.isFrozen(key)).toBe(true)
    expect(DOCUMENT_PREVIEW_RASTER_BOUNDS).toEqual({
      maxWidth: 320,
      maxHeight: 240,
    })
  })

  it.each([
    [
      { width: 1920, height: 1080 },
      { pixelWidth: 320, pixelHeight: 180 },
    ],
    [
      { width: 1000, height: 1000 },
      { pixelWidth: 240, pixelHeight: 240 },
    ],
  ])("fits %o into the same stored-preview policy", (page, expected) => {
    const key = createDocumentPreviewKey({
      ...identity(),
      pageWidth: page.width,
      pageHeight: page.height,
    })
    expect(key).toMatchObject(expected)
  })

  it("serializes cache-authority facts while retaining document revision as diagnostics", () => {
    const key = createDocumentPreviewKey(identity())
    const clone = createDocumentPreviewKey({ ...identity() })

    expect(serializeDocumentPreviewKey(key)).toBe(
      serializeDocumentPreviewKey(clone)
    )
    expect(isSameDocumentPreviewKey(key, clone)).toBe(true)
    expect(
      isSameDocumentPreviewKey(key, {
        ...clone,
        documentRevision: clone.documentRevision + 1,
      })
    ).toBe(true)

    const changed = [
      { ...key, recordVersion: key.recordVersion + 1 },
      { ...key, contentSnapshotId: "content-b" },
      { ...key, pageId: "page-b" },
      { ...key, pageWidth: 1754, pageHeight: 1240 },
      { ...key, rendererRevision: "renderer-thumbnail-v2" },
    ]
    for (const candidate of changed) {
      const canonicalCandidate = createDocumentPreviewKey(
        candidate,
        candidate.rendererRevision
      )
      expect(isSameDocumentPreviewKey(key, canonicalCandidate)).toBe(false)
    }
  })

  it("rejects malformed identities, revisions, and non-canonical raster sizes", () => {
    expect(() =>
      createDocumentPreviewIdentity({
        documentId: "",
        recordVersion: 1,
        contentSnapshotId: "content-a",
        documentRevision: 0,
        firstPageId: "page-a",
        firstPageWidth: 1240,
        firstPageHeight: 1754,
      })
    ).toThrow("cannot contain empty IDs")
    expect(() => createDocumentPreviewKey(identity(), " ")).toThrow(
      "cannot be empty"
    )
    expect(() =>
      createDocumentPreviewKey({ ...identity(), pageWidth: 1240.5 })
    ).toThrow("page dimensions must be positive integers")
    expect(() =>
      serializeDocumentPreviewKey({
        ...createDocumentPreviewKey(identity()),
        pixelWidth: 171,
      })
    ).toThrow("must match the canonical size")
  })
})
