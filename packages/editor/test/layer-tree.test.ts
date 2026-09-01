import { describe, expect, it } from "vitest"
import {
  applyCommand,
  assertValidDocument,
  componentRenderConformanceDocument,
  getGroupNodeIds,
  northstarSeed,
  resolveComponentInstanceNodes,
  type ComponentDefinition,
  type ComponentInstance,
  validateDocument,
  type Document,
  type DocumentCommand,
} from "@webmcp/document"
import {
  commitCommands,
  createDocumentHistory,
  undoDocument,
} from "../src/history"
import {
  buildLayerTreeModel,
  layerDropCommands,
  layerKey,
  layerSelectionForTarget,
  layerSelectionState,
  visibleLayerRows,
} from "../src/layer-tree"

const at = "2026-08-27T12:00:00.000Z"
const command = (
  draft: Omit<DocumentCommand, "id" | "at" | "actor">,
  id: string
) => ({ ...draft, id, at, actor: "human" }) as DocumentCommand

type LayerDropDrafts = ReturnType<typeof layerDropCommands>

function executeLayerDrop(document: Document, drafts: LayerDropDrafts) {
  return drafts.reduce(
    (current, draft, index) =>
      applyCommand(current, command(draft, `execute-drop-${index + 1}`)),
    document
  )
}

function pageNodeIds(document: Document, pageId = "cover") {
  return (
    document.pages.find((candidate) => candidate.id === pageId)?.nodeIds ?? []
  )
}

function expectGroupStackContiguous(
  document: Document,
  groupId: string,
  pageId = "cover"
) {
  const order = pageNodeIds(document, pageId)
  const indexes = getGroupNodeIds(document, groupId)
    .map((nodeId) => order.indexOf(nodeId))
    .sort((left, right) => left - right)
  const first = indexes[0]
  expect(first).toBeDefined()
  expect(indexes).toEqual(
    Array.from({ length: indexes.length }, (_, index) => first! + index)
  )
}

function groupedDocument() {
  const first = applyCommand(
    northstarSeed,
    command(
      {
        type: "group_nodes",
        groupId: "cover-copy",
        pageId: "cover",
        name: "Cover copy",
        nodeIds: ["cover-eyebrow", "cover-title"],
      },
      "group-copy"
    )
  )
  const second = applyCommand(
    first,
    command(
      {
        type: "group_nodes",
        groupId: "cover-meta",
        pageId: "cover",
        name: "Cover meta",
        nodeIds: ["cover-date", "cover-studio"],
      },
      "group-meta"
    )
  )
  return applyCommand(
    second,
    command(
      {
        type: "group_nodes",
        groupId: "cover-content",
        pageId: "cover",
        name: "Cover content",
        nodeIds: ["cover-eyebrow", "cover-title", "cover-date", "cover-studio"],
      },
      "group-content"
    )
  )
}

function componentLayerDocument() {
  const document = groupedDocument()
  const component: ComponentDefinition = {
    id: "component-cover-copy",
    name: "Cover copy",
    description: "Reusable cover heading",
    sourceGroupId: "cover-copy",
    defaultVariantId: "component-cover-copy-default",
    variants: [
      {
        id: "component-cover-copy-default",
        name: "Default",
        overrides: {},
      },
    ],
  }
  const instance: ComponentInstance = {
    id: "instance-cover-copy",
    name: "Cover copy instance",
    componentId: component.id,
    variantId: component.defaultVariantId,
    rootGroupId: "instance-cover-copy-root",
    transform: { x: 60, y: 80, scale: 1, rotation: 0 },
    nodeMappings: ["cover-eyebrow", "cover-title"].map((sourceNodeId) => ({
      sourceNodeId,
      instanceNodeId: `instance-${sourceNodeId}`,
    })),
    groupMappings: [
      {
        sourceGroupId: component.sourceGroupId,
        instanceGroupId: "instance-cover-copy-root",
      },
    ],
    overrides: {
      "cover-title": { text: "Instance title" },
    },
  }
  document.components = [component]
  document.componentInstances = [instance]
  document.groups.push({
    id: instance.rootGroupId,
    pageId: "story",
    name: instance.name,
    role: "organize",
    nodeIds: instance.nodeMappings.map((mapping) => mapping.instanceNodeId),
  })
  const nodes = resolveComponentInstanceNodes(document, instance)
  document.nodes.push(...nodes)
  document.pages
    .find((page) => page.id === "story")
    ?.nodeIds.push(...nodes.map((node) => node.id))
  return assertValidDocument(document)
}

describe("layer tree model", () => {
  it("nests frame-owned layers once in explicit paint order", () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    page.nodeIds.splice(1, 0, "cover-frame")
    document.nodes.push({
      id: "cover-frame",
      type: "frame",
      name: "Cover copy frame",
      x: 70,
      y: 450,
      width: 560,
      height: 420,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "transparent",
      radius: 0,
      strokeWidth: 0,
      children: [
        {
          nodeId: "cover-eyebrow",
          positioning: "auto",
          horizontalSizing: "fixed",
          verticalSizing: "fixed",
          offsetX: 0,
          offsetY: 0,
          grow: 0,
        },
        {
          nodeId: "cover-title",
          positioning: "auto",
          horizontalSizing: "fill",
          verticalSizing: "fixed",
          offsetX: 0,
          offsetY: 0,
          grow: 0,
        },
      ],
      autoLayout: null,
      clipsContent: true,
    })

    const model = buildLayerTreeModel(document, "cover")
    const frame = model.byKey.get(layerKey("node", "cover-frame"))
    expect(frame?.children.map((child) => child.id)).toEqual([
      "cover-title",
      "cover-eyebrow",
    ])
    expect(
      model.items.flatMap((item) => [
        item.id,
        ...item.children.map((child) => child.id),
      ])
    ).toEqual(
      expect.arrayContaining(["cover-frame", "cover-title", "cover-eyebrow"])
    )
    expect(model.items.filter((item) => item.id === "cover-title")).toEqual([])

    const source = model.byKey.get(layerKey("node", "cover-eyebrow"))!
    const target = model.byKey.get(layerKey("node", "cover-title"))!
    const drafts = layerDropCommands(document, "cover", source, target, "above")
    expect(drafts).toEqual([
      expect.objectContaining({
        type: "update_node",
        nodeId: "cover-frame",
      }),
    ])
    const reordered = executeLayerDrop(document, drafts)
    expect(
      reordered.nodes.find(
        (node) => node.id === "cover-frame" && node.type === "frame"
      )
    ).toMatchObject({
      children: [{ nodeId: "cover-title" }, { nodeId: "cover-eyebrow" }],
    })
    expect(pageNodeIds(reordered).slice(1, 4)).toEqual([
      "cover-frame",
      "cover-title",
      "cover-eyebrow",
    ])

    const reorderedModel = buildLayerTreeModel(reordered, "cover")
    const insertDrafts = layerDropCommands(
      reordered,
      "cover",
      reorderedModel.byKey.get(layerKey("node", "cover-date"))!,
      reorderedModel.byKey.get(layerKey("node", "cover-frame"))!,
      "inside"
    )
    const inserted = executeLayerDrop(reordered, insertDrafts)
    expect(
      inserted.nodes.find(
        (node) => node.id === "cover-frame" && node.type === "frame"
      )
    ).toMatchObject({
      children: [
        { nodeId: "cover-title" },
        { nodeId: "cover-eyebrow" },
        {
          nodeId: "cover-date",
          positioning: "absolute",
        },
      ],
    })
  })

  it("labels mask groups, sources, and content from explicit identities", () => {
    const document = structuredClone(northstarSeed)
    document.groups = [
      {
        id: "cover-mask",
        pageId: "cover",
        name: "Cover mask",
        role: "mask",
        nodeIds: ["cover-panel", "cover-title"],
        mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
      },
    ]

    const model = buildLayerTreeModel(document, "cover")
    expect(model.byKey.get(layerKey("group", "cover-mask"))?.mask).toEqual({
      role: "group",
      groupId: "cover-mask",
      groupName: "Cover mask",
      type: "vector",
      sourceNodeIds: ["cover-panel"],
    })
    expect(model.byKey.get(layerKey("node", "cover-panel"))?.mask?.role).toBe(
      "source"
    )
    expect(model.byKey.get(layerKey("node", "cover-title"))?.mask?.role).toBe(
      "content"
    )
    expect(
      visibleLayerRows(model.items, new Set(), "mask source").map(
        (row) => row.item.id
      )
    ).toContain("cover-panel")
  })

  it("projects main components, instances, and child override ownership", () => {
    const document = componentLayerDocument()
    const sourceModel = buildLayerTreeModel(document, "cover")
    const instanceModel = buildLayerTreeModel(document, "story")

    expect(
      sourceModel.byKey.get(layerKey("group", "cover-copy"))?.component
    ).toMatchObject({
      role: "source",
      componentId: "component-cover-copy",
      instanceId: null,
    })
    expect(
      sourceModel.byKey.get(layerKey("node", "cover-title"))?.component
    ).toMatchObject({
      role: "source-child",
      sourceNodeId: "cover-title",
    })
    expect(
      instanceModel.byKey.get(layerKey("group", "instance-cover-copy-root"))
        ?.component
    ).toMatchObject({
      role: "instance",
      componentId: "component-cover-copy",
      instanceId: "instance-cover-copy",
      overrideProperties: ["text"],
    })
    expect(
      instanceModel.byKey.get(layerKey("node", "instance-cover-title"))
        ?.component
    ).toMatchObject({
      role: "instance-child",
      sourceNodeId: "cover-title",
      overrideProperties: ["text"],
    })
  })

  it("projects nested groups once in canonical front-to-back order", () => {
    const document = groupedDocument()
    const model = buildLayerTreeModel(document, "cover")
    const parent = model.byKey.get(layerKey("group", "cover-content"))

    expect(parent?.children.map((item) => item.id)).toEqual([
      "cover-meta",
      "cover-copy",
    ])
    expect(parent?.nodeIds).toEqual(
      expect.arrayContaining([
        "cover-eyebrow",
        "cover-title",
        "cover-date",
        "cover-studio",
      ])
    )
    expect(model.byKey.has(layerKey("node", "wa-title"))).toBe(false)
    expect(
      [...model.byKey.values()].filter((item) => item.id === "cover-title")
    ).toHaveLength(1)
  })

  it("derives mixed visibility and lock state across descendants", () => {
    let document = groupedDocument()
    document = applyCommand(
      document,
      command(
        {
          type: "update_node",
          nodeId: "cover-title",
          patch: { visible: false, locked: true },
        },
        "mixed-state"
      )
    )
    const parent = buildLayerTreeModel(document, "cover").byKey.get(
      layerKey("group", "cover-content")
    )

    expect(parent).toMatchObject({
      visible: false,
      visibilityMixed: true,
      locked: false,
      lockMixed: true,
    })
  })

  it("flattens expansion and search with exact ARIA set metadata", () => {
    const model = buildLayerTreeModel(groupedDocument(), "cover")
    const parentKey = layerKey("group", "cover-content")
    const metaKey = layerKey("group", "cover-meta")
    const expanded = new Set([parentKey, metaKey])
    const rows = visibleLayerRows(model.items, expanded)
    const parent = rows.find((row) => row.item.key === parentKey)
    const meta = rows.find((row) => row.item.key === metaKey)
    const date = rows.find((row) => row.item.id === "cover-date")

    expect(parent).toMatchObject({ depth: 1, parentKey: null })
    expect(meta).toMatchObject({ depth: 2, parentKey })
    expect(date).toMatchObject({
      depth: 3,
      parentKey: metaKey,
      positionInSet: 2,
      setSize: 2,
    })

    const searchRows = visibleLayerRows(model.items, new Set(), "couple")
    expect(searchRows.map((row) => row.item.id)).toEqual([
      "cover-content",
      "cover-copy",
      "cover-title",
    ])
    expect(expanded).toEqual(new Set([parentKey, metaKey]))
  })

  it("supports replace, toggle, partial-group, and visible range selection", () => {
    const model = buildLayerTreeModel(groupedDocument(), "cover")
    const rows = visibleLayerRows(
      model.items,
      new Set([
        layerKey("group", "cover-content"),
        layerKey("group", "cover-copy"),
        layerKey("group", "cover-meta"),
      ])
    )
    const copyKey = layerKey("group", "cover-copy")
    const titleKey = layerKey("node", "cover-title")
    const dateKey = layerKey("node", "cover-date")

    const group = model.byKey.get(copyKey)
    expect(group).toBeDefined()
    const partial = new Set(["cover-title"])
    expect(layerSelectionState(group!, partial)).toBe("partial")

    const completed = layerSelectionForTarget(
      rows,
      partial,
      titleKey,
      copyKey,
      { additive: true, range: false }
    )
    expect(completed).toEqual(new Set(["cover-title", "cover-eyebrow"]))

    const range = layerSelectionForTarget(rows, new Set(), titleKey, dateKey, {
      additive: false,
      range: true,
    })
    expect(range).toEqual(
      new Set(["cover-title", "cover-eyebrow", "cover-date"])
    )
  })

  it("creates reorder and reparent command transactions from drop intent", () => {
    const document = groupedDocument()
    const model = buildLayerTreeModel(document, "cover")
    const source = model.byKey.get(layerKey("node", "cover-panel"))!
    const target = model.byKey.get(layerKey("group", "cover-content"))!
    const inside = layerDropCommands(
      document,
      "cover",
      source,
      target,
      "inside"
    )
    expect(inside).toEqual([
      {
        type: "reparent_node",
        pageId: "cover",
        nodeId: "cover-panel",
        targetGroupId: "cover-content",
      },
    ])

    const content = model.byKey.get(layerKey("group", "cover-content"))!
    const otherRoot = model.items.find(
      (item) => item.key !== content.key && item.nodeIds.length
    )!
    const reordered = layerDropCommands(
      document,
      "cover",
      otherRoot,
      content,
      "above"
    )
    expect(reordered.some((draft) => draft.type === "reorder_nodes")).toBe(true)
    expect(
      layerDropCommands(document, "cover", content, content, "inside")
    ).toEqual([])
  })

  it("executes above and below drops in canonical paint order", () => {
    const document = groupedDocument()
    const model = buildLayerTreeModel(document, "cover")
    const eyebrow = model.byKey.get(layerKey("node", "cover-eyebrow"))!
    const title = model.byKey.get(layerKey("node", "cover-title"))!

    const aboveDrafts = layerDropCommands(
      document,
      "cover",
      eyebrow,
      title,
      "above"
    )
    expect(aboveDrafts).toEqual([
      {
        type: "reorder_nodes",
        pageId: "cover",
        nodeIds: ["cover-eyebrow"],
        toIndex: 2,
      },
    ])
    const above = executeLayerDrop(document, aboveDrafts)
    const aboveOrder = pageNodeIds(above)
    expect(aboveOrder.indexOf("cover-eyebrow")).toBe(
      aboveOrder.indexOf("cover-title") + 1
    )
    expectGroupStackContiguous(above, "cover-content")
    expect(
      validateDocument(above).filter((issue) => issue.severity === "error")
    ).toEqual([])

    const belowDrafts = layerDropCommands(
      document,
      "cover",
      title,
      eyebrow,
      "below"
    )
    expect(belowDrafts).toEqual([
      {
        type: "reorder_nodes",
        pageId: "cover",
        nodeIds: ["cover-title"],
        toIndex: 1,
      },
    ])
    const below = executeLayerDrop(document, belowDrafts)
    const belowOrder = pageNodeIds(below)
    expect(belowOrder.indexOf("cover-title") + 1).toBe(
      belowOrder.indexOf("cover-eyebrow")
    )
    expectGroupStackContiguous(below, "cover-content")
    expect(
      validateDocument(below).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("executes an inside drop as a valid contiguous group move", () => {
    const document = groupedDocument()
    const model = buildLayerTreeModel(document, "cover")
    const panel = model.byKey.get(layerKey("node", "cover-panel"))!
    const content = model.byKey.get(layerKey("group", "cover-content"))!
    const drafts = layerDropCommands(
      document,
      "cover",
      panel,
      content,
      "inside"
    )

    const moved = executeLayerDrop(document, drafts)

    expect(drafts).toEqual([
      {
        type: "reparent_node",
        pageId: "cover",
        nodeId: "cover-panel",
        targetGroupId: "cover-content",
      },
    ])
    expect(
      moved.groups.find((group) => group.id === "cover-content")?.nodeIds
    ).toContain("cover-panel")
    expectGroupStackContiguous(moved, "cover-content")
    expect(
      validateDocument(moved).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("commits a multi-command reparent and reorder as one undoable move", () => {
    const document = groupedDocument()
    const beforeOrder = pageNodeIds(document)
    const beforeGroups = document.groups
    const model = buildLayerTreeModel(document, "cover")
    const panel = model.byKey.get(layerKey("node", "cover-panel"))!
    const copy = model.byKey.get(layerKey("group", "cover-copy"))!
    const drafts = layerDropCommands(document, "cover", panel, copy, "above")
    const commands = drafts.map((draft, index) =>
      command(draft, `transaction-drop-${index + 1}`)
    )
    const initial = createDocumentHistory(document, "before-layer-drop")

    const moved = commitCommands(initial, commands, {
      label: "Move Olive panel above Cover copy",
    })

    expect(drafts.map((draft) => draft.type)).toEqual([
      "reparent_node",
      "reorder_nodes",
    ])
    expect(moved.past).toHaveLength(1)
    expect(moved.operationVersion).toBe(initial.operationVersion + 1)
    expect(moved.past[0]?.label).toBe("Move Olive panel above Cover copy")
    expect(
      moved.document.groups.find((group) => group.id === "cover-content")
        ?.nodeIds
    ).toContain("cover-panel")
    const movedOrder = pageNodeIds(moved.document)
    expect(movedOrder.indexOf("cover-panel")).toBe(
      Math.max(
        movedOrder.indexOf("cover-eyebrow"),
        movedOrder.indexOf("cover-title")
      ) + 1
    )
    expectGroupStackContiguous(moved.document, "cover-content")

    const undone = undoDocument(moved)
    expect(undone.operationVersion).toBe(moved.operationVersion + 1)
    expect(undone.past).toHaveLength(0)
    expect(undone.future).toHaveLength(1)
    expect(pageNodeIds(undone.document)).toEqual(beforeOrder)
    expect(undone.document.groups).toEqual(beforeGroups)
    expect(undone.document).toEqual(document)
  })

  it("positions cross-parent below drops beside the intended sibling", () => {
    const document = groupedDocument()
    const model = buildLayerTreeModel(document, "cover")
    const panel = model.byKey.get(layerKey("node", "cover-panel"))!
    const copy = model.byKey.get(layerKey("group", "cover-copy"))!
    const drafts = layerDropCommands(document, "cover", panel, copy, "below")

    expect(drafts.map((draft) => draft.type)).toEqual([
      "reparent_node",
      "reorder_nodes",
    ])

    const moved = executeLayerDrop(document, drafts)
    const order = pageNodeIds(moved)
    expect(order.indexOf("cover-panel") + 1).toBe(
      Math.min(order.indexOf("cover-eyebrow"), order.indexOf("cover-title"))
    )
    expectGroupStackContiguous(moved, "cover-content")
    expect(
      validateDocument(moved).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("projects 1,000 layers without an unbounded model cost", () => {
    const rect = northstarSeed.nodes.find((node) => node.type === "rect")
    expect(rect?.type).toBe("rect")
    if (!rect || rect.type !== "rect") return
    const nodes = Array.from({ length: 1_000 }, (_, index) => ({
      ...rect,
      id: `large-layer-${index + 1}`,
      name: `Large layer ${index + 1}`,
    }))
    const document: Document = {
      ...northstarSeed,
      pages: northstarSeed.pages.map((page) =>
        page.id === "cover"
          ? { ...page, nodeIds: nodes.map((node) => node.id) }
          : page
      ),
      nodes: [
        ...nodes,
        ...northstarSeed.nodes.filter(
          (node) =>
            !northstarSeed.pages
              .find((page) => page.id === "cover")
              ?.nodeIds.includes(node.id)
        ),
      ],
      groups: [],
    }
    const startedAt = performance.now()
    const model = buildLayerTreeModel(document, "cover")
    const elapsed = performance.now() - startedAt

    expect(model.items).toHaveLength(1_000)
    expect(model.byKey).toHaveLength(1_000)
    expect(elapsed).toBeLessThan(1_000)
  })

  it("indexes 1,000 component instance roots and children for bounded selection lookup", () => {
    const seed = structuredClone(componentRenderConformanceDocument)
    const source = seed.nodes.find(
      (node) => node.id === "component-badge-source"
    )!
    const instances = Array.from({ length: 1_000 }, (_, index) => ({
      id: `selection-instance-${index}`,
      name: `Selection instance ${index}`,
      componentId: "component-badge",
      variantId: "component-badge-default",
      rootGroupId: `selection-instance-${index}-root`,
      transform: { x: index, y: index, scale: 1, rotation: 0 },
      nodeMappings: [
        {
          sourceNodeId: source.id,
          instanceNodeId: `selection-instance-${index}-node`,
        },
      ],
      groupMappings: [
        {
          sourceGroupId: "component-badge-source-root",
          instanceGroupId: `selection-instance-${index}-root`,
        },
      ],
      overrides: {},
    }))
    const nodes = instances.map((_, index) => ({
      ...source,
      id: `selection-instance-${index}-node`,
      name: `Selection node ${index}`,
    }))
    const groups = instances.map((instance, index) => ({
      id: instance.rootGroupId,
      pageId: "component-render-page",
      name: instance.name,
      nodeIds: [`selection-instance-${index}-node`],
    }))
    const document: Document = {
      ...seed,
      nodes: [source, ...nodes],
      groups: [
        seed.groups.find(
          (group) => group.id === "component-badge-source-root"
        )!,
        ...groups,
      ],
      pages: seed.pages.map((page) => ({
        ...page,
        nodeIds: [source.id, ...nodes.map((node) => node.id)],
      })),
      components: seed.components.filter(
        (component) => component.id === "component-badge"
      ),
      componentInstances: instances,
    }

    const startedAt = performance.now()
    const model = buildLayerTreeModel(document, "component-render-page")
    for (let index = 0; index < 1_000; index += 1) {
      expect(
        model.byKey.get(layerKey("group", `selection-instance-${index}-root`))
          ?.component
      ).toMatchObject({
        role: "instance",
        instanceId: `selection-instance-${index}`,
      })
      expect(
        model.byKey.get(layerKey("node", `selection-instance-${index}-node`))
          ?.component
      ).toMatchObject({
        role: "instance-child",
        instanceId: `selection-instance-${index}`,
      })
    }
    const elapsed = performance.now() - startedAt

    expect(model.items).toHaveLength(1_001)
    expect(model.byKey).toHaveLength(2_002)
    expect(elapsed).toBeLessThan(1_000)
  })
})
