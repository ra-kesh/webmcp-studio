// @vitest-environment jsdom

import { Rect, Textbox, type TPointerEvent, type Transform } from "fabric"
import { describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import {
  createFabricSyncObject,
  fabricComparableNodeGeometry,
  fabricObjectToNodePatch,
  FabricCanvasAdapter,
  syncFabricObjectFromNode,
} from "../src/fabric-adapter"

describe("Fabric text resize constraints", () => {
  it("round-trips a rotated fixed clip without a first-transform jump", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (node.type !== "text") throw new Error("Expected fixed text")
    const page = renderConformanceDocument.pages.find((candidate) =>
      candidate.nodeIds.includes(node.id)
    )!
    const textbox = createFabricSyncObject(node)
    if (!(textbox instanceof Textbox)) throw new Error("Expected Textbox")
    expect(fabricObjectToNodePatch(textbox)).toEqual(
      fabricComparableNodeGeometry(node)
    )

    textbox.set({ left: textbox.left + 20, top: textbox.top + 10 })
    syncFabricObjectFromNode(textbox, node)
    expect(fabricObjectToNodePatch(textbox)).toEqual(
      fabricComparableNodeGeometry(node)
    )

    const onNodesChange = vi.fn(() => true)
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
    })
    Reflect.set(adapter, "canvas", {
      getHeight: vi.fn(() => page.height),
      getWidth: vi.fn(() => page.width),
      requestRenderAll: vi.fn(),
    })
    Reflect.set(adapter, "documentId", renderConformanceDocument.id)
    Reflect.set(adapter, "pageId", page.id)
    Reflect.get(adapter, "objectByNodeId").set(node.id, textbox)
    Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
    Reflect.get(adapter, "nodeIdByObject").set(textbox, node.id)
    Reflect.get(adapter, "textSizingModeByNodeId").set(node.id, node.sizingMode)
    Reflect.get(
      adapter,
      "onBeforeTransform"
    )({
      transform: { action: "resizing", target: textbox },
    })
    Reflect.get(adapter, "onObjectModified")({ target: textbox })
    expect(onNodesChange).not.toHaveBeenCalled()
  })

  it("resizes fixed text through intrinsic dimensions and its clip", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected fixed text")
    const node = { ...source, rotation: 0 }
    const page = renderConformanceDocument.pages.find((candidate) =>
      candidate.nodeIds.includes(node.id)
    )!
    const textbox = createFabricSyncObject(node)
    if (!(textbox instanceof Textbox)) throw new Error("Expected Textbox")
    const onNodesChange = vi.fn(() => true)
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
    })
    Reflect.set(adapter, "canvas", {
      getHeight: vi.fn(() => page.height),
      getWidth: vi.fn(() => page.width),
      requestRenderAll: vi.fn(),
    })
    Reflect.set(adapter, "documentId", renderConformanceDocument.id)
    Reflect.set(adapter, "pageId", page.id)
    Reflect.get(adapter, "objectByNodeId").set(node.id, textbox)
    Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
    Reflect.get(adapter, "nodeIdByObject").set(textbox, node.id)
    Reflect.get(adapter, "textSizingModeByNodeId").set(node.id, node.sizingMode)
    const transform = {
      action: "resizing",
      corner: "mr",
      originX: "left",
      originY: "center",
      target: textbox,
    } as Transform
    Reflect.get(adapter, "onBeforeTransform")({ transform })
    const baseline = {
      width: textbox.width,
      height: textbox.height,
      scaleX: textbox.scaleX,
      scaleY: textbox.scaleY,
    }
    const event = {} as TPointerEvent
    const control = textbox.controls.mr!
    Reflect.set(textbox, "canvas", {
      fire: vi.fn(),
      getZoom: vi.fn(() => 1),
    })
    expect(
      control.getActionHandler(event, textbox, control)?.(
        event,
        transform,
        node.x + node.width + 47,
        node.y + node.height / 2
      )
    ).toBe(true)

    Reflect.get(
      adapter,
      "onObjectTransformPreview"
    )({
      e: event,
      target: textbox,
      transform,
    })

    expect(textbox.width).toBeGreaterThan(baseline.width)
    expect(fabricObjectToNodePatch(textbox).y).toBe(node.y)
    expect(textbox.height).toBeCloseTo(baseline.height, 5)
    expect(textbox.scaleX).toBe(baseline.scaleX)
    expect(textbox.scaleY).toBe(baseline.scaleY)
    expect(textbox.clipPath).toBeInstanceOf(Rect)
    expect(textbox.clipPath?.width).toBeCloseTo(textbox.width, 5)
    expect(textbox.clipPath?.height).toBeCloseTo(node.height, 2)
    expect(fabricObjectToNodePatch(textbox).height).toBeCloseTo(node.height, 5)

    Reflect.get(adapter, "onObjectModified")({ target: textbox })
    expect(onNodesChange).toHaveBeenCalledWith([
      {
        nodeId: node.id,
        patch: expect.objectContaining({
          width: fabricObjectToNodePatch(textbox).width,
          height: node.height,
        }),
      },
    ])
  })

  it("preserves the visible fixed-text anchor for Shift and Shift+Alt", () => {
    for (const centered of [false, true]) {
      const source = renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "text-typography"
      )!
      if (source.type !== "text") throw new Error("Expected fixed text")
      const node = { ...source, rotation: 0 }
      const page = renderConformanceDocument.pages.find((candidate) =>
        candidate.nodeIds.includes(node.id)
      )!
      const textbox = createFabricSyncObject(node)
      if (!(textbox instanceof Textbox)) throw new Error("Expected Textbox")
      const adapter = new FabricCanvasAdapter({
        onSelectionChange: vi.fn(),
        onNodesChange: vi.fn(() => true),
      })
      const canvas = {
        fire: vi.fn(),
        getHeight: vi.fn(() => page.height),
        getWidth: vi.fn(() => page.width),
        getZoom: vi.fn(() => 1),
        requestRenderAll: vi.fn(),
      }
      Reflect.set(adapter, "canvas", canvas)
      Reflect.set(textbox, "canvas", canvas)
      Reflect.set(adapter, "documentId", renderConformanceDocument.id)
      Reflect.set(adapter, "pageId", page.id)
      Reflect.get(adapter, "objectByNodeId").set(node.id, textbox)
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(textbox, node.id)
      Reflect.get(adapter, "textSizingModeByNodeId").set(
        node.id,
        node.sizingMode
      )
      const transform = {
        action: "resizing",
        corner: "mr",
        originX: centered ? "center" : "left",
        originY: "center",
        target: textbox,
      } as Transform
      Reflect.get(adapter, "onBeforeTransform")({ transform })
      const event = { shiftKey: true, altKey: centered } as TPointerEvent
      const control = textbox.controls.mr!

      expect(
        control.getActionHandler(event, textbox, control)?.(
          event,
          transform,
          node.x + node.width + 40,
          node.y + node.height / 2
        )
      ).toBe(true)
      Reflect.get(
        adapter,
        "onObjectTransformPreview"
      )({
        e: event,
        target: textbox,
        transform,
      })

      const preview = fabricObjectToNodePatch(textbox)
      expect(preview.width / preview.height).toBeCloseTo(
        node.width / node.height,
        2
      )
      if (centered) {
        expect(preview.x + preview.width / 2).toBeCloseTo(
          node.x + node.width / 2,
          1
        )
      } else {
        expect(preview.x).toBeCloseTo(node.x, 1)
      }
      expect(
        Math.abs(preview.y + preview.height / 2 - (node.y + node.height / 2))
      ).toBeLessThanOrEqual(0.1)
    }
  })

  it("preserves the canonical fixed-text anchor through every public resize control", () => {
    const cases = [
      { corner: "tl", originX: "right", originY: "bottom", x: -40, y: -30 },
      { corner: "mt", originX: "center", originY: "bottom", x: 0, y: -30 },
      { corner: "tr", originX: "left", originY: "bottom", x: 40, y: -30 },
      { corner: "mr", originX: "left", originY: "center", x: 40, y: 0 },
      { corner: "br", originX: "left", originY: "top", x: 40, y: 30 },
      { corner: "mb", originX: "center", originY: "top", x: 0, y: 30 },
      { corner: "bl", originX: "right", originY: "top", x: -40, y: 30 },
      { corner: "ml", originX: "right", originY: "center", x: -40, y: 0 },
    ] as const
    const originRatio = (origin: string) =>
      origin === "right" || origin === "bottom"
        ? 1
        : origin === "center"
          ? 0.5
          : 0

    for (const resizeCase of cases) {
      const source = renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === "text-typography"
      )!
      if (source.type !== "text") throw new Error("Expected fixed text")
      const node = { ...source, rotation: 0 }
      const page = renderConformanceDocument.pages.find((candidate) =>
        candidate.nodeIds.includes(node.id)
      )!
      const textbox = createFabricSyncObject(node)
      if (!(textbox instanceof Textbox)) throw new Error("Expected Textbox")
      const adapter = new FabricCanvasAdapter({
        onSelectionChange: vi.fn(),
        onNodesChange: vi.fn(() => true),
      })
      const canvas = {
        ...{
          altActionKey: null,
          centeredKey: "altKey",
          centeredScaling: false,
          uniformScaling: false,
          uniScaleKey: "shiftKey",
        },
        fire: vi.fn(),
        getHeight: vi.fn(() => page.height),
        getWidth: vi.fn(() => page.width),
        getZoom: vi.fn(() => 1),
        requestRenderAll: vi.fn(),
      }
      Reflect.set(adapter, "canvas", canvas)
      Reflect.set(textbox, "canvas", canvas)
      Reflect.set(adapter, "documentId", renderConformanceDocument.id)
      Reflect.set(adapter, "pageId", page.id)
      Reflect.get(adapter, "objectByNodeId").set(node.id, textbox)
      Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
      Reflect.get(adapter, "nodeIdByObject").set(textbox, node.id)
      Reflect.get(adapter, "textSizingModeByNodeId").set(
        node.id,
        node.sizingMode
      )
      const control = textbox.controls[resizeCase.corner]!
      const event = { shiftKey: true } as TPointerEvent
      const action = control.getActionName(event, control, textbox)
      const transform = {
        action,
        corner: resizeCase.corner,
        originX: resizeCase.originX,
        originY: resizeCase.originY,
        original: { scaleX: textbox.scaleX, scaleY: textbox.scaleY },
        scaleX: textbox.scaleX,
        scaleY: textbox.scaleY,
        signX: resizeCase.x < 0 ? -1 : 1,
        signY: resizeCase.y < 0 ? -1 : 1,
        skewX: 0,
        skewY: 0,
        target: textbox,
      } as Transform & { signX: number; signY: number }
      Reflect.get(adapter, "onBeforeTransform")({ transform })
      const startX =
        node.x + node.width * originRatio(resizeCase.originX) - resizeCase.x
      const startY =
        node.y + node.height * originRatio(resizeCase.originY) - resizeCase.y

      expect(
        control.getActionHandler(event, textbox, control)?.(
          event,
          transform,
          startX + resizeCase.x * 2,
          startY + resizeCase.y * 2
        )
      ).toBe(true)
      Reflect.get(
        adapter,
        "onObjectTransformPreview"
      )({
        e: event,
        target: textbox,
        transform,
      })

      const preview = fabricObjectToNodePatch(textbox)
      const expectedAnchor = {
        x: node.x + node.width * originRatio(resizeCase.originX),
        y: node.y + node.height * originRatio(resizeCase.originY),
      }
      const actualAnchor = {
        x: preview.x + preview.width * originRatio(resizeCase.originX),
        y: preview.y + preview.height * originRatio(resizeCase.originY),
      }
      expect(
        Math.abs(actualAnchor.x - expectedAnchor.x),
        resizeCase.corner
      ).toBeLessThanOrEqual(0.1)
      expect(
        Math.abs(actualAnchor.y - expectedAnchor.y),
        resizeCase.corner
      ).toBeLessThanOrEqual(0.1)
      expect(preview.width / preview.height).toBeCloseTo(
        node.width / node.height,
        2
      )
    }
  })

  it("snaps auto-height text through intrinsic width without stretching glyphs", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "long-text-only"
    )!
    if (node.type !== "text") throw new Error("Expected auto-height text")
    const page = renderConformanceDocument.pages.find((candidate) =>
      candidate.nodeIds.includes(node.id)
    )!
    const textbox = createFabricSyncObject(node)
    if (!(textbox instanceof Textbox)) throw new Error("Expected Textbox")
    const onNodesChange = vi.fn(() => true)
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
    })
    Reflect.set(adapter, "canvas", {
      getHeight: vi.fn(() => page.height),
      getWidth: vi.fn(() => page.width),
      requestRenderAll: vi.fn(),
    })
    Reflect.set(adapter, "documentId", renderConformanceDocument.id)
    Reflect.set(adapter, "pageId", page.id)
    Reflect.get(adapter, "objectByNodeId").set(node.id, textbox)
    Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
    Reflect.get(adapter, "nodeIdByObject").set(textbox, node.id)
    Reflect.get(adapter, "textSizingModeByNodeId").set(node.id, node.sizingMode)
    const transform = {
      action: "resizing",
      corner: "mr",
      originX: "left",
      originY: "center",
      target: textbox,
    } as Transform
    Reflect.get(adapter, "onBeforeTransform")({ transform })

    const baselineScaleX = textbox.scaleX
    const baselineHeight = textbox.height
    const pageCenter = page.width / 2
    const event = { shiftKey: true } as TPointerEvent
    const control = textbox.controls.mr!
    Reflect.set(textbox, "canvas", {
      fire: vi.fn(),
      getZoom: vi.fn(() => 1),
    })
    expect(
      control.getActionHandler(event, textbox, control)?.(
        event,
        transform,
        pageCenter - 3,
        node.y + node.height / 2
      )
    ).toBe(true)
    expect(fabricObjectToNodePatch(textbox).y).not.toBe(node.y)
    Reflect.get(
      adapter,
      "onObjectTransformPreview"
    )({
      e: event,
      target: textbox,
      transform,
    })

    const preview = fabricObjectToNodePatch(textbox)
    expect(preview.x + preview.width).toBeCloseTo(pageCenter, 1)
    expect(preview.y).toBe(node.y)
    expect(textbox.scaleX).toBe(baselineScaleX)
    expect(textbox.height).toBeGreaterThan(baselineHeight)
    expect(Reflect.get(adapter, "activeGuides")).toEqual([
      { axis: "x", value: pageCenter, source: "page" },
    ])
    expect(onNodesChange).not.toHaveBeenCalled()

    Reflect.get(adapter, "onObjectModified")({ target: textbox })

    expect(onNodesChange).toHaveBeenCalledWith([
      {
        nodeId: node.id,
        patch: expect.objectContaining({ width: preview.width }),
      },
    ])
    expect(onNodesChange.mock.calls[0]?.[0][0]?.patch).not.toHaveProperty(
      "height"
    )
  })

  it("keeps the canonical top-left fixed for rotated auto-height reflow", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "long-text-only"
    )!
    if (source.type !== "text") throw new Error("Expected auto-height text")
    const node = { ...source, rotation: 17 }
    const page = renderConformanceDocument.pages.find((candidate) =>
      candidate.nodeIds.includes(node.id)
    )!
    const textbox = createFabricSyncObject(node)
    if (!(textbox instanceof Textbox)) throw new Error("Expected Textbox")
    const onNodesChange = vi.fn(() => true)
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange,
    })
    const canvas = {
      fire: vi.fn(),
      getHeight: vi.fn(() => page.height),
      getWidth: vi.fn(() => page.width),
      getZoom: vi.fn(() => 1),
      requestRenderAll: vi.fn(),
    }
    Reflect.set(adapter, "canvas", canvas)
    Reflect.set(textbox, "canvas", canvas)
    Reflect.set(adapter, "documentId", renderConformanceDocument.id)
    Reflect.set(adapter, "pageId", page.id)
    Reflect.get(adapter, "objectByNodeId").set(node.id, textbox)
    Reflect.get(adapter, "nodeByNodeId").set(node.id, node)
    Reflect.get(adapter, "nodeIdByObject").set(textbox, node.id)
    Reflect.get(adapter, "textSizingModeByNodeId").set(node.id, node.sizingMode)
    const transform = {
      action: "resizing",
      corner: "mr",
      originX: "left",
      originY: "center",
      target: textbox,
    } as Transform
    Reflect.get(adapter, "onBeforeTransform")({ transform })
    const event = {} as TPointerEvent
    const control = textbox.controls.mr!
    const rightCenter = textbox.getPointByOrigin("right", "center")
    const radians = (node.rotation * Math.PI) / 180

    expect(
      control.getActionHandler(event, textbox, control)?.(
        event,
        transform,
        rightCenter.x - Math.cos(radians) * 100,
        rightCenter.y - Math.sin(radians) * 100
      )
    ).toBe(true)
    expect(fabricObjectToNodePatch(textbox)).not.toMatchObject({
      x: node.x,
      y: node.y,
    })

    Reflect.get(
      adapter,
      "onObjectTransformPreview"
    )({
      e: event,
      target: textbox,
      transform,
    })

    expect(fabricObjectToNodePatch(textbox)).toMatchObject({
      x: node.x,
      y: node.y,
      rotation: node.rotation,
    })
    Reflect.get(adapter, "onObjectModified")({ target: textbox })
    expect(onNodesChange).toHaveBeenCalledOnce()
    expect(onNodesChange.mock.calls[0]?.[0][0]?.patch).not.toHaveProperty(
      "height"
    )
  })

  it("keeps auto-width text free of resize handles", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "auto-width-label"
    )!
    if (node.type !== "text") throw new Error("Expected auto-width text")
    const textbox = createFabricSyncObject(node)
    if (!(textbox instanceof Textbox)) throw new Error("Expected Textbox")

    expect(textbox.isControlVisible("ml")).toBe(false)
    expect(textbox.isControlVisible("mr")).toBe(false)
    expect(textbox.isControlVisible("mt")).toBe(false)
    expect(textbox.isControlVisible("mb")).toBe(false)
  })
})
