import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import {
  MOUNTED_MEDIA_RECOVERY_DATABASE_VERSION,
  MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME,
  MOUNTED_MEDIA_RECOVERY_STORE_NAME,
  MountedMediaRecoveryRepository,
} from "./mounted-media-recovery-repository"
import type {
  CreateMountedMediaRecoveryIntentInput,
  MountedMediaRecoveryDocumentCommit,
  MountedMediaRecoveryRecord,
} from "./mounted-media-recovery-repository"

const databaseNames: string[] = []
const createdAt = "2026-08-30T10:00:00.000Z"
const committedAt = "2026-08-30T10:01:00.000Z"
const completedAt = "2026-08-30T10:02:00.000Z"

const sha = (character: string) => `sha256-${character.repeat(64)}`

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase))
})

const repository = (suffix: string) => {
  const databaseName = `mounted-media-recovery-${suffix}-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  let quarantine = 0
  return {
    databaseName,
    value: new MountedMediaRecoveryRepository({
      databaseName,
      indexedDB,
      now: () => completedAt,
      createId: () => `quarantine-${++quarantine}`,
    }),
  }
}

const intent = (
  operationId = "mounted-recovery-operation-1",
  documentId = "document-mounted-recovery-1",
  at = createdAt
): CreateMountedMediaRecoveryIntentInput => ({
  operationId,
  documentId,
  localAssetId: "local-mounted-recovery",
  localSource: "asset:local/local-mounted-recovery",
  managedAssetId: "asset-mountedrecovery01",
  managedSource: "asset:managed/asset-mountedrecovery01",
  expectedReferenceKeys: ["field:hero:current", "node:image-1"],
  preexistingTargetReferenceKeys: ["field:library:default"],
  sourceContentSnapshotId: sha("a"),
  sourceHistorySnapshotId: "history-mounted-source",
  sourceOperationVersion: 7,
  sourceDraftRecordVersion: 11,
  sourceDraftSnapshotId: sha("b"),
  createdAt: at,
})

const documentCommit = (
  at = committedAt,
  documentId = "document-mounted-recovery-1"
): MountedMediaRecoveryDocumentCommit => ({
  kind: "committed",
  resultContentSnapshotId: sha("c"),
  resultHistorySnapshotId: "history-mounted-result",
  resultOperationVersion: 8,
  commitId: "history-commit-mounted-recovery",
  undoable: true,
  durable: {
    documentId,
    recordVersion: 12,
    contentSnapshotId: sha("c"),
    draftSnapshotId: sha("d"),
    savedAt: at,
  },
})

const observedLaterCommit = (
  at = committedAt,
  documentId = "document-mounted-recovery-1"
): MountedMediaRecoveryDocumentCommit => ({
  kind: "observed_later",
  resultContentSnapshotId: sha("e"),
  resultHistorySnapshotId: "history-mounted-result",
  resultOperationVersion: 8,
  commitId: "history-commit-mounted-recovery",
  undoable: true,
  durable: {
    documentId,
    recordVersion: 13,
    contentSnapshotId: sha("e"),
    draftSnapshotId: sha("f"),
    savedAt: at,
  },
})

const historyCheckpoint = () => ({
  resultContentSnapshotId: sha("c"),
  resultHistorySnapshotId: "history-mounted-result",
  resultOperationVersion: 8,
  commitId: "history-commit-mounted-recovery",
  undoable: true,
})

const openDatabase = (name: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      name,
      MOUNTED_MEDIA_RECOVERY_DATABASE_VERSION
    )
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => undefined
    transaction.onabort = () => reject(transaction.error)
  })

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const prepareIntent = async (
  value: MountedMediaRecoveryRepository,
  record: MountedMediaRecoveryRecord,
  checkpoint = historyCheckpoint(),
  updatedAt = committedAt
) => {
  const result = await value.recordHistoryPrepared({
    operationId: record.operationId,
    expectedRevision: record.revision,
    historyCheckpoint: checkpoint,
    updatedAt,
  })
  if (!result.ok) throw new Error("Expected durable history checkpoint")
  return result.record
}

const commitIntent = async (
  value: MountedMediaRecoveryRepository,
  record: MountedMediaRecoveryRecord,
  commit = documentCommit()
) => {
  const prepared =
    record.historyCheckpoint === null
      ? await prepareIntent(
          value,
          record,
          historyCheckpoint(),
          commit.durable.savedAt
        )
      : record
  const result = await value.recordDocumentCommitted({
    operationId: record.operationId,
    expectedRevision: prepared.revision,
    documentCommit: commit,
    updatedAt: commit.durable.savedAt,
  })
  if (!result.ok) throw new Error("Expected durable document commit")
  return result.record
}

const completeIntent = async (
  value: MountedMediaRecoveryRepository,
  record: MountedMediaRecoveryRecord,
  at = completedAt
) => {
  const result = await value.recordRecentComplete({
    operationId: record.operationId,
    expectedRevision: record.revision,
    idempotencyKey: record.recentUseIdempotencyKey,
    requestId: `request-${record.operationId}`,
    usedAt: at,
    assetRevision: 19,
    updatedAt: at,
  })
  if (!result.ok) throw new Error("Expected managed Recent completion")
  return result.record
}

const sourceAnchor = (record: MountedMediaRecoveryRecord) => ({
  contentSnapshotId: record.sourceContentSnapshotId,
  historySnapshotId: record.sourceHistorySnapshotId,
  operationVersion: record.sourceOperationVersion,
  draftRecordVersion: record.sourceDraftRecordVersion,
  draftSnapshotId: record.sourceDraftSnapshotId,
})

describe("MountedMediaRecoveryRepository", () => {
  it("persists one exact intent with a stable Recent key and rejects operation identity drift", async () => {
    const fixture = repository("stable-intent")
    const input = intent()
    const created = await fixture.value.createIntent(input)
    expect(created).toMatchObject({
      ok: true,
      status: "created",
      record: {
        revision: 1,
        status: "intent",
        recentUseIdempotencyKey: expect.stringMatching(
          /^mounted-recovery-use:[0-9a-f]{64}$/
        ),
      },
    })
    if (!created.ok) throw new Error("Expected mounted recovery intent")

    const replayed = await fixture.value.createIntent({
      ...input,
      createdAt: committedAt,
    })
    expect(replayed).toEqual({
      ok: true,
      status: "replayed",
      record: created.record,
    })
    for (const conflictedInput of [
      {
        ...input,
        expectedReferenceKeys: [
          "field:hero:current",
          "node:image-1",
          "node:image-2",
        ],
      },
      {
        ...input,
        preexistingTargetReferenceKeys: [
          "field:library:default",
          "node:already-managed",
        ],
      },
      { ...input, sourceDraftSnapshotId: sha("f") },
      {
        ...input,
        managedAssetId: "asset-mountedrecovery02",
        managedSource: "asset:managed/asset-mountedrecovery02" as const,
      },
    ]) {
      expect(await fixture.value.createIntent(conflictedInput)).toEqual({
        ok: false,
        reason: "operation_conflict",
        current: created.record,
      })
    }

    expect(
      await fixture.value.createIntent({
        ...intent("mounted-recovery-empty-target-baseline"),
        preexistingTargetReferenceKeys: [],
      })
    ).toMatchObject({
      ok: true,
      status: "created",
      record: { preexistingTargetReferenceKeys: [] },
    })
    for (const preexistingTargetReferenceKeys of [
      ["node:z", "node:a"],
      ["node:a", "node:a"],
      ["field:hero:current"],
    ]) {
      expect(
        await fixture.value.createIntent({
          ...intent(
            `mounted-recovery-invalid-target-${preexistingTargetReferenceKeys.join("-")}`
          ),
          preexistingTargetReferenceKeys,
        })
      ).toMatchObject({ ok: false, reason: "validation_failed" })
    }
  })

  it("durably prepares the exact pure history result before body persistence with replay, adoption, and conflict safety", async () => {
    const fixture = repository("history-prepared")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const checkpoint = historyCheckpoint()
    expect(
      await fixture.value.recordDocumentCommitted({
        operationId: created.record.operationId,
        expectedRevision: created.record.revision,
        documentCommit: documentCommit(),
        updatedAt: committedAt,
      })
    ).toEqual({
      ok: false,
      reason: "operation_conflict",
      current: created.record,
    })
    const prepared = await fixture.value.recordHistoryPrepared({
      operationId: created.record.operationId,
      expectedRevision: created.record.revision,
      historyCheckpoint: checkpoint,
      updatedAt: committedAt,
    })
    expect(prepared).toMatchObject({
      ok: true,
      status: "updated",
      record: {
        revision: 2,
        status: "history_prepared",
        historyCheckpoint: checkpoint,
        documentCommit: null,
      },
    })
    if (!prepared.ok) throw new Error("Expected durable history checkpoint")

    expect(
      await fixture.value.recordHistoryPrepared({
        operationId: created.record.operationId,
        expectedRevision: created.record.revision,
        historyCheckpoint: checkpoint,
        updatedAt: completedAt,
      })
    ).toEqual({ ok: true, status: "adopted", record: prepared.record })
    expect(
      await fixture.value.recordHistoryPrepared({
        operationId: created.record.operationId,
        expectedRevision: prepared.record.revision,
        historyCheckpoint: checkpoint,
        updatedAt: completedAt,
      })
    ).toEqual({ ok: true, status: "replayed", record: prepared.record })

    for (const drifted of [
      { ...checkpoint, resultContentSnapshotId: sha("9") },
      { ...checkpoint, resultHistorySnapshotId: "history-other-result" },
      { ...checkpoint, commitId: "history-commit-other-result" },
      { ...checkpoint, undoable: false },
    ]) {
      expect(
        await fixture.value.recordHistoryPrepared({
          operationId: created.record.operationId,
          expectedRevision: prepared.record.revision,
          historyCheckpoint: drifted,
          updatedAt: completedAt,
        })
      ).toEqual({
        ok: false,
        reason: "operation_conflict",
        current: prepared.record,
      })
    }

    for (const invalid of [
      {
        ...checkpoint,
        resultContentSnapshotId: created.record.sourceContentSnapshotId,
      },
      {
        ...checkpoint,
        resultHistorySnapshotId: created.record.sourceHistorySnapshotId,
      },
      {
        ...checkpoint,
        resultOperationVersion: created.record.sourceOperationVersion,
      },
      {
        ...checkpoint,
        resultOperationVersion: created.record.sourceOperationVersion + 2,
      },
    ]) {
      const other = await fixture.value.createIntent(
        intent(
          `history-prepared-invalid-${invalid.resultContentSnapshotId}-${invalid.resultOperationVersion}`
        )
      )
      if (!other.ok) throw new Error("Expected separate mounted intent")
      expect(
        await fixture.value.recordHistoryPrepared({
          operationId: other.record.operationId,
          expectedRevision: other.record.revision,
          historyCheckpoint: invalid,
          updatedAt: committedAt,
        })
      ).toMatchObject({ ok: false, reason: "validation_failed" })
    }

    const reopened = new MountedMediaRecoveryRepository({
      databaseName: fixture.databaseName,
      indexedDB,
    })
    expect(await reopened.get(prepared.record.operationId)).toEqual({
      ok: true,
      status: "found",
      record: prepared.record,
    })
  })

  it("survives reload after the durable document commit and resumes Recent without another relink", async () => {
    const fixture = repository("crash-after-document")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const committed = await commitIntent(fixture.value, created.record)

    const reopened = new MountedMediaRecoveryRepository({
      databaseName: fixture.databaseName,
      indexedDB,
    })
    expect(await reopened.get(committed.operationId)).toEqual({
      ok: true,
      status: "found",
      record: committed,
    })
    expect(await reopened.listPendingByDocument(committed.documentId)).toEqual({
      ok: true,
      records: [committed],
    })
    const completed = await completeIntent(reopened, committed)
    expect(completed).toMatchObject({
      status: "complete",
      documentCommit: committed.documentCommit,
      recentUseIdempotencyKey: committed.recentUseIdempotencyKey,
      recentReceipt: {
        requestId: `request-${committed.operationId}`,
        assetRevision: 19,
      },
    })
    expect(await reopened.listPendingByDocument(committed.documentId)).toEqual({
      ok: true,
      records: [],
    })
  })

  it("rejects cross-document, mixed-snapshot, and non-advanced durable receipts without mutating the intent", async () => {
    const fixture = repository("receipt-binding")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const prepared = await prepareIntent(fixture.value, created.record)
    const valid = documentCommit()
    const invalidReceipts: Array<
      readonly [MountedMediaRecoveryDocumentCommit, string]
    > = [
      [
        {
          ...valid,
          durable: { ...valid.durable, documentId: "document-another-head" },
        },
        "validation_failed",
      ],
      [
        {
          ...valid,
          durable: { ...valid.durable, contentSnapshotId: sha("e") },
        },
        "validation_failed",
      ],
      [
        {
          ...valid,
          resultOperationVersion: created.record.sourceOperationVersion,
        },
        "operation_conflict",
      ],
      [
        {
          ...valid,
          resultOperationVersion: created.record.sourceOperationVersion + 2,
        },
        "operation_conflict",
      ],
      [
        {
          ...valid,
          durable: {
            ...valid.durable,
            recordVersion: created.record.sourceDraftRecordVersion,
          },
        },
        "validation_failed",
      ],
      [
        {
          ...valid,
          durable: {
            ...valid.durable,
            recordVersion: created.record.sourceDraftRecordVersion + 2,
          },
        },
        "validation_failed",
      ],
      [
        {
          ...valid,
          durable: {
            ...valid.durable,
            draftSnapshotId: created.record.sourceDraftSnapshotId,
          },
        },
        "validation_failed",
      ],
      [
        {
          ...valid,
          resultContentSnapshotId: sha("9"),
          durable: { ...valid.durable, contentSnapshotId: sha("9") },
        },
        "operation_conflict",
      ],
    ]
    for (const [receipt, reason] of invalidReceipts) {
      expect(
        await fixture.value.recordDocumentCommitted({
          operationId: created.record.operationId,
          expectedRevision: prepared.revision,
          documentCommit: receipt,
          updatedAt: committedAt,
        })
      ).toMatchObject({ ok: false, reason })
      expect(await fixture.value.get(created.record.operationId)).toEqual({
        ok: true,
        status: "found",
        record: prepared,
      })
    }
    expect(
      await fixture.value.recordDocumentCommitted({
        operationId: created.record.operationId,
        expectedRevision: prepared.revision,
        documentCommit: valid,
        updatedAt: committedAt,
      })
    ).toMatchObject({ ok: true, status: "updated" })
  })

  it("replays the exact document and Recent receipts without advancing revision", async () => {
    const fixture = repository("transition-replay")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const commit = documentCommit()
    const committed = await commitIntent(fixture.value, created.record, commit)
    expect(
      await fixture.value.recordDocumentCommitted({
        operationId: committed.operationId,
        expectedRevision: created.record.revision,
        documentCommit: commit,
        updatedAt: completedAt,
      })
    ).toEqual({ ok: true, status: "replayed", record: committed })

    const recentInput = {
      operationId: committed.operationId,
      expectedRevision: committed.revision,
      idempotencyKey: committed.recentUseIdempotencyKey,
      requestId: "request-mounted-replay",
      usedAt: completedAt,
      assetRevision: 21,
      updatedAt: completedAt,
    }
    const completed = await fixture.value.recordRecentComplete(recentInput)
    if (!completed.ok) throw new Error("Expected managed Recent completion")
    expect(
      await fixture.value.recordRecentComplete({
        ...recentInput,
        expectedRevision: committed.revision,
      })
    ).toEqual({ ok: true, status: "replayed", record: completed.record })
  })

  it("adopts an equivalent document commit won by another tab and preserves its authoritative history receipt", async () => {
    const fixture = repository("commit-adoption")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const prepared = await prepareIntent(fixture.value, created.record)
    const firstCommit = documentCommit()
    const secondCommit: MountedMediaRecoveryDocumentCommit = {
      ...firstCommit,
      durable: {
        ...firstCommit.durable,
        savedAt: "2026-08-30T10:01:01.000Z",
      },
    }
    const results = await Promise.all([
      fixture.value.recordDocumentCommitted({
        operationId: created.record.operationId,
        expectedRevision: prepared.revision,
        documentCommit: firstCommit,
        updatedAt: firstCommit.durable.savedAt,
      }),
      fixture.value.recordDocumentCommitted({
        operationId: created.record.operationId,
        expectedRevision: prepared.revision,
        documentCommit: secondCommit,
        updatedAt: secondCommit.durable.savedAt,
      }),
    ])
    expect(
      results
        .map((result) => (result.ok ? result.status : result.reason))
        .sort()
    ).toEqual(["adopted", "updated"])
    if (!results[0].ok || !results[1].ok) {
      throw new Error("Expected one committed winner and one exact adoption")
    }
    expect(results[0].record).toEqual(results[1].record)
    expect(results[0].record).toMatchObject({
      revision: 3,
      status: "document_committed",
      recentUseIdempotencyKey: created.record.recentUseIdempotencyKey,
    })
  })

  it("records and adopts the same strictly later durable head while retaining prepared history evidence", async () => {
    const fixture = repository("observed-later-adoption")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const prepared = await prepareIntent(fixture.value, created.record)
    const firstObservation = observedLaterCommit()
    const secondObservation: MountedMediaRecoveryDocumentCommit = {
      ...firstObservation,
      durable: {
        ...firstObservation.durable,
        savedAt: "2026-08-30T10:01:01.000Z",
      },
    }
    const results = await Promise.all([
      fixture.value.recordDocumentCommitted({
        operationId: created.record.operationId,
        expectedRevision: prepared.revision,
        documentCommit: firstObservation,
        updatedAt: firstObservation.durable.savedAt,
      }),
      fixture.value.recordDocumentCommitted({
        operationId: created.record.operationId,
        expectedRevision: prepared.revision,
        documentCommit: secondObservation,
        updatedAt: secondObservation.durable.savedAt,
      }),
    ])
    expect(
      results
        .map((result) => (result.ok ? result.status : result.reason))
        .sort()
    ).toEqual(["adopted", "updated"])
    if (!results[0].ok || !results[1].ok) {
      throw new Error("Expected one observed winner and one exact adoption")
    }
    expect(results[0].record).toEqual(results[1].record)
    expect(results[0].record.documentCommit).toMatchObject({
      kind: "observed_later",
      commitId: historyCheckpoint().commitId,
      undoable: historyCheckpoint().undoable,
      resultContentSnapshotId: sha("e"),
      resultOperationVersion: created.record.sourceOperationVersion + 1,
      durable: {
        recordVersion: created.record.sourceDraftRecordVersion + 2,
      },
    })
    expect(results[0].record.historyCheckpoint).toMatchObject({
      resultContentSnapshotId: sha("c"),
    })
    expect(results[0].record.documentCommit?.resultContentSnapshotId).not.toBe(
      results[0].record.historyCheckpoint?.resultContentSnapshotId
    )
  })

  it("rejects observed-later receipts at the exact or older head and keeps exact receipts at plus one", async () => {
    const fixture = repository("observed-later-binding")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const prepared = await prepareIntent(fixture.value, created.record)
    const observed = observedLaterCommit()
    const exactAlreadyApplied: MountedMediaRecoveryDocumentCommit = {
      ...documentCommit(),
      kind: "already_applied",
    }
    const invalidReceipts: Array<
      readonly [MountedMediaRecoveryDocumentCommit, string]
    > = [
      [
        {
          ...observed,
          durable: {
            ...observed.durable,
            recordVersion: created.record.sourceDraftRecordVersion + 1,
          },
        },
        "validation_failed",
      ],
      [
        {
          ...observed,
          durable: {
            ...observed.durable,
            recordVersion: created.record.sourceDraftRecordVersion,
          },
        },
        "validation_failed",
      ],
      [
        {
          ...observed,
          resultOperationVersion: created.record.sourceOperationVersion,
        },
        "operation_conflict",
      ],
      [
        {
          ...observed,
          commitId: "history-commit-observed-later",
        },
        "operation_conflict",
      ],
      [
        {
          ...observed,
          undoable: false,
        },
        "operation_conflict",
      ],
      [
        {
          ...exactAlreadyApplied,
          resultOperationVersion: created.record.sourceOperationVersion + 2,
        },
        "operation_conflict",
      ],
      [
        {
          ...exactAlreadyApplied,
          durable: {
            ...exactAlreadyApplied.durable,
            recordVersion: created.record.sourceDraftRecordVersion + 2,
          },
        },
        "validation_failed",
      ],
    ]
    for (const [receipt, reason] of invalidReceipts) {
      expect(
        await fixture.value.recordDocumentCommitted({
          operationId: created.record.operationId,
          expectedRevision: prepared.revision,
          documentCommit: receipt,
          updatedAt: committedAt,
        })
      ).toMatchObject({ ok: false, reason })
    }
    expect(await fixture.value.get(created.record.operationId)).toEqual({
      ok: true,
      status: "found",
      record: prepared,
    })
    expect(
      await fixture.value.recordDocumentCommitted({
        operationId: created.record.operationId,
        expectedRevision: prepared.revision,
        documentCommit: exactAlreadyApplied,
        updatedAt: committedAt,
      })
    ).toMatchObject({ ok: true, status: "updated" })
  })

  it("terminalizes an unchanged precommit intent with exact replay and refuses stale or drifted dispositions", async () => {
    const fixture = repository("abandon")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const abandonInput = {
      operationId: created.record.operationId,
      expectedRevision: created.record.revision,
      source: sourceAnchor(created.record),
      code: "recovery_dismissed",
      message: "The unchanged recovery intent was dismissed.",
      requestId: null,
      updatedAt: committedAt,
    }
    const abandoned = await fixture.value.abandonPrecommitIntent(abandonInput)
    expect(abandoned).toMatchObject({
      ok: true,
      status: "updated",
      record: { revision: 2, status: "abandoned" },
    })
    if (!abandoned.ok) throw new Error("Expected abandoned disposition")
    expect(await fixture.value.abandonPrecommitIntent(abandonInput)).toEqual({
      ok: true,
      status: "replayed",
      record: abandoned.record,
    })
    expect(
      await fixture.value.listPendingByDocument(created.record.documentId)
    ).toEqual({ ok: true, records: [] })

    const preparedCreated = await fixture.value.createIntent(
      intent("mounted-recovery-operation-prepared-abandon")
    )
    if (!preparedCreated.ok)
      throw new Error("Expected prepared recovery intent")
    const prepared = await prepareIntent(fixture.value, preparedCreated.record)
    const abandonedPrepared = await fixture.value.abandonPrecommitIntent({
      ...abandonInput,
      operationId: prepared.operationId,
      expectedRevision: prepared.revision,
      source: sourceAnchor(prepared),
    })
    expect(abandonedPrepared).toMatchObject({
      ok: true,
      status: "updated",
      record: {
        status: "abandoned",
        historyCheckpoint: prepared.historyCheckpoint,
        documentCommit: null,
      },
    })
    expect(
      await fixture.value.listPendingByDocument(prepared.documentId)
    ).toEqual({ ok: true, records: [] })

    const staleCreated = await fixture.value.createIntent(
      intent("mounted-recovery-operation-stale")
    )
    if (!staleCreated.ok) throw new Error("Expected stale recovery intent")
    const retried = await fixture.value.markRetry({
      operationId: staleCreated.record.operationId,
      expectedRevision: staleCreated.record.revision,
      code: "draft_save_failed",
      message: "Retry the recovery operation.",
      requestId: null,
      updatedAt: committedAt,
    })
    if (!retried.ok) throw new Error("Expected retry checkpoint")
    expect(
      await fixture.value.abandonPrecommitIntent({
        ...abandonInput,
        operationId: staleCreated.record.operationId,
        expectedRevision: staleCreated.record.revision,
        source: sourceAnchor(staleCreated.record),
      })
    ).toEqual({
      ok: false,
      reason: "cas_conflict",
      current: retried.record,
    })
    expect(
      await fixture.value.abandonPrecommitIntent({
        ...abandonInput,
        operationId: staleCreated.record.operationId,
        expectedRevision: retried.record.revision,
        source: { ...sourceAnchor(staleCreated.record), operationVersion: 99 },
      })
    ).toEqual({
      ok: false,
      reason: "operation_conflict",
      current: retried.record,
    })
  })

  it("retains terminal conflicts as audit records without reopening them as pending", async () => {
    const fixture = repository("terminal-conflict")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const conflicted = await fixture.value.markConflict({
      operationId: created.record.operationId,
      expectedRevision: created.record.revision,
      code: "document_anchor_changed",
      message: "The exact mounted document anchor changed.",
      requestId: null,
      updatedAt: committedAt,
    })
    expect(conflicted).toMatchObject({
      ok: true,
      status: "updated",
      record: { status: "conflict" },
    })
    if (!conflicted.ok) throw new Error("Expected terminal conflict")
    expect(await fixture.value.get(created.record.operationId)).toEqual({
      ok: true,
      status: "found",
      record: conflicted.record,
    })
    expect(
      await fixture.value.listPendingByDocument(created.record.documentId)
    ).toEqual({ ok: true, records: [] })
  })

  it("keeps the local journal clock monotonic when an authoritative Recent timestamp is older", async () => {
    const fixture = repository("older-server-clock")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const commit = documentCommit("2026-08-30T10:03:00.000Z")
    const committed = await commitIntent(fixture.value, created.record, commit)
    const completed = await fixture.value.recordRecentComplete({
      operationId: committed.operationId,
      expectedRevision: committed.revision,
      idempotencyKey: committed.recentUseIdempotencyKey,
      requestId: "request-older-server-clock",
      usedAt: "2026-08-30T09:00:00.000Z",
      assetRevision: 22,
      updatedAt: "2026-08-30T09:00:00.000Z",
    })
    expect(completed).toMatchObject({
      ok: true,
      status: "updated",
      record: {
        status: "complete",
        updatedAt: committed.updatedAt,
        recentReceipt: { usedAt: "2026-08-30T09:00:00.000Z" },
      },
    })
  })

  it("uses revision CAS for retry and conflict transitions", async () => {
    const fixture = repository("cas")
    const created = await fixture.value.createIntent(intent())
    if (!created.ok) throw new Error("Expected mounted recovery intent")
    const retry = await fixture.value.markRetry({
      operationId: created.record.operationId,
      expectedRevision: created.record.revision,
      code: "draft_save_failed",
      message: "The durable draft write must be retried.",
      requestId: null,
      updatedAt: committedAt,
    })
    expect(retry).toMatchObject({
      ok: true,
      status: "updated",
      record: { revision: 2, status: "retry" },
    })
    if (!retry.ok) throw new Error("Expected retry checkpoint")
    expect(
      await fixture.value.markConflict({
        operationId: retry.record.operationId,
        expectedRevision: created.record.revision,
        code: "document_anchor_changed",
        message: "The mounted document anchor changed.",
        requestId: null,
        updatedAt: completedAt,
      })
    ).toEqual({
      ok: false,
      reason: "cas_conflict",
      current: retry.record,
    })
  })

  it("retains only the newest 64 completed receipts and never prunes pending work", async () => {
    const fixture = repository("retention")
    const completedIds: string[] = []
    for (let index = 0; index < 65; index += 1) {
      const at = new Date(Date.parse(createdAt) + index * 1_000).toISOString()
      const created = await fixture.value.createIntent(
        intent(
          `mounted-retention-${String(index).padStart(2, "0")}`,
          `document-retention-${String(index).padStart(2, "0")}`,
          at
        )
      )
      if (!created.ok) throw new Error("Expected retention intent")
      const committed = await commitIntent(
        fixture.value,
        created.record,
        documentCommit(at, created.record.documentId)
      )
      await completeIntent(fixture.value, committed, at)
      completedIds.push(created.record.operationId)
    }
    expect(await fixture.value.get(completedIds[0])).toEqual({
      ok: true,
      status: "missing",
    })
    expect(await fixture.value.get(completedIds[1])).toMatchObject({
      ok: true,
      status: "found",
      record: { status: "complete" },
    })

    const pending = await fixture.value.createIntent(
      intent("mounted-retention-pending", "document-retention-pending")
    )
    if (!pending.ok) throw new Error("Expected pending retention intent")
    expect(
      await fixture.value.listPendingByDocument(pending.record.documentId)
    ).toEqual({ ok: true, records: [pending.record] })
  })

  it("quarantines malformed indexed records and reports corruption explicitly", async () => {
    const fixture = repository("quarantine")
    expect(await fixture.value.get("initialize-recovery-store")).toEqual({
      ok: true,
      status: "missing",
    })
    const database = await openDatabase(fixture.databaseName)
    const transaction = database.transaction(
      MOUNTED_MEDIA_RECOVERY_STORE_NAME,
      "readwrite"
    )
    const done = transactionDone(transaction)
    transaction.objectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME).put({
      operationId: "mounted-corrupt-operation",
      documentId: "document-corrupt-recovery",
      status: "intent",
      updatedAt: createdAt,
    })
    transaction.objectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME).put({
      operationId: "mounted-corrupt-read",
      documentId: "document-corrupt-read",
      status: "intent",
      updatedAt: createdAt,
    })
    await done
    database.close()

    const listed = await fixture.value.listPendingByDocument(
      "document-corrupt-recovery"
    )
    expect(listed).toMatchObject({
      ok: false,
      reason: "corrupt_record",
      quarantineIds: ["mounted-recovery-quarantine-quarantine-1"],
    })
    expect(await fixture.value.get("mounted-corrupt-operation")).toEqual({
      ok: true,
      status: "missing",
    })
    expect(await fixture.value.get("mounted-corrupt-read")).toMatchObject({
      ok: false,
      reason: "corrupt_record",
      quarantineId: "mounted-recovery-quarantine-quarantine-2",
    })

    const quarantinedDatabase = await openDatabase(fixture.databaseName)
    const quarantinedTransaction = quarantinedDatabase.transaction(
      MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME
    )
    const quarantineDone = transactionDone(quarantinedTransaction)
    const quarantineCount = await requestResult(
      quarantinedTransaction
        .objectStore(MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME)
        .count()
    )
    await quarantineDone
    quarantinedDatabase.close()
    expect(quarantineCount).toBe(2)
  })
})
