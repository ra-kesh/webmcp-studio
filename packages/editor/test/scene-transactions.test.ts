import { northstarSeed, type SceneTransaction } from "@webmcp/document"
import { describe, expect, it } from "vitest"
import { createDocumentHistory, undoDocument } from "../src/history"
import {
  commitSceneTransaction,
  sceneTransactionForHistory,
  sceneTransactionToChangeSet,
} from "../src/scene-transactions"

describe("editor scene transactions", () => {
  it("commits several canonical commands as one undo entry", () => {
    const history = createDocumentHistory(
      structuredClone(northstarSeed),
      "snapshot-editor-transaction"
    )
    const request: SceneTransaction = {
      version: 1,
      id: "transaction-editor-1",
      idempotencyKey: "editor-1",
      title: "Update cover title",
      mode: "commit",
      expected: {
        documentId: history.document.id,
        revision: history.document.revision,
        snapshotId: history.snapshotId,
        operationVersion: history.operationVersion,
      },
      commands: [
        {
          id: "command-editor-move",
          type: "update_node",
          actor: "human",
          at: "2026-09-02T08:00:00.000Z",
          nodeId: "cover-title",
          patch: { x: 140 },
        },
        {
          id: "command-editor-rename",
          type: "update_node",
          actor: "human",
          at: "2026-09-02T08:00:01.000Z",
          nodeId: "cover-title",
          patch: { name: "Committed cover title" },
        },
      ],
    }

    const result = commitSceneTransaction(history, request)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.history.past).toHaveLength(1)
    expect(result.commit?.label).toBe(request.title)
    expect(result.transaction.result.snapshotId).toBe(result.history.snapshotId)
    expect(result.history.document.revision).toBe(history.document.revision + 2)
    expect(
      result.history.document.sceneTransactionMetadata?.receipts
    ).toContainEqual({
      idempotencyKey: "editor-1",
      requestHash: result.transaction.requestHash,
    })
    expect(undoDocument(result.history).document).toEqual(history.document)
  })

  it("does not add an undo entry when a persisted commit is replayed", () => {
    const history = createDocumentHistory(
      structuredClone(northstarSeed),
      "snapshot-editor-replay"
    )
    const request = sceneTransactionForHistory(
      history,
      [
        {
          id: "command-editor-replay",
          type: "update_node",
          actor: "agent",
          at: "2026-09-02T08:00:00.000Z",
          nodeId: "cover-title",
          patch: { x: 210 },
        },
      ],
      { identity: "editor-replay", idempotencyKey: "editor-replay" }
    )
    const first = commitSceneTransaction(history, request)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const replay = commitSceneTransaction(first.history, request)
    expect(replay).toMatchObject({
      ok: true,
      commit: null,
      history: first.history,
      transaction: { replayed: true, changed: false },
    })
    expect(replay.history.past).toHaveLength(1)
  })

  it("leaves history untouched when transaction preflight fails", () => {
    const history = createDocumentHistory(
      structuredClone(northstarSeed),
      "snapshot-editor-rollback"
    )
    const request: SceneTransaction = {
      version: 1,
      id: "transaction-editor-failure",
      idempotencyKey: "editor-failure",
      title: "Broken transaction",
      mode: "commit",
      expected: {
        documentId: history.document.id,
        revision: history.document.revision,
        snapshotId: history.snapshotId,
        operationVersion: history.operationVersion,
      },
      commands: [
        {
          id: "command-editor-valid",
          type: "update_node",
          actor: "human",
          at: "2026-09-02T08:00:00.000Z",
          nodeId: "cover-title",
          patch: { x: 160 },
        },
        {
          id: "command-editor-invalid",
          type: "remove_node",
          actor: "human",
          at: "2026-09-02T08:00:01.000Z",
          nodeId: "missing-node",
        },
      ],
    }

    const result = commitSceneTransaction(history, request)

    expect(result).toMatchObject({
      ok: false,
      history,
      transaction: { error: { commandIndex: 1 } },
    })
    expect(result.history).toBe(history)
  })

  it("does not commit preview or review transactions", () => {
    const history = createDocumentHistory(
      structuredClone(northstarSeed),
      "snapshot-editor-preview"
    )
    const request: SceneTransaction = {
      version: 1,
      id: "transaction-editor-preview",
      idempotencyKey: "editor-preview",
      title: "Preview cover title",
      mode: "preview",
      expected: {
        documentId: history.document.id,
        revision: history.document.revision,
        snapshotId: history.snapshotId,
        operationVersion: history.operationVersion,
      },
      commands: [
        {
          id: "command-editor-preview",
          type: "update_node",
          actor: "human",
          at: "2026-09-02T08:00:00.000Z",
          nodeId: "cover-title",
          patch: { x: 180 },
        },
      ],
    }

    const result = commitSceneTransaction(history, request)

    expect(result).toMatchObject({
      ok: false,
      transaction: { error: { code: "invalid_transaction" } },
    })
    expect(result.history).toBe(history)
  })

  it("builds a transaction from the exact current history identity", () => {
    const history = createDocumentHistory(
      structuredClone(northstarSeed),
      "snapshot-editor-builder"
    )
    const commands: SceneTransaction["commands"] = [
      {
        id: "command-editor-builder",
        type: "update_node",
        actor: "human",
        at: "2026-09-02T08:00:00.000Z",
        nodeId: "cover-title",
        patch: { x: 200 },
      },
    ]

    expect(
      sceneTransactionForHistory(history, commands, {
        identity: "builder-1",
      })
    ).toMatchObject({
      id: "transaction-builder-1",
      idempotencyKey: "editor:builder-1",
      title: "Update layer",
      mode: "commit",
      expected: {
        documentId: history.document.id,
        revision: history.document.revision,
        snapshotId: history.snapshotId,
        operationVersion: history.operationVersion,
      },
      commands,
    })
  })

  it("projects a review transaction without translating its commands", () => {
    const history = createDocumentHistory(
      structuredClone(northstarSeed),
      "snapshot-editor-review"
    )
    const request = sceneTransactionForHistory(
      history,
      [
        {
          id: "command-editor-review",
          type: "update_node",
          actor: "agent",
          at: "2026-09-02T08:00:00.000Z",
          nodeId: "cover-title",
          patch: { x: 240 },
        },
      ],
      { identity: "editor-review", mode: "review" }
    )

    const changeSet = sceneTransactionToChangeSet(
      request,
      "2026-09-02T08:00:01.000Z"
    )
    expect(changeSet).toMatchObject({
      id: request.id,
      documentId: request.expected.documentId,
      baseRevision: request.expected.revision,
      baseSnapshotId: request.expected.snapshotId,
      title: request.title,
      operations: [{ command: request.commands[0] }],
    })
    expect(changeSet.operations[0]?.command).toEqual(request.commands[0])
  })
})
