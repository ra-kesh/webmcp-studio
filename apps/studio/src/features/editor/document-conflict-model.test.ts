import { describe, expect, it } from "vitest"
import type { CurrentDraftSnapshot } from "./current-draft-repository"
import type { LocalSaveState } from "./document-draft-save-controller"
import type { DocumentDraftConflict } from "./document-draft-repository"
import {
  projectDocumentConflictModel,
  selectNewestUnresolvedConflict,
} from "./document-conflict-model"

const conflict = (
  conflictId: string,
  options: Partial<DocumentDraftConflict> = {}
): DocumentDraftConflict => ({
  schemaVersion: 1,
  conflictId,
  documentId: "document-a",
  sessionId: "tab-a",
  expectedRecordVersion: 2,
  observedRecordVersion: 3,
  baseDraftSnapshotId: `sha256-${"1".repeat(64)}`,
  observedContentSnapshotId: `sha256-${"2".repeat(64)}`,
  observedDraftSnapshotId: `sha256-${"3".repeat(64)}`,
  candidateContentSnapshotId: `sha256-${"4".repeat(64)}`,
  candidateDraftSnapshotId: `sha256-${"5".repeat(64)}`,
  candidate: {
    document: { id: "document-a", name: "Editorial" },
    sourceContext: {
      quotationSource: {
        customer: { name: "PRIVATE CUSTOMER" },
      },
      quotationTemplateId: "editorial-olive",
      designTemplate: null,
    },
  } as unknown as CurrentDraftSnapshot,
  reason: "stale_write",
  detectedAt: "2026-08-28T10:00:00.000Z",
  resolvedAt: null,
  resolution: null,
  resolutionDocumentId: null,
  ...options,
})

const saved: LocalSaveState = {
  status: "saved",
  recordVersion: 3,
  savedAt: "2026-08-28T10:00:00.000Z",
}

const project = (
  verifiedConflicts: readonly DocumentDraftConflict[],
  saveState: LocalSaveState = saved
) =>
  projectDocumentConflictModel({
    documentId: "document-a",
    documentName: "Editorial",
    saveState,
    verifiedConflicts,
  })

describe("document conflict model", () => {
  it("selects the newest unresolved verified conflict deterministically", () => {
    const old = conflict("conflict-old")
    const resolved = conflict("conflict-resolved", {
      detectedAt: "2026-08-28T13:00:00.000Z",
      resolvedAt: "2026-08-28T14:00:00.000Z",
      resolution: "reload_saved",
    })
    const wrongDocument = conflict("conflict-wrong-document", {
      documentId: "document-b",
      detectedAt: "2026-08-28T15:00:00.000Z",
    })
    const tieA = conflict("conflict-a", {
      detectedAt: "2026-08-28T12:00:00.000Z",
    })
    const tieB = conflict("conflict-b", {
      detectedAt: "2026-08-28T12:00:00.000Z",
      candidateDraftSnapshotId: `sha256-${"9".repeat(64)}`,
    })

    expect(
      selectNewestUnresolvedConflict("document-a", [
        tieA,
        resolved,
        wrongDocument,
        old,
        tieB,
      ])
    ).toBe(tieB)
  })

  it.each([
    [
      "stale_write",
      "changed",
      "A newer saved version exists",
      "The saved document changed after editing began.",
    ],
    [
      "deleted_elsewhere",
      "deleted",
      "The saved document was deleted",
      "The saved document is now in Trash.",
    ],
    [
      "migration_collision",
      "migration_collision",
      "Two stored versions need recovery",
      "A stored version already used this document identity during migration.",
    ],
  ] as const)(
    "projects %s with exact candidate action identity",
    (reason, durableHeadState, reasonLabel, durableHeadCopy) => {
      const candidate = conflict("conflict-exact", {
        reason,
        candidateDraftSnapshotId: `sha256-${"8".repeat(64)}`,
      })
      const model = project([candidate])
      expect(model).toMatchObject({
        status: "conflict",
        identity: {
          conflictId: "conflict-exact",
          candidateDraftSnapshotId: `sha256-${"8".repeat(64)}`,
        },
        reason,
        durableHeadState,
        reasonLabel,
        durableHeadCopy,
        detectedAt: candidate.detectedAt,
        expectedRecordVersion: 2,
        observedRecordVersion: 3,
        actions: ["download", "reload", "save_copy"],
      })
      expect(JSON.stringify(model)).not.toContain("PRIVATE CUSTOMER")
      expect(JSON.stringify(model)).not.toContain("quotationSource")
      expect(JSON.stringify(model)).not.toContain("sourceContext")
    }
  )

  it.each([
    [
      {
        status: "external_change",
        reason: "saved_elsewhere",
        observedRecordVersion: 4,
      },
      "Editorial changed elsewhere",
    ],
    [
      {
        status: "external_change",
        reason: "deleted_elsewhere",
        observedRecordVersion: 4,
      },
      "Editorial was deleted elsewhere",
    ],
  ] as const)("projects external change %j", (saveState, heading) => {
    expect(project([], saveState)).toMatchObject({
      status: "external_change",
      reason: saveState.reason,
      observedRecordVersion: 4,
      heading,
      actions: ["download", "reload", "save_copy"],
    })
  })

  it("projects quarantine as recovery rather than an ordinary external change", () => {
    expect(
      project([], {
        status: "external_change",
        reason: "quarantined_elsewhere",
        observedRecordVersion: 4,
      })
    ).toMatchObject({
      status: "recovery_required",
      failureKind: "corrupt_record",
      detail: "The saved document was quarantined and cannot be reopened.",
    })
  })

  it("keeps discovery and operation failures distinct", () => {
    expect(
      projectDocumentConflictModel({
        documentId: "document-a",
        documentName: "Editorial",
        saveState: saved,
        verifiedConflicts: [],
        discoveryFailure: {
          kind: "corrupt_record",
          message: "PRIVATE STORAGE DETAIL",
        },
      })
    ).toEqual({
      status: "recovery_required",
      documentId: "document-a",
      documentName: "Editorial",
      heading: "Recovery needed for Editorial",
      detail: "A stored recovery candidate could not be verified.",
      failureKind: "corrupt_record",
      operation: { status: "idle" },
    })

    const identity = {
      conflictId: "conflict-exact",
      candidateDraftSnapshotId: `sha256-${"8".repeat(64)}`,
    }
    const model = projectDocumentConflictModel({
      documentId: "document-a",
      documentName: "Editorial",
      saveState: saved,
      verifiedConflicts: [
        conflict("conflict-exact", {
          candidateDraftSnapshotId: identity.candidateDraftSnapshotId,
        }),
      ],
      operation: {
        status: "failed",
        action: "save_copy",
        identity,
        message: "The copy could not be saved.",
        retryable: true,
      },
    })
    expect(model).toMatchObject({
      status: "conflict",
      identity,
      operation: {
        status: "failed",
        action: "save_copy",
        identity,
        retryable: true,
      },
    })
  })

  it("distinguishes save failure and resolved history from actionable conflict", () => {
    expect(
      project(
        [
          conflict("conflict-resolved", {
            resolvedAt: "2026-08-28T11:00:00.000Z",
            resolution: "save_copy",
            resolutionDocumentId: "document-copy",
          }),
        ],
        { status: "failed", message: "private adapter text", retryable: false }
      )
    ).toEqual({
      status: "save_failed",
      documentId: "document-a",
      documentName: "Editorial",
      heading: "Changes to Editorial were not saved",
      detail: "Download your open version before retrying or leaving.",
      retryable: false,
      actions: ["download"],
      operation: { status: "idle" },
    })
  })
})
