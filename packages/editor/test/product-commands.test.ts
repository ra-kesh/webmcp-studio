import { describe, expect, it, vi } from "vitest"
import {
  buildCanvasContextMenu,
  buildLayerContextMenu,
  buildOutputContextMenu,
  buildPageContextMenu,
  buildProductAppMenus,
  buildSelectedImageMenu,
  createProductCommandRuntime,
  formatProductCommandShortcut,
  productCommandCatalog,
  productCommandArgumentContract,
  productCommandExecutionPolicy,
  productCommandIds,
  projectProductCommandCapabilities,
  projectProductCommandPalette,
  resolveProductCommand,
  validateProductCommandInvocation,
  type ProductCommandInvocation,
  type ProductCommandRuntimeContext,
  type ProductCommandTarget,
  type ProductMenuItem,
} from "../src/product-commands"

const editorContext = {
  reviewPending: false,
  hasSelection: true,
  selectedNodeCount: 1,
  hasSelectedGroup: false,
  hasClipboard: true,
  hasUndo: true,
  hasRedo: true,
  hasZoomSelection: true,
  canCropImage: true,
  canTransformImage: true,
  imageCropActive: false,
  image: {
    canInsert: true,
    canReplace: true,
    replaceDisabledReason: null,
    canEnterCrop: true,
    canApplyCrop: false,
    canCancelCrop: false,
    canFit: true,
    canFill: false,
    canFlip: true,
    canRotate: true,
    canResetRotation: false,
    canResetPlacement: false,
    canResizeFrameToImage: false,
    canSetRectangleFrame: false,
    canSetRoundedRectangleFrame: true,
    canSetEllipseFrame: true,
    cropDraftChanged: false,
  },
} as const

const context = (
  overrides: Partial<ProductCommandRuntimeContext> = {}
): ProductCommandRuntimeContext => ({
  documentId: "document-1",
  snapshotId: "snapshot-1",
  activePageId: "page-1",
  activeOutputId: "output-1",
  pageIds: ["page-1", "page-2"],
  outputIds: ["output-1", "output-2"],
  nodeIds: ["node-1", "node-2", "node-3"],
  pageNodeCounts: { "page-1": 3, "page-2": 0 },
  groupIds: ["group-1"],
  selection: {
    pageId: "page-1",
    nodeIds: ["node-1"],
    nodeTypes: ["image"],
    groupId: null,
    anyLocked: false,
    allLocked: false,
    allVisible: true,
    allHidden: false,
  },
  activeTool: "select",
  editor: editorContext,
  structureByTarget: {
    "page-1": {
      reviewPending: false,
      outputCount: 2,
      outputPageCount: 2,
      pageIndex: 0,
    },
    "page-2": {
      reviewPending: false,
      outputCount: 2,
      outputPageCount: 2,
      pageIndex: 1,
    },
    "output-1": {
      reviewPending: false,
      outputCount: 2,
      outputPageCount: 2,
    },
    "output-2": {
      reviewPending: false,
      outputCount: 2,
      outputPageCount: 1,
    },
  },
  ...overrides,
})

const selectionTarget = (
  overrides: Partial<Extract<ProductCommandTarget, { kind: "selection" }>> = {}
): Extract<ProductCommandTarget, { kind: "selection" }> => ({
  kind: "selection",
  documentId: "document-1",
  snapshotId: "snapshot-1",
  displayName: "Hero image",
  pageId: "page-1",
  nodeIds: ["node-1"],
  ...overrides,
})

const pageTarget = (
  pageId = "page-1"
): Extract<ProductCommandTarget, { kind: "page" }> => ({
  kind: "page",
  documentId: "document-1",
  snapshotId: "snapshot-1",
  displayName: pageId === "page-1" ? "Cover" : "Details",
  pageId,
})

const outputTarget = (
  outputId = "output-1"
): Extract<ProductCommandTarget, { kind: "output" }> => ({
  kind: "output",
  documentId: "document-1",
  snapshotId: "snapshot-1",
  displayName: "Proposal PDF",
  outputId,
})

function commands(items: readonly ProductMenuItem[]): string[] {
  return items.flatMap((item) =>
    item.type === "command"
      ? [item.command.invocation.commandId]
      : item.type === "submenu"
        ? commands(item.items)
        : []
  )
}

describe("product command catalog", () => {
  it("covers every stable editor, structure, and product action ID once", () => {
    expect(Object.keys(productCommandCatalog)).toEqual([...productCommandIds])
    expect(new Set(productCommandIds).size).toBe(productCommandIds.length)

    for (const command of Object.values(productCommandCatalog)) {
      expect(command.label.trim()).not.toBe("")
      expect(command.category.trim()).not.toBe("")
      expect(command.subgroup.trim()).not.toBe("")
      expect(command.keywords.length).toBeGreaterThan(0)
      expect(command.scope).toBeTruthy()
      expect(command.icon).toBeTruthy()
    }
  })

  it("projects platform labels from the same machine-readable chords", () => {
    expect(formatProductCommandShortcut("history.undo", "mac")).toBe("⌘Z")
    expect(formatProductCommandShortcut("history.undo", "windows")).toBe(
      "Ctrl+Z"
    )
    expect(formatProductCommandShortcut("history.undo", "linux")).toBe("Ctrl+Z")
    expect(formatProductCommandShortcut("command.search", "mac")).toBe("⌘K")
    expect(formatProductCommandShortcut("command.search", "linux")).toBe(
      "Ctrl+K"
    )
  })

  it("owns typed argument contracts beside the command definitions", () => {
    expect(productCommandArgumentContract("object.add-text")).toMatchObject({
      kind: "text-preset",
      optional: true,
    })
    expect(productCommandArgumentContract("arrange.align")).toMatchObject({
      kind: "alignment",
      variants: expect.arrayContaining(["left", "bottom"]),
    })
    expect(productCommandArgumentContract("mask.create")).toEqual({
      kind: "mask-create",
      fields: {
        sourceNodeIds: { type: "string[]", minItems: 1, maxItems: 4 },
        parentGroupId: { type: "string|null" },
      },
    })
    expect(productCommandArgumentContract("history.undo")).toEqual({
      kind: "none",
    })
  })
})

describe("product command runtime", () => {
  it("keeps mask payloads explicit and shares exact capability reasons", () => {
    const maskEditor = {
      canCreate: true,
      createDisabledReason: null,
      canRelease: true,
      releaseDisabledReason: null,
      canSetVector: false,
      vectorDisabledReason: "This mask already uses Vector.",
      canSetAlpha: false,
      alphaDisabledReason:
        "Alpha masks are not available yet because image and text readiness is not deterministic across every renderer.",
      canSetLuminance: true,
      luminanceDisabledReason: null,
      canSetSources: true,
      sourcesDisabledReason: null,
    }
    const mask = {
      groupId: "group-1",
      createParentGroupId: "group-1",
      type: "vector" as const,
      sourceNodeIds: ["node-1"],
      eligibleSourceNodeIds: ["node-1", "node-2"],
      createSourceNodeIds: ["node-1"],
      reassignmentSourceNodeIds: [],
      create: { enabled: true, disabledReason: null },
      release: { enabled: true, disabledReason: null },
      setVector: {
        enabled: false,
        disabledReason: "This mask already uses Vector.",
      },
      setAlpha: {
        enabled: false,
        disabledReason: maskEditor.alphaDisabledReason,
      },
      setLuminance: { enabled: true, disabledReason: null },
      setSources: { enabled: true, disabledReason: null },
    }
    const runtimeContext = context({
      editor: { ...editorContext, mask: maskEditor },
      mask,
      selection: {
        pageId: "page-1",
        nodeIds: ["node-1", "node-2"],
        nodeTypes: ["rect", "text"],
        groupId: "group-1",
        anyLocked: false,
        allLocked: false,
        allVisible: true,
        allHidden: false,
      },
    })
    const create = resolveProductCommand(
      {
        commandId: "mask.create",
        target: selectionTarget({
          nodeIds: ["node-1", "node-2"],
          groupId: "group-1",
        }),
        arguments: {
          kind: "mask-create",
          sourceNodeIds: ["node-1"],
          parentGroupId: "group-1",
        },
      },
      runtimeContext
    )
    expect(create.enabled).toBe(true)
    expect(
      resolveProductCommand(
        {
          commandId: "mask.create",
          target: selectionTarget({
            nodeIds: ["node-1", "node-2"],
            groupId: "group-1",
          }),
          arguments: {
            kind: "mask-create",
            sourceNodeIds: ["node-1"],
            parentGroupId: null,
          },
        },
        runtimeContext
      ).disabledReason
    ).toBe("The selected layers no longer share that exact mask parent.")
    expect(
      resolveProductCommand(
        {
          commandId: "mask.sources.set",
          target: {
            kind: "group",
            documentId: "document-1",
            snapshotId: "snapshot-1",
            displayName: "Mask",
            pageId: "page-1",
            groupId: "group-1",
          },
          arguments: { kind: "mask-sources", sourceNodeIds: ["node-1"] },
        },
        runtimeContext
      ).disabledReason
    ).toBe("Those layers are already the mask sources in that order.")
    expect(
      resolveProductCommand(
        {
          commandId: "mask.sources.set",
          target: {
            kind: "group",
            documentId: "document-1",
            snapshotId: "snapshot-1",
            displayName: "Mask",
            pageId: "page-1",
            groupId: "group-1",
          },
          arguments: {
            kind: "mask-sources",
            sourceNodeIds: ["node-2", "node-1"],
          },
        },
        runtimeContext
      ).enabled
    ).toBe(true)
    expect(
      validateProductCommandInvocation(
        {
          commandId: "mask.sources.set",
          target: {
            kind: "group",
            documentId: "document-1",
            snapshotId: "snapshot-1",
            displayName: "Mask",
            pageId: "page-1",
            groupId: "group-1",
          },
          arguments: {
            kind: "mask-sources",
            sourceNodeIds: ["node-1", "node-1"],
          },
        },
        runtimeContext
      )
    ).toEqual({
      ok: false,
      status: "invalid",
      reason: "Choose from one through four unique mask source layers.",
    })
    expect(
      resolveProductCommand(
        {
          commandId: "mask.type.alpha",
          target: {
            kind: "group",
            documentId: "document-1",
            snapshotId: "snapshot-1",
            displayName: "Mask",
            pageId: "page-1",
            groupId: "group-1",
          },
        },
        runtimeContext
      ).disabledReason
    ).toBe(maskEditor.alphaDisabledReason)
    expect(
      resolveProductCommand(
        {
          commandId: "mask.type.luminance",
          target: {
            kind: "group",
            documentId: "document-1",
            snapshotId: "snapshot-1",
            displayName: "Mask",
            pageId: "page-1",
            groupId: "group-1",
          },
        },
        runtimeContext
      )
    ).toMatchObject({ enabled: true, disabledReason: null })
  })

  it("owns checked state, dynamic labels, and supplied disabled reasons", () => {
    const current = context({
      activeTool: "hand",
      selection: {
        pageId: "page-1",
        nodeIds: ["node-1", "node-2"],
        nodeTypes: ["rect", "text"],
        groupId: null,
        anyLocked: true,
        allLocked: true,
        allVisible: false,
        allHidden: true,
      },
      stateByCommandId: {
        "document.home": {
          enabled: false,
          disabledReason: "Resolve the active edit before going home.",
        },
        "image.fill": { checked: true },
        "canvas.rulers.toggle": { checked: true },
        "canvas.guides.toggle": { checked: false },
        "output.export-pdf": {
          enabled: false,
          disabledReason: "PDF export is still being prepared.",
          label: "2-page PDF",
        },
      },
    })

    expect(
      resolveProductCommand({ commandId: "tool.hand" }, current)
    ).toMatchObject({
      checked: true,
      enabled: true,
    })
    expect(
      resolveProductCommand({ commandId: "canvas.rulers.toggle" }, current)
    ).toMatchObject({ checked: true, enabled: true })
    expect(
      resolveProductCommand({ commandId: "canvas.guides.toggle" }, current)
    ).toMatchObject({ checked: false, enabled: true })
    expect(
      resolveProductCommand({ commandId: "document.home" }, current)
    ).toMatchObject({
      enabled: false,
      disabledReason: "Resolve the active edit before going home.",
    })
    expect(
      resolveProductCommand(
        {
          commandId: "object.visibility.toggle",
          target: selectionTarget({ nodeIds: ["node-1", "node-2"] }),
        },
        current
      )
    ).toMatchObject({ label: "Show selection" })
    expect(
      resolveProductCommand(
        {
          commandId: "object.lock.toggle",
          target: selectionTarget({ nodeIds: ["node-1", "node-2"] }),
        },
        current
      )
    ).toMatchObject({ label: "Unlock selection", enabled: true })
    expect(
      resolveProductCommand(
        {
          commandId: "image.fill",
          target: selectionTarget({ nodeIds: ["node-1", "node-2"] }),
        },
        current
      )
    ).toMatchObject({ checked: true })
    expect(
      resolveProductCommand(
        { commandId: "output.export-pdf", target: outputTarget() },
        current
      )
    ).toMatchObject({
      label: "2-page PDF",
      enabled: false,
      disabledReason: "PDF export is still being prepared.",
    })
  })

  it("requires typed alignment and distribution arguments", () => {
    expect(
      validateProductCommandInvocation(
        { commandId: "arrange.align", target: selectionTarget() },
        context()
      )
    ).toEqual({ ok: false, status: "invalid", reason: "Choose an alignment." })
    expect(
      validateProductCommandInvocation(
        {
          commandId: "arrange.align",
          target: selectionTarget(),
          arguments: {
            kind: "alignment",
            alignment: "left",
            relativeTo: "page",
          },
        },
        context()
      )
    ).toEqual({ ok: true })
    expect(
      resolveProductCommand(
        {
          commandId: "arrange.align",
          target: selectionTarget(),
          arguments: {
            kind: "alignment",
            alignment: "left",
            relativeTo: "selection",
          },
        },
        context()
      )
    ).toMatchObject({
      enabled: false,
      disabledReason: "Select at least two layers to align them.",
    })
    expect(
      resolveProductCommand(
        {
          commandId: "arrange.align",
          target: selectionTarget(),
          arguments: {
            kind: "alignment",
            alignment: "left",
            relativeTo: "page",
          },
        },
        context()
      )
    ).toMatchObject({ enabled: true })
  })

  it("revalidates the live snapshot and never executes a stale target", () => {
    let current = context()
    const execute = vi.fn(() => true)
    const runtime = createProductCommandRuntime({
      getContext: () => current,
      execute,
    })
    const invocation: ProductCommandInvocation = {
      commandId: "object.delete",
      target: selectionTarget(),
    }

    expect(runtime.resolve(invocation).enabled).toBe(true)
    current = context({ snapshotId: "snapshot-2" })

    expect(runtime.run(invocation)).toEqual({
      status: "stale",
      reason: "The document changed after this command opened.",
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("revalidates selection identity and capability immediately before run", () => {
    let current = context()
    const execute = vi.fn(() => true)
    const runtime = createProductCommandRuntime({
      getContext: () => current,
      execute,
    })
    const invocation: ProductCommandInvocation = {
      commandId: "object.delete",
      target: selectionTarget(),
    }
    current = context({
      selection: {
        ...context().selection!,
        nodeIds: ["node-2"],
      },
      editor: { ...editorContext, reviewPending: true },
    })

    expect(runtime.run(invocation)).toMatchObject({ status: "stale" })
    expect(execute).not.toHaveBeenCalled()
  })

  it("reports an executable command as declined unless the host explicitly accepts it", () => {
    const invocation: ProductCommandInvocation = {
      commandId: "document.new",
    }
    const runtime = createProductCommandRuntime({
      getContext: () => context(),
      execute: () => false,
    })

    expect(runtime.run(invocation)).toEqual({ status: "declined" })
  })
})

describe("pure product menu models", () => {
  it("builds the exact desktop headings with catalog-backed commands", () => {
    const menus = buildProductAppMenus(context())
    expect(menus.map(({ label }) => label)).toEqual([
      "File",
      "Edit",
      "View",
      "Object",
      "Text",
      "Arrange",
      "Help",
    ])
    const ids = menus.flatMap((menu) =>
      menu.groups.flatMap((group) => commands(group.items))
    )
    expect(ids).toContain("document.new")
    expect(ids).toContain("document.home")
    expect(ids).toContain("object.add-text")
    expect(ids).toContain("arrange.align")
    expect(ids).toContain("command.search")
    expect(ids.every((id) => id in productCommandCatalog)).toBe(true)
    expect(
      productCommandIds
        .filter((id) => productCommandCatalog[id].appMenu)
        .every((id) => ids.includes(id))
    ).toBe(true)
    const exports = menus
      .flatMap((menu) => menu.groups)
      .flatMap((group) => group.items)
      .filter(
        (item) =>
          item.type === "command" &&
          (item.command.invocation.commandId === "output.export-png" ||
            item.command.invocation.commandId === "output.export-pdf")
      )
    expect(exports).toHaveLength(2)
    expect(
      exports.every((item) => item.type === "command" && item.command.enabled)
    ).toBe(true)
  })

  it("separates blank canvas discovery from selected image actions", () => {
    const blank = buildCanvasContextMenu(
      context({
        selection: null,
        editor: {
          ...editorContext,
          hasSelection: false,
          selectedNodeCount: 0,
          hasZoomSelection: false,
        },
      })
    )
    expect(blank.map(({ id }) => id)).toEqual(["clipboard", "insert", "view"])
    expect(blank.flatMap((group) => commands(group.items))).toEqual([
      "object.paste",
      "selection.select-all",
      "object.add-text",
      "image.insert",
      "object.add-rectangle",
      "object.add-ellipse",
      "object.add-line",
      "canvas.fit",
      "canvas.zoom-in",
      "canvas.zoom-out",
      "canvas.zoom-reset",
      "canvas.rulers.toggle",
      "canvas.guides.toggle",
      "canvas.guides.manage",
    ])
    const selectAll = blank
      .flatMap((group) => group.items)
      .find(
        (item) =>
          item.type === "command" &&
          item.command.invocation.commandId === "selection.select-all"
      )
    expect(selectAll).toMatchObject({
      type: "command",
      command: {
        enabled: true,
        disabledReason: null,
        invocation: {
          target: { kind: "page", pageId: "page-1" },
        },
      },
    })

    const image = buildCanvasContextMenu(context())
    expect(image.map(({ id }) => id)).toEqual([
      "edit",
      "arrange",
      "object",
      "image",
    ])
    expect(image.flatMap((group) => commands(group.items))).toContain(
      "image.crop"
    )
  })

  it("keeps select all bound to the page where the command opened", () => {
    const invocation: ProductCommandInvocation = {
      commandId: "selection.select-all",
      target: pageTarget("page-1"),
    }

    expect(validateProductCommandInvocation(invocation, context())).toEqual({
      ok: true,
    })
    expect(
      validateProductCommandInvocation(
        invocation,
        context({ activePageId: "page-2" })
      )
    ).toEqual({
      ok: false,
      status: "stale",
      reason: "The active page changed after this command opened.",
    })
  })

  it("derives select all availability from its targeted page", () => {
    expect(
      resolveProductCommand(
        {
          commandId: "selection.select-all",
          target: pageTarget("page-2"),
        },
        context({ activePageId: "page-2" })
      )
    ).toMatchObject({
      enabled: false,
      disabledReason: "This page does not contain any layers.",
    })
    expect(
      resolveProductCommand(
        {
          commandId: "selection.select-all",
          target: pageTarget("page-1"),
        },
        context()
      )
    ).toMatchObject({ enabled: true, disabledReason: null })
  })

  it("keeps locked commands visible with a specific reason", () => {
    const lockedContext = context({
      selection: {
        ...context().selection!,
        anyLocked: true,
        allLocked: true,
      },
    })
    const menu = buildCanvasContextMenu(lockedContext)
    const items = menu.flatMap((group) => group.items)
    const deleteItem = items.find(
      (item) =>
        item.type === "command" &&
        item.command.invocation.commandId === "object.delete"
    )
    expect(deleteItem).toMatchObject({
      type: "command",
      command: {
        enabled: false,
        disabledReason: "Unlock the selected layers before editing.",
      },
    })
    const lockItem = items.find(
      (item) =>
        item.type === "command" &&
        item.command.invocation.commandId === "object.lock.toggle"
    )
    expect(lockItem).toMatchObject({
      type: "command",
      command: { enabled: true, label: "Unlock selection" },
    })
  })

  it("shares target-aware page and output models with final-item invariants", () => {
    const finalContext = context({
      structureByTarget: {
        "page-1": {
          reviewPending: false,
          outputCount: 1,
          outputPageCount: 1,
          pageIndex: 0,
        },
        "output-1": {
          reviewPending: false,
          outputCount: 1,
          outputPageCount: 1,
        },
      },
    })
    const page = buildPageContextMenu(finalContext, pageTarget())
    const output = buildOutputContextMenu(finalContext, outputTarget())
    const pageDelete = page
      .flatMap((group) => group.items)
      .find(
        (item) =>
          item.type === "command" &&
          item.command.invocation.commandId === "page.remove"
      )
    const outputDelete = output
      .flatMap((group) => group.items)
      .find(
        (item) =>
          item.type === "command" &&
          item.command.invocation.commandId === "output.remove"
      )
    expect(pageDelete).toMatchObject({
      type: "command",
      command: {
        enabled: false,
        disabledReason: "An output must keep at least one page.",
      },
    })
    expect(outputDelete).toMatchObject({
      type: "command",
      command: {
        enabled: false,
        disabledReason: "A document must keep at least one output.",
      },
    })
  })

  it("resolves PDF availability against the targeted output", () => {
    const pdfContext = context({ pdfOutputIds: ["output-1"] })
    const supported = resolveProductCommand(
      { commandId: "output.export-pdf", target: outputTarget("output-1") },
      pdfContext
    )
    const unsupported = resolveProductCommand(
      { commandId: "output.export-pdf", target: outputTarget("output-2") },
      pdfContext
    )

    expect(supported.enabled).toBe(true)
    expect(unsupported).toMatchObject({
      enabled: false,
      disabledReason: "This output does not support PDF export.",
    })
  })

  it("builds layer and selected-image menus from the same invocations", () => {
    const nodeTarget: Extract<ProductCommandTarget, { kind: "node" }> = {
      kind: "node",
      documentId: "document-1",
      snapshotId: "snapshot-1",
      displayName: "Hero image",
      pageId: "page-1",
      nodeId: "node-1",
    }
    const layerMenu = buildLayerContextMenu(context(), nodeTarget)
    expect(layerMenu.flatMap((group) => commands(group.items))).toContain(
      "object.rename"
    )
    const layerDelete = layerMenu
      .flatMap((group) => group.items)
      .find(
        (item) =>
          item.type === "command" &&
          item.command.invocation.commandId === "object.delete"
      )
    expect(layerDelete).toMatchObject({
      type: "command",
      command: {
        invocation: {
          target: {
            kind: "selection",
            nodeIds: ["node-1"],
            groupId: null,
          },
        },
      },
    })
    expect(
      buildSelectedImageMenu(context()).flatMap((group) =>
        commands(group.items)
      )
    ).toContain("image.frame.ellipse")
  })

  it("rejects a layer menu invocation when its captured selection drifts", () => {
    const openedContext = context({
      selection: {
        ...context().selection!,
        nodeIds: ["node-1", "node-2"],
      },
    })
    const nodeTarget: Extract<ProductCommandTarget, { kind: "node" }> = {
      kind: "node",
      documentId: "document-1",
      snapshotId: "snapshot-1",
      displayName: "Hero image",
      pageId: "page-1",
      nodeId: "node-1",
    }
    const deleteItem = buildLayerContextMenu(openedContext, nodeTarget)
      .flatMap((group) => group.items)
      .find(
        (item) =>
          item.type === "command" &&
          item.command.invocation.commandId === "object.delete"
      )
    if (!deleteItem || deleteItem.type !== "command") {
      throw new Error("Expected the layer delete command.")
    }
    let current = openedContext
    const execute = vi.fn(() => true)
    const runtime = createProductCommandRuntime({
      getContext: () => current,
      execute,
    })
    current = context({
      selection: {
        ...openedContext.selection!,
        nodeIds: ["node-1", "node-3"],
      },
    })

    expect(runtime.run(deleteItem.command.invocation)).toMatchObject({
      status: "stale",
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("projects searchable live palette state with typed parameter variants", () => {
    const palette = projectProductCommandPalette(context(), "linux")
    const search = palette.find(
      ({ invocation }) => invocation.commandId === "command.search"
    )
    expect(search).toMatchObject({
      label: "Search commands…",
      shortcut: "Ctrl+K",
      enabled: true,
    })
    expect(search?.searchText).toContain("command palette")
    expect(
      palette.find(
        ({ invocation }) => invocation.commandId === "output.export-png"
      )
    ).toMatchObject({ enabled: true, targetDisplayName: "Current page" })
    expect(
      palette.find(
        ({ invocation }) => invocation.commandId === "output.export-pdf"
      )
    ).toMatchObject({ enabled: true, targetDisplayName: "Active output" })
    expect(
      palette.filter(
        ({ invocation }) => invocation.commandId === "arrange.align"
      )
    ).toHaveLength(12)
    expect(
      palette.filter(
        ({ invocation }) => invocation.commandId === "arrange.distribute"
      )
    ).toHaveLength(2)
  })

  it("projects the complete canonical capability vocabulary", () => {
    const capabilities = projectProductCommandCapabilities(context())
    expect(
      new Set(capabilities.map(({ invocation }) => invocation.commandId))
    ).toEqual(new Set(productCommandIds))
    expect(
      capabilities.filter(
        ({ invocation }) => invocation.commandId === "arrange.align"
      )
    ).toHaveLength(12)
    expect(
      capabilities.filter(
        ({ invocation }) => invocation.commandId === "arrange.distribute"
      )
    ).toHaveLength(2)
  })

  it("classifies direct, review-only, and specialized automation honestly", () => {
    expect(productCommandExecutionPolicy("tool.select")).toEqual({
      modes: ["dry_run", "direct"],
      reason: null,
      recommendedTool: null,
    })
    expect(productCommandExecutionPolicy("object.delete")).toEqual({
      modes: ["dry_run", "proposal"],
      reason: null,
      recommendedTool: null,
    })
    expect(productCommandExecutionPolicy("document.publish")).toMatchObject({
      modes: [],
      recommendedTool: "publish_template",
    })
    expect(productCommandExecutionPolicy("canvas.zoom-in").modes).toEqual([])
    expect(productCommandExecutionPolicy("canvas.guides.toggle").modes).toEqual(
      []
    )
  })
})
