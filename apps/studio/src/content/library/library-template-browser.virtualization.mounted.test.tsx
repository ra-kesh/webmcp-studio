// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  LIBRARY_TEMPLATE_VIRTUALIZATION_THRESHOLD,
  LibraryTemplateBrowser,
} from "./library-template-browser"
import {
  cloneTemplates,
  confirmedPage,
  DiscoveryTestRoot,
  discoveryState,
  staticController,
} from "./library-template-browser.test-support"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

class DeferredIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly scrollMargin = "0px"
  readonly thresholds = [0]
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

describe("LibraryTemplateBrowser container grid and virtualization", () => {
  let host: HTMLDivElement
  let root: Root
  let width: number
  let resizeCallbacks: Set<ResizeObserverCallback>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    width = 1180
    resizeCallbacks = new Set()
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const elementWidth = this.hasAttribute("data-library-grid-host")
          ? width
          : 900
        const elementHeight = this.hasAttribute("data-library-virtualized")
          ? 620
          : 300
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: elementWidth,
          bottom: elementHeight,
          width: elementWidth,
          height: elementHeight,
          toJSON: () => ({}),
        }
      }
    )
    vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver)
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(readonly callback: ResizeObserverCallback) {
          resizeCallbacks.add(callback)
        }
        disconnect() {
          resizeCallbacks.delete(this.callback)
        }
        observe(target: Element) {
          const rect = target.getBoundingClientRect()
          this.callback(
            [
              {
                target,
                contentRect: rect,
                borderBoxSize: [
                  { inlineSize: rect.width, blockSize: rect.height },
                ],
              } as unknown as ResizeObserverEntry,
            ],
            this
          )
        }
        unobserve() {}
      }
    )
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      })
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const notifyResize = async () => {
    await act(async () => {
      for (const callback of resizeCallbacks) {
        const target = host.querySelector("[data-library-grid-host]") ?? host
        const rect = target.getBoundingClientRect()
        callback(
          [
            {
              target,
              contentRect: rect,
              borderBoxSize: [
                { inlineSize: rect.width, blockSize: rect.height },
              ],
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver
        )
      }
    })
  }

  it("keeps 48 items semantic and switches to virtual rows at 49", async () => {
    const semanticItems = cloneTemplates(
      LIBRARY_TEMPLATE_VIRTUALIZATION_THRESHOLD
    )
    const semanticController = staticController(
      discoveryState({ confirmedPage: confirmedPage(semanticItems) })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={semanticController}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(host.querySelector("[data-library-semantic-list]")).not.toBeNull()
    expect(host.querySelector("[data-library-virtualized]")).toBeNull()
    expect(host.querySelectorAll("[data-template-card]")).toHaveLength(48)

    await act(async () => root.unmount())
    root = createRoot(host)
    const virtualItems = cloneTemplates(49)
    const last = virtualItems.at(-1)!
    const virtualController = staticController(
      discoveryState({
        confirmedPage: confirmedPage(virtualItems),
        focusIntent: {
          id: 9,
          target: "item",
          itemIdentity: `template:${last.id}@${last.version}`,
        },
      })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={virtualController}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(host.querySelector("[data-library-virtualized]")).not.toBeNull()
    expect(host.querySelector("[data-library-semantic-list]")).toBeNull()
    expect(host.querySelector('[aria-setsize="49"]')).not.toBeNull()
    expect(
      host.querySelector(
        `[data-template-card="template:${last.id}@${last.version}"]`
      )
    ).not.toBeNull()
    expect(virtualController.clearFocusIntent).toHaveBeenCalledWith(9)
  })

  it("derives start and editor column counts only from the measured host", async () => {
    const items = cloneTemplates(6)
    const controller = staticController(
      discoveryState({ confirmedPage: confirmedPage(items) })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const startList = host.querySelector<HTMLElement>(
      "[data-library-semantic-list]"
    )!
    expect(startList.style.gridTemplateColumns).toContain("repeat(4")

    width = 700
    await notifyResize()
    expect(startList.style.gridTemplateColumns).toContain("repeat(2")

    await act(async () => root.unmount())
    root = createRoot(host)
    width = 500
    const editorController = staticController(
      discoveryState({ confirmedPage: confirmedPage(items) })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={editorController}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="editor"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })
    const editorList = host.querySelector<HTMLElement>(
      "[data-library-semantic-list]"
    )!
    expect(editorList.style.gridTemplateColumns).toContain("repeat(2")

    width = 360
    await notifyResize()
    expect(editorList.style.gridTemplateColumns).toContain("repeat(1")
  })

  it("restores the focused virtual card after a column-count remount", async () => {
    const items = cloneTemplates(49)
    const controller = staticController(
      discoveryState({ confirmedPage: confirmedPage(items) })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const focused = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Show details for ${items[0]!.name}"]`
    )!
    await act(async () => focused.focus())
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      `Show details for ${items[0]!.name}`
    )

    width = 700
    await notifyResize()

    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      `Show details for ${items[0]!.name}`
    )
  })
})
