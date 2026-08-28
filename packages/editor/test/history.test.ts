import {
  applyQuotationTemplate,
  captureSemanticFragment,
  cloneSemanticFragment,
  composeQuotationDocument,
  northstarSeed,
  northstarQuotationPayload,
  renderConformanceDocument,
} from "@webmcp/document"
import { describe, expect, it } from "vitest"
import {
  commitCommands,
  createDocumentHistory,
  HISTORY_COALESCE_WINDOW_MS,
  HISTORY_LIMIT,
  redoDocument,
  replaceDocument,
  undoDocument,
} from "../src/history"

const updateTitleX = (id: string, x: number) => ({
  id,
  type: "update_node" as const,
  actor: "human" as const,
  at: "2026-08-26T09:30:00.000Z",
  nodeId: "cover-title",
  patch: { x },
})

describe("document history", () => {
  it("replaces one image source as one named exact undo step", () => {
    const image = renderConformanceDocument.nodes.find(
      (node) => node.id === "image-cover"
    )!
    if (image.type !== "image") throw new Error("Expected image fixture")
    const initial = createDocumentHistory(renderConformanceDocument)
    const changed = commitCommands(initial, [
      {
        id: "replace-image",
        type: "replace_image_source",
        actor: "human",
        at: "2026-08-28T12:00:00.000Z",
        nodeId: image.id,
        assetId: "asset-replacement",
        src: "https://cdn.example.com/replacement.jpg",
      },
    ])

    expect(changed.past).toHaveLength(1)
    expect(changed.past[0]?.label).toBe("Replace image")
    expect(changed.document.nodes.find((node) => node.id === image.id)).toEqual(
      {
        ...image,
        assetId: "asset-replacement",
        src: "https://cdn.example.com/replacement.jpg",
      }
    )
    expect(undoDocument(changed).document).toEqual(renderConformanceDocument)
    expect(redoDocument(undoDocument(changed)).document).toEqual(
      changed.document
    )
  })

  it("groups a batch of renderer changes into one undo step", () => {
    const initial = createDocumentHistory(northstarSeed)
    const changed = commitCommands(initial, [
      {
        id: "move-one",
        type: "update_node",
        actor: "human",
        at: "2026-08-26T09:30:00.000Z",
        nodeId: "cover-title",
        patch: { x: 100 },
      },
      {
        id: "move-two",
        type: "update_node",
        actor: "human",
        at: "2026-08-26T09:30:00.001Z",
        nodeId: "cover-date",
        patch: { x: 100 },
      },
    ])

    expect(changed.past).toHaveLength(1)
    const undone = undoDocument(changed)
    expect(undone.document).toEqual(northstarSeed)
    expect(redoDocument(undone).document).toEqual(changed.document)
  })

  it("deletes a field and every binding as one exact undo and redo step", () => {
    const initial = createDocumentHistory(northstarSeed)
    const changed = commitCommands(initial, [
      {
        id: "delete-package-price",
        type: "remove_field",
        actor: "human",
        at: "2026-08-28T01:00:00.000Z",
        fieldId: "package_price",
      },
    ])

    expect(changed.past).toHaveLength(1)
    expect(changed.past[0]?.label).toBe("Delete field")
    expect(
      changed.document.fields.some((field) => field.id === "package_price")
    ).toBe(false)
    expect(changed.document.fieldValues.package_price).toBeUndefined()
    expect(
      changed.document.bindings.some(
        (binding) => binding.fieldId === "package_price"
      )
    ).toBe(false)

    const undone = undoDocument(changed)
    expect(undone.document).toEqual(northstarSeed)
    expect(redoDocument(undone).document).toEqual(changed.document)
  })

  it("duplicates a bound page as one exact undo and redo step", () => {
    const initial = createDocumentHistory(northstarSeed)
    const sourcePage = northstarSeed.pages.find((page) => page.id === "cover")!
    const fragment = captureSemanticFragment(
      northstarSeed,
      sourcePage.id,
      sourcePage.nodeIds
    )
    const clone = cloneSemanticFragment(fragment, {
      targetPageId: "cover-copy",
      createId: (kind, sourceId) => `${kind}-copy-${sourceId}`,
    })
    const changed = commitCommands(initial, [
      {
        id: "duplicate-cover",
        type: "duplicate_page",
        actor: "human",
        at: "2026-08-28T01:00:00.000Z",
        outputId: sourcePage.outputId,
        page: {
          ...sourcePage,
          id: "cover-copy",
          name: "Cover copy",
          nodeIds: clone.nodeIds,
        },
        nodes: clone.nodes,
        groups: clone.groups,
        bindings: clone.bindings,
      },
    ])

    expect(changed.past).toHaveLength(1)
    expect(changed.past[0]?.label).toBe("Duplicate page")
    expect(changed.document.bindings).toHaveLength(
      northstarSeed.bindings.length + clone.bindings.length
    )

    const undone = undoDocument(changed)
    expect(undone.document).toEqual(northstarSeed)
    expect(redoDocument(undone).document).toEqual(changed.document)
  })

  it("duplicates a bound selection as one exact undo step", () => {
    const initial = createDocumentHistory(northstarSeed)
    const fragment = captureSemanticFragment(northstarSeed, "cover", [
      "cover-title",
      "cover-date",
    ])
    const clone = cloneSemanticFragment(fragment, {
      targetPageId: "cover",
      offsetX: 24,
      offsetY: 24,
      createId: (kind, sourceId) => `${kind}-selection-copy-${sourceId}`,
    })
    const changed = commitCommands(initial, [
      {
        id: "duplicate-cover-selection",
        type: "duplicate_nodes",
        actor: "human",
        at: "2026-08-28T01:00:00.000Z",
        pageId: "cover",
        nodes: clone.nodes,
        groups: clone.groups,
        bindings: clone.bindings,
      },
    ])

    expect(changed.past).toHaveLength(1)
    expect(changed.past[0]?.label).toBe("Duplicate layers")
    expect(clone.bindings).toHaveLength(2)
    expect(undoDocument(changed).document).toEqual(northstarSeed)
  })

  it("imports a replacement document as one undoable change", () => {
    const initial = createDocumentHistory(northstarSeed)
    const imported = {
      ...northstarSeed,
      id: "imported-document",
      name: "Imported document",
    }
    const changed = replaceDocument(initial, imported)

    expect(changed.document).toEqual(imported)
    expect(changed.future).toEqual([])
    expect(undoDocument(changed).document).toEqual(northstarSeed)
  })

  it("applies a quotation theme as one named undo and redo step", () => {
    const document = composeQuotationDocument(
      northstarQuotationPayload,
      "editorial-olive"
    )
    const initial = createDocumentHistory(document)
    const themed = applyQuotationTemplate(
      document,
      "editorial-olive",
      "midnight-film",
      { now: "2026-08-28T12:00:00.000Z" }
    )
    const changed = replaceDocument(initial, themed, {
      label: "Apply Midnight Film theme",
    })

    expect(changed.past).toHaveLength(1)
    expect(changed.past[0]?.label).toBe("Apply Midnight Film theme")
    expect(undoDocument(changed).document).toEqual(document)
    expect(redoDocument(undoDocument(changed)).document).toEqual(themed)
  })

  it("records a named snapshot and advances the operation version", () => {
    const initial = createDocumentHistory(northstarSeed, "snapshot-initial")
    const changed = commitCommands(initial, [updateTitleX("move-title", 100)], {
      label: "Move selection",
      committedAt: 100,
    })

    expect(changed.snapshotId).toBe("snapshot-move-title")
    expect(changed.operationVersion).toBe(1)
    expect(changed.past).toEqual([
      expect.objectContaining({
        label: "Move selection",
        beforeSnapshotId: "snapshot-initial",
        afterSnapshotId: "snapshot-move-title",
      }),
    ])

    const undone = undoDocument(changed)
    expect(undone.snapshotId).toBe("snapshot-initial")
    expect(undone.operationVersion).toBe(2)

    const redone = redoDocument(undone)
    expect(redone.snapshotId).toBe("snapshot-move-title")
    expect(redone.operationVersion).toBe(3)
  })

  it("gives a branch a new identity when the document revision is reused", () => {
    const initial = createDocumentHistory(northstarSeed, "snapshot-initial")
    const first = commitCommands(initial, [updateTitleX("first", 100)])
    const undone = undoDocument(first)
    const branch = commitCommands(undone, [updateTitleX("branch", 120)])

    expect(branch.document.revision).toBe(first.document.revision)
    expect(branch.snapshotId).not.toBe(first.snapshotId)
    expect(branch.snapshotId).toBe("snapshot-branch")
    expect(branch.operationVersion).toBe(3)
    expect(branch.future).toEqual([])
  })

  it("coalesces keyboard nudges for the same selection within 300 ms", () => {
    const initial = createDocumentHistory(northstarSeed, "snapshot-initial")
    const first = commitCommands(initial, [updateTitleX("nudge-one", 83)], {
      label: "Nudge selection",
      coalesceKey: "nudge:cover-title",
      committedAt: 100,
    })
    const second = commitCommands(first, [updateTitleX("nudge-two", 84)], {
      label: "Nudge selection",
      coalesceKey: "nudge:cover-title",
      committedAt: 100 + HISTORY_COALESCE_WINDOW_MS,
    })

    expect(second.past).toHaveLength(1)
    expect(second.operationVersion).toBe(2)
    expect(second.past[0]).toMatchObject({
      label: "Nudge selection",
      beforeSnapshotId: "snapshot-initial",
      afterSnapshotId: "snapshot-nudge-two",
    })
    expect(undoDocument(second).document).toEqual(northstarSeed)
  })

  it("starts a new undo step after the coalescing window or selection changes", () => {
    const initial = createDocumentHistory(northstarSeed)
    const first = commitCommands(initial, [updateTitleX("nudge-one", 83)], {
      coalesceKey: "nudge:cover-title",
      committedAt: 100,
    })
    const elapsed = commitCommands(first, [updateTitleX("nudge-two", 84)], {
      coalesceKey: "nudge:cover-title",
      committedAt: 101 + HISTORY_COALESCE_WINDOW_MS,
    })
    const otherSelection = commitCommands(
      elapsed,
      [updateTitleX("nudge-three", 85)],
      {
        coalesceKey: "nudge:cover-date",
        committedAt: 102 + HISTORY_COALESCE_WINDOW_MS,
      }
    )

    expect(elapsed.past).toHaveLength(2)
    expect(otherSelection.past).toHaveLength(3)
  })

  it("bounds retained undo entries without rewinding the operation version", () => {
    let history = createDocumentHistory(northstarSeed)
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      history = commitCommands(history, [
        updateTitleX(`move-${index}`, 100 + index),
      ])
    }

    expect(history.past).toHaveLength(HISTORY_LIMIT)
    expect(history.operationVersion).toBe(HISTORY_LIMIT + 5)
    expect(history.past[0]?.afterSnapshotId).toBe("snapshot-move-5")
  })
})
