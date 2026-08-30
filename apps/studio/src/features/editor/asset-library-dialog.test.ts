import {
  documentSchema,
  localAssetSource,
  managedAssetSource,
  sceneNodeSchema,
} from "@webmcp/document"
import { describe, expect, it } from "vitest"
import {
  chooseLocalAssetPromotionProjection,
  projectLiveLocalAssetPromotion,
  projectPersistedLocalAssetPromotion,
} from "./asset-library-dialog"
import { localAssetPromotionJournalSchema } from "./local-asset-promotion-journal"
import { hasCurrentRelinkUndo } from "./local-asset-relink-projection"

const localAssetId = "local-photo-1"
const managedAssetId = "asset-1234567890"
const localSource = localAssetSource(localAssetId)
const managedSource = managedAssetSource(managedAssetId)

const documentFor = (id: string, source: string, assetId: string) =>
  documentSchema.parse({
    schemaVersion: 2,
    id,
    name: "Promotion projection",
    revision: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:01.000Z",
    outputs: [
      {
        id: "output-1",
        name: "Output",
        kind: "custom",
        pageIds: ["page-1"],
        exportFormats: ["png"],
      },
    ],
    pages: [
      {
        id: "page-1",
        outputId: "output-1",
        name: "Page",
        width: 400,
        height: 400,
        background: "#fff",
        nodeIds: ["photo"],
      },
    ],
    nodes: [
      sceneNodeSchema.parse({
        id: "photo",
        type: "image",
        name: "Photo",
        assetId,
        src: source,
        alt: "Photo",
        altProvenance: "authored",
        decorative: false,
        placement: {
          mode: "manual",
          focalX: 0.5,
          focalY: 0.5,
          zoom: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        frameMask: { shape: "rectangle" },
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      }),
    ],
    groups: [],
    fields: [],
    fieldValues: {},
    bindings: [],
  })

const completeJournal = localAssetPromotionJournalSchema.parse({
  schemaVersion: 1,
  localAssetId,
  revision: 9,
  contentSha256: "a".repeat(64),
  idempotencyKey: "upload-key-1",
  recentUseIdempotencyKey: "recent-key-1",
  attempt: 1,
  state: "complete",
  managedAssetId,
  managedContentSha256: "a".repeat(64),
  managedStatus: "ready",
  managedAssetRevision: 2,
  sourceDocumentId: "document-1",
  sourceContentSnapshotId: `sha256-${"b".repeat(64)}`,
  sourceHistorySnapshotId: "history-1",
  sourceOperationVersion: 1,
  sourceDraftRecordVersion: 1,
  sourceDraftSnapshotId: `sha256-${"c".repeat(64)}`,
  sourceLocalAssetRevision: 1,
  expectedReferenceKeys: ["node/photo/src"],
  mappingRequestId: "mapping-request-1",
  relinkResultContentSnapshotId: `sha256-${"d".repeat(64)}`,
  relinkResultHistorySnapshotId: "history-2",
  relinkResultOperationVersion: 2,
  relinkResultKind: "committed",
  relinkResultDraftContentSnapshotId: `sha256-${"d".repeat(64)}`,
  relinkResultDraftSnapshotId: `sha256-${"e".repeat(64)}`,
  relinkResultDraftRecordVersion: 2,
  relinkCommitId: "commit-1",
  relinkUndoable: true,
  recentUseUsedAt: "2026-08-30T00:00:08.000Z",
  recentUseAssetRevision: 3,
  recentUseRequestId: "use-request-1",
  errorCode: null,
  errorRequestId: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:08.000Z",
  lease: null,
})

describe("persisted promotion UI projection", () => {
  it("shows completion only for the exact managed target in its source document", () => {
    const exact = documentFor("document-1", managedSource, managedAssetId)
    const anotherDocument = documentFor("document-2", localSource, localAssetId)
    const restoredByUndo = documentFor("document-1", localSource, localAssetId)
    const incoherentTarget = {
      ...exact,
      nodes: exact.nodes.map((node) =>
        node.id === "photo"
          ? { ...node, assetId: "asset-another-managed" }
          : node
      ),
    }

    expect(
      projectPersistedLocalAssetPromotion(completeJournal, exact, localAssetId)
    ).toMatchObject({ phase: "complete", undoable: false })
    expect(
      projectPersistedLocalAssetPromotion(
        completeJournal,
        anotherDocument,
        localAssetId
      )
    ).toBeNull()
    expect(
      projectPersistedLocalAssetPromotion(
        completeJournal,
        restoredByUndo,
        localAssetId
      )
    ).toBeNull()
    expect(
      projectPersistedLocalAssetPromotion(
        completeJournal,
        incoherentTarget,
        localAssetId
      )
    ).toBeNull()
  })

  it("does not offer checkpointed recovery in another document", () => {
    const markingUsed = localAssetPromotionJournalSchema.parse({
      ...completeJournal,
      state: "marking_used",
      recentUseUsedAt: null,
      recentUseAssetRevision: null,
      recentUseRequestId: null,
    })
    const anotherDocument = documentFor(
      "document-2",
      managedSource,
      managedAssetId
    )

    expect(
      projectPersistedLocalAssetPromotion(
        markingUsed,
        anotherDocument,
        localAssetId
      )
    ).toBeNull()
  })

  it("shows a reusable mapping only where the exact local alias is present", () => {
    const mapped = localAssetPromotionJournalSchema.parse({
      ...completeJournal,
      state: "mapped",
      relinkResultContentSnapshotId: null,
      relinkResultHistorySnapshotId: null,
      relinkResultOperationVersion: null,
      relinkResultKind: null,
      relinkResultDraftContentSnapshotId: null,
      relinkResultDraftSnapshotId: null,
      relinkResultDraftRecordVersion: null,
      relinkCommitId: null,
      relinkUndoable: null,
      recentUseUsedAt: null,
      recentUseAssetRevision: null,
      recentUseRequestId: null,
    })
    const reusableDocument = documentFor(
      "document-2",
      localSource,
      localAssetId
    )
    const unrelatedDocument = documentFor(
      "document-2",
      managedSource,
      managedAssetId
    )

    expect(
      projectPersistedLocalAssetPromotion(
        mapped,
        reusableDocument,
        localAssetId
      )
    ).toMatchObject({ phase: "backed_up" })
    expect(
      projectPersistedLocalAssetPromotion(
        mapped,
        unrelatedDocument,
        localAssetId
      )
    ).toBeNull()
  })

  it("projects a foreign active lease as busy and its expiry as retryable", () => {
    const mapped = localAssetPromotionJournalSchema.parse({
      ...completeJournal,
      state: "mapped",
      relinkResultContentSnapshotId: null,
      relinkResultHistorySnapshotId: null,
      relinkResultOperationVersion: null,
      relinkResultKind: null,
      relinkResultDraftContentSnapshotId: null,
      relinkResultDraftSnapshotId: null,
      relinkResultDraftRecordVersion: null,
      relinkCommitId: null,
      relinkUndoable: null,
      recentUseUsedAt: null,
      recentUseAssetRevision: null,
      recentUseRequestId: null,
      lease: {
        ownerId: "another-tab",
        token: "foreign-lease",
        expiresAt: "2026-08-30T00:01:00.000Z",
      },
    })
    const source = documentFor("document-1", localSource, localAssetId)
    const anotherDocumentWithLocalAlias = documentSchema.parse({
      ...documentFor("document-2", localSource, localAssetId),
      outputs: [
        {
          ...source.outputs[0],
          id: "output-2",
          pageIds: ["page-2"],
        },
      ],
      pages: [
        {
          ...source.pages[0],
          id: "page-2",
          outputId: "output-2",
          nodeIds: ["photo-2"],
        },
      ],
      nodes: source.nodes.map((node) => ({ ...node, id: "photo-2" })),
    })
    const anotherDocumentWithoutLocalAlias = documentFor(
      "document-2",
      managedSource,
      managedAssetId
    )

    expect(
      projectPersistedLocalAssetPromotion(
        mapped,
        source,
        localAssetId,
        Date.parse("2026-08-30T00:00:30.000Z")
      )
    ).toMatchObject({ phase: "reconciling", retryable: false })
    expect(
      projectPersistedLocalAssetPromotion(
        mapped,
        source,
        localAssetId,
        Date.parse("2026-08-30T00:01:00.001Z")
      )
    ).toMatchObject({ phase: "backed_up", retryable: true })
    expect(
      projectPersistedLocalAssetPromotion(
        mapped,
        anotherDocumentWithLocalAlias,
        localAssetId,
        Date.parse("2026-08-30T00:00:30.000Z")
      )
    ).toMatchObject({
      phase: "reconciling",
      message: "Another Studio tab is continuing this image.",
      retryable: false,
    })
    expect(
      projectPersistedLocalAssetPromotion(
        mapped,
        anotherDocumentWithLocalAlias,
        localAssetId,
        Date.parse("2026-08-30T00:01:00.001Z")
      )
    ).toBeNull()
    expect(
      projectPersistedLocalAssetPromotion(
        mapped,
        anotherDocumentWithoutLocalAlias,
        localAssetId,
        Date.parse("2026-08-30T00:00:30.000Z")
      )
    ).toBeNull()

    const queued = localAssetPromotionJournalSchema.parse({
      ...mapped,
      state: "queued",
      contentSha256: null,
      managedAssetId: null,
      managedContentSha256: null,
      managedStatus: null,
      managedAssetRevision: null,
      mappingRequestId: null,
    })
    expect(
      projectPersistedLocalAssetPromotion(
        queued,
        source,
        localAssetId,
        Date.parse("2026-08-30T00:00:30.000Z")
      )
    ).toMatchObject({ phase: "reconciling", retryable: false })
    expect(
      projectPersistedLocalAssetPromotion(
        queued,
        source,
        localAssetId,
        Date.parse("2026-08-30T00:01:00.001Z")
      )
    ).toBeNull()
  })

  it("restores a durable relink conflict only in its anchored document", () => {
    const conflict = localAssetPromotionJournalSchema.parse({
      ...completeJournal,
      state: "relinking",
      relinkResultDraftContentSnapshotId: null,
      relinkResultDraftSnapshotId: null,
      relinkResultDraftRecordVersion: null,
      recentUseUsedAt: null,
      recentUseAssetRevision: null,
      recentUseRequestId: null,
      errorCode: "local_relink_conflict",
    })
    const partialTarget = documentFor(
      "document-1",
      managedAssetSource("asset-wrong-target"),
      "asset-wrong-target"
    )
    const unrelated = { ...partialTarget, id: "document-2" }
    const repairedSource = documentFor("document-1", localSource, localAssetId)

    expect(
      projectPersistedLocalAssetPromotion(conflict, partialTarget, localAssetId)
    ).toMatchObject({ phase: "conflict", retryable: false })
    expect(
      projectPersistedLocalAssetPromotion(conflict, unrelated, localAssetId)
    ).toBeNull()
    expect(
      projectPersistedLocalAssetPromotion(
        conflict,
        repairedSource,
        localAssetId
      )
    ).toBeNull()
  })
})

describe("live promotion UI projection", () => {
  const completePromotion = {
    operationId: "operation-1",
    localAssetId,
    sourceDocumentId: "document-1",
    expectedReferenceKeys: ["node/photo/src"],
    managedAssetId,
    relinkCommitId: "commit-1",
    phase: "complete" as const,
    loaded: null,
    total: null,
    message: null,
    retryable: false,
    undoable: true,
  }

  it("drops stale completion after Undo or a document transition", () => {
    const restoredByUndo = documentFor("document-1", localSource, localAssetId)
    const anotherDocument = documentFor(
      "document-2",
      managedSource,
      managedAssetId
    )

    expect(
      projectLiveLocalAssetPromotion(
        completePromotion,
        restoredByUndo,
        localAssetId
      )
    ).toBeNull()
    expect(
      projectLiveLocalAssetPromotion(
        completePromotion,
        anotherDocument,
        localAssetId
      )
    ).toBeNull()
  })

  it("retains truthful completion through an unrelated document edit", () => {
    const target = documentFor("document-1", managedSource, managedAssetId)
    const unrelatedEdit = { ...target, name: "Renamed design", revision: 2 }

    expect(
      projectLiveLocalAssetPromotion(
        completePromotion,
        unrelatedEdit,
        localAssetId
      )
    ).toEqual(completePromotion)
  })

  it("claims Undo only while the exact relink commit remains in past history", () => {
    expect(hasCurrentRelinkUndo("complete", "commit-1", ["commit-1"])).toBe(
      true
    )
    expect(hasCurrentRelinkUndo("complete", "commit-1", [])).toBe(false)
    expect(
      hasCurrentRelinkUndo("complete", "commit-1", ["unrelated-commit"])
    ).toBe(false)
    expect(hasCurrentRelinkUndo("failed", "commit-1", ["commit-1"])).toBe(false)
  })

  it("lets authoritative persisted completion replace stale local failure", () => {
    const staleFailure = {
      ...completePromotion,
      phase: "failed" as const,
      message: "Retry the stale operation.",
      retryable: true,
      undoable: false,
    }
    const persistedCompletion = {
      ...completePromotion,
      operationId: "journal-12",
      relinkCommitId: null,
      undoable: false,
    }

    expect(
      chooseLocalAssetPromotionProjection(staleFailure, persistedCompletion)
    ).toBe(persistedCompletion)
    expect(
      chooseLocalAssetPromotionProjection(
        completePromotion,
        persistedCompletion
      )
    ).toBe(completePromotion)
  })
})
