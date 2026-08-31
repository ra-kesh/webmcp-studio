import { describe, expect, it } from "vitest"
import type { DocumentDraftRecord } from "./document-draft-repository"
import {
  completedLibraryTemplateCreate,
  failedLibraryTemplateCreate,
} from "./library-template-create-completion"

const record = (documentId: string): DocumentDraftRecord =>
  ({
    summary: { documentId, deletedAt: null },
    envelope: { document: { id: documentId } },
  }) as DocumentDraftRecord

describe("library template create completion", () => {
  it("returns a stable catalog-safe completion only for the exact installed durable head", () => {
    const documentId = "document-31168e5d-bba7-479d-9e74-d8abee824cd9"
    expect(
      completedLibraryTemplateCreate(record(documentId), documentId)
    ).toEqual({ succeeded: true, completionId: documentId })
  })

  it("keeps successful session-only and inconsistent installs out of Recent", () => {
    expect(completedLibraryTemplateCreate(null, "document-session")).toEqual({
      succeeded: true,
      completionId: null,
    })
    expect(
      completedLibraryTemplateCreate(record("document-other"), "document-next")
    ).toEqual({ succeeded: true, completionId: null })
    expect(
      completedLibraryTemplateCreate(
        record("document with spaces"),
        "document with spaces"
      )
    ).toEqual({ succeeded: true, completionId: null })
  })

  it("keeps failed creation distinct from a successful session-only install", () => {
    expect(failedLibraryTemplateCreate()).toEqual({
      succeeded: false,
      completionId: null,
    })
  })
})
