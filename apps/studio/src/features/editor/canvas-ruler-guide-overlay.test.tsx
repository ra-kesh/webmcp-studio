// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CanvasRulerGuideOverlay,
  drawCanvasRulerGuideOverlay,
} from "./canvas-ruler-guide-overlay"

const preferences = { rulersVisible: true, guidesVisible: true }

describe("drawCanvasRulerGuideOverlay", () => {
  it("scales its backing coordinate system for DPR and draws fixed-size ruler chrome", () => {
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn(() => ({ width: 18 })),
      moveTo: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      roundRect: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    drawCanvasRulerGuideOverlay(context, {
      width: 800,
      height: 600,
      dpr: 2,
      camera: { x: 90, y: 70, zoom: 1 },
      pageSize: { width: 1240, height: 1754 },
      guides: [{ id: "guide-x", axis: "x", position: 120 }],
      preferences,
      selectedGuideId: "guide-x",
      hoveredGuideId: null,
      drag: null,
      theme: {
        background: "white",
        foreground: "#18181b",
        accent: "#0d99ff",
      },
    })

    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 800, 20)
    expect(context.fillRect).toHaveBeenCalledWith(0, 20, 20, 580)
    expect(context.fillText).toHaveBeenCalled()
  })

  it("keeps ruler chrome visible without leaking a hidden-guide badge", () => {
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn(() => ({ width: 18 })),
      moveTo: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      roundRect: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    drawCanvasRulerGuideOverlay(context, {
      width: 800,
      height: 600,
      dpr: 1,
      camera: { x: 90, y: 70, zoom: 1 },
      pageSize: { width: 1240, height: 1754 },
      guides: [{ id: "guide-x", axis: "x", position: 120 }],
      preferences: { rulersVisible: true, guidesVisible: false },
      selectedGuideId: "guide-x",
      hoveredGuideId: null,
      drag: null,
      theme: {
        background: "white",
        foreground: "#18181b",
        accent: "#0d99ff",
      },
    })

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 800, 20)
    expect(context.roundRect).not.toHaveBeenCalled()
  })

  it("uses supplied dark-theme chrome and foreground colors", () => {
    const fillStyles: unknown[] = []
    const strokeStyles: unknown[] = []
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn(() => ({ width: 18 })),
      moveTo: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      roundRect: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(context, "fillStyle", {
      configurable: true,
      set: (value) => fillStyles.push(value),
    })
    Object.defineProperty(context, "strokeStyle", {
      configurable: true,
      set: (value) => strokeStyles.push(value),
    })

    drawCanvasRulerGuideOverlay(context, {
      width: 800,
      height: 600,
      dpr: 1,
      camera: { x: 90, y: 70, zoom: 1 },
      pageSize: { width: 1240, height: 1754 },
      guides: [],
      preferences,
      selectedGuideId: null,
      hoveredGuideId: null,
      drag: null,
      theme: {
        background: "#18181b",
        foreground: "#fafafa",
        accent: "#38bdf8",
      },
    })

    expect(fillStyles).toContain("#18181b")
    expect(fillStyles).toContain("#fafafa")
    expect(strokeStyles).toContain("#fafafa")
  })
})

describe("CanvasRulerGuideOverlay", () => {
  let host: HTMLDivElement
  let root: Root
  let resizeCallback: ResizeObserverCallback | null

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      })
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    resizeCallback = null
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    )
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("leaves the full viewport transparent and owns only ruler and guide hit strips", async () => {
    await act(async () => {
      root.render(
        <CanvasRulerGuideOverlay
          camera={{ x: 100, y: 80, zoom: 1 }}
          guides={[
            { id: "guide-x", axis: "x", position: 120 },
            { id: "guide-y", axis: "y", position: 240 },
          ]}
          pageId="cover"
          pageSize={{ width: 1240, height: 1754 }}
          preferences={preferences}
          selectedGuideId={null}
          viewport={{ width: 800, height: 600 }}
          onAddGuide={vi.fn()}
          onDuplicateGuide={vi.fn()}
          onGuideSelectionChange={vi.fn()}
          onMoveGuide={vi.fn()}
          onRemoveGuide={vi.fn()}
        />
      )
    })

    const overlay = host.querySelector<HTMLElement>(
      '[data-canvas-ruler-guide-overlay="true"]'
    )
    expect(overlay?.className).toContain("pointer-events-none")
    expect(
      overlay?.querySelector('canvas[data-ruler-guide-canvas="true"]')
        ?.className
    ).toContain("pointer-events-none")
    expect(overlay?.querySelectorAll("[data-ruler-hit-axis]")).toHaveLength(2)
    expect(overlay?.querySelectorAll("[data-guide-hit-id]")).toHaveLength(2)
    expect(
      overlay?.querySelector<HTMLElement>('[data-guide-hit-id="guide-x"]')
        ?.style.width
    ).toBe("12px")
    expect(resizeCallback).not.toBeNull()
  })

  it("removes all pointer owners while interaction is disabled", async () => {
    await act(async () => {
      root.render(
        <CanvasRulerGuideOverlay
          camera={{ x: 100, y: 80, zoom: 1 }}
          guides={[{ id: "guide-x", axis: "x", position: 120 }]}
          interactive={false}
          pageId="cover"
          pageSize={{ width: 1240, height: 1754 }}
          preferences={preferences}
          selectedGuideId={null}
          viewport={{ width: 800, height: 600 }}
          onAddGuide={vi.fn()}
          onDuplicateGuide={vi.fn()}
          onGuideSelectionChange={vi.fn()}
          onMoveGuide={vi.fn()}
          onRemoveGuide={vi.fn()}
        />
      )
    })
    expect(host.querySelectorAll("[data-ruler-hit-axis]")).toHaveLength(0)
    expect(host.querySelectorAll("[data-guide-hit-id]")).toHaveLength(0)
    expect(host.querySelector("canvas")).not.toBeNull()
  })

  it("keeps hidden guides non-interactive even while rulers remain visible", async () => {
    await act(async () => {
      root.render(
        <CanvasRulerGuideOverlay
          camera={{ x: 100, y: 80, zoom: 1 }}
          guides={[{ id: "guide-x", axis: "x", position: 120 }]}
          pageId="cover"
          pageSize={{ width: 1240, height: 1754 }}
          preferences={{ rulersVisible: true, guidesVisible: false }}
          selectedGuideId="guide-x"
          viewport={{ width: 800, height: 600 }}
          onAddGuide={vi.fn()}
          onDuplicateGuide={vi.fn()}
          onGuideSelectionChange={vi.fn()}
          onMoveGuide={vi.fn()}
          onRemoveGuide={vi.fn()}
        />
      )
    })
    expect(host.querySelectorAll("[data-ruler-hit-axis]")).toHaveLength(0)
    expect(host.querySelectorAll("[data-guide-hit-id]")).toHaveLength(0)
    expect(host.querySelector("canvas")).not.toBeNull()
  })
})
