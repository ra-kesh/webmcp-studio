import { describe, expect, it } from "vitest"
import {
  decodeDocumentRouteSegment,
  documentLibraryNoticeCopy,
  documentPath,
  validateDocumentLibraryNoticeSearch,
} from "./document-route"

describe("document route", () => {
  it.each([
    "document-a",
    "document with whitespace",
    "folder/document",
    "document%25",
    "document~copy",
    "दस्तावेज़-🖼️",
  ])("round-trips the exact ID through one path segment: %s", (documentId) => {
    const encoded = documentPath(documentId)
    expect(encoded).toEqual({
      ok: true,
      documentId,
      encodedDocumentId: encodeURIComponent(documentId),
      pathname: `/documents/${encodeURIComponent(documentId)}`,
    })
    if (!encoded.ok) throw new Error("Expected a valid document route.")
    expect(encoded.encodedDocumentId).not.toContain("/")
    expect(decodeDocumentRouteSegment(encoded.encodedDocumentId)).toEqual(
      encoded
    )
  })

  it("rejects empty, malformed, and multi-segment route input with typed results", () => {
    expect(documentPath("")).toEqual({
      ok: false,
      reason: "empty_document_id",
    })
    expect(decodeDocumentRouteSegment("")).toEqual({
      ok: false,
      reason: "empty_document_id",
    })
    expect(decodeDocumentRouteSegment("bad%2")).toEqual({
      ok: false,
      reason: "malformed_document_id",
    })
    expect(decodeDocumentRouteSegment("document-a/document-b")).toEqual({
      ok: false,
      reason: "not_one_segment",
    })
  })
})

describe("document library redirect notices", () => {
  it("validates only typed, document-specific search", () => {
    expect(
      validateDocumentLibraryNoticeSearch({
        notice: "document_missing",
        documentId: "folder/document%25",
        storageMessage: "sensitive implementation detail",
      })
    ).toEqual({
      notice: "document_missing",
      documentId: "folder/document%25",
    })
    expect(
      validateDocumentLibraryNoticeSearch({ notice: "invalid_document_route" })
    ).toEqual({ notice: "invalid_document_route" })
    expect(
      validateDocumentLibraryNoticeSearch({ notice: "document_missing" })
    ).toBeNull()
    expect(
      validateDocumentLibraryNoticeSearch({
        notice: "unknown",
        documentId: "document-a",
      })
    ).toBeNull()
  })

  it("projects fixed safe copy without accepting raw storage text", () => {
    const search = validateDocumentLibraryNoticeSearch({
      notice: "document_unavailable",
      documentId: "document-a",
      message: "IndexedDB exposed internal failure text",
    })
    expect(search).toEqual({
      notice: "document_unavailable",
      documentId: "document-a",
    })
    if (!search) throw new Error("Expected valid notice search.")
    expect(documentLibraryNoticeCopy(search)).toBe(
      "The document “document-a” is temporarily unavailable."
    )
    expect(documentLibraryNoticeCopy(search)).not.toContain("IndexedDB")
  })
})
