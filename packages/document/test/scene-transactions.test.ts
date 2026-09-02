import { describe, expect, it } from "vitest"
import {
  deriveDocumentSnapshotId,
  documentSchema,
  executeSceneTransaction,
  northstarSeed,
  SCENE_TRANSACTION_RECEIPT_LIMIT,
  SceneTransactionExecutor,
  type SceneTransaction,
} from "../src"
import { projectPagePaintPlan } from "../src/page-paint-plan"

const transaction = (
  overrides: Partial<SceneTransaction> = {}
): SceneTransaction => ({
  version: 1,
  id: "transaction-canvas-1",
  idempotencyKey: "canvas-1",
  title: "Move and rename cover title",
  mode: "preview",
  expected: {
    documentId: northstarSeed.id,
    revision: northstarSeed.revision,
    snapshotId: "snapshot-canvas-1",
    operationVersion: 4,
  },
  commands: [
    {
      id: "command-move-title",
      type: "update_node",
      actor: "agent",
      at: "2026-09-02T08:00:00.000Z",
      nodeId: "cover-title",
      patch: { x: 120 },
    },
    {
      id: "command-rename-title",
      type: "update_node",
      actor: "agent",
      at: "2026-09-02T08:00:01.000Z",
      nodeId: "cover-title",
      patch: { name: "Automated cover title" },
    },
  ],
  ...overrides,
})

const context = () => ({
  document: structuredClone(northstarSeed),
  snapshotId: "snapshot-canvas-1",
  operationVersion: 4,
})

describe("scene transactions", () => {
  it("preflights a multi-command candidate without mutating its source", () => {
    const source = context()
    const before = structuredClone(source.document)
    const result = executeSceneTransaction(source, transaction())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe("preview_ready")
    expect(result.commandCount).toBe(2)
    expect(result.result.revision).toBe(northstarSeed.revision + 2)
    expect(
      result.document.nodes.find((node) => node.id === "cover-title")
    ).toMatchObject({ x: 120, name: "Automated cover title" })
    expect(
      result.document.sceneTransactionMetadata?.receipts.some(
        (receipt) => receipt.idempotencyKey === "canvas-1"
      )
    ).not.toBe(true)
    expect(source.document).toEqual(before)
  })

  it("rejects stale identity before applying any command", () => {
    const source = context()
    const result = executeSceneTransaction(
      source,
      transaction({
        expected: {
          ...transaction().expected,
          revision: northstarSeed.revision + 1,
        },
      })
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: "revision_mismatch" },
      document: source.document,
    })
  })

  it("rolls back the complete candidate when a later command fails", () => {
    const source = context()
    const request = transaction({
      commands: [
        transaction().commands[0]!,
        {
          id: "command-missing-node",
          type: "remove_node",
          actor: "agent",
          at: "2026-09-02T08:00:01.000Z",
          nodeId: "node-that-does-not-exist",
        },
      ],
    })
    const result = executeSceneTransaction(source, request)

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "command_failed",
        commandIndex: 1,
        commandId: "command-missing-node",
      },
      document: source.document,
    })
    expect(
      source.document.nodes.find((node) => node.id === "cover-title")?.x
    ).not.toBe(120)
  })

  it("replays the same idempotent request and rejects key reuse", () => {
    const executor = new SceneTransactionExecutor()
    const first = executor.execute(context(), transaction())
    const replay = executor.execute(context(), transaction())
    const conflict = executor.execute(
      context(),
      transaction({ title: "A different transaction" })
    )

    expect(first).toMatchObject({ ok: true, replayed: false })
    expect(replay).toMatchObject({ ok: true, replayed: true })
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "idempotency_key_reused" },
    })
    expect(executor.size).toBe(1)
  })

  it("persists commit replay protection through canonical JSON reload", async () => {
    const request = transaction({ mode: "commit" })
    const first = executeSceneTransaction(context(), request)

    expect(first).toMatchObject({ ok: true, replayed: false, changed: true })
    if (!first.ok) return
    expect(first.document.sceneTransactionMetadata).toMatchObject({
      schemaVersion: 1,
      receipts: [
        { idempotencyKey: "canvas-1", requestHash: first.requestHash },
      ],
    })

    const reloadedDocument = documentSchema.parse(
      JSON.parse(JSON.stringify(first.document))
    )
    const withoutReceipt = {
      ...reloadedDocument,
      sceneTransactionMetadata: undefined,
    }
    expect(await deriveDocumentSnapshotId(reloadedDocument)).not.toBe(
      await deriveDocumentSnapshotId(withoutReceipt)
    )
    expect(reloadedDocument.revision).toBe(withoutReceipt.revision)
    expect(
      projectPagePaintPlan(reloadedDocument, reloadedDocument.pages[0]!.id)
    ).toEqual(projectPagePaintPlan(withoutReceipt, withoutReceipt.pages[0]!.id))

    const reloaded = {
      document: reloadedDocument,
      snapshotId: "snapshot-after-reload",
      operationVersion: 5,
    }
    const replay = executeSceneTransaction(reloaded, request)
    expect(replay).toMatchObject({
      ok: true,
      status: "committed",
      replayed: true,
      changed: false,
      document: reloaded.document,
    })
    expect(replay.document.revision).toBe(first.document.revision)

    const conflict = executeSceneTransaction(
      reloaded,
      transaction({ mode: "commit", title: "Different payload" })
    )
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "idempotency_key_reused" },
      document: reloaded.document,
    })
  })

  it("prunes the shared operational receipt ledger to its schema bound", () => {
    let current = context()

    for (let index = 0; index < SCENE_TRANSACTION_RECEIPT_LIMIT + 2; index++) {
      const identity = `bounded-${index}`
      const result = executeSceneTransaction(
        current,
        transaction({
          id: `transaction-${identity}`,
          idempotencyKey: identity,
          title: `Bounded transaction ${index}`,
          mode: "commit",
          expected: {
            documentId: current.document.id,
            revision: current.document.revision,
            snapshotId: current.snapshotId,
            operationVersion: current.operationVersion,
          },
          commands: [
            {
              id: `command-${identity}`,
              type: "update_node",
              actor: "agent",
              at: "2026-09-02T08:00:00.000Z",
              nodeId: "cover-title",
              patch: { x: 200 + index },
            },
          ],
        })
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      current = {
        document: result.document,
        snapshotId: `snapshot-${identity}`,
        operationVersion: result.result.operationVersion,
      }
    }

    expect(current.document.sceneTransactionMetadata?.receipts).toHaveLength(
      SCENE_TRANSACTION_RECEIPT_LIMIT
    )
    expect(
      current.document.sceneTransactionMetadata?.receipts[0]?.idempotencyKey
    ).toBe("bounded-2")
    expect(
      current.document.sceneTransactionMetadata?.receipts.at(-1)?.idempotencyKey
    ).toBe(`bounded-${SCENE_TRANSACTION_RECEIPT_LIMIT + 1}`)
  })

  it("returns a structured failure for non-JSON input", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(executeSceneTransaction(context(), circular)).toMatchObject({
      ok: false,
      error: {
        code: "invalid_transaction",
        message: "The transaction must be serializable JSON data.",
      },
    })
  })
})
