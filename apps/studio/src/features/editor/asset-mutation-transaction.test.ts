import { describe, expect, it } from "vitest"
import type { Document } from "@webmcp/document"
import { commitCommands, createDocumentHistory } from "@webmcp/editor/history"
import { quotationStarter } from "./quotation-starter"
import {
  captureAddAssetAnchor,
  captureReplaceAssetAnchor,
  executeAssetMutation,
} from "./asset-mutation-transaction"
import type { AssetMutationState } from "./asset-mutation-transaction"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function documentWithImage(): Document {
  const document = structuredClone(quotationStarter.document)
  const page = document.pages[0]
  document.nodes.push({
    id: "transaction-image",
    type: "image",
    name: "Transaction image",
    assetId: "asset-original",
    src: "asset:local/asset-original",
    alt: "Original",
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    decorative: false,
    x: 20,
    y: 20,
    width: 200,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    constraints: { horizontal: "min", vertical: "min" },
  })
  page.nodeIds.push("transaction-image")
  return document
}

function stateFor(document = documentWithImage()): AssetMutationState {
  return {
    snapshotId: "snapshot-initial",
    document,
    activePageId: document.pages[0]?.id ?? "missing-page",
    reviewPending: false,
    recoveryPending: false,
  }
}

describe("asset mutation transaction", () => {
  it("stops after paused decode when review starts and never persists", async () => {
    let state = stateFor()
    const anchor = captureAddAssetAnchor(state)
    if (!anchor) throw new Error("Add anchor is unavailable")
    const decode = deferred<{ width: number; height: number }>()
    const events: string[] = []
    const transaction = executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: () => decode.promise,
      persist: async () => {
        events.push("persist")
      },
      rollback: async () => {
        events.push("rollback")
      },
      commit: () => {
        events.push("commit")
        return true
      },
    })

    state = { ...state, reviewPending: true }
    decode.resolve({ width: 100, height: 80 })

    await expect(transaction).resolves.toEqual({
      status: "aborted",
      reason: "review_started",
    })
    expect(events).toEqual([])
  })

  it("rolls back a staged asset when the page changes during persistence", async () => {
    let state = stateFor()
    const anchor = captureAddAssetAnchor(state)
    if (!anchor) throw new Error("Add anchor is unavailable")
    const storage = deferred<void>()
    const persistenceStarted = deferred<void>()
    const events: string[] = []
    const transaction = executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => ({ width: 100, height: 80 }),
      persist: async () => {
        events.push("persist:start")
        persistenceStarted.resolve()
        await storage.promise
        events.push("persist:complete")
      },
      rollback: async () => {
        events.push("rollback")
      },
      commit: () => {
        events.push("commit")
        return true
      },
    })

    await persistenceStarted.promise
    state = {
      ...state,
      activePageId: state.document.pages[1]?.id ?? "another-page",
    }
    storage.resolve()

    await expect(transaction).resolves.toEqual({
      status: "aborted",
      reason: "page_changed",
    })
    expect(events).toEqual(["persist:start", "persist:complete", "rollback"])
  })

  it("revalidates the replacement target and removes its staged asset", async () => {
    let state = stateFor()
    const anchor = captureReplaceAssetAnchor(state, "transaction-image")
    if (!anchor) throw new Error("Replacement anchor is unavailable")
    const storage = deferred<void>()
    const persistenceStarted = deferred<void>()
    let staged = false
    let commits = 0
    const transaction = executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => ({ width: 100, height: 80 }),
      persist: async () => {
        staged = true
        persistenceStarted.resolve()
        await storage.promise
      },
      rollback: async () => {
        staged = false
      },
      commit: () => {
        commits += 1
        return true
      },
    })

    await persistenceStarted.promise
    const document = structuredClone(state.document)
    document.nodes = document.nodes.filter(
      (node) => node.id !== "transaction-image"
    )
    document.pages = document.pages.map((page) => ({
      ...page,
      nodeIds: page.nodeIds.filter((nodeId) => nodeId !== "transaction-image"),
    }))
    state = { ...state, snapshotId: "snapshot-after-delete", document }
    storage.resolve()

    const result = await transaction
    expect(result).toEqual({ status: "aborted", reason: "target_changed" })
    expect(staged).toBe(false)
    expect(commits).toBe(0)
  })

  it("rolls back when document replacement invalidates the captured snapshot", async () => {
    let state = stateFor()
    const anchor = captureAddAssetAnchor(state)
    if (!anchor) throw new Error("Add anchor is unavailable")
    const storage = deferred<void>()
    const persistenceStarted = deferred<void>()
    let staged = false
    const transaction = executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => ({ width: 100, height: 80 }),
      persist: async () => {
        staged = true
        persistenceStarted.resolve()
        await storage.promise
      },
      rollback: async () => {
        staged = false
      },
      commit: () => true,
    })

    await persistenceStarted.promise
    const replacement = structuredClone(state.document)
    replacement.id = "replacement-document"
    state = {
      ...state,
      snapshotId: "snapshot-replacement",
      document: replacement,
    }
    storage.resolve()

    await expect(transaction).resolves.toEqual({
      status: "aborted",
      reason: "document_changed",
    })
    expect(staged).toBe(false)
  })

  it("cleans persistence when a synchronous document commit rejects", async () => {
    const state = stateFor()
    const anchor = captureAddAssetAnchor(state)
    if (!anchor) throw new Error("Add anchor is unavailable")
    const events: string[] = []
    const result = await executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => {
        events.push("decode")
        return { width: 100, height: 80 }
      },
      persist: async () => {
        events.push("persist")
      },
      rollback: async () => {
        events.push("rollback")
      },
      commit: () => {
        events.push("commit")
        return false
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      reason: "commit_rejected",
    })
    expect(events).toEqual(["decode", "persist", "commit", "rollback"])
  })

  it("rolls back persistence and skips canonical commit when source activation fails", async () => {
    const originalDocument = documentWithImage()
    let history = createDocumentHistory(originalDocument, "snapshot-initial")
    const state = stateFor(history.document)
    const anchor = captureReplaceAssetAnchor(state, "transaction-image")
    if (!anchor) throw new Error("Replacement anchor is unavailable")
    const events: string[] = []
    const result = await executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => {
        events.push("decode:file")
        return { width: 100, height: 80 }
      },
      persist: async () => {
        events.push("persist")
      },
      activate: async () => {
        events.push("decode:source")
        throw new Error("renderer source rejected")
      },
      rollback: async () => {
        events.push("rollback")
      },
      commit: () => {
        events.push("commit")
        history = commitCommands(history, [
          {
            id: "replace-transaction-image",
            type: "replace_image_source",
            actor: "human",
            at: "2026-08-28T12:00:00.000Z",
            nodeId: "transaction-image",
            assetId: "asset-replacement",
            src: "asset:local/asset-replacement",
          },
        ])
        return true
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      reason: "source_failed",
    })
    expect(events).toEqual([
      "decode:file",
      "persist",
      "decode:source",
      "rollback",
    ])
    expect(history.document).toBe(originalDocument)
    expect(history.snapshotId).toBe("snapshot-initial")
    expect(history.past).toEqual([])
    expect(history.future).toEqual([])
    expect(history.operationVersion).toBe(0)
  })

  it("activates the exact source before committing one replacement", async () => {
    const state = stateFor()
    const anchor = captureReplaceAssetAnchor(state, "transaction-image")
    if (!anchor) throw new Error("Replacement anchor is unavailable")
    const events: string[] = []
    const result = await executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => {
        events.push("decode:file")
        return { width: 100, height: 80 }
      },
      persist: async () => {
        events.push("persist")
      },
      activate: async () => {
        events.push("decode:source")
      },
      rollback: async () => {
        events.push("rollback")
      },
      commit: () => {
        events.push("commit")
        return true
      },
    })

    expect(result.status).toBe("committed")
    expect(events).toEqual([
      "decode:file",
      "persist",
      "decode:source",
      "commit",
    ])
  })

  it("returns only after commit so callers cannot create an object URL early", async () => {
    const state = stateFor()
    const anchor = captureAddAssetAnchor(state)
    if (!anchor) throw new Error("Add anchor is unavailable")
    const events: string[] = []
    const result = await executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => {
        events.push("decode")
        return { width: 100, height: 80 }
      },
      persist: async () => {
        events.push("persist")
      },
      rollback: async () => {
        events.push("rollback")
      },
      commit: () => {
        events.push("commit")
        return true
      },
    })
    if (result.status === "committed") events.push("object-url")

    expect(result.status).toBe("committed")
    expect(events).toEqual(["decode", "persist", "commit", "object-url"])
  })

  it("does not attempt document commit when the atomic storage transaction fails", async () => {
    const state = stateFor()
    const anchor = captureAddAssetAnchor(state)
    if (!anchor) throw new Error("Add anchor is unavailable")
    let commits = 0
    let rollbacks = 0
    const result = await executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => ({ width: 100, height: 80 }),
      persist: async () => {
        throw new Error("quota")
      },
      rollback: async () => {
        rollbacks += 1
      },
      commit: () => {
        commits += 1
        return true
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      reason: "persist_failed",
    })
    expect(commits).toBe(0)
    expect(rollbacks).toBe(0)
  })

  it("reports cleanup failure instead of claiming a staged asset was removed", async () => {
    const state = stateFor()
    const anchor = captureAddAssetAnchor(state)
    if (!anchor) throw new Error("Add anchor is unavailable")
    const result = await executeAssetMutation({
      anchor,
      readState: () => state,
      prepare: async () => ({ width: 100, height: 80 }),
      persist: async () => undefined,
      rollback: async () => {
        throw new Error("database offline")
      },
      commit: () => false,
    })

    expect(result).toMatchObject({
      status: "failed",
      reason: "rollback_failed",
    })
  })
})
