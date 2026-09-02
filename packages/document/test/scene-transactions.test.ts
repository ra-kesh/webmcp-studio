import { describe, expect, it } from "vitest"
import {
  executeSceneTransaction,
  northstarSeed,
  SceneTransactionExecutor,
  type SceneTransaction,
} from "../src"

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
