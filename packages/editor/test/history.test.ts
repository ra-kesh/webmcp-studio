import {
  assetReferenceKeysForSource,
  applyQuotationTemplate,
  captureSemanticFragment,
  cloneSemanticFragment,
  composeQuotationDocument,
  northstarSeed,
  northstarQuotationPayload,
  renderConformanceDocument,
} from "@webmcp/document"
import { maskRenderConformanceDocument } from "@webmcp/document/internal/mask-render-conformance"
import { describe, expect, it } from "vitest"
import {
  breakDocumentHistoryCoalescing,
  clearDocumentRedoHistory,
  commitCommands,
  commitCommandsWithResult,
  createDocumentHistory,
  HISTORY_COALESCE_WINDOW_MS,
  HISTORY_LIMIT,
  HISTORY_MAX_BYTES,
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
  it("creates and releases a mask as exact single history steps", () => {
    const before = {
      ...structuredClone(maskRenderConformanceDocument),
      revision: 10,
      groups: [],
    }
    const initial = createDocumentHistory(before, "mask-before")
    const createCommand = {
      id: "history-create-mask",
      type: "create_mask_group" as const,
      actor: "human" as const,
      at: "2026-08-31T15:00:00.000Z",
      expectedRevision: before.revision,
      pageId: "mask-conformance-page",
      groupId: "history-mask",
      name: "History mask",
      nodeIds: ["mask-conformance-source", "mask-conformance-content"],
      sourceNodeIds: ["mask-conformance-source"] as [string],
      maskType: "vector" as const,
    }
    const created = commitCommandsWithResult(initial, [createCommand])!
    expect(created.history.past).toHaveLength(1)
    expect(created.commit.label).toBe("Create mask")
    expect(undoDocument(created.history).document).toEqual(before)
    expect(redoDocument(undoDocument(created.history)).document).toEqual(
      created.history.document
    )

    const released = commitCommandsWithResult(created.history, [
      {
        id: "history-release-mask",
        type: "release_mask_group",
        actor: "human",
        at: "2026-08-31T15:01:00.000Z",
        expectedRevision: created.history.document.revision,
        pageId: "mask-conformance-page",
        groupId: "history-mask",
      },
    ])!
    expect(released.history.past).toHaveLength(2)
    expect(released.commit.label).toBe("Release mask")
    expect(undoDocument(released.history).document).toEqual(
      created.history.document
    )
    expect(redoDocument(undoDocument(released.history)).document).toEqual(
      released.history.document
    )
  })

  it("does not emit history, snapshots, operation versions, commits, or receipts for mask no-ops", () => {
    const before = {
      ...structuredClone(maskRenderConformanceDocument),
      revision: 10,
      groups: [],
    }
    const initial = createDocumentHistory(before, "mask-before")
    const createCommand = {
      id: "history-idempotent-mask",
      type: "create_mask_group" as const,
      actor: "human" as const,
      at: "2026-08-31T15:10:00.000Z",
      expectedRevision: before.revision,
      pageId: "mask-conformance-page",
      groupId: "history-idempotent-group",
      name: "History idempotent mask",
      nodeIds: ["mask-conformance-source", "mask-conformance-content"],
      sourceNodeIds: ["mask-conformance-source"] as [string],
      maskType: "vector" as const,
    }
    const created = commitCommandsWithResult(initial, [createCommand])!
    const replay = commitCommandsWithResult(created.history, [createCommand])
    expect(replay).toBeNull()
    expect(commitCommands(created.history, [createCommand])).toBe(
      created.history
    )

    const semanticNoOp = commitCommandsWithResult(created.history, [
      {
        id: "history-mask-type-no-op",
        type: "set_mask_type",
        actor: "human",
        at: "2026-08-31T15:11:00.000Z",
        expectedRevision: created.history.document.revision,
        pageId: "mask-conformance-page",
        groupId: "history-idempotent-group",
        maskType: "vector",
      },
    ])
    expect(semanticNoOp).toBeNull()
    const sourceNoOp = commitCommandsWithResult(created.history, [
      {
        id: "history-mask-source-no-op",
        type: "set_mask_sources",
        actor: "human",
        at: "2026-08-31T15:12:00.000Z",
        expectedRevision: created.history.document.revision,
        pageId: "mask-conformance-page",
        groupId: "history-idempotent-group",
        sourceNodeIds: ["mask-conformance-source"],
      },
    ])
    expect(sourceNoOp).toBeNull()
    expect(created.history).toMatchObject({
      snapshotId: "snapshot-history-idempotent-mask",
      operationVersion: 1,
    })
    expect(created.history.document.commandReceipts).toHaveLength(1)
  })

  it("changes vector to alpha as one exact undoable history step", () => {
    const before = {
      ...structuredClone(maskRenderConformanceDocument),
      revision: 10,
    }
    const initial = createDocumentHistory(before, "alpha-before")
    const changed = commitCommandsWithResult(initial, [
      {
        id: "history-set-alpha-mask",
        type: "set_mask_type",
        actor: "human",
        at: "2026-08-31T15:15:00.000Z",
        expectedRevision: before.revision,
        pageId: "mask-conformance-page",
        groupId: "mask-conformance-group",
        maskType: "alpha",
      },
    ])!
    expect(changed.history.past).toHaveLength(1)
    expect(changed.history.document.groups[0]).toMatchObject({
      role: "mask",
      mask: { type: "alpha" },
    })
    expect(undoDocument(changed.history).document).toEqual(before)
    expect(redoDocument(undoDocument(changed.history)).document).toEqual(
      changed.history.document
    )
  })

  it("changes vector to luminance as one exact undoable history step", () => {
    const before = {
      ...structuredClone(maskRenderConformanceDocument),
      revision: 11,
    }
    const initial = createDocumentHistory(before, "luminance-before")
    const changed = commitCommandsWithResult(initial, [
      {
        id: "history-set-luminance-mask",
        type: "set_mask_type",
        actor: "human",
        at: "2026-08-31T15:16:00.000Z",
        expectedRevision: before.revision,
        pageId: "mask-conformance-page",
        groupId: "mask-conformance-group",
        maskType: "luminance",
      },
    ])!
    expect(changed.history.past).toHaveLength(1)
    expect(changed.history.document.groups[0]).toMatchObject({
      role: "mask",
      mask: { type: "luminance" },
    })
    expect(undoDocument(changed.history).document).toEqual(before)
    expect(redoDocument(undoDocument(changed.history)).document).toEqual(
      changed.history.document
    )
  })

  it("reorders multiple mask sources as one exact step and skips the full-list no-op", () => {
    const before = structuredClone(maskRenderConformanceDocument)
    const source = before.nodes.find(
      (node) => node.id === "mask-conformance-source"
    )!
    before.nodes.push({
      ...structuredClone(source),
      id: "mask-conformance-source-two",
      name: "Second mask source",
    })
    before.pages[0]!.nodeIds.splice(1, 0, "mask-conformance-source-two")
    const group = before.groups[0]!
    if (group.role !== "mask") throw new Error("Mask fixture is missing")
    group.nodeIds.splice(1, 0, "mask-conformance-source-two")
    group.mask.sourceNodeIds = [
      "mask-conformance-source",
      "mask-conformance-source-two",
    ]
    const initial = createDocumentHistory(before, "multi-source-before")
    const changed = commitCommandsWithResult(initial, [
      {
        id: "history-reorder-mask-sources",
        type: "set_mask_sources",
        actor: "human",
        at: "2026-08-31T15:20:00.000Z",
        expectedRevision: before.revision,
        pageId: before.pages[0]!.id,
        groupId: group.id,
        sourceNodeIds: [
          "mask-conformance-source-two",
          "mask-conformance-source",
        ],
      },
    ])!
    expect(changed.commit.label).toBe("Change mask sources")
    expect(changed.history.past).toHaveLength(1)
    expect(undoDocument(changed.history).document).toEqual(before)
    expect(redoDocument(undoDocument(changed.history)).document).toEqual(
      changed.history.document
    )
    expect(
      commitCommandsWithResult(changed.history, [
        {
          id: "history-reorder-mask-sources-no-op",
          type: "set_mask_sources",
          actor: "human",
          at: "2026-08-31T15:21:00.000Z",
          expectedRevision: changed.history.document.revision,
          pageId: before.pages[0]!.id,
          groupId: group.id,
          sourceNodeIds: [
            "mask-conformance-source-two",
            "mask-conformance-source",
          ],
        },
      ])
    ).toBeNull()
  })
  it("admits canonical documents through full schema validation once", () => {
    const invalid = structuredClone(northstarSeed)
    invalid.nodes[0]!.x = Number.NaN

    expect(() => createDocumentHistory(invalid)).toThrow()
  })

  it("preserves unchanged canonical identities for incremental renderers", () => {
    const target = northstarSeed.nodes.find(
      (node) => node.id === "cover-title"
    )!
    const unchanged = northstarSeed.nodes.find((node) => node.id !== target.id)!
    const initial = createDocumentHistory(northstarSeed)
    const changed = commitCommands(initial, [
      updateTitleX("identity-preserving-update", target.x + 1),
    ])

    expect(changed.document).not.toBe(initial.document)
    expect(changed.document.pages[0]).toBe(initial.document.pages[0])
    expect(
      changed.document.nodes.find((node) => node.id === unchanged.id)
    ).toBe(unchanged)
    expect(
      changed.document.nodes.find((node) => node.id === target.id)
    ).not.toBe(target)
  })

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

  it("relinks every local reference as one exact undo and redo step", () => {
    const before = structuredClone(renderConformanceDocument)
    const image = before.nodes.find((node) => node.id === "image-cover")!
    if (image.type !== "image") throw new Error("Expected image fixture")
    image.assetId = "history-local-image"
    image.src = "asset:local/history-local-image"
    const initial = createDocumentHistory(before)
    const command = {
      id: "relink-history-image",
      type: "relink_asset_references" as const,
      actor: "human" as const,
      at: "2026-08-30T05:00:00.000Z",
      from: "asset:local/history-local-image" as const,
      toAssetId: "asset-historymanaged01",
      toSource: "asset:managed/asset-historymanaged01" as const,
      expectedReferenceKeys: assetReferenceKeysForSource(
        before,
        "asset:local/history-local-image"
      ),
    }
    const result = commitCommandsWithResult(initial, [command])

    expect(result).not.toBeNull()
    expect(result?.history.past).toHaveLength(1)
    expect(result?.commit).toMatchObject({
      label: "Make image available everywhere",
      undoable: true,
    })
    const undone = undoDocument(result!.history)
    expect(undone.document).toEqual(before)
    expect(redoDocument(undone).document).toEqual(result?.history.document)

    const tiny = createDocumentHistory(before, "tiny-before", { maxBytes: 1 })
    const unretained = commitCommandsWithResult(tiny, [command])
    expect(unretained?.commit.undoable).toBe(false)
    expect(unretained?.history.past).toHaveLength(0)
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
        componentInstances: clone.componentInstances,
        bindings: clone.bindings,
        variableBindings: clone.variableBindings,
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
        componentInstances: clone.componentInstances,
        bindings: clone.bindings,
        variableBindings: clone.variableBindings,
      },
    ])

    expect(changed.past).toHaveLength(1)
    expect(changed.past[0]?.label).toBe("Duplicate layers")
    expect(clone.bindings).toHaveLength(2)
    expect(undoDocument(changed).document).toEqual(northstarSeed)
  })

  it("creates and detaches component state through exact history snapshots", () => {
    const initial = createDocumentHistory(northstarSeed)
    const withComponent = commitCommands(
      initial,
      [
        {
          id: "group-component-source",
          type: "group_nodes",
          actor: "human",
          at: "2026-08-30T16:00:00.000Z",
          groupId: "history-component-source",
          pageId: "cover",
          name: "History component",
          nodeIds: ["cover-panel", "cover-eyebrow"],
        },
        {
          id: "create-history-component",
          type: "create_component",
          actor: "human",
          at: "2026-08-30T16:00:00.000Z",
          component: {
            id: "history-component",
            name: "History component",
            description: "",
            sourceGroupId: "history-component-source",
            defaultVariantId: "history-component-default",
            variants: [
              {
                id: "history-component-default",
                name: "Default",
                overrides: {},
              },
            ],
          },
        },
      ],
      { label: "Create component" }
    )
    expect(withComponent.past).toHaveLength(1)
    expect(undoDocument(withComponent).document).toEqual(northstarSeed)

    const withInstance = commitCommands(withComponent, [
      {
        id: "create-history-instance",
        type: "create_component_instance",
        actor: "human",
        at: "2026-08-30T16:01:00.000Z",
        pageId: "story",
        instance: {
          id: "history-instance",
          name: "History instance",
          componentId: "history-component",
          variantId: "history-component-default",
          rootGroupId: "history-instance-root",
          transform: { x: 80, y: 80, scale: 0.5, rotation: 0 },
          nodeMappings: [
            {
              sourceNodeId: "cover-panel",
              instanceNodeId: "history-instance-panel",
            },
            {
              sourceNodeId: "cover-eyebrow",
              instanceNodeId: "history-instance-eyebrow",
            },
          ],
          groupMappings: [
            {
              sourceGroupId: "history-component-source",
              instanceGroupId: "history-instance-root",
            },
          ],
          overrides: {},
        },
      },
    ])
    expect(withInstance.past.at(-1)?.label).toBe("Create component instance")
    const instanceUndone = undoDocument(withInstance)
    expect(instanceUndone.document).toEqual(withComponent.document)
    expect(redoDocument(instanceUndone).document).toEqual(withInstance.document)
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
    expect(history.pastBytes).toBeLessThanOrEqual(HISTORY_MAX_BYTES)
    expect(history.operationVersion).toBe(HISTORY_LIMIT + 5)
    expect(history.past[0]?.afterSnapshotId).toBe("snapshot-move-5")
  })

  it("bounds retained snapshot memory and keeps the newest undo steps", () => {
    const oneEntry = commitCommands(
      createDocumentHistory(northstarSeed, "snapshot-initial"),
      [updateTitleX("measure-one", 100)]
    )
    const maxBytes = oneEntry.pastBytes + 64
    let history = createDocumentHistory(northstarSeed, "snapshot-initial", {
      maxBytes,
    })

    for (let index = 0; index < 6; index += 1) {
      history = commitCommands(history, [
        updateTitleX(`budget-${index}`, 100 + index),
      ])
    }

    expect(history.past.length).toBeGreaterThan(0)
    expect(history.past.length).toBeLessThan(6)
    expect(history.pastBytes).toBeLessThanOrEqual(maxBytes)
    expect(history.past.at(-1)?.afterSnapshotId).toBe("snapshot-budget-5")
    expect(undoDocument(history).document.nodes).toEqual(
      history.past.at(-1)?.before.nodes
    )
  })

  it("bounds redo memory independently after undo", () => {
    let history = createDocumentHistory(northstarSeed, "snapshot-initial", {
      maxBytes: HISTORY_MAX_BYTES,
    })
    for (let index = 0; index < 8; index += 1) {
      history = commitCommands(history, [
        updateTitleX(`redo-budget-${index}`, 100 + index),
      ])
    }
    while (history.past.length) history = undoDocument(history)

    expect(history.futureBytes).toBeLessThanOrEqual(history.maxBytes)
    expect(history.pastBytes).toBe(0)
    expect(redoDocument(history).operationVersion).toBe(
      history.operationVersion + 1
    )
  })

  it("commits an oversized change without retaining a misleading undo step", () => {
    const initial = createDocumentHistory(northstarSeed, "snapshot-initial", {
      maxBytes: 1,
    })
    const changed = commitCommands(initial, [updateTitleX("oversized", 444)])

    expect(changed.document).not.toEqual(initial.document)
    expect(changed.operationVersion).toBe(1)
    expect(changed.past).toEqual([])
    expect(changed.pastBytes).toBe(0)
    expect(undoDocument(changed)).toBe(changed)
  })

  it("reports commit identity independently from undo retention", () => {
    const initial = createDocumentHistory(northstarSeed, "snapshot-initial", {
      maxBytes: 1,
    })
    const result = commitCommandsWithResult(initial, [
      updateTitleX("oversized-observed", 445),
    ])

    expect(result?.history.past).toEqual([])
    expect(result?.commit).toMatchObject({
      id: "transaction-oversized-observed",
      label: "Update layer",
      undoable: false,
    })
  })

  it("reports the retained entry identity for a coalesced commit", () => {
    const initial = createDocumentHistory(northstarSeed, "snapshot-initial")
    const first = commitCommandsWithResult(
      initial,
      [updateTitleX("coalesced-one", 100)],
      { coalesceKey: "nudge:cover-title", committedAt: 100 }
    )!
    const second = commitCommandsWithResult(
      first.history,
      [updateTitleX("coalesced-two", 101)],
      { coalesceKey: "nudge:cover-title", committedAt: 101 }
    )!

    expect(second.history.past).toHaveLength(1)
    expect(second.commit).toMatchObject({
      id: first.commit.id,
      undoable: true,
    })
    expect(second.history.past[0]?.id).toBe(second.commit.id)
  })

  it("rejects invalid history byte limits", () => {
    expect(() =>
      createDocumentHistory(northstarSeed, "snapshot-initial", {
        maxBytes: Number.NaN,
      })
    ).toThrow("finite non-negative")
    expect(() =>
      createDocumentHistory(northstarSeed, "snapshot-initial", {
        maxBytes: -1,
      })
    ).toThrow("finite non-negative")
  })

  it("keeps byte accounting exact when redo or coalescing state is cleared", () => {
    const committed = commitCommands(
      createDocumentHistory(northstarSeed, "snapshot-initial"),
      [updateTitleX("nudge", 100)],
      { coalesceKey: "nudge:cover-title" }
    )
    const separated = breakDocumentHistoryCoalescing(committed)
    expect(separated.past[0]?.coalesceKey).toBeUndefined()
    expect(separated.pastBytes).toBe(
      separated.past.reduce((bytes, entry) => bytes + entry.approximateBytes, 0)
    )

    const undone = undoDocument(separated)
    expect(undone.futureBytes).toBeGreaterThan(0)
    const cleared = clearDocumentRedoHistory(undone)
    expect(cleared.future).toEqual([])
    expect(cleared.futureBytes).toBe(0)
  })
})
