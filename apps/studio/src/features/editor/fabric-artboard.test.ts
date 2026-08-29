import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import {
  CanvasRuntimeOverlay,
  CropPreviewDimmer,
  FabricArtboard,
  acceptImageSourceStateChange,
  applyImageCropModeOrReport,
  canvasRuntimeFailureMessage,
  canvasDocumentFontRequests,
  createCanvasRuntimeState,
  describeInteractiveCanvas,
  projectCropPreviewMaskShape,
  reduceCanvasRuntimeState,
  settleCanvasInteractivity,
  waitForCanvasDocumentFonts,
} from "./fabric-artboard"

const imageFixture = renderConformanceDocument.nodes.find(
  (node) => node.id === "image-cover"
)
const pageFixture = renderConformanceDocument.pages[0]

if (imageFixture?.type !== "image") {
  throw new Error("Expected image and page fixtures")
}

describe("FabricArtboard crop preview", () => {
  it("loads every visible page font before Fabric measures its text", async () => {
    const load = vi.fn(() => Promise.resolve([{} as FontFace]))
    const check = vi.fn(() => true)
    const ready = Promise.resolve({}) as Promise<FontFaceSet>
    const requests = canvasDocumentFontRequests(
      renderConformanceDocument,
      "square-page"
    )

    await waitForCanvasDocumentFonts(renderConformanceDocument, "square-page", {
      check,
      load,
      ready,
    })

    expect(requests).toContainEqual({
      descriptor: '650 30px "Geist Variable"',
      sample: "AUTO WIDTH",
    })
    expect(load).toHaveBeenCalledWith('650 30px "Geist Variable"', "AUTO WIDTH")
    expect(check).toHaveBeenCalledWith(
      '650 30px "Geist Variable"',
      "AUTO WIDTH"
    )
  })

  it("rejects fallback measurement when the requested face is unavailable", async () => {
    const ready = Promise.resolve({}) as Promise<FontFaceSet>

    await expect(
      waitForCanvasDocumentFonts(renderConformanceDocument, "square-page", {
        check: vi.fn(() => false),
        load: vi.fn(() => Promise.resolve([])),
        ready,
      })
    ).rejects.toThrow('Canvas font unavailable: 650 30px "Geist Variable"')
  })

  it("connects the Fabric application canvas to discoverable instructions", () => {
    const upperCanvas = { setAttribute: vi.fn() }
    const canvas = {
      parentElement: { querySelector: vi.fn(() => upperCanvas) },
    } as unknown as HTMLCanvasElement

    expect(describeInteractiveCanvas(canvas, "canvas-help")).toBe(true)
    expect(upperCanvas.setAttribute).toHaveBeenCalledWith(
      "aria-describedby",
      "canvas-help"
    )
  })

  it("cancels every transient canvas edit when review makes it non-interactive", () => {
    const adapter = {
      cancelTextEditing: vi.fn(() => false),
      cancelTransform: vi.fn(() => true),
    }

    expect(settleCanvasInteractivity(adapter, false)).toBe(true)
    expect(adapter.cancelTextEditing).toHaveBeenCalledOnce()
    expect(adapter.cancelTransform).toHaveBeenCalledOnce()

    adapter.cancelTextEditing.mockClear()
    adapter.cancelTransform.mockClear()
    expect(settleCanvasInteractivity(adapter, true)).toBe(false)
    expect(adapter.cancelTextEditing).not.toHaveBeenCalled()
    expect(adapter.cancelTransform).not.toHaveBeenCalled()
  })

  it("contains canvas startup and sync failures in a retryable runtime state", () => {
    const initial = createCanvasRuntimeState()
    const failed = reduceCanvasRuntimeState(initial, {
      type: "failed",
      attempt: 0,
      stage: "sync",
    })

    expect(failed).toEqual({
      status: "error",
      attempt: 0,
      userRetried: false,
      stage: "sync",
    })
    expect(canvasRuntimeFailureMessage("sync")).toContain(
      "document is unchanged"
    )

    const retrying = reduceCanvasRuntimeState(failed, { type: "retry" })
    expect(retrying).toEqual({
      status: "preparing",
      attempt: 1,
      userRetried: true,
      stage: null,
    })
    expect(
      reduceCanvasRuntimeState(retrying, {
        type: "failed",
        attempt: 0,
        stage: "startup",
      })
    ).toBe(retrying)
    expect(
      reduceCanvasRuntimeState(retrying, {
        type: "failed",
        attempt: 1,
        stage: "startup",
      })
    ).toEqual({
      status: "error",
      attempt: 1,
      userRetried: true,
      stage: "startup",
    })
  })

  it("renders stable live states and an actionable canvas retry", () => {
    const preparing = renderToStaticMarkup(
      createElement(CanvasRuntimeOverlay, {
        runtime: createCanvasRuntimeState(),
        onRetry: vi.fn(),
      })
    )
    const failed = renderToStaticMarkup(
      createElement(CanvasRuntimeOverlay, {
        runtime: {
          status: "error",
          attempt: 1,
          userRetried: true,
          stage: "sync",
        },
        onRetry: vi.fn(),
      })
    )

    expect(preparing).toContain('role="status"')
    expect(preparing).toContain("Preparing canvas…")
    expect(failed).toContain('role="alert"')
    expect(failed).toContain("Canvas still unavailable")
    expect(failed).toContain("Retry canvas")
  })

  it("accepts readiness only for the exact current image source", () => {
    const sources = new Map([["image-1", "asset:managed/current"]])
    const tokens = new Map([["image-1", "replacement-current"]])
    const reported = new Map()

    expect(
      acceptImageSourceStateChange(
        sources,
        reported,
        {
          nodeId: "image-1",
          src: "asset:managed/old",
          resourceToken: "replacement-current",
          readiness: "unavailable",
        },
        tokens
      )
    ).toBe("stale")
    expect(reported.size).toBe(0)

    expect(
      acceptImageSourceStateChange(
        sources,
        reported,
        {
          nodeId: "image-1",
          src: "asset:managed/current",
          resourceToken: "replacement-old",
          readiness: "ready",
        },
        tokens
      )
    ).toBe("stale")
    expect(reported.size).toBe(0)

    const current = {
      nodeId: "image-1",
      src: "asset:managed/current",
      resourceToken: "replacement-current",
      readiness: "ready" as const,
      naturalSize: { width: 1600, height: 900 },
    }
    expect(
      acceptImageSourceStateChange(sources, reported, current, tokens)
    ).toBe("accepted")
    expect(
      acceptImageSourceStateChange(sources, reported, current, tokens)
    ).toBe("duplicate")
    expect(reported.get("image-1")).toEqual(current)
  })

  it("reports an unavailable image when the adapter rejects crop entry", () => {
    const onUnavailable = vi.fn()
    const adapter = { setImageCropMode: vi.fn(() => false) }
    const mode = {
      nodeId: imageFixture.id,
      placement: imageFixture.placement,
    }

    expect(applyImageCropModeOrReport(adapter, mode, onUnavailable)).toBe(false)
    expect(onUnavailable).toHaveBeenCalledWith({
      nodeId: imageFixture.id,
      reason: "image_unavailable",
    })
  })

  it("projects the rotated rectangle in page coordinates", () => {
    expect(projectCropPreviewMaskShape(imageFixture)).toEqual({
      shape: "rectangle",
      x: imageFixture.x,
      y: imageFixture.y,
      width: imageFixture.width,
      height: imageFixture.height,
      radius: 0,
      transform: `rotate(${imageFixture.rotation} ${imageFixture.x} ${imageFixture.y})`,
    })
  })

  it("uses the canonical shorter-edge radius and exact ellipse geometry", () => {
    expect(
      projectCropPreviewMaskShape({
        ...imageFixture,
        frameMask: { shape: "rounded_rectangle", radius: 0.2 },
      })
    ).toMatchObject({
      shape: "rectangle",
      radius: Math.min(imageFixture.width, imageFixture.height) * 0.2,
    })
    expect(
      projectCropPreviewMaskShape({
        ...imageFixture,
        frameMask: { shape: "ellipse" },
      })
    ).toEqual({
      shape: "ellipse",
      cx: imageFixture.x + imageFixture.width / 2,
      cy: imageFixture.y + imageFixture.height / 2,
      rx: imageFixture.width / 2,
      ry: imageFixture.height / 2,
      transform: `rotate(${imageFixture.rotation} ${imageFixture.x} ${imageFixture.y})`,
    })
  })

  it("dims only the artboard outside the true frame mask", () => {
    const markup = renderToStaticMarkup(
      createElement(CropPreviewDimmer, {
        node: { ...imageFixture, frameMask: { shape: "ellipse" } },
        page: pageFixture,
      })
    )

    expect(markup).toContain('data-crop-preview-dimmer="true"')
    expect(markup).toContain(
      `viewBox="0 0 ${pageFixture.width} ${pageFixture.height}"`
    )
    expect(markup).toContain('maskUnits="userSpaceOnUse"')
    expect(markup).toContain('fill="rgba(15, 23, 42, 0.4)"')
    expect(markup).toContain(
      `transform="rotate(${imageFixture.rotation} ${imageFixture.x} ${imageFixture.y})"`
    )
  })

  it("does not render crop chrome for hidden or off-page images", () => {
    const imagePage = renderConformanceDocument.pages.find((page) =>
      page.nodeIds.includes(imageFixture.id)
    )!
    const otherPage = renderConformanceDocument.pages.find(
      (page) => page.id !== imagePage.id
    )!
    const render = (
      document: typeof renderConformanceDocument,
      pageId: string
    ) =>
      renderToStaticMarkup(
        createElement(FabricArtboard, {
          document,
          pageId,
          selection: null,
          imageCropMode: {
            nodeId: imageFixture.id,
            placement: imageFixture.placement,
          },
          zoom: 1,
          onSelectionChange: vi.fn(),
          onNodesChange: vi.fn(),
        })
      )

    const hiddenDocument = {
      ...renderConformanceDocument,
      nodes: renderConformanceDocument.nodes.map((node) =>
        node.id === imageFixture.id ? { ...node, visible: false } : node
      ),
    }

    expect(render(hiddenDocument, imagePage.id)).not.toContain(
      'data-crop-preview-dimmer="true"'
    )
    expect(render(renderConformanceDocument, otherPage.id)).not.toContain(
      'data-crop-preview-dimmer="true"'
    )
  })
})
