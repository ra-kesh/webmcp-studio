import {
  ActiveSelection,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  Path,
  Rect,
  Textbox,
  type TPointerEvent,
  type Transform,
} from "fabric"
import { describe, expect, it, vi } from "vitest"
import {
  componentRenderConformanceCases,
  componentRenderConformanceDocument,
  createAdverseRichTextConformanceNode,
  imageRenderParityCases,
  imageRenderParityInput,
  imageRenderParityNode,
  imageRenderParityPixelRatios,
  projectImagePaint,
  projectNodeForRender,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
} from "@webmcp/document"
import {
  createFabricSyncObject,
  createFabricObjectForSync,
  createFabricImageGroup,
  applyFabricTextListEdit,
  cancelFabricTextEditing,
  constrainTextGeometryPatch,
  enterFabricTextEditing,
  equivalentImageSources,
  FABRIC_TRANSFORM_MODIFIER_POLICY,
  fabricTextSelection,
  fabricTextControlVisibility,
  fabricObjectToNodePatch,
  fabricComparableNodeGeometry,
  fabricTransformKind,
  FabricCanvasAdapter,
  fabricTextObjectOptions,
  isMissingImagePlaceholder,
  projectFabricImagePaint,
  projectFabricImageCropDrag,
  projectFabricTextState,
  projectedTextOffsetToSource,
  readTextEditingClipboardData,
  recordTextEdit,
  richTextEditPatch,
  resolveTextEditExit,
  settleTextEditCache,
  shouldPreserveTextEditingSelection,
  syncFabricObjectFromNode,
  textEditPatch,
  textEditFinalizationPolicy,
  writeTextEditingClipboardData,
} from "../src/fabric-adapter"
import {
  continuePlainTextList,
  indentPlainTextList,
  removePlainTextListMarker,
} from "../src/text-lists"

function decodedFabricImage(
  src: string,
  naturalSize: { width: number; height: number }
) {
  return new FabricImage({
    src,
    width: naturalSize.width,
    height: naturalSize.height,
    naturalWidth: naturalSize.width,
    naturalHeight: naturalSize.height,
  } as HTMLImageElement)
}

describe("equivalentImageSources", () => {
  it("accepts a browser-resolved absolute URL for the same document-relative image", () => {
    expect(
      equivalentImageSources(
        "http://localhost:3001/v1/studio/assets/asset-1/content",
        "/v1/studio/assets/asset-1/content",
        "http://localhost:3001/documents/document-1"
      )
    ).toBe(true)
  })

  it("rejects a different resolved image URL", () => {
    expect(
      equivalentImageSources(
        "http://localhost:3001/v1/studio/assets/asset-2/content",
        "/v1/studio/assets/asset-1/content",
        "http://localhost:3001/documents/document-1"
      )
    ).toBe(false)
  })
})

function expectFabricImageAffine(
  image: FabricImage,
  frame: { width: number; height: number },
  expected: [number, number, number, number, number, number]
) {
  const [a, b, c, d, centerX, centerY] = image.calcOwnMatrix()
  const sourceToFrame = [
    a,
    b,
    c,
    d,
    centerX + frame.width / 2 - a * (image.width / 2) - c * (image.height / 2),
    centerY + frame.height / 2 - b * (image.width / 2) - d * (image.height / 2),
  ]
  sourceToFrame.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index]!, 10)
  )
}

function createTransformHarness(options?: {
  onNodesChange?: ReturnType<typeof vi.fn>
  nodeId?: string
}) {
  const node = renderConformanceDocument.nodes.find(
    (candidate) => candidate.id === (options?.nodeId ?? "ellipse-stroke")
  )!
  const object = createFabricSyncObject(node)
  const onNodesChange = options?.onNodesChange ?? vi.fn(() => true)
  const adapter = new FabricCanvasAdapter({
    onSelectionChange: vi.fn(),
    onNodesChange,
  })
  const page = renderConformanceDocument.pages.find((candidate) =>
    candidate.nodeIds.includes(node.id)
  )!
  const canvas = {
    discardActiveObject: vi.fn(),
    endCurrentTransform: vi.fn(),
    getHeight: vi.fn(() => page.height),
    getWidth: vi.fn(() => page.width),
    requestRenderAll: vi.fn(),
    setActiveObject: vi.fn(),
  }
  Reflect.set(adapter, "canvas", canvas)
  Reflect.set(adapter, "documentId", renderConformanceDocument.id)
  Reflect.set(adapter, "pageId", page.id)
  Reflect.get(adapter, "objectByNodeId").set(node.id, object)
  Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
  Reflect.get(adapter, "nodeIdByObject").set(object, node.id)

  const begin = (action = "drag") =>
    Reflect.get(
      adapter,
      "onBeforeTransform"
    )({
      transform: { action, target: object },
    })
  const finish = () =>
    Reflect.get(adapter, "onObjectModified")({ target: object })
  canvas.endCurrentTransform.mockImplementation(finish)

  return { adapter, begin, canvas, finish, node, object, onNodesChange, page }
}

function setFabricPreviewRect(
  object: FabricObject,
  proposed: { x: number; y: number; width: number; height: number }
) {
  const current = fabricObjectToNodePatch(object)
  object.set({
    left: (object.left ?? 0) + proposed.x - current.x,
    top: (object.top ?? 0) + proposed.y - current.y,
    scaleX: object.scaleX * (proposed.width / current.width),
    scaleY: object.scaleY * (proposed.height / current.height),
  })
  object.setCoords()
}

describe("Fabric document boundary", () => {
  it("projects every component semantic case through ordinary Fabric objects", () => {
    const nodesById = new Map(
      componentRenderConformanceDocument.nodes.map((node) => [node.id, node])
    )
    for (const fixture of componentRenderConformanceCases) {
      for (const nodeId of fixture.nodeIds) {
        const node = nodesById.get(nodeId)
        if (!node || node.type !== "rect") throw new Error(`Missing ${nodeId}`)
        const object = createFabricSyncObject(node)
        expect(object).toBeInstanceOf(Rect)
        expect(object).toMatchObject({
          fill: node.fill,
          opacity: node.opacity,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          angle: node.rotation,
        })
        expect(
          fabricComparableNodeGeometry(fabricObjectToNodePatch(object))
        ).toEqual(fabricComparableNodeGeometry(node))
      }
    }
  })

  it("uses canonical resolved resource values for Fabric objects and text", () => {
    const panel = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "rect-stroke-radius"
    )!
    const body = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "long-text-only"
    )!
    const label = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "auto-width-label"
    )!
    if (body.type !== "text" || label.type !== "text") {
      throw new Error("Missing resource conformance text")
    }

    const object = createFabricSyncObject(panel)
    expect(object).toBeInstanceOf(Rect)
    expect(object).toMatchObject({
      fill: "#0f766e",
      opacity: 0.63,
      // Fabric draws the stroke centered on the path, so the inner path radius
      // is reduced by half the 8px stroke to preserve the canonical 24px edge.
      rx: 28,
      ry: 28,
    })
    const bodyProjection = projectFabricTextState(body)
    expect(bodyProjection).toMatchObject({
      fontFamily: "Geist Variable",
      fontSize: 22,
      fontWeight: 510,
      fontStyle: "italic",
      underline: true,
    })
    expect(bodyProjection.lineHeight).toBeCloseTo(1.106194690265487)
    expect(bodyProjection.charSpacing).toBeCloseTo(59.090909090909086)
    expect(fabricTextObjectOptions(body, bodyProjection)).toMatchObject({
      fontStyle: "italic",
      underline: true,
    })
    const mixedText = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "text-typography"
    )
    if (!mixedText || mixedText.type !== "text") {
      throw new Error("Missing mixed resource conformance text")
    }
    expect(
      projectFabricTextState(mixedText)
        .layoutLines.flatMap((line) => line.segments)
        .some((segment) => segment.style.color === "#0e7490")
    ).toBe(true)
    expect(projectFabricTextState(label).text).toBe("UPDATED LABEL")
  })

  it("uses familiar resize and center-origin modifier semantics", () => {
    expect(FABRIC_TRANSFORM_MODIFIER_POLICY).toEqual({
      uniformScaling: false,
      uniScaleKey: "shiftKey",
      centeredScaling: false,
      centeredKey: "altKey",
      altActionKey: null,
    })
  })

  it("normalizes invalid viewport zoom before screen-space snapping", () => {
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange: vi.fn(),
    })

    adapter.setViewportZoom(0.25)
    expect(Reflect.get(adapter, "viewportZoom")).toBe(0.25)
    adapter.setViewportZoom(0)
    expect(Reflect.get(adapter, "viewportZoom")).toBe(1)
    adapter.setViewportZoom(Number.NaN)
    expect(Reflect.get(adapter, "viewportZoom")).toBe(1)
  })

  it("keeps snap targets page-scoped and clears live snap state when they change", () => {
    const harness = createTransformHarness()
    Reflect.set(harness.adapter, "moveSnapLatch", {
      x: { value: 240, source: "guide" },
    })
    Reflect.set(harness.adapter, "activeGuides", [
      { axis: "x", value: 240, source: "guide" },
    ])

    harness.adapter.setSnapTargets(harness.page.id, [
      { axis: "x", value: 240, source: "guide" },
    ])

    expect(Reflect.get(harness.adapter, "moveSnapLatch")).toBeNull()
    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([])
    expect(
      Reflect.get(harness.adapter, "activeSnapTargets").call(harness.adapter)
    ).toEqual([{ axis: "x", value: 240, source: "guide" }])

    Reflect.set(harness.adapter, "pageId", "another-page")
    expect(
      Reflect.get(harness.adapter, "activeSnapTargets").call(harness.adapter)
    ).toEqual([])
  })

  it("keeps Shift side handles on Fabric's public scale path", () => {
    const target = new Rect({
      left: 50,
      top: 50,
      width: 100,
      height: 100,
      strokeWidth: 0,
    })
    Reflect.set(target, "canvas", {
      ...FABRIC_TRANSFORM_MODIFIER_POLICY,
      fire: vi.fn(),
      getZoom: vi.fn(() => 1),
    })
    const control = target.controls.mr!
    const event = { shiftKey: true, altKey: false } as TPointerEvent
    const transform = {
      target,
      corner: "mr",
      originX: "left",
      originY: "center",
      signX: 1,
      signY: 1,
      skewX: 0,
      skewY: 0,
      scaleX: 1,
      scaleY: 1,
    } as Transform & { signX: number; signY: number }

    expect(control.getActionName(event, control, target)).toBe("scaleX")
    expect(
      control.getActionHandler(event, target, control)?.(
        event,
        transform,
        200,
        100
      )
    ).toBe(true)
    expect(target.scaleX).toBeGreaterThan(1)
    expect(target.skewX).toBe(0)
    expect(target.skewY).toBe(0)
  })

  it("reports the public canvas context target without suppressing selection policy", () => {
    const onContextMenu = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange: vi.fn(),
      onContextMenu,
    })
    const object = new Rect({ width: 20, height: 20 })
    Reflect.get(adapter, "nodeIdByObject").set(object, "node-1")
    const request = Reflect.get(adapter, "onContextMenuPointerDown")

    request({
      e: { button: 2, clientX: 120, clientY: 84 },
      target: object,
    })
    request({
      e: { button: 2, clientX: 32, clientY: 16 },
      target: undefined,
    })
    request({
      e: { button: 0, clientX: 0, clientY: 0 },
      target: object,
    })

    expect(onContextMenu).toHaveBeenNthCalledWith(1, {
      clientX: 120,
      clientY: 84,
      nodeId: "node-1",
    })
    expect(onContextMenu).toHaveBeenNthCalledWith(2, {
      clientX: 32,
      clientY: 16,
      nodeId: null,
    })
    expect(onContextMenu).toHaveBeenCalledTimes(2)
  })

  it("prevents single-object scale flips that canonical geometry cannot store", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "ellipse-stroke"
    )!
    const object = createFabricSyncObject(node)

    expect(object.lockScalingFlip).toBe(true)

    object.set({ lockScalingFlip: false })
    syncFabricObjectFromNode(object, node)
    expect(object.lockScalingFlip).toBe(true)
  })

  it("normalizes Fabric transforms into canonical top-left geometry", () => {
    const object = new Rect({
      left: 12.25,
      top: 40.75,
      width: 100,
      height: 80,
      scaleX: 1.5,
      scaleY: 0.5,
      angle: 15,
      originX: "left",
      originY: "top",
      strokeWidth: 0,
    })

    expect(fabricObjectToNodePatch(object)).toEqual({
      x: 12.3,
      y: 40.8,
      width: 150,
      height: 40,
      rotation: 15,
    })
  })

  it("projects ActiveSelection scale and rotation into each node's world geometry", () => {
    const first = new Rect({
      left: 10,
      top: 20,
      width: 100,
      height: 50,
      originX: "left",
      originY: "top",
      strokeWidth: 0,
    })
    const second = new Rect({
      left: 200,
      top: 100,
      width: 80,
      height: 40,
      originX: "left",
      originY: "top",
      strokeWidth: 0,
    })
    const selection = new ActiveSelection([first, second])
    selection.set({
      left: selection.left + 30,
      top: selection.top + 20,
      scaleX: 2,
      scaleY: 1.5,
      angle: 20,
    })
    selection.setCoords()

    expect(fabricObjectToNodePatch(first)).toEqual({
      x: -47.9,
      y: -76.9,
      width: 200,
      height: 75,
      rotation: 20,
    })
    expect(fabricObjectToNodePatch(second)).toEqual({
      x: 268.1,
      y: 165.8,
      width: 160,
      height: 60,
      rotation: 20,
    })
  })

  it("maps only Fabric's public move, resize, and rotate actions", () => {
    expect(fabricTransformKind("drag")).toBe("move")
    expect(fabricTransformKind("scale")).toBe("resize")
    expect(fabricTransformKind("scaleX")).toBe("resize")
    expect(fabricTransformKind("scaleY")).toBe("resize")
    expect(fabricTransformKind("resizing")).toBe("resize")
    expect(fabricTransformKind("rotate")).toBe("rotate")
    expect(fabricTransformKind("skewX")).toBeNull()
    expect(fabricTransformKind(undefined)).toBeNull()
  })

  it("compares a no-op against Fabric's projected precision", () => {
    expect(
      fabricComparableNodeGeometry({
        x: 10.04,
        y: 20.05,
        width: 100.04,
        height: 80.05,
        rotation: 0.04,
      })
    ).toEqual({
      x: 10,
      y: 20.1,
      width: 100,
      height: 80.1,
      rotation: 0,
    })
    expect(
      fabricComparableNodeGeometry({
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 350,
      }).rotation
    ).toBe(-10)
  })

  it("commits one changed transform and emits nothing for a no-op", () => {
    const changed = createTransformHarness()
    changed.begin()
    changed.object.set({ left: changed.node.x + 12 })
    changed.finish()

    expect(changed.onNodesChange).toHaveBeenCalledOnce()
    expect(changed.onNodesChange).toHaveBeenCalledWith([
      {
        nodeId: changed.node.id,
        patch: expect.objectContaining({ x: changed.node.x + 12 }),
      },
    ])
    expect(Reflect.get(changed.adapter, "transformSessions").active).toBeNull()

    const unchanged = createTransformHarness()
    unchanged.begin("scale")
    unchanged.finish()

    expect(unchanged.onNodesChange).not.toHaveBeenCalled()
    expect(
      Reflect.get(unchanged.adapter, "transformSessions").active
    ).toBeNull()
  })

  it("applies Shift resize constraints during preview and commits once", () => {
    const harness = createTransformHarness()
    const axisAlignedNode = { ...harness.node, rotation: 0 }
    Reflect.get(harness.adapter, "nodeByNodeId").set(
      axisAlignedNode.id,
      axisAlignedNode
    )
    syncFabricObjectFromNode(harness.object, axisAlignedNode)
    harness.begin("scale")
    harness.object.set({ scaleX: 2, scaleY: 1.1 })

    Reflect.get(
      harness.adapter,
      "onObjectTransformPreview"
    )({
      e: { shiftKey: true },
      target: harness.object,
      transform: { corner: "br", shiftKey: true },
    })

    const preview = fabricObjectToNodePatch(harness.object)
    expect(preview.width / preview.height).toBeCloseTo(
      axisAlignedNode.width / axisAlignedNode.height,
      3
    )
    expect(harness.onNodesChange).not.toHaveBeenCalled()

    harness.finish()

    expect(harness.onNodesChange).toHaveBeenCalledOnce()
    expect(harness.onNodesChange).toHaveBeenCalledWith([
      {
        nodeId: axisAlignedNode.id,
        patch: expect.objectContaining({
          width: preview.width,
          height: preview.height,
        }),
      },
    ])
  })

  it("preserves the pointer-down center for Alt and Shift+Alt resize", () => {
    for (const shiftKey of [false, true]) {
      const harness = createTransformHarness()
      const node = { ...harness.node, rotation: 0 }
      Reflect.get(harness.adapter, "nodeByNodeId").set(node.id, node)
      syncFabricObjectFromNode(harness.object, node)
      harness.begin("scaleX")
      const baselineCenter = {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      }
      setFabricPreviewRect(harness.object, {
        x: node.x - 31,
        y: node.y,
        width: node.width + 62,
        height: node.height,
      })

      Reflect.get(
        harness.adapter,
        "onObjectTransformPreview"
      )({
        // Alt is deliberately absent: the stable pointer-down origin owns
        // centered semantics even if the key is released during the drag.
        e: { shiftKey },
        target: harness.object,
        transform: {
          action: "scaleX",
          corner: "mr",
          originX: "center",
          originY: "center",
          shiftKey,
        },
      })

      const preview = fabricObjectToNodePatch(harness.object)
      expect(preview.x + preview.width / 2).toBeCloseTo(baselineCenter.x, 1)
      expect(preview.y + preview.height / 2).toBeCloseTo(baselineCenter.y, 1)
      if (shiftKey) {
        expect(preview.width / preview.height).toBeCloseTo(
          node.width / node.height,
          2
        )
      }
    }
  })

  it("snaps an axis-aligned resize edge and exposes the existing guide model", () => {
    const harness = createTransformHarness()
    const axisAlignedNode = { ...harness.node, rotation: 0 }
    Reflect.get(harness.adapter, "nodeByNodeId").set(
      axisAlignedNode.id,
      axisAlignedNode
    )
    syncFabricObjectFromNode(harness.object, axisAlignedNode)
    harness.begin("scaleX")
    // Put the moving right edge three pixels away from the page center.
    const pageCenter = renderConformanceDocument.pages[0]!.width / 2
    harness.object.set({
      scaleX: (pageCenter - axisAlignedNode.x - 3) / axisAlignedNode.width,
    })

    Reflect.get(
      harness.adapter,
      "onObjectTransformPreview"
    )({
      e: { shiftKey: false },
      target: harness.object,
      transform: { corner: "mr", shiftKey: false },
    })

    const preview = fabricObjectToNodePatch(harness.object)
    expect(preview.x + preview.width).toBeCloseTo(pageCenter, 1)
    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([
      { axis: "x", value: pageCenter, source: "page" },
    ])
    expect(harness.onNodesChange).not.toHaveBeenCalled()
  })

  it("snaps resize and move previews to explicit page-guide targets", () => {
    const harness = createTransformHarness()
    const node = { ...harness.node, rotation: 0 }
    Reflect.get(harness.adapter, "nodeByNodeId").set(node.id, node)
    syncFabricObjectFromNode(harness.object, node)
    const guideX = node.x + node.width + 36
    harness.adapter.setSnapTargets(harness.page.id, [
      { axis: "x", value: guideX, source: "guide" },
    ])

    harness.begin("scaleX")
    setFabricPreviewRect(harness.object, {
      x: node.x,
      y: node.y,
      width: guideX - node.x - 6,
      height: node.height,
    })
    Reflect.get(
      harness.adapter,
      "onObjectTransformPreview"
    )({
      target: harness.object,
      transform: { action: "scaleX", corner: "mr" },
    })
    expect(
      fabricObjectToNodePatch(harness.object).x +
        fabricObjectToNodePatch(harness.object).width
    ).toBeCloseTo(guideX, 1)
    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([
      { axis: "x", value: guideX, source: "guide" },
    ])

    harness.adapter.cancelTransform()
    harness.begin("drag")
    setFabricPreviewRect(harness.object, {
      x: guideX - 6,
      y: node.y,
      width: node.width,
      height: node.height,
    })
    Reflect.get(harness.adapter, "onObjectMoving")({ target: harness.object })
    expect(fabricObjectToNodePatch(harness.object).x).toBeCloseTo(guideX, 1)
    expect(Reflect.get(harness.adapter, "moveSnapLatch")).toEqual({
      x: { value: guideX, source: "guide" },
    })
    expect(Reflect.get(harness.adapter, "activeGuides")).toContainEqual({
      axis: "x",
      value: guideX,
      source: "guide",
    })
  })

  it("uses the same screen-pixel snap distance across viewport zooms", () => {
    for (const { zoom, documentOffset } of [
      { zoom: 0.25, documentOffset: 24 },
      { zoom: 4, documentOffset: 1.5 },
    ]) {
      const harness = createTransformHarness()
      const node = { ...harness.node, rotation: 0 }
      Reflect.get(harness.adapter, "nodeByNodeId").set(node.id, node)
      syncFabricObjectFromNode(harness.object, node)
      harness.adapter.setViewportZoom(zoom)
      harness.begin("scaleX")
      const pageCenter = harness.page.width / 2
      setFabricPreviewRect(harness.object, {
        x: node.x,
        y: node.y,
        width: pageCenter - node.x - documentOffset,
        height: node.height,
      })

      Reflect.get(
        harness.adapter,
        "onObjectTransformPreview"
      )({
        target: harness.object,
        transform: { action: "scaleX", corner: "mr" },
      })

      const preview = fabricObjectToNodePatch(harness.object)
      expect(documentOffset * zoom).toBeLessThanOrEqual(8)
      expect(preview.x + preview.width).toBeCloseTo(pageCenter, 1)
      expect(Reflect.get(harness.adapter, "resizeSnapLatch")).toEqual({
        x: { value: pageCenter, source: "page" },
      })
    }
  })

  it("holds and releases the live resize snap without guide flicker", () => {
    const harness = createTransformHarness()
    const node = { ...harness.node, rotation: 0 }
    Reflect.get(harness.adapter, "nodeByNodeId").set(node.id, node)
    syncFabricObjectFromNode(harness.object, node)
    harness.begin("scaleX")
    const pageCenter = harness.page.width / 2
    const previewRightEdge = (offset: number) => {
      setFabricPreviewRect(harness.object, {
        x: node.x,
        y: node.y,
        width: pageCenter - node.x + offset,
        height: node.height,
      })
      Reflect.get(
        harness.adapter,
        "onObjectTransformPreview"
      )({
        target: harness.object,
        transform: { action: "scaleX", corner: "mr" },
      })
      return fabricObjectToNodePatch(harness.object)
    }

    const acquired = previewRightEdge(6)
    expect(acquired.x + acquired.width).toBeCloseTo(pageCenter, 1)
    expect(Reflect.get(harness.adapter, "resizeSnapLatch")).not.toBeNull()

    const held = previewRightEdge(10)
    expect(held.x + held.width).toBeCloseTo(pageCenter, 1)
    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([
      { axis: "x", value: pageCenter, source: "page" },
    ])

    const released = previewRightEdge(13)
    expect(released.x + released.width).toBeCloseTo(pageCenter + 13, 1)
    expect(Reflect.get(harness.adapter, "resizeSnapLatch")).toBeNull()
    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([])
  })

  it("declines world-axis resize snapping for rotated nodes", () => {
    const harness = createTransformHarness()
    harness.begin("scaleX")
    harness.object.set({ left: harness.object.left + 12, scaleX: 2 })
    const manualPreview = fabricObjectToNodePatch(harness.object)

    Reflect.get(
      harness.adapter,
      "onObjectTransformPreview"
    )({
      e: { shiftKey: false },
      target: harness.object,
      transform: { corner: "mr", shiftKey: false },
    })

    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([])
    expect(fabricObjectToNodePatch(harness.object)).toEqual(manualPreview)
    expect(harness.onNodesChange).not.toHaveBeenCalled()
  })

  it("preserves aspect and the fixed anchor for rotated Shift side resize", () => {
    const harness = createTransformHarness()
    const baselineRatio = harness.node.width / harness.node.height
    harness.begin("scaleX")
    const fixedAnchor = harness.object.getPointByOrigin("left", "center")
    harness.object.set({ scaleX: harness.object.scaleX * 2 })

    Reflect.get(
      harness.adapter,
      "onObjectTransformPreview"
    )({
      e: { shiftKey: true },
      target: harness.object,
      transform: {
        action: "scaleX",
        corner: "mr",
        originX: "left",
        originY: "center",
        shiftKey: true,
      },
    })

    const preview = fabricObjectToNodePatch(harness.object)
    const preservedAnchor = harness.object.getPointByOrigin("left", "center")
    expect(preview.width / preview.height).toBeCloseTo(baselineRatio, 2)
    expect(preservedAnchor.x).toBeCloseTo(fixedAnchor.x, 5)
    expect(preservedAnchor.y).toBeCloseTo(fixedAnchor.y, 5)
    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([])
    expect(Reflect.get(harness.adapter, "resizeSnapLatch")).toBeNull()
    expect(harness.onNodesChange).not.toHaveBeenCalled()
  })

  it("snaps Shift rotation with hysteresis before the canonical commit", () => {
    const harness = createTransformHarness()
    harness.begin("rotate")
    const previewRotation = (angle: number) => {
      harness.object.set({ angle })
      Reflect.get(
        harness.adapter,
        "onObjectTransformPreview"
      )({
        e: { shiftKey: true },
        target: harness.object,
        transform: { corner: "mtr", shiftKey: true },
      })
    }

    previewRotation(13)
    expect(harness.object.angle).toBe(15)
    previewRotation(19)
    expect(harness.object.angle).toBe(15)
    expect(harness.onNodesChange).not.toHaveBeenCalled()

    harness.finish()

    expect(harness.onNodesChange).toHaveBeenCalledOnce()
    expect(harness.onNodesChange).toHaveBeenCalledWith([
      {
        nodeId: harness.node.id,
        patch: expect.objectContaining({ rotation: 15 }),
      },
    ])
    expect(Reflect.get(harness.adapter, "rotationSnapLatch")).toBeNull()
  })

  it("does not create history when fractional canonical geometry round-trips", () => {
    const harness = createTransformHarness()
    const fractional = {
      ...harness.node,
      x: harness.node.x + 0.04,
      y: harness.node.y + 0.04,
      rotation: harness.node.rotation + 0.04,
    }
    Reflect.get(harness.adapter, "nodeByNodeId").set(fractional.id, fractional)
    syncFabricObjectFromNode(harness.object, fractional)
    harness.begin()
    harness.finish()

    expect(harness.onNodesChange).not.toHaveBeenCalled()
  })

  it("cancels a live transform, keeps selection, and suppresses trailing modified", () => {
    const harness = createTransformHarness()
    const baseline = fabricObjectToNodePatch(harness.object)
    harness.begin("rotate")
    harness.object.set({
      left: harness.node.x + 48,
      top: harness.node.y + 24,
      angle: harness.node.rotation + 30,
    })
    Reflect.set(harness.adapter, "activeGuides", [
      { axis: "x", value: 10, source: "page" },
    ])

    expect(harness.adapter.cancelTransform()).toBe(true)

    expect(harness.canvas.endCurrentTransform).toHaveBeenCalledOnce()
    expect(harness.onNodesChange).not.toHaveBeenCalled()
    expect(fabricObjectToNodePatch(harness.object)).toEqual(baseline)
    expect(harness.canvas.setActiveObject).toHaveBeenCalledWith(harness.object)
    expect(Reflect.get(harness.adapter, "activeGuides")).toEqual([])
    expect(Reflect.get(harness.adapter, "transformSessions").active).toBeNull()
  })

  it("commits a transformed ActiveSelection as one world-geometry batch", () => {
    const nodes = [
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "diagonal-line"
      )!,
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "ellipse-stroke"
      )!,
    ]
    const objects = nodes.map(createFabricSyncObject)
    const selection = new ActiveSelection(objects)
    const onNodesChange = vi.fn(() => true)
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
    })
    Reflect.set(adapter, "canvas", {
      requestRenderAll: vi.fn(),
    })
    Reflect.set(adapter, "documentId", renderConformanceDocument.id)
    Reflect.set(adapter, "pageId", renderConformanceDocument.pages[0]!.id)
    nodes.forEach((node, index) => {
      const object = objects[index]!
      Reflect.get(adapter, "objectByNodeId").set(node.id, object)
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(object, node.id)
    })
    Reflect.get(
      adapter,
      "onBeforeTransform"
    )({
      transform: { action: "scale", target: selection },
    })
    selection.set({
      left: selection.left + 18,
      top: selection.top + 12,
      scaleX: 1.2,
      scaleY: 1.2,
      angle: 15,
    })
    selection.setCoords()

    Reflect.get(adapter, "onObjectModified")({ target: selection })

    expect(onNodesChange).toHaveBeenCalledOnce()
    expect(onNodesChange.mock.calls[0]?.[0]).toHaveLength(2)
    expect(onNodesChange.mock.calls[0]?.[0]).toEqual(
      nodes.map((node, index) => ({
        nodeId: node.id,
        patch: fabricObjectToNodePatch(objects[index]!),
      }))
    )
  })

  it("makes a mixed locked ActiveSelection inspectable but non-transformable", () => {
    const nodes = [
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "rect-stroke-radius"
      )!,
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "ellipse-stroke"
      )!,
    ]
    const objects = nodes.map(createFabricSyncObject)
    const setActiveObject = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange: vi.fn(),
    })
    Reflect.set(adapter, "canvas", {
      discardActiveObject: vi.fn(),
      fire: vi.fn(),
      requestRenderAll: vi.fn(),
      setActiveObject,
    })
    Reflect.set(adapter, "pageId", renderConformanceDocument.pages[0]!.id)
    nodes.forEach((node, index) => {
      const object = objects[index]!
      Reflect.get(adapter, "objectByNodeId").set(node.id, object)
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(object, node.id)
    })

    adapter.select({
      pageId: renderConformanceDocument.pages[0]!.id,
      nodeIds: nodes.map((node) => node.id),
    })

    const selection = setActiveObject.mock.calls[0]?.[0] as ActiveSelection
    expect(selection).toBeInstanceOf(ActiveSelection)
    expect(selection).toMatchObject({
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    })
  })

  it("only exposes non-flipping uniform resize handles for an ActiveSelection", () => {
    const nodes = [
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "ellipse-stroke"
      )!,
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "diagonal-line"
      )!,
    ]
    const objects = nodes.map(createFabricSyncObject)
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange: vi.fn(),
    })
    Reflect.set(adapter, "canvas", {
      fire: vi.fn(),
      requestRenderAll: vi.fn(),
    })
    nodes.forEach((node, index) => {
      const object = objects[index]!
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(object, node.id)
    })

    const selection = Reflect.get(adapter, "createActiveSelection").call(
      adapter,
      objects
    ) as ActiveSelection

    expect(selection.lockScalingFlip).toBe(true)
    for (const key of ["ml", "mr", "mt", "mb"]) {
      expect(selection.isControlVisible(key)).toBe(false)
    }
    for (const key of ["tl", "tr", "bl", "br", "mtr"]) {
      expect(selection.isControlVisible(key)).toBe(true)
    }
  })

  it("normalizes a Fabric-created mixed locked selection before transforms", () => {
    const unlockedNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "ellipse-stroke"
    )!
    const lockedNode = {
      ...renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "rect-stroke-radius"
      )!,
      locked: true,
    }
    const nodes = [unlockedNode, lockedNode]
    const objects = nodes.map(createFabricSyncObject)
    const selection = new ActiveSelection(objects)
    const onSelectionChange = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange,
      onNodesChange: vi.fn(),
    })
    Reflect.set(adapter, "pageId", renderConformanceDocument.pages[0]!.id)
    Reflect.set(adapter, "canvas", {
      getActiveObject: vi.fn(() => selection),
      getActiveObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
    })
    nodes.forEach((node, index) => {
      const object = objects[index]!
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(object, node.id)
    })

    Reflect.get(adapter, "onSelection")()
    Reflect.get(
      adapter,
      "onBeforeTransform"
    )({
      transform: { action: "drag", target: selection },
    })

    expect(selection).toMatchObject({
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    })
    expect(onSelectionChange).toHaveBeenCalledWith({
      pageId: renderConformanceDocument.pages[0]!.id,
      nodeIds: nodes.map((node) => node.id),
    })
    expect(Reflect.get(adapter, "transformSessions").active).toBeNull()
  })

  it("rolls back a nonuniform rotated ActiveSelection resize without a commit", async () => {
    const nodes = [
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "ellipse-stroke"
      )!,
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "diagonal-line"
      )!,
    ]
    const objects = nodes.map(createFabricSyncObject)
    const baseline = objects.map(fabricObjectToNodePatch)
    const selection = new ActiveSelection(objects)
    const onNodesChange = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
    })
    const setActiveObject = vi.fn()
    Reflect.set(adapter, "canvas", {
      discardActiveObject: vi.fn(() => selection.onDeselect()),
      fire: vi.fn(),
      requestRenderAll: vi.fn(),
      setActiveObject,
    })
    Reflect.set(adapter, "documentId", renderConformanceDocument.id)
    Reflect.set(adapter, "pageId", renderConformanceDocument.pages[0]!.id)
    nodes.forEach((node, index) => {
      const object = objects[index]!
      Reflect.get(adapter, "objectByNodeId").set(node.id, object)
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(object, node.id)
    })
    Reflect.get(
      adapter,
      "onBeforeTransform"
    )({
      transform: { action: "scale", target: selection },
    })
    selection.set({ scaleX: 1.5, scaleY: 0.7 })
    selection.setCoords()

    Reflect.get(adapter, "onObjectModified")({ target: selection })
    await Promise.resolve()

    expect(onNodesChange).not.toHaveBeenCalled()
    expect(objects.map(fabricObjectToNodePatch)).toEqual(baseline)
    expect(setActiveObject.mock.calls.at(-1)?.[0]).toBeInstanceOf(
      ActiveSelection
    )
    expect(Reflect.get(adapter, "transformSessions").active).toBeNull()
  })

  it("restores every ActiveSelection member exactly when Escape cancels", () => {
    const nodes = [
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "ellipse-stroke"
      )!,
      renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "diagonal-line"
      )!,
    ]
    const objects = nodes.map(createFabricSyncObject)
    const baseline = objects.map(fabricObjectToNodePatch)
    const selection = new ActiveSelection(objects)
    const onNodesChange = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
    })
    const setActiveObject = vi.fn()
    const canvas = {
      discardActiveObject: vi.fn(() => selection.onDeselect()),
      endCurrentTransform: vi.fn(() =>
        Reflect.get(adapter, "onObjectModified")({ target: selection })
      ),
      fire: vi.fn(),
      requestRenderAll: vi.fn(),
      setActiveObject,
    }
    Reflect.set(adapter, "canvas", canvas)
    Reflect.set(adapter, "documentId", renderConformanceDocument.id)
    Reflect.set(adapter, "pageId", renderConformanceDocument.pages[0]!.id)
    nodes.forEach((node, index) => {
      const object = objects[index]!
      Reflect.get(adapter, "objectByNodeId").set(node.id, object)
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(object, node.id)
    })
    Reflect.get(
      adapter,
      "onBeforeTransform"
    )({
      transform: { action: "rotate", target: selection },
    })
    selection.set({
      left: selection.left + 30,
      top: selection.top + 20,
      scaleX: 1.3,
      scaleY: 1.3,
      angle: 25,
    })
    selection.setCoords()

    expect(adapter.cancelTransform()).toBe(true)

    expect(objects.map(fabricObjectToNodePatch)).toEqual(baseline)
    expect(onNodesChange).not.toHaveBeenCalled()
    const restoredSelection = setActiveObject.mock.calls.at(-1)?.[0]
    expect(restoredSelection).toBeInstanceOf(ActiveSelection)
    expect(restoredSelection.getObjects()).toEqual(objects)
  })

  it("releases a click-without-movement session on mouse up", () => {
    const harness = createTransformHarness()
    harness.begin()

    Reflect.get(harness.adapter, "onTransformPointerUp")()

    expect(harness.adapter.cancelTransform()).toBe(false)
    expect(harness.canvas.endCurrentTransform).not.toHaveBeenCalled()
    expect(harness.onNodesChange).not.toHaveBeenCalled()
  })

  it("cancels a live transform before an external selection replacement", () => {
    const harness = createTransformHarness()
    const baseline = fabricObjectToNodePatch(harness.object)
    harness.begin()
    harness.object.set({
      left: harness.node.x + 48,
      top: harness.node.y + 24,
    })

    harness.adapter.select(null)

    expect(harness.canvas.endCurrentTransform).toHaveBeenCalledOnce()
    expect(fabricObjectToNodePatch(harness.object)).toEqual(baseline)
    expect(harness.onNodesChange).not.toHaveBeenCalled()
    expect(Reflect.get(harness.adapter, "transformSessions").active).toBeNull()
    expect(() => harness.adapter.cancelTransform()).not.toThrow()
    expect(harness.adapter.cancelTransform()).toBe(false)
  })

  it("cancels and restores a live transform before adapter unmount", async () => {
    const harness = createTransformHarness()
    const baseline = fabricObjectToNodePatch(harness.object)
    const dispose = vi.fn(async () => undefined)
    Object.assign(harness.canvas, {
      dispose,
      off: vi.fn(),
      upperCanvasEl: { removeEventListener: vi.fn() },
    })
    harness.begin("scale")
    harness.object.set({
      left: harness.node.x + 48,
      top: harness.node.y + 24,
      scaleX: 1.4,
      scaleY: 1.4,
    })

    await harness.adapter.unmount()

    expect(harness.canvas.endCurrentTransform).toHaveBeenCalledOnce()
    expect(fabricObjectToNodePatch(harness.object)).toEqual(baseline)
    expect(harness.onNodesChange).not.toHaveBeenCalled()
    expect(Reflect.get(harness.adapter, "transformSessions").active).toBeNull()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("queues stale-context rollback outside Fabric's modified finalizer", async () => {
    const harness = createTransformHarness()
    const baseline = fabricObjectToNodePatch(harness.object)
    harness.begin()
    harness.object.set({
      left: harness.node.x + 48,
      top: harness.node.y + 24,
    })
    Reflect.set(harness.adapter, "pageId", "replacement-page")

    harness.finish()

    expect(harness.canvas.discardActiveObject).not.toHaveBeenCalled()
    expect(harness.onNodesChange).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(harness.canvas.discardActiveObject).toHaveBeenCalledOnce()
    expect(fabricObjectToNodePatch(harness.object)).toEqual(baseline)
    expect(Reflect.get(harness.adapter, "transformSessions").active).toBeNull()
  })

  it("cancels before returning from a sync whose page was removed", async () => {
    const harness = createTransformHarness()
    const baseline = fabricObjectToNodePatch(harness.object)
    harness.begin()
    harness.object.set({ left: harness.node.x + 40 })

    await harness.adapter.sync(
      {
        ...renderConformanceDocument,
        id: "replacement-document",
        pages: [],
      },
      "removed-page"
    )

    expect(harness.canvas.endCurrentTransform).toHaveBeenCalledOnce()
    expect(fabricObjectToNodePatch(harness.object)).toEqual(baseline)
    expect(Reflect.get(harness.adapter, "transformSessions").active).toBeNull()
    expect(harness.onNodesChange).not.toHaveBeenCalled()
  })

  it("restores a rejected transform after Fabric finishes finalizing", async () => {
    const onNodesChange = vi.fn(() => false)
    const harness = createTransformHarness({ onNodesChange })
    const baseline = fabricObjectToNodePatch(harness.object)
    harness.begin()
    harness.object.set({ left: harness.node.x + 35 })

    harness.finish()
    expect(fabricObjectToNodePatch(harness.object)).not.toEqual(baseline)
    await Promise.resolve()

    expect(onNodesChange).toHaveBeenCalledOnce()
    expect(fabricObjectToNodePatch(harness.object)).toEqual(baseline)
    expect(harness.canvas.setActiveObject).toHaveBeenCalledWith(harness.object)
  })

  it("does not apply a queued rejection rollback after the canvas context changes", async () => {
    const harness = createTransformHarness({
      onNodesChange: vi.fn(() => false),
    })
    harness.begin()
    harness.object.set({ left: harness.node.x + 35 })
    harness.finish()
    Reflect.set(harness.adapter, "generation", 99)

    await Promise.resolve()

    expect(harness.canvas.setActiveObject).not.toHaveBeenCalled()
  })

  it("enters direct editing only for an editable unlocked Textbox", () => {
    const focus = vi.fn()
    const enterEditing = vi.fn(function (this: Textbox) {
      this.isEditing = true
      return this
    })
    const text = Object.create(Textbox.prototype) as Textbox
    Object.assign(text, {
      editable: true,
      lockMovementX: false,
      lockMovementY: false,
      isEditing: false,
      hiddenTextarea: { focus },
      enterEditing,
    })
    const canvas = {
      setActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
    }

    expect(enterFabricTextEditing(canvas, text)).toBe(true)
    expect(canvas.setActiveObject).toHaveBeenCalledWith(text)
    expect(enterEditing).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    expect(canvas.requestRenderAll).toHaveBeenCalledOnce()

    text.editable = false
    expect(enterFabricTextEditing(canvas, text)).toBe(false)
    expect(enterFabricTextEditing(canvas, new Rect())).toBe(false)
  })

  it("restores both document and fixed-body scroll after Fabric focuses its textarea", () => {
    const body = {
      scrollLeft: 0,
      scrollTop: 0,
      scrollTo: vi.fn(function (
        this: { scrollLeft: number; scrollTop: number },
        options: ScrollToOptions
      ) {
        this.scrollLeft = options.left ?? 0
        this.scrollTop = options.top ?? 0
      }),
    }
    const scrollingElement = {
      scrollLeft: 0,
      scrollTop: 0,
      scrollTo: vi.fn(function (
        this: { scrollLeft: number; scrollTop: number },
        options: ScrollToOptions
      ) {
        this.scrollLeft = options.left ?? 0
        this.scrollTop = options.top ?? 0
      }),
    }
    const ownerDocument = {
      body,
      scrollingElement,
      defaultView: {
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
          callback(0)
          return 1
        }),
        setTimeout: vi.fn((callback: () => void) => {
          callback()
          return 1
        }),
      },
    }
    const text = Object.create(Textbox.prototype) as Textbox
    Object.assign(text, {
      editable: true,
      lockMovementX: false,
      lockMovementY: false,
      isEditing: false,
      canvas: { upperCanvasEl: { ownerDocument } },
      hiddenTextarea: { focus: vi.fn() },
      enterEditing: vi.fn(function (this: Textbox) {
        this.isEditing = true
        body.scrollLeft = 56
        scrollingElement.scrollTop = 24
        return this
      }),
    })

    expect(
      enterFabricTextEditing(
        { setActiveObject: vi.fn(), requestRenderAll: vi.fn() },
        text
      )
    ).toBe(true)
    expect(body.scrollLeft).toBe(0)
    expect(scrollingElement.scrollTop).toBe(0)
    expect(body.scrollTo).toHaveBeenCalled()
    expect(scrollingElement.scrollTo).toHaveBeenCalled()
  })

  it("does not emit a document patch when direct editing exits unchanged", () => {
    expect(textEditPatch("Keep this text", "Keep this text")).toBeNull()
    expect(textEditPatch("Before", "After")).toEqual({ text: "After" })
    expect(textEditPatch(undefined, "New text")).toEqual({ text: "New text" })
  })

  it("projects canonical sizing and overflow into the Fabric text contract", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (node.type !== "text") throw new Error("Expected text")
    const canonical = projectNodeForRender(node)
    if (canonical.type !== "text") throw new Error("Expected text")

    expect(projectFabricTextState(node)).toMatchObject({
      text: canonical.content.text,
      displayText: canonical.content.displayText,
      width: canonical.frame.width,
      height: canonical.frame.height,
      fontFamily: canonical.content.fontFamily,
      fontSize: canonical.content.fontSize,
      fontWeight: canonical.content.fontWeight,
      lineHeight: canonical.content.lineHeight / 1.13,
      topOffset:
        ((canonical.content.lineHeight - 1) * canonical.content.fontSize) / 2 -
        1,
      sizingMode: canonical.content.sizingMode,
      overflow: canonical.content.layout.overflow,
      clipOverflow: true,
    })
    expect(canonical.content.displayText).not.toBe(canonical.content.text)
    expect(
      projectFabricTextState({ ...node, sizingMode: "auto_height" })
    ).toMatchObject({ sizingMode: "auto_height", clipOverflow: false })
  })

  it("keeps a 1,000-run late-wrap paste inside the Fabric edit budget", async () => {
    const source = createAdverseRichTextConformanceNode()
    const destination = {
      ...source,
      text: "",
      runs: [],
    }
    const target = Object.create(Textbox.prototype) as Textbox
    const textarea = {
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: "forward",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setSelectionRange(start: number, end: number, direction: string) {
        this.selectionStart = start
        this.selectionEnd = end
        this.selectionDirection = direction
      },
    }
    Object.assign(target, {
      text: "",
      hiddenTextarea: textarea,
      isEditing: true,
      selectionStart: 0,
      selectionEnd: 0,
      graphemeSplit: (value: string) => Array.from(value),
      initDimensions: vi.fn(),
      set(patch: Record<string, unknown>) {
        Object.assign(this, patch)
        return this
      },
      setCoords: vi.fn(),
      setSelectionStart(value: number) {
        this.selectionStart = value
      },
      setSelectionEnd(value: number) {
        this.selectionEnd = value
      },
    })
    const onTextEditingChange = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange: vi.fn(() => true),
      onTextEditingChange,
    })
    Reflect.set(adapter, "canvas", { requestRenderAll: vi.fn() })
    Reflect.get(adapter, "nodeIdByObject").set(target, destination.id)
    Reflect.get(adapter, "nodeByNodeId").set(destination.id, destination)
    Reflect.get(adapter, "onTextEditingEntered")({ target })
    onTextEditingChange.mockClear()

    const clipboardValues = new Map<string, string>()
    const clipboard = {
      getData: (type: string) => clipboardValues.get(type) ?? "",
      setData: (type: string, value: string) => {
        clipboardValues.set(type, value)
      },
    }
    expect(
      writeTextEditingClipboardData(clipboard, source, {
        anchor: 0,
        focus: source.text.length,
      })
    ).toBe(true)

    const preventDefault = vi.fn()
    const startedAt = performance.now()
    Reflect.get(
      adapter,
      "onTextEditingPaste"
    )({
      clipboardData: clipboard,
      preventDefault,
    })
    const elapsed = performance.now() - startedAt
    const session = Reflect.get(adapter, "textEditSession")

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(session.draftNode).toMatchObject({
      text: source.text,
      runs: source.runs,
    })
    expect(session.target.text).toBe(source.text)
    expect(onTextEditingChange).not.toHaveBeenCalled()
    Reflect.get(adapter, "onTextSelectionChanged")({ target })
    Reflect.get(adapter, "onTextSelectionChanged")({ target })
    await Promise.resolve()
    expect(onTextEditingChange).toHaveBeenCalledOnce()
    expect(onTextEditingChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: source.text })
    )
    const fabricProjection = projectFabricTextState(session.draftNode)
    expect(fabricProjection.layoutLines.map((line) => line.sourceEnd)).toEqual([
      6_301, 7_000,
    ])
    expect(
      fabricProjection.layoutLines.flatMap((line) => line.segments)
    ).toHaveLength(1_001)
    expect(
      Object.values(fabricProjection.editingStyles).reduce(
        (count, styles) => count + Object.keys(styles ?? {}).length,
        0
      )
    ).toBe(7_000)
    expect(elapsed).toBeLessThan(250)

    onTextEditingChange.mockClear()
    Reflect.get(adapter, "onTextSelectionChanged")({ target })
    Reflect.get(adapter, "onTextEditingExited")({ target })
    expect(
      onTextEditingChange.mock.calls.map(([state]) => state?.text ?? null)
    ).toEqual([source.text, null])
    await Promise.resolve()
    expect(onTextEditingChange).toHaveBeenCalledTimes(2)
  })

  it("keeps rich-text styles segment-based until direct editing", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const node = {
      ...source,
      text: "Bold text wraps",
      width: 90,
      height: 200,
      sizingMode: "auto_height" as const,
      runs: [
        {
          start: 0,
          end: 4,
          style: {
            color: "#dc2626",
            fontSize: 36,
            fontWeight: 700,
            italic: true,
            decoration: "underline" as const,
          },
        },
      ],
      paragraphs: [],
      links: [],
    }

    const state = projectFabricTextState(node)

    expect(state.displayText).toContain("\n")
    expect(state.layoutLines[0]?.segments[0]).toMatchObject({
      text: "Bold",
      style: {
        color: "#dc2626",
        fontFamily: "Geist Variable",
        fontSize: 36,
        fontWeight: 700,
        italic: true,
        decoration: "underline",
      },
    })
    expect(fabricTextObjectOptions(node, state).styles).toEqual({})
    expect(state.editingStyles[0]?.[0]).toMatchObject({
      fill: "#dc2626",
      fontFamily: "Geist Variable",
      fontSize: 36,
      fontWeight: 700,
      fontStyle: "italic",
      underline: true,
      linethrough: false,
    })
    expect(state.editingStyles[0]?.[4]).toBeUndefined()
  })

  it("maps projected list markers and soft wraps back to authored offsets", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const text = "Alpha beta gamma delta epsilon"
    const state = projectFabricTextState({
      ...source,
      text,
      width: 180,
      height: 200,
      sizingMode: "auto_height",
      paragraphs: [
        {
          start: 0,
          end: text.length,
          style: { list: { kind: "bulleted", level: 0 } },
        },
      ],
    })
    const markerLength = state.displayText.indexOf("Alpha")
    const softWrap = state.displayText.indexOf("\n")

    expect(state.editingListMarkers).toEqual(["• "])
    expect(markerLength).toBeGreaterThan(0)
    expect(projectedTextOffsetToSource(state.layoutLines, 0)).toBe(0)
    expect(projectedTextOffsetToSource(state.layoutLines, markerLength)).toBe(0)
    expect(
      projectedTextOffsetToSource(state.layoutLines, markerLength + 3)
    ).toBe(3)
    expect(softWrap).toBeGreaterThan(0)
    expect(projectedTextOffsetToSource(state.layoutLines, softWrap)).toBe(
      state.layoutLines[0]?.sourceEnd
    )
    expect(
      projectedTextOffsetToSource(state.layoutLines, state.displayText.length)
    ).toBe(text.length)
  })

  it("writes rich text beside plain text and honors paste-as-plain", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const values = new Map<string, string>()
    const clipboard = {
      getData: (type: string) => values.get(type) ?? "",
      setData: (type: string, value: string) => {
        values.set(type, value)
      },
    }

    expect(
      writeTextEditingClipboardData(clipboard, source, {
        anchor: 0,
        focus: Math.min(4, source.text.length),
      })
    ).toBe(true)
    expect(values.get("text/plain")).toBe(source.text.slice(0, 4))
    expect(readTextEditingClipboardData(clipboard)).toMatchObject({
      kind: "rich",
      payload: { text: source.text.slice(0, 4) },
    })
    expect(readTextEditingClipboardData(clipboard, true)).toEqual({
      kind: "plain",
      text: source.text.slice(0, 4),
    })
    expect(
      writeTextEditingClipboardData(clipboard, source, {
        anchor: 2,
        focus: 2,
      })
    ).toBe(false)
  })

  it("records changed text before a fast second edit can exit", () => {
    const canonicalText = new Map([["text-1", "Before"]])

    expect(recordTextEdit(canonicalText, "text-1", "After")).toEqual({
      text: "After",
    })
    expect(canonicalText.get("text-1")).toBe("After")
    expect(recordTextEdit(canonicalText, "text-1", "After")).toBeNull()
  })

  it("bridges Fabric grapheme indexes to canonical UTF-16 selections", () => {
    const text = Object.create(Textbox.prototype) as Textbox
    Object.assign(text, {
      text: "A😀B",
      selectionStart: 1,
      selectionEnd: 2,
      hiddenTextarea: null,
      graphemeSplit: (value: string) => Array.from(value),
    })

    expect(fabricTextSelection(text)).toEqual({ anchor: 1, focus: 3 })
  })

  it("commits text and rich ranges together as one direct-edit patch", () => {
    const baseline = renderConformanceDocument.nodes.find(
      (candidate) => candidate.type === "text"
    )!
    if (baseline.type !== "text") throw new Error("Expected text")
    const draft = {
      ...baseline,
      runs: [{ start: 0, end: 2, style: { italic: true } }],
    }

    expect(richTextEditPatch(baseline, draft)).toEqual({
      text: draft.text,
      runs: draft.runs,
      paragraphs: draft.paragraphs,
      links: draft.links,
    })
    expect(richTextEditPatch(draft, structuredClone(draft))).toBeNull()
  })

  it("restores the edit baseline on cancel and commits once on normal exit", () => {
    expect(resolveTextEditExit("Before", "Draft", true)).toEqual({
      cancelled: true,
      text: "Before",
      patch: null,
    })
    expect(resolveTextEditExit("Before", "After", false)).toEqual({
      cancelled: false,
      text: "After",
      patch: { text: "After" },
    })
    expect(resolveTextEditExit("Same", "Same", false).patch).toBeNull()
  })

  it("cleans up the hidden textarea when an active edit is cancelled", () => {
    const blur = vi.fn()
    const set = vi.fn(function (this: Textbox, patch: { text: string }) {
      this.text = patch.text
      return this
    })
    const exitEditing = vi.fn(function (this: Textbox) {
      this.isEditing = false
      return this
    })
    const text = Object.create(Textbox.prototype) as Textbox
    Object.assign(text, {
      text: "Draft",
      isEditing: true,
      hiddenTextarea: { value: "Draft", blur },
      set,
      exitEditing,
    })

    expect(cancelFabricTextEditing(text, "Before")).toBe(true)
    expect(text.text).toBe("Before")
    expect(exitEditing).toHaveBeenCalledOnce()
    expect(blur).toHaveBeenCalledOnce()
    expect(text.hiddenTextarea?.value).toBe("Before")
    expect(cancelFabricTextEditing(text, "Before")).toBe(false)
  })

  it("applies list edits through Fabric's textarea without emitting an interim patch", () => {
    const textarea = {
      value: "• Alpha",
      selectionStart: 7,
      selectionEnd: 7,
    } as HTMLTextAreaElement
    const updateFromTextArea = vi.fn()
    const text = Object.create(Textbox.prototype) as Textbox
    Object.assign(text, { hiddenTextarea: textarea, updateFromTextArea })
    const edit = continuePlainTextList(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    )!

    expect(applyFabricTextListEdit(text, edit)).toBe(true)
    expect(textarea).toMatchObject({
      value: "• Alpha\n• ",
      selectionStart: 10,
      selectionEnd: 10,
    })
    expect(updateFromTextArea).toHaveBeenCalledOnce()
  })

  it("settles list keyboard work as one direct-edit patch on exit", () => {
    const baseline = "1. Parent\n2. Child"
    const indented = indentPlainTextList(baseline, 12, 12, "indent")!
    const continued = continuePlainTextList(
      indented.text,
      indented.selectionStart + 5,
      indented.selectionStart + 5
    )!

    expect(resolveTextEditExit(baseline, continued.text, false).patch).toEqual({
      text: continued.text,
    })
  })

  it("removes a list marker through the textarea and waits for edit exit", () => {
    const textarea = {
      value: "2. Item",
      selectionStart: 3,
      selectionEnd: 3,
    } as HTMLTextAreaElement
    const updateFromTextArea = vi.fn()
    const text = Object.create(Textbox.prototype) as Textbox
    Object.assign(text, { hiddenTextarea: textarea, updateFromTextArea })
    const edit = removePlainTextListMarker(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    )!

    expect(applyFabricTextListEdit(text, edit)).toBe(true)
    expect(textarea).toMatchObject({
      value: "Item",
      selectionStart: 0,
      selectionEnd: 0,
    })
    expect(updateFromTextArea).toHaveBeenCalledOnce()
  })

  it("commits navigation exits but cancels review and document replacement", () => {
    expect(textEditFinalizationPolicy("select")).toBe("commit")
    expect(textEditFinalizationPolicy("page_change")).toBe("commit")
    expect(textEditFinalizationPolicy("document_replace")).toBe("cancel")
    expect(textEditFinalizationPolicy("review_lock")).toBe("cancel")
  })

  it("does not end editing when React echoes the same text selection", () => {
    expect(
      shouldPreserveTextEditingSelection("text-1", {
        pageId: "page-1",
        nodeIds: ["text-1"],
      })
    ).toBe(true)
    expect(
      shouldPreserveTextEditingSelection("text-1", {
        pageId: "page-1",
        nodeIds: ["text-2"],
      })
    ).toBe(false)
    expect(shouldPreserveTextEditingSelection("text-1", null)).toBe(false)
  })

  it("rolls the canonical edit cache back when Studio rejects a commit", () => {
    const textByNodeId = new Map([["text-1", "Draft"]])

    expect(
      settleTextEditCache(textByNodeId, "text-1", "Before", "Draft", false)
    ).toBe("Before")
    expect(textByNodeId.get("text-1")).toBe("Before")
    expect(
      settleTextEditCache(textByNodeId, "text-1", "Before", "After", undefined)
    ).toBe("After")
  })

  it("exposes only the resize controls allowed by each text sizing mode", () => {
    expect(fabricTextControlVisibility("auto_width")).toEqual({
      tl: false,
      tr: false,
      bl: false,
      br: false,
      ml: false,
      mr: false,
      mt: false,
      mb: false,
      mtr: true,
    })
    expect(fabricTextControlVisibility("auto_height")).toEqual({
      tl: false,
      tr: false,
      bl: false,
      br: false,
      ml: true,
      mr: true,
      mt: false,
      mb: false,
      mtr: true,
    })
    expect(Object.values(fabricTextControlVisibility("fixed"))).toEqual(
      Array(9).fill(true)
    )
  })

  it("cannot persist Fabric geometry on a managed text axis", () => {
    const geometry = { x: 12, y: 20, width: 300, height: 140, rotation: 5 }

    expect(constrainTextGeometryPatch("fixed", geometry)).toEqual(geometry)
    expect(constrainTextGeometryPatch("auto_height", geometry)).toEqual({
      x: 12,
      y: 20,
      width: 300,
      rotation: 5,
    })
    expect(constrainTextGeometryPatch("auto_width", geometry)).toEqual({
      x: 12,
      y: 20,
      rotation: 5,
    })
  })

  it("uses a standalone object's canonical origin instead of control bounds", () => {
    const object = new Rect({
      left: 470,
      top: 727,
      width: 300,
      height: 300,
      originX: "left",
      originY: "top",
      padding: 10,
      strokeWidth: 0,
    })

    expect(fabricObjectToNodePatch(object)).toMatchObject({ x: 470, y: 727 })
  })

  it("keeps bordered shape outer dimensions equal to the canonical frame", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "rect-stroke-radius"
    )!
    if (node.type !== "rect") throw new Error("Expected rectangle")
    const object = createFabricSyncObject(node)

    expect(object).toBeInstanceOf(Rect)
    expect(object.getScaledWidth()).toBe(node.width)
    expect(object.getScaledHeight()).toBe(node.height)
    expect(fabricObjectToNodePatch(object)).toMatchObject({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
    })
  })

  it("maps fill, fit, and manual paint projections to the same Fabric affine", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    if (fixture.type !== "image") throw new Error("Expected image")
    const naturalSize = { width: 400, height: 240 }

    for (const placement of [
      fixture.placement,
      {
        ...fixture.placement,
        mode: "fit" as const,
        focalX: 0.8,
        focalY: 0.1,
        rotation: -19,
      },
      {
        ...fixture.placement,
        mode: "manual" as const,
        focalX: 0.75,
        focalY: 0.2,
        zoom: 1.7,
        rotation: 31,
        flipX: true,
        flipY: true,
      },
    ]) {
      const node = { ...fixture, placement }
      const state = projectFabricImagePaint(node, naturalSize)
      const group = createFabricImageGroup(
        node,
        decodedFabricImage(node.src, naturalSize)
      )
      const image = group
        .getObjects()
        .find((child): child is FabricImage => child instanceof FabricImage)

      expect(image).toBeDefined()
      expectFabricImageAffine(image!, node, [
        state.sourceToFrame.a,
        state.sourceToFrame.b,
        state.sourceToFrame.c,
        state.sourceToFrame.d,
        state.sourceToFrame.e,
        state.sourceToFrame.f,
      ])
      expect(group.width).toBe(node.width)
      expect(group.height).toBe(node.height)
      expect(fabricObjectToNodePatch(group)).toMatchObject({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
      })
    }
  })

  it("maps every retained 1x/2x image affine and frame mask into Fabric", () => {
    for (const fixture of imageRenderParityCases) {
      for (const pixelRatio of imageRenderParityPixelRatios) {
        const input = imageRenderParityInput(fixture, pixelRatio)
        const node = imageRenderParityNode(fixture, pixelRatio)
        const expected = projectImagePaint(input)
        const state = projectFabricImagePaint(node, input.naturalSize)
        expect(state.sourceToFrame).toEqual(expected.sourceToFrame)
        expect(state.clip).toEqual(expected.clip)

        const group = createFabricImageGroup(
          node,
          decodedFabricImage(node.src, input.naturalSize)
        )
        const image = group
          .getObjects()
          .find((child): child is FabricImage => child instanceof FabricImage)
        expect(image).toBeDefined()
        expectFabricImageAffine(image!, node, [
          expected.sourceToFrame.a,
          expected.sourceToFrame.b,
          expected.sourceToFrame.c,
          expected.sourceToFrame.d,
          expected.sourceToFrame.e,
          expected.sourceToFrame.f,
        ])

        if (expected.clip.shape === "ellipse") {
          expect(group.clipPath).toBeInstanceOf(Ellipse)
          expect(group.clipPath).toMatchObject({
            left: 0,
            top: 0,
            rx: expected.clip.radiusX,
            ry: expected.clip.radiusY,
            originX: "center",
            originY: "center",
          })
        } else {
          expect(group.clipPath).toBeInstanceOf(Rect)
          expect(group.clipPath).toMatchObject({
            left: 0,
            top: 0,
            width: expected.clip.width,
            height: expected.clip.height,
            rx:
              expected.clip.shape === "rounded_rectangle"
                ? expected.clip.radius
                : 0,
            ry:
              expected.clip.shape === "rounded_rectangle"
                ? expected.clip.radius
                : 0,
            originX: "center",
            originY: "center",
          })
        }
        expect(fabricObjectToNodePatch(group)).toMatchObject({
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
        })
      }
    }
  })

  it("enters manual crop from Fit without changing the visible pixels", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-contain"
    )!
    if (fixture.type !== "image") throw new Error("Expected image")
    const naturalSize = { width: 400, height: 240 }
    const manual = projectFabricImageCropDrag(
      fixture,
      naturalSize,
      fixture.placement,
      { x: 0, y: 0 }
    )
    const fitPaint = projectImagePaint({
      frame: fixture,
      naturalSize,
      placement: fixture.placement,
      frameMask: fixture.frameMask,
    })
    const manualPaint = projectImagePaint({
      frame: fixture,
      naturalSize,
      placement: manual,
      frameMask: fixture.frameMask,
    })

    expect(manual.mode).toBe("manual")
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      expect(manualPaint.sourceToFrame[key]).toBeCloseTo(
        fitPaint.sourceToFrame[key],
        10
      )
    }
  })

  it("routes crop dragging through preview while the frame and history stay fixed", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const peerNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "rect-stroke-radius"
    )!
    if (fixture.type !== "image" || peerNode.type !== "rect") {
      throw new Error("Expected image and rectangle")
    }
    const image = decodedFabricImage(fixture.src, {
      width: 400,
      height: 240,
    })
    const group = createFabricImageGroup(fixture, image)
    const peer = createFabricSyncObject(peerNode)
    const onNodesChange = vi.fn()
    const onImageCropPreview = vi.fn()
    const requestRenderAll = vi.fn()
    const setActiveObject = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
      onImageCropPreview,
    })
    const objectByNodeId = Reflect.get(adapter, "objectByNodeId") as Map<
      string,
      Rect | Group
    >
    const nodeByNodeId = Reflect.get(adapter, "nodeByNodeId") as Map<
      string,
      typeof fixture | typeof peerNode
    >
    const nodeIdByObject = Reflect.get(adapter, "nodeIdByObject") as WeakMap<
      Rect | Group,
      string
    >
    objectByNodeId.set(fixture.id, group)
    objectByNodeId.set(peerNode.id, peer)
    nodeByNodeId.set(fixture.id, fixture)
    nodeByNodeId.set(peerNode.id, peerNode)
    nodeIdByObject.set(group, fixture.id)
    nodeIdByObject.set(peer, peerNode.id)
    Reflect.set(adapter, "canvas", { requestRenderAll, setActiveObject })

    const frameBefore = fabricObjectToNodePatch(group)
    const frameClipBefore = group.clipPath
    const objectCachingBefore = group.objectCaching
    expect(
      adapter.setImageCropMode({
        nodeId: fixture.id,
        placement: fixture.placement,
      })
    ).toBe(true)
    expect(group).toMatchObject({
      selectable: false,
      evented: true,
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      objectCaching: false,
    })
    expect(group.clipPath).toBeUndefined()
    expect(peer).toMatchObject({ selectable: false, evented: false })

    const peerBefore = fabricObjectToNodePatch(peer)
    peer.set({ left: peer.left + 20, top: peer.top + 10 })
    Reflect.get(adapter, "onObjectMoving")({ target: peer })
    expect(fabricObjectToNodePatch(peer)).toEqual(peerBefore)
    expect(onNodesChange).not.toHaveBeenCalled()

    const event = { button: 0, preventDefault: vi.fn() }
    const pointerEvent = (x: number, y: number) => ({
      e: event,
      target: group,
      scenePoint: { x, y },
      viewportPoint: { x, y },
    })
    Reflect.get(adapter, "onImageCropPointerDown")(pointerEvent(360, 520))
    Reflect.get(adapter, "onImageCropPointerMove")(pointerEvent(395, 540))
    Reflect.get(adapter, "onImageCropPointerUp")(pointerEvent(395, 540))

    expect(onImageCropPreview).toHaveBeenCalledOnce()
    expect(onImageCropPreview).toHaveBeenCalledWith({
      nodeId: fixture.id,
      placement: expect.objectContaining({ mode: "manual" }),
    })
    expect(onNodesChange).not.toHaveBeenCalled()
    expect(fabricObjectToNodePatch(group)).toEqual(frameBefore)

    Reflect.get(adapter, "onObjectModified")({ target: group })
    expect(onNodesChange).not.toHaveBeenCalled()
    expect(fabricObjectToNodePatch(group)).toEqual(frameBefore)

    expect(adapter.setImageCropMode(null)).toBe(true)
    expect(group.clipPath).toBe(frameClipBefore)
    expect(group).toMatchObject({
      selectable: true,
      evented: true,
      hasControls: true,
      lockMovementX: false,
      lockMovementY: false,
      objectCaching: objectCachingBefore,
    })
    expect(peer).toMatchObject({ selectable: true, evented: true })
    expect(setActiveObject).toHaveBeenCalledWith(group)

    group.set({ left: group.left + 12 })
    Reflect.get(adapter, "onObjectModified")({ target: group })
    expect(onNodesChange).toHaveBeenCalledOnce()
    expect(onNodesChange).toHaveBeenCalledWith([
      {
        nodeId: fixture.id,
        patch: expect.objectContaining({ x: fixture.x + 12 }),
      },
    ])
  })

  it("reveals one canonical image outside every frame mask and restores the exact clip", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    if (fixture.type !== "image") throw new Error("Expected image")

    for (const frameMask of [
      { shape: "rectangle" as const },
      { shape: "rounded_rectangle" as const, radius: 0.2 },
      { shape: "ellipse" as const },
    ]) {
      const node = { ...fixture, frameMask }
      const image = decodedFabricImage(node.src, {
        width: 400,
        height: 240,
      })
      const group = createFabricImageGroup(node, image)
      const clipBefore = group.clipPath
      const cachingBefore = group.objectCaching
      const adapter = new FabricCanvasAdapter({
        onSelectionChange: vi.fn(),
        onNodesChange: vi.fn(),
      })
      const objectByNodeId = Reflect.get(adapter, "objectByNodeId") as Map<
        string,
        Group
      >
      const nodeByNodeId = Reflect.get(adapter, "nodeByNodeId") as Map<
        string,
        typeof node
      >
      objectByNodeId.set(node.id, group)
      nodeByNodeId.set(node.id, node)
      Reflect.set(adapter, "canvas", {
        requestRenderAll: vi.fn(),
        setActiveObject: vi.fn(),
      })

      expect(
        adapter.setImageCropMode({
          nodeId: node.id,
          placement: node.placement,
        })
      ).toBe(true)
      expect(group.getObjects()).toContain(image)
      expect(group.clipPath).toBeUndefined()
      expect(group.objectCaching).toBe(false)
      expect(fabricObjectToNodePatch(group)).toMatchObject({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
      })

      expect(adapter.setImageCropMode(null)).toBe(true)
      expect(group.clipPath).toBe(clipBefore)
      expect(group.objectCaching).toBe(cachingBefore)
      expect(group.getObjects()).toContain(image)
    }
  })

  it("paints a frame, placement, and mask draft without syncing the document", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    if (fixture.type !== "image") throw new Error("Expected image")
    const image = decodedFabricImage(fixture.src, {
      width: 400,
      height: 240,
    })
    const group = createFabricImageGroup(fixture, image)
    const clipBefore = group.clipPath
    const requestRenderAll = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange: vi.fn(),
    })
    const objectByNodeId = Reflect.get(adapter, "objectByNodeId") as Map<
      string,
      Group
    >
    const nodeByNodeId = Reflect.get(adapter, "nodeByNodeId") as Map<
      string,
      typeof fixture
    >
    objectByNodeId.set(fixture.id, group)
    nodeByNodeId.set(fixture.id, fixture)
    Reflect.set(adapter, "canvas", {
      requestRenderAll,
      setActiveObject: vi.fn(),
    })

    expect(
      adapter.setImageCropMode({
        nodeId: fixture.id,
        placement: fixture.placement,
      })
    ).toBe(true)
    expect(
      adapter.previewImageCropDraft({
        nodeId: fixture.id,
        frame: {
          x: fixture.x + 24,
          y: fixture.y + 16,
          width: fixture.width - 40,
          height: fixture.height - 30,
          rotation: fixture.rotation + 8,
        },
        placement: {
          ...fixture.placement,
          mode: "manual",
          focalX: 0.7,
          zoom: 1.3,
        },
        frameMask: { shape: "ellipse" },
      })
    ).toBe(true)
    expect(fabricObjectToNodePatch(group)).toMatchObject({
      x: fixture.x + 24,
      y: fixture.y + 16,
      width: fixture.width - 40,
      height: fixture.height - 30,
      rotation: fixture.rotation + 8,
    })
    expect(group.clipPath).toBeUndefined()
    expect(Reflect.get(adapter, "nodeByNodeId").get(fixture.id)).toBe(fixture)

    expect(adapter.setImageCropMode(null)).toBe(true)
    expect(fabricObjectToNodePatch(group)).toMatchObject({
      x: fixture.x,
      y: fixture.y,
      width: fixture.width,
      height: fixture.height,
      rotation: fixture.rotation,
    })
    expect(group.clipPath).toBe(clipBefore)
    expect(requestRenderAll).toHaveBeenCalled()
  })

  it("keeps the frame fixed and replaces only frame-local clip geometry", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    if (fixture.type !== "image") throw new Error("Expected image")
    const image = decodedFabricImage(fixture.src, {
      width: 400,
      height: 240,
    })
    const group = createFabricImageGroup(
      { ...fixture, frameMask: { shape: "ellipse" } },
      image
    )
    const frame = group
      .getObjects()
      .find(
        (child): child is Rect =>
          child instanceof Rect && !(child instanceof FabricImage)
      )

    expect(group.clipPath).toBeInstanceOf(Ellipse)
    expect(group.clipPath).toMatchObject({
      left: 0,
      top: 0,
      rx: fixture.width / 2,
      ry: fixture.height / 2,
      originX: "center",
      originY: "center",
    })
    expect(frame).toMatchObject({
      left: -fixture.width / 2,
      top: -fixture.height / 2,
      width: fixture.width,
      height: fixture.height,
    })

    const updated = {
      ...fixture,
      width: 410,
      height: 230,
      placement: {
        ...fixture.placement,
        mode: "manual" as const,
        zoom: 2,
        rotation: 27,
        flipY: true,
      },
      frameMask: { shape: "rounded_rectangle" as const, radius: 0.2 },
    }
    syncFabricObjectFromNode(group, updated)

    const syncedImage = group
      .getObjects()
      .find((child): child is FabricImage => child instanceof FabricImage)
    expect(syncedImage).toBe(image)
    expect(group.width).toBe(updated.width)
    expect(group.height).toBe(updated.height)
    expect(group.clipPath).toBeInstanceOf(Rect)
    expect(group.clipPath).toMatchObject({
      left: 0,
      top: 0,
      width: updated.width,
      height: updated.height,
      rx: 46,
      ry: 46,
      originX: "center",
      originY: "center",
    })
    expect(frame).toMatchObject({
      left: -updated.width / 2,
      top: -updated.height / 2,
      width: updated.width,
      height: updated.height,
    })
  })

  it("rejects decoded images without usable natural dimensions", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    if (fixture.type !== "image") throw new Error("Expected image")
    const invalidImage = decodedFabricImage(fixture.src, {
      width: 0,
      height: 0,
    })

    expect(() => createFabricImageGroup(fixture, invalidImage)).toThrow(
      "Decoded image must have finite positive natural dimensions"
    )
  })

  it("keeps syncing later canvas objects when one image source rejects", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const rectNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "rect-stroke-radius"
    )!
    if (imageNode.type !== "image" || rectNode.type !== "rect") {
      throw new Error("Expected image and rectangle fixtures")
    }
    const rejectedSource = {
      ...imageNode,
      src: "asset:local/missing-canvas-image",
    }
    const loadImage = vi.fn().mockRejectedValue(new Error("decode failed"))
    const objects = []

    for (const node of [rejectedSource, rectNode]) {
      objects.push(await createFabricObjectForSync(node, loadImage))
    }

    expect(objects).toHaveLength(2)
    expect(isMissingImagePlaceholder(objects[0]!)).toBe(true)
    expect(JSON.stringify(objects[0]!.toObject())).toContain(
      "Image unavailable"
    )
    expect(objects[1]).toBeInstanceOf(Rect)
    expect(loadImage).toHaveBeenCalledOnce()
    expect(JSON.stringify(objects[0]!.toObject())).not.toContain(
      "asset:local/missing-canvas-image"
    )
  })

  it("propagates cancellation instead of converting it to a missing-image placeholder", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    if (imageNode.type !== "image") throw new Error("Expected image fixture")
    const controller = new AbortController()
    const reason = new DOMException("Canvas sync timed out", "TimeoutError")
    let observedSignal: AbortSignal | undefined
    const loadImage = vi.fn(
      (_node: typeof imageNode, signal?: AbortSignal) =>
        new Promise<FabricObject>((_resolve, reject) => {
          observedSignal = signal
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )
    const loading = createFabricObjectForSync(
      imageNode,
      loadImage,
      controller.signal
    )

    controller.abort(reason)

    await expect(loading).rejects.toBe(reason)
    expect(observedSignal).toBe(controller.signal)
  })

  it.each([
    { width: 1, height: 1 },
    { width: 10, height: 10 },
    { width: 50, height: 20 },
    { width: 420, height: 280 },
  ])(
    "keeps a $width x $height missing-image placeholder inside its canonical frame",
    async ({ width, height }) => {
      const source = renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "image-cover"
      )!
      if (source.type !== "image") throw new Error("Expected image fixture")
      const placeholder = await createFabricObjectForSync(
        {
          ...source,
          width,
          height,
          src: `asset:local/missing-${width}-${height}`,
        },
        vi.fn().mockRejectedValue(new Error("decode failed"))
      )

      expect(isMissingImagePlaceholder(placeholder)).toBe(true)
      expect(placeholder.width).toBe(width)
      expect(placeholder.height).toBe(height)
      expect(placeholder.getScaledWidth()).toBe(width)
      expect(placeholder.getScaledHeight()).toBe(height)
      expect(
        JSON.stringify(placeholder.toObject()).includes("Image unavailable")
      ).toBe(width >= 96 && height * 0.16 >= 14)
    }
  )

  it("contains an image rejection across the complete adapter sync", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const rectNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "rect-stroke-radius"
    )!
    const sourcePage = renderConformanceDocument.pages.find((page) =>
      page.nodeIds.includes(imageNode.id)
    )!
    if (imageNode.type !== "image" || rectNode.type !== "rect") {
      throw new Error("Expected image and rectangle fixtures")
    }
    const rejectedSource = {
      ...imageNode,
      src: "asset:local/missing-adapter-image",
    }
    const document = {
      ...renderConformanceDocument,
      nodes: [rejectedSource, rectNode],
      pages: [
        {
          ...sourcePage,
          nodeIds: [rejectedSource.id, rectNode.id],
        },
      ],
      groups: [],
    }
    const added = []
    const fakeCanvas = {
      backgroundColor: "",
      add: vi.fn((object) => added.push(object)),
      clear: vi.fn(),
      discardActiveObject: vi.fn(),
      getActiveObjects: vi.fn(() => []),
      moveObjectTo: vi.fn(),
      remove: vi.fn(),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
      setDimensions: vi.fn(),
    }
    const adapter = new FabricCanvasAdapter({
      onNodesChange: vi.fn(),
      onSelectionChange: vi.fn(),
      onTextEditRequest: vi.fn(),
    })
    Reflect.set(adapter, "canvas", fakeCanvas)
    const fromUrl = vi
      .spyOn(FabricImage, "fromURL")
      .mockRejectedValueOnce(new Error("decode failed"))

    await adapter.sync(document, sourcePage.id)

    expect(added).toHaveLength(2)
    expect(isMissingImagePlaceholder(added[0]!)).toBe(true)
    expect(added[1]).toBeInstanceOf(Rect)
    expect(fakeCanvas.moveObjectTo.mock.calls.map((call) => call[1])).toEqual([
      0, 1,
    ])
    expect(fakeCanvas.requestRenderAll).toHaveBeenCalledOnce()
    expect(fromUrl).toHaveBeenCalledOnce()
    const objectByNodeId = Reflect.get(adapter, "objectByNodeId") as Map<
      string,
      unknown
    >
    expect([...objectByNodeId.keys()]).toEqual([rejectedSource.id, rectNode.id])
    expect(
      adapter.setImageCropMode({
        nodeId: rejectedSource.id,
        placement: rejectedSource.placement,
      })
    ).toBe(false)
    expect(adapter.getImageSourceReadiness(rejectedSource.id)).toBe(
      "unavailable"
    )
    expect(adapter.getImageNaturalSize(rejectedSource.id)).toBeNull()
    expect(adapter.getImageSourceReadiness(rectNode.id)).toBeNull()
    expect(adapter.getImageNaturalSize(rectNode.id)).toBeNull()
    expect(Reflect.get(adapter, "imageCropMode")).toBeNull()

    fakeCanvas.setDimensions.mockClear()
    fakeCanvas.moveObjectTo.mockClear()
    await adapter.sync(document, sourcePage.id)
    expect(fakeCanvas.setDimensions).not.toHaveBeenCalled()
    expect(fakeCanvas.moveObjectTo).not.toHaveBeenCalled()
    expect(fromUrl).toHaveBeenCalledOnce()
    fromUrl.mockRestore()
  })

  it("retries only the requested missing image and preserves its stack and selection", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const rectNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "rect-stroke-radius"
    )!
    const sourcePage = renderConformanceDocument.pages.find((page) =>
      page.nodeIds.includes(imageNode.id)
    )!
    if (imageNode.type !== "image" || rectNode.type !== "rect") {
      throw new Error("Expected image and rectangle fixtures")
    }
    const missingImage = {
      ...imageNode,
      src: "asset:local/retry-missing-image",
    }
    const document = {
      ...renderConformanceDocument,
      nodes: [missingImage, rectNode],
      pages: [{ ...sourcePage, nodeIds: [missingImage.id, rectNode.id] }],
      groups: [],
    }
    const objects: FabricObject[] = []
    let selected: FabricObject[] = []
    const fakeCanvas = {
      backgroundColor: "",
      add: vi.fn((object: FabricObject) => objects.push(object)),
      clear: vi.fn(() => objects.splice(0)),
      discardActiveObject: vi.fn(() => {
        selected = []
      }),
      getActiveObjects: vi.fn(() => selected),
      getObjects: vi.fn(() => objects),
      moveObjectTo: vi.fn((object: FabricObject, index: number) => {
        const currentIndex = objects.indexOf(object)
        if (currentIndex >= 0) objects.splice(currentIndex, 1)
        objects.splice(index, 0, object)
      }),
      remove: vi.fn((object: FabricObject) => {
        const index = objects.indexOf(object)
        if (index >= 0) objects.splice(index, 1)
      }),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn((object: FabricObject) => {
        selected = [object]
      }),
      setDimensions: vi.fn(),
    }
    const adapter = new FabricCanvasAdapter({
      onNodesChange: vi.fn(),
      onSelectionChange: vi.fn(),
    })
    Reflect.set(adapter, "canvas", fakeCanvas)
    const fromUrl = vi
      .spyOn(FabricImage, "fromURL")
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce(decodedFabricImage(missingImage.src, imageNode))

    await adapter.sync(document, sourcePage.id)
    const placeholder = objects[0]!
    const untouchedRectangle = objects[1]!
    selected = [placeholder]

    await expect(adapter.retryImageSource(missingImage.id)).resolves.toBe(
      "ready"
    )

    expect(objects).toHaveLength(2)
    expect(objects[0]).not.toBe(placeholder)
    expect(objects[1]).toBe(untouchedRectangle)
    expect(isMissingImagePlaceholder(objects[0]!)).toBe(false)
    expect(fakeCanvas.remove).toHaveBeenCalledOnce()
    expect(fakeCanvas.remove).toHaveBeenCalledWith(placeholder)
    expect(fakeCanvas.moveObjectTo).toHaveBeenLastCalledWith(objects[0], 0)
    expect(fakeCanvas.setActiveObject).toHaveBeenCalledWith(objects[0])
    expect(adapter.getImageSourceReadiness(missingImage.id)).toBe("ready")
    expect(fromUrl).toHaveBeenCalledTimes(2)
    fromUrl.mockRestore()
  })

  it("leaves a missing image and every sibling untouched when its retry fails", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const sourcePage = renderConformanceDocument.pages.find((page) =>
      page.nodeIds.includes(imageNode.id)
    )!
    if (imageNode.type !== "image") throw new Error("Expected image fixture")
    const missingImage = {
      ...imageNode,
      src: "asset:local/retry-still-missing",
    }
    const objects: FabricObject[] = []
    const fakeCanvas = {
      backgroundColor: "",
      add: vi.fn((object: FabricObject) => objects.push(object)),
      clear: vi.fn(() => objects.splice(0)),
      discardActiveObject: vi.fn(),
      getActiveObjects: vi.fn(() => []),
      getObjects: vi.fn(() => objects),
      moveObjectTo: vi.fn(),
      remove: vi.fn(),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
      setDimensions: vi.fn(),
    }
    const adapter = new FabricCanvasAdapter({
      onNodesChange: vi.fn(),
      onSelectionChange: vi.fn(),
    })
    Reflect.set(adapter, "canvas", fakeCanvas)
    const fromUrl = vi
      .spyOn(FabricImage, "fromURL")
      .mockRejectedValue(new Error("decode failed"))
    await adapter.sync(
      {
        ...renderConformanceDocument,
        nodes: [missingImage],
        pages: [{ ...sourcePage, nodeIds: [missingImage.id] }],
        groups: [],
      },
      sourcePage.id
    )
    const placeholder = objects[0]!
    fakeCanvas.remove.mockClear()
    fakeCanvas.add.mockClear()

    await expect(adapter.retryImageSource(missingImage.id)).resolves.toBe(
      "unavailable"
    )

    expect(objects).toEqual([placeholder])
    expect(fakeCanvas.remove).not.toHaveBeenCalled()
    expect(fakeCanvas.add).not.toHaveBeenCalled()
    expect(adapter.getImageSourceReadiness(missingImage.id)).toBe("unavailable")
    expect(fromUrl).toHaveBeenCalledTimes(2)
    fromUrl.mockRestore()
  })

  it("keeps old pixels mounted until a decoded replacement swaps atomically", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const sourcePage = renderConformanceDocument.pages.find((page) =>
      page.nodeIds.includes(imageNode.id)
    )!
    if (imageNode.type !== "image") throw new Error("Expected image fixture")
    const replacementNode = {
      ...imageNode,
      src: "https://cdn.example.com/replacement.jpg",
    }
    const documentWith = (node: typeof imageNode) => ({
      ...renderConformanceDocument,
      nodes: [node],
      pages: [{ ...sourcePage, nodeIds: [node.id] }],
      groups: [],
    })
    const added: FabricObject[] = []
    const fakeCanvas = {
      backgroundColor: "",
      add: vi.fn((object: FabricObject) => added.push(object)),
      clear: vi.fn(),
      discardActiveObject: vi.fn(),
      getActiveObjects: vi.fn(() => []),
      moveObjectTo: vi.fn(),
      remove: vi.fn(),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
      setDimensions: vi.fn(),
    }
    const adapter = new FabricCanvasAdapter({
      onNodesChange: vi.fn(),
      onSelectionChange: vi.fn(),
    })
    Reflect.set(adapter, "canvas", fakeCanvas)
    let resolveReplacement!: (image: FabricImage) => void
    const replacementDecode = new Promise<FabricImage>((resolve) => {
      resolveReplacement = resolve
    })
    const fromUrl = vi
      .spyOn(FabricImage, "fromURL")
      .mockResolvedValueOnce(decodedFabricImage(imageNode.src, imageNode))
      .mockImplementationOnce(() => replacementDecode)

    await adapter.sync(documentWith(imageNode), sourcePage.id)
    const objectByNodeId = Reflect.get(adapter, "objectByNodeId") as Map<
      string,
      FabricObject
    >
    const oldObject = objectByNodeId.get(imageNode.id)
    const replacementSync = adapter.sync(
      documentWith(replacementNode),
      sourcePage.id
    )
    await Promise.resolve()

    expect(objectByNodeId.get(imageNode.id)).toBe(oldObject)
    expect(fakeCanvas.remove).not.toHaveBeenCalled()
    expect(adapter.getImageSourceReadiness(imageNode.id)).toBe("ready")

    resolveReplacement(decodedFabricImage(replacementNode.src, imageNode))
    await replacementSync

    const installed = objectByNodeId.get(imageNode.id)
    expect(installed).not.toBe(oldObject)
    expect(fakeCanvas.remove).toHaveBeenCalledOnce()
    expect(fakeCanvas.remove).toHaveBeenCalledWith(oldObject)
    expect(added.at(-1)).toBe(installed)
    expect(adapter.getImageSourceReadiness(imageNode.id)).toBe("ready")
    expect(adapter.getImageNaturalSize(imageNode.id)).toEqual({
      width: imageNode.width,
      height: imageNode.height,
    })
    fromUrl.mockRestore()
  })

  it("does not lose an image replacement when a newer sync supersedes its pending decode", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const sourcePage = renderConformanceDocument.pages.find((page) =>
      page.nodeIds.includes(imageNode.id)
    )!
    if (imageNode.type !== "image") throw new Error("Expected image fixture")
    const replacementNode = {
      ...imageNode,
      src: "https://cdn.example.com/superseding-replacement.jpg",
    }
    const documentWith = (node: typeof imageNode) => ({
      ...renderConformanceDocument,
      nodes: [node],
      pages: [{ ...sourcePage, nodeIds: [node.id] }],
      groups: [],
    })
    const objects: FabricObject[] = []
    const fakeCanvas = {
      backgroundColor: "",
      add: vi.fn((object: FabricObject) => objects.push(object)),
      clear: vi.fn(),
      discardActiveObject: vi.fn(),
      getActiveObjects: vi.fn(() => []),
      moveObjectTo: vi.fn(),
      remove: vi.fn((object: FabricObject) => {
        const index = objects.indexOf(object)
        if (index >= 0) objects.splice(index, 1)
      }),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
      setDimensions: vi.fn(),
    }
    const adapter = new FabricCanvasAdapter({
      onNodesChange: vi.fn(),
      onSelectionChange: vi.fn(),
    })
    Reflect.set(adapter, "canvas", fakeCanvas)

    let resolveStale!: (image: FabricImage) => void
    let resolveCurrent!: (image: FabricImage) => void
    const staleDecode = new Promise<FabricImage>((resolve) => {
      resolveStale = resolve
    })
    const currentDecode = new Promise<FabricImage>((resolve) => {
      resolveCurrent = resolve
    })
    const fromUrl = vi
      .spyOn(FabricImage, "fromURL")
      .mockResolvedValueOnce(decodedFabricImage(imageNode.src, imageNode))
      .mockImplementationOnce(() => staleDecode)
      .mockImplementationOnce(() => currentDecode)

    await adapter.sync(documentWith(imageNode), sourcePage.id)
    const oldObject = objects[0]
    const staleSync = adapter.sync(documentWith(replacementNode), sourcePage.id)
    await Promise.resolve()
    const currentSync = adapter.sync(
      documentWith(replacementNode),
      sourcePage.id
    )
    await Promise.resolve()

    expect(fromUrl).toHaveBeenCalledTimes(3)
    resolveCurrent(decodedFabricImage(replacementNode.src, imageNode))
    await currentSync
    resolveStale(decodedFabricImage(replacementNode.src, imageNode))
    await staleSync

    const installed = Reflect.get(adapter, "objectByNodeId").get(imageNode.id)
    expect(installed).not.toBe(oldObject)
    expect(objects).toEqual([installed])
    expect(fakeCanvas.remove).toHaveBeenCalledTimes(1)
    expect(Reflect.get(adapter, "nodeByNodeId").get(imageNode.id)).toBe(
      replacementNode
    )
    fromUrl.mockRestore()
  })

  it("retains old pixels when a replacement decode fails", async () => {
    const imageNode = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "image-cover"
    )!
    const sourcePage = renderConformanceDocument.pages.find((page) =>
      page.nodeIds.includes(imageNode.id)
    )!
    if (imageNode.type !== "image") throw new Error("Expected image fixture")
    const replacementNode = {
      ...imageNode,
      src: "https://cdn.example.com/broken-replacement.jpg",
    }
    const documentWith = (node: typeof imageNode) => ({
      ...renderConformanceDocument,
      nodes: [node],
      pages: [{ ...sourcePage, nodeIds: [node.id] }],
      groups: [],
    })
    const fakeCanvas = {
      backgroundColor: "",
      add: vi.fn(),
      clear: vi.fn(),
      discardActiveObject: vi.fn(),
      getActiveObjects: vi.fn(() => []),
      moveObjectTo: vi.fn(),
      remove: vi.fn(),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
      setDimensions: vi.fn(),
    }
    const adapter = new FabricCanvasAdapter({
      onNodesChange: vi.fn(),
      onSelectionChange: vi.fn(),
    })
    Reflect.set(adapter, "canvas", fakeCanvas)
    const fromUrl = vi
      .spyOn(FabricImage, "fromURL")
      .mockResolvedValueOnce(decodedFabricImage(imageNode.src, imageNode))
      .mockRejectedValueOnce(new Error("decode failed"))

    await adapter.sync(documentWith(imageNode), sourcePage.id)
    const objectByNodeId = Reflect.get(adapter, "objectByNodeId") as Map<
      string,
      FabricObject
    >
    const oldObject = objectByNodeId.get(imageNode.id)
    await adapter.sync(documentWith(replacementNode), sourcePage.id)

    expect(objectByNodeId.get(imageNode.id)).toBe(oldObject)
    expect(fakeCanvas.remove).not.toHaveBeenCalled()
    expect(fakeCanvas.add).toHaveBeenCalledOnce()
    expect(isMissingImagePlaceholder(objectByNodeId.get(imageNode.id)!)).toBe(
      false
    )
    expect(adapter.getImageSourceReadiness(imageNode.id)).toBe("unavailable")
    fromUrl.mockRestore()
  })

  it("honors the icon viewBox meet geometry instead of stretching path bounds", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "icon-viewbox"
    )!
    if (node.type !== "icon") throw new Error("Expected icon")
    const object = createFabricSyncObject(node)

    expect(object).toBeInstanceOf(Group)
    const path = object
      .getObjects()
      .find((child): child is Path => child instanceof Path)
    expect(path).toBeDefined()
    expect(path?.scaleX).toBe(3.75)
    expect(path?.scaleY).toBe(3.75)
    // Fabric stores children relative to the group's center. The path also
    // compensates its scaled stroke inset so its ink matches the SVG viewport.
    expect(path?.left).toBe(-36.5625)
    expect(path?.top).toBe(-36.5625)
    expect(object.getScaledWidth()).toBe(node.width)
    expect(object.getScaledHeight()).toBe(node.height)
  })

  it("compensates line stroke bounds without changing canonical geometry", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "diagonal-line"
    )!
    if (node.type !== "line") throw new Error("Expected line")
    const object = createFabricSyncObject(node)

    expect(fabricObjectToNodePatch(object)).toEqual({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
    })

    const moved = { ...node, x: node.x + 24, y: node.y - 12, rotation: 17 }
    syncFabricObjectFromNode(object, moved)
    expect(fabricObjectToNodePatch(object)).toMatchObject({
      x: moved.x,
      y: moved.y,
      rotation: moved.rotation,
    })
  })

  it("keeps icon viewport geometry stable across canonical resync", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "icon-viewbox"
    )!
    if (node.type !== "icon") throw new Error("Expected icon")
    const object = createFabricSyncObject(node)
    const resized = { ...node, width: 240, height: 120 }

    syncFabricObjectFromNode(object, resized)

    const path = object
      .getObjects()
      .find((child): child is Path => child instanceof Path)
    expect(path).toBeDefined()
    expect(path?.scaleX).toBe(5)
    expect(path?.scaleY).toBe(5)
    expect(path?.left).toBe(-48.75)
    expect(path?.top).toBe(-48.75)
    expect(fabricObjectToNodePatch(object)).toMatchObject({
      width: 240,
      height: 120,
    })
  })
})
