import { northstarSeed, type SceneTransaction } from "@webmcp/document"
import { describe, expect, it } from "vitest"
import { createDocumentHistory, undoDocument } from "../src/history"
import { commitSceneTransaction } from "../src/scene-transactions"

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
    expect(result.commit.label).toBe(request.title)
    expect(result.transaction.result.snapshotId).toBe(result.history.snapshotId)
    expect(result.history.document.revision).toBe(history.document.revision + 2)
    expect(undoDocument(result.history).document).toEqual(history.document)
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
})
