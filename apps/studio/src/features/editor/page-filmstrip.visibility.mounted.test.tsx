// @vitest-environment jsdom

import { act, createElement, StrictMode, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { createImageHeavyPerformanceFixture } from "./image-heavy-performance-fixture.test-contract"
import {
  filmstripThumbnailGeometry,
  filmstripThumbnailRasterSize,
  PAGE_FILMSTRIP_COMPACT_HEIGHT,
  PAGE_FILMSTRIP_DENSITY_HEIGHTS,
  PAGE_FILMSTRIP_DESKTOP_HEIGHT,
  PageFilmstrip,
} from "./page-filmstrip"
import type { PageThumbnailRasterKey } from "./page-thumbnail-raster-cache"
import { StudioPageThumbnailRasterError } from "./page-thumbnail-raster-producer"

vi.mock("@webmcp/render-view", () => ({
  Artboard: ({
    pageId,
    showImageRecoveryActions,
  }: {
    pageId: string
    showImageRecoveryActions?: boolean
  }) =>
    createElement("div", {
      "data-artboard-page-id": pageId,
      "data-recovery-actions": String(showImageRecoveryActions),
    }),
}))

const fixture = createImageHeavyPerformanceFixture({
  pageCount: 100,
  imagesPerPage: 8,
})
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
)
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
)
const originalMatchMedia = Object.getOwnPropertyDescriptor(
  globalThis,
  "matchMedia"
)
let objectUrlSequence = 0
const createObjectUrl = vi.fn(() => `blob:filmstrip-${++objectUrlSequence}`)
const revokeObjectUrl = vi.fn<(url: string) => void>()
let desktopFilmstripMatches = false
const desktopFilmstripListeners = new Set<() => void>()
const matchMedia = vi.fn(
  (query: string) =>
    ({
      matches: desktopFilmstripMatches,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        desktopFilmstripListeners.add(listener)
      },
      removeEventListener: (_type: string, listener: () => void) => {
        desktopFilmstripListeners.delete(listener)
      },
      addListener: (listener: () => void) => {
        desktopFilmstripListeners.add(listener)
      },
      removeListener: (listener: () => void) => {
        desktopFilmstripListeners.delete(listener)
      },
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList
)

const setDesktopFilmstripMatches = (matches: boolean) => {
  desktopFilmstripMatches = matches
  for (const listener of desktopFilmstripListeners) listener()
}

class TestIntersectionObserver implements IntersectionObserver {
  static instances: TestIntersectionObserver[] = []

  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly scrollMargin = "0px"
  readonly thresholds = [0]
  readonly observed = new Set<Element>()
  disconnected = false

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.root = options.root ?? null
    this.rootMargin = options.rootMargin ?? "0px"
    TestIntersectionObserver.instances.push(this)
  }

  disconnect() {
    this.disconnected = true
    this.observed.clear()
  }

  observe(element: Element) {
    this.observed.add(element)
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  unobserve(element: Element) {
    this.observed.delete(element)
  }

  trigger(pageIds: readonly string[], isIntersecting: boolean) {
    const requested = new Set(pageIds)
    const entries = [...this.observed]
      .filter((element) => {
        const id = element.getAttribute("data-page-thumbnail-id")
        return id !== null && requested.has(id)
      })
      .map(
        (target) =>
          ({
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
          }) as IntersectionObserverEntry
      )
    this.callback(entries, this)
  }
}

function FilmstripHarness() {
  const [activePageId, setActivePageId] = useState(fixture.document.pages[0].id)
  return createElement(PageFilmstrip, {
    document: fixture.document,
    activePageId,
    reviewPending: false,
    onSelectPage: setActivePageId,
    onAddPage: vi.fn(),
    onDuplicatePage: vi.fn(),
    onRemovePage: vi.fn(),
    onReorderPage: vi.fn(),
  })
}

const renderedThumbnailIds = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-artboard-page-id]")].map(
    (element) => element.dataset.artboardPageId
  )

const pageSelectorButtons = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLButtonElement>("button[data-page-selector-id]"),
]

const pageActionButtons = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLButtonElement>(
    'button[aria-label^="More actions for "]'
  ),
]

const pressKey = async (element: HTMLElement, key: string) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  })
  await act(async () => element.dispatchEvent(event))
  return event
}

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  }
  Object.assign(globalThis, {
    IntersectionObserver: TestIntersectionObserver,
    matchMedia,
    ResizeObserver: TestResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  })
})

beforeEach(() => {
  TestIntersectionObserver.instances.length = 0
  desktopFilmstripMatches = false
  desktopFilmstripListeners.clear()
  matchMedia.mockClear()
  objectUrlSequence = 0
  createObjectUrl.mockClear()
  revokeObjectUrl.mockClear()
})

afterAll(() => {
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl)
  } else {
    Reflect.deleteProperty(URL, "createObjectURL")
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl)
  } else {
    Reflect.deleteProperty(URL, "revokeObjectURL")
  }
  if (originalMatchMedia) {
    Object.defineProperty(globalThis, "matchMedia", originalMatchMedia)
  } else {
    Reflect.deleteProperty(globalThis, "matchMedia")
  }
})

describe("PageFilmstrip thumbnail visibility", () => {
  it.each([
    {
      density: "compact" as const,
      maxWidth: 44,
      maxHeight: 56,
    },
    {
      density: "comfortable" as const,
      maxWidth: 52,
      maxHeight: 72,
    },
  ])(
    "fits every page shape inside the $density thumbnail slot",
    ({ density, maxWidth, maxHeight }) => {
      for (const page of [
        { width: 1240, height: 1754 },
        { width: 1240, height: 800 },
        { width: 1080, height: 1080 },
      ]) {
        const geometry = filmstripThumbnailGeometry(page, density)

        expect(geometry.width).toBeLessThanOrEqual(maxWidth)
        expect(geometry.height).toBeLessThanOrEqual(maxHeight)
        expect(geometry.width / geometry.height).toBeCloseTo(
          page.width / page.height
        )
      }
    }
  )

  it("keeps compact as the default density and derives a larger comfortable raster", () => {
    const page = { width: 1240, height: 1754 }

    expect(PAGE_FILMSTRIP_COMPACT_HEIGHT).toBe(88)
    expect(PAGE_FILMSTRIP_DESKTOP_HEIGHT).toBe(96)
    expect(PAGE_FILMSTRIP_DENSITY_HEIGHTS).toEqual({
      compact: { compact: 88, desktop: 96 },
      comfortable: { compact: 88, desktop: 120 },
    })
    expect(filmstripThumbnailRasterSize(page, 2)).toEqual({
      width: 79,
      height: 112,
    })
    expect(filmstripThumbnailRasterSize(page, 2, "comfortable")).toEqual({
      width: 102,
      height: 144,
    })
  })

  it("exposes controlled compact and comfortable gallery densities without changing page semantics", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const onDensityChange = vi.fn()
    const props = {
      document: fixture.document,
      activePageId: fixture.document.pages[1].id,
      reviewPending: false,
      onSelectPage: vi.fn(),
      onAddPage: vi.fn(),
      onDuplicatePage: vi.fn(),
      onRemovePage: vi.fn(),
      onReorderPage: vi.fn(),
      onDensityChange,
    }

    try {
      await act(async () =>
        root.render(createElement(PageFilmstrip, { ...props }))
      )
      const region = host.querySelector<HTMLElement>(
        '[data-page-filmstrip="gallery"]'
      )
      if (!region) throw new Error("Expected page filmstrip gallery")

      expect(region.dataset.density).toBe("compact")
      expect(region.dataset.thumbnailDensity).toBe("compact")
      expect(region.dataset.compactHeight).toBe("88")
      expect(region.dataset.desktopHeight).toBe("96")
      expect(region.className).toContain("h-[88px]")
      expect(region.className).toContain("min-[1280px]:h-24")
      expect(
        pageSelectorButtons(host).map((button) => button.dataset.pageSelectorId)
      ).toEqual(fixture.document.outputs[0].pageIds)
      expect(pageSelectorButtons(host)[1]).toMatchObject({
        tabIndex: 0,
      })
      expect(pageSelectorButtons(host)[1]?.getAttribute("aria-current")).toBe(
        "page"
      )
      expect(pageActionButtons(host)).toHaveLength(100)
      const scrollViewport = host.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      )
      expect(scrollViewport).not.toBeNull()
      expect(
        scrollViewport?.querySelector('[class*="min-w-max"]')
      ).not.toBeNull()
      expect(
        host.querySelector('button[data-command-id="page.add"]')
      ).not.toBeNull()

      expect(host.querySelector("button[data-density-control]")).toBeNull()

      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            density: "comfortable",
          })
        )
      )
      expect(region.dataset.density).toBe("comfortable")
      expect(region.dataset.thumbnailDensity).toBe("compact")
      expect(region.dataset.compactHeight).toBe("88")
      expect(region.dataset.desktopHeight).toBe("120")
      expect(region.className).toContain("h-[88px]")
      expect(region.className).toContain("min-[1280px]:h-[120px]")
      expect(host.querySelector("button[data-density-control]")).toBeNull()
      const comfortableThumbnail = host.querySelector<HTMLElement>(
        "[data-page-thumbnail-id]"
      )
      expect(comfortableThumbnail?.className).toContain("h-[60px]")
      expect(comfortableThumbnail?.className).not.toContain("h-[76px]")
      const compactComfortableItem = comfortableThumbnail?.closest<HTMLElement>(
        "[data-page-filmstrip-item]"
      )
      expect(compactComfortableItem?.className).toContain("w-[60px]")
      const addPageButton = host.querySelector<HTMLButtonElement>(
        'button[data-command-id="page.add"]'
      )
      expect(addPageButton?.className).toContain("h-[68px]")
      expect(addPageButton?.className).toContain("min-[1280px]:h-[108px]")

      await act(async () => setDesktopFilmstripMatches(true))
      expect(region.dataset.thumbnailDensity).toBe("comfortable")
      const comfortableToggle = host.querySelector<HTMLButtonElement>(
        "button[data-density-control]"
      )
      expect(comfortableToggle?.getAttribute("aria-label")).toBe(
        "Use compact page strip"
      )
      expect(comfortableToggle?.getAttribute("aria-pressed")).toBe("true")
      expect(comfortableToggle?.dataset.state).toBe("on")
      expect(comfortableToggle?.className).toContain("size-7")
      await act(async () => comfortableToggle?.click())
      expect(onDensityChange).toHaveBeenCalledWith("compact")
      const desktopComfortableThumbnail = host.querySelector<HTMLElement>(
        "[data-page-thumbnail-id]"
      )
      expect(desktopComfortableThumbnail?.className).toContain("h-[76px]")
      expect(
        desktopComfortableThumbnail?.closest<HTMLElement>(
          "[data-page-filmstrip-item]"
        )?.className
      ).toContain("w-[76px]")
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it.each([
    {
      name: "extreme portrait at DPR 2",
      page: { width: 105, height: 1120 },
      pixelRatio: 2,
      expected: { width: 11, height: 112 },
    },
    {
      name: "near-square page at fractional DPR",
      page: { width: 100, height: 110 },
      pixelRatio: 1.3,
      expected: { width: 57, height: 63 },
    },
    {
      name: "extreme landscape at DPR 2",
      page: { width: 1120, height: 105 },
      pixelRatio: 2,
      expected: { width: 88, height: 8 },
    },
    {
      name: "standard portrait at DPR 2",
      page: { width: 1240, height: 1754 },
      pixelRatio: 2,
      expected: { width: 79, height: 112 },
    },
    {
      name: "one-pixel-wide portrait at DPR 2",
      page: { width: 1, height: 8192 },
      pixelRatio: 2,
      expected: { width: 1, height: 112 },
    },
    {
      name: "one-pixel-high landscape at DPR 2",
      page: { width: 8192, height: 1 },
      pixelRatio: 2,
      expected: { width: 88, height: 1 },
    },
  ])(
    "derives an accepted raster for $name",
    ({ page, pixelRatio, expected }) => {
      expect(filmstripThumbnailRasterSize(page, pixelRatio)).toEqual(expected)
    }
  )

  it.each([
    {
      name: "extreme portrait at DPR 2",
      width: 105,
      height: 1120,
      pixelRatio: 2,
      expected: { pixelWidth: 11, pixelHeight: 112 },
    },
    {
      name: "near-square page at fractional DPR",
      width: 100,
      height: 110,
      pixelRatio: 1.3,
      expected: { pixelWidth: 57, pixelHeight: 63 },
    },
    {
      name: "extreme landscape at DPR 2",
      width: 1120,
      height: 105,
      pixelRatio: 2,
      expected: { pixelWidth: 88, pixelHeight: 8 },
    },
    {
      name: "standard portrait at DPR 2",
      width: 1240,
      height: 1754,
      pixelRatio: 2,
      expected: { pixelWidth: 79, pixelHeight: 112 },
    },
    {
      name: "one-pixel-wide portrait at DPR 2",
      width: 1,
      height: 8192,
      pixelRatio: 2,
      expected: { pixelWidth: 1, pixelHeight: 112 },
    },
    {
      name: "one-pixel-high landscape at DPR 2",
      width: 8192,
      height: 1,
      pixelRatio: 2,
      expected: { pixelWidth: 88, pixelHeight: 1 },
    },
  ])(
    "uses the shared raster size for $name",
    async ({ width, height, pixelRatio, expected }) => {
      const host = document.createElement("div")
      document.body.appendChild(host)
      const root = createRoot(host)
      const targetPageId = fixture.document.pages[1].id
      const customDocument = {
        ...fixture.document,
        pages: fixture.document.pages.map((page) =>
          page.id === targetPageId ? { ...page, width, height } : page
        ),
      }
      const producer = vi.fn(async (key: PageThumbnailRasterKey) =>
        Promise.resolve(new Blob([key.pageId], { type: "image/png" }))
      )

      try {
        await act(async () =>
          root.render(
            createElement(PageFilmstrip, {
              document: customDocument,
              activePageId: customDocument.pages[0].id,
              reviewPending: false,
              onSelectPage: vi.fn(),
              onAddPage: vi.fn(),
              onDuplicatePage: vi.fn(),
              onRemovePage: vi.fn(),
              onReorderPage: vi.fn(),
              raster: {
                canonicalDocument: customDocument,
                documentSnapshotId: `snapshot-${width}-${height}`,
                rendererRevision: "renderer-geometry",
                producer,
                pixelRatio,
              },
            })
          )
        )
        const observer = TestIntersectionObserver.instances.at(-1)
        if (!observer) throw new Error("Expected the shared thumbnail observer")

        await act(async () => {
          observer.trigger([targetPageId], true)
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(producer).toHaveBeenCalledOnce()
        expect(producer.mock.calls[0]?.[0]).toMatchObject(expected)
      } finally {
        await act(async () => root.unmount())
        host.remove()
      }
    }
  )

  it("keeps 100 page controls reachable while mounting only active and near-visible renderers", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root: Root = createRoot(host)

    try {
      await act(async () => root.render(createElement(FilmstripHarness)))
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      expect(observer.rootMargin).toBe("0px 240px")
      expect(observer.observed).toHaveLength(100)
      expect(
        host.querySelectorAll('button[aria-label^="Open page "]')
      ).toHaveLength(100)
      expect(
        [
          ...host.querySelectorAll<HTMLElement>("[data-page-filmstrip-item]"),
        ].every(
          (item) =>
            item.style.contentVisibility === "auto" &&
            item.style.containIntrinsicSize === "68px 88px"
        )
      ).toBe(true)
      expect(renderedThumbnailIds(host)).toEqual(["performance-page-1"])

      await act(async () => {
        observer.trigger(
          [
            "performance-page-1",
            "performance-page-2",
            "performance-page-3",
            "performance-page-4",
          ],
          true
        )
      })
      expect(renderedThumbnailIds(host)).toEqual([
        "performance-page-1",
        "performance-page-2",
        "performance-page-3",
        "performance-page-4",
      ])

      await act(async () => {
        observer.trigger(
          [
            "performance-page-1",
            "performance-page-2",
            "performance-page-3",
            "performance-page-4",
          ],
          false
        )
        observer.trigger(
          ["performance-page-50", "performance-page-51", "performance-page-52"],
          true
        )
      })
      expect(renderedThumbnailIds(host)).toEqual([
        "performance-page-1",
        "performance-page-50",
        "performance-page-51",
        "performance-page-52",
      ])

      const lastPageButton = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Open page 100: Image story 100"]'
      )
      if (!lastPageButton) throw new Error("Expected the last page selector")
      await act(async () => lastPageButton.click())

      expect(renderedThumbnailIds(host)).toEqual([
        "performance-page-50",
        "performance-page-51",
        "performance-page-52",
        "performance-page-100",
      ])
      expect(
        host.querySelectorAll('[data-thumbnail-state="deferred"]')
      ).toHaveLength(96)
      expect(
        [
          ...host.querySelectorAll<HTMLElement>("[data-recovery-actions]"),
        ].every((element) => element.dataset.recoveryActions === "false")
      ).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }

    expect(TestIntersectionObserver.instances.at(-1)?.disconnected).toBe(true)
  })

  it("provides roving page and menu focus across 100 pages", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)

    try {
      await act(async () => root.render(createElement(FilmstripHarness)))
      const selectors = pageSelectorButtons(host)
      const menus = pageActionButtons(host)

      expect(selectors).toHaveLength(100)
      expect(menus).toHaveLength(100)
      expect(selectors.filter((button) => button.tabIndex === 0)).toEqual([
        selectors[0],
      ])
      expect(menus.filter((button) => button.tabIndex === 0)).toEqual([
        menus[0],
      ])
      expect(selectors.slice(1).every((button) => button.tabIndex === -1)).toBe(
        true
      )
      expect(menus.slice(1).every((button) => button.tabIndex === -1)).toBe(
        true
      )

      selectors[0].focus()
      expect(document.activeElement).toBe(selectors[0])

      const nextEvent = await pressKey(selectors[0], "ArrowRight")
      expect(nextEvent.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(selectors[1])
      expect(selectors[1].getAttribute("aria-current")).toBe("page")
      expect(selectors[0].tabIndex).toBe(-1)
      expect(selectors[1].tabIndex).toBe(0)
      expect(menus[0].tabIndex).toBe(-1)
      expect(menus[1].tabIndex).toBe(0)
      expect(renderedThumbnailIds(host)).toEqual(["performance-page-2"])

      await pressKey(selectors[1], "End")
      expect(document.activeElement).toBe(selectors[99])
      expect(selectors[99].getAttribute("aria-current")).toBe("page")
      expect(menus[99].tabIndex).toBe(0)
      expect(renderedThumbnailIds(host)).toEqual(["performance-page-100"])

      const rightBoundaryEvent = await pressKey(selectors[99], "ArrowRight")
      expect(rightBoundaryEvent.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(selectors[99])
      expect(selectors[99].getAttribute("aria-current")).toBe("page")

      await pressKey(selectors[99], "Home")
      expect(document.activeElement).toBe(selectors[0])
      expect(selectors[0].getAttribute("aria-current")).toBe("page")
      expect(menus[0].tabIndex).toBe(0)

      const leftBoundaryEvent = await pressKey(selectors[0], "ArrowLeft")
      expect(leftBoundaryEvent.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(selectors[0])
      expect(
        pageSelectorButtons(host).filter((button) => button.tabIndex === 0)
      ).toEqual([selectors[0]])
      expect(
        pageActionButtons(host).filter((button) => button.tabIndex === 0)
      ).toEqual([menus[0]])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("aborts an inactive raster after it leaves the viewport margin", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const signals = new Map<string, AbortSignal>()
    const producer = vi.fn(
      (key: PageThumbnailRasterKey, signal: AbortSignal) => {
        signals.set(key.pageId, signal)
        return new Promise<Blob>(() => undefined)
      }
    )

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            document: fixture.document,
            activePageId: fixture.document.pages[0].id,
            reviewPending: false,
            onSelectPage: vi.fn(),
            onAddPage: vi.fn(),
            onDuplicatePage: vi.fn(),
            onRemovePage: vi.fn(),
            onReorderPage: vi.fn(),
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-abort",
              rendererRevision: "renderer-abort",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
      })
      expect(producer).toHaveBeenCalledOnce()
      expect(signals.get("performance-page-2")?.aborted).toBe(false)
      const loadingThumbnail = host.querySelector<HTMLElement>(
        '[data-page-thumbnail-id="performance-page-2"] [data-thumbnail-state="loading"]'
      )
      expect(loadingThumbnail?.className).toContain("animate-pulse")
      expect(loadingThumbnail?.className).toContain(
        "motion-reduce:animate-none"
      )

      await act(async () => {
        observer.trigger(["performance-page-2"], false)
        await Promise.resolve()
      })
      expect(signals.get("performance-page-2")?.aborted).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("admits expensive rasters only after the filmstrip settles", async () => {
    vi.useFakeTimers()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    const producer = vi.fn(
      (_key: PageThumbnailRasterKey, _signal: AbortSignal) =>
        new Promise<Blob>(() => undefined)
    )

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            document: fixture.document,
            activePageId: fixture.document.pages[0].id,
            reviewPending: false,
            onSelectPage: vi.fn(),
            onAddPage: vi.fn(),
            onDuplicatePage: vi.fn(),
            onRemovePage: vi.fn(),
            onReorderPage: vi.fn(),
            raster: {
              admissionDelayMs: 300,
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-settled-admission",
              rendererRevision: "renderer-settled-admission",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")
      if (!(observer.root instanceof HTMLElement)) {
        throw new Error("Expected the filmstrip scroll viewport")
      }

      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await vi.advanceTimersByTimeAsync(299)
      })
      expect(producer).not.toHaveBeenCalled()

      await act(async () => {
        observer.root?.dispatchEvent(new Event("scroll"))
        await vi.advanceTimersByTimeAsync(299)
      })
      expect(producer).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
        await Promise.resolve()
      })
      expect(producer).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it("does not admit a delayed raster after the page leaves the viewport", async () => {
    vi.useFakeTimers()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    const producer = vi.fn(
      (_key: PageThumbnailRasterKey, _signal: AbortSignal) =>
        new Promise<Blob>(() => undefined)
    )

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            document: fixture.document,
            activePageId: fixture.document.pages[0].id,
            reviewPending: false,
            onSelectPage: vi.fn(),
            onAddPage: vi.fn(),
            onDuplicatePage: vi.fn(),
            onRemovePage: vi.fn(),
            onReorderPage: vi.fn(),
            raster: {
              admissionDelayMs: 300,
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-exit-before-admission",
              rendererRevision: "renderer-exit-before-admission",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await vi.advanceTimersByTimeAsync(100)
        observer.trigger(["performance-page-2"], false)
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(producer).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it("aborts an admitted delayed raster synchronously on viewport exit", async () => {
    vi.useFakeTimers()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    let rasterSignal: AbortSignal | undefined
    const producer = vi.fn(
      (_key: PageThumbnailRasterKey, signal: AbortSignal) => {
        rasterSignal = signal
        return new Promise<Blob>(() => undefined)
      }
    )

    const renderFilmstrip = (activePageId: string) =>
      root.render(
        createElement(PageFilmstrip, {
          document: fixture.document,
          activePageId,
          reviewPending: false,
          onSelectPage: vi.fn(),
          onAddPage: vi.fn(),
          onDuplicatePage: vi.fn(),
          onRemovePage: vi.fn(),
          onReorderPage: vi.fn(),
          raster: {
            admissionDelayMs: 300,
            canonicalDocument: fixture.document,
            documentSnapshotId: "snapshot-exit-after-admission",
            rendererRevision: "renderer-exit-after-admission",
            producer,
          },
        })
      )

    try {
      await act(async () => renderFilmstrip(fixture.document.pages[0].id))
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
        await Promise.resolve()
      })
      expect(producer).toHaveBeenCalledOnce()
      expect(rasterSignal?.aborted).toBe(false)

      await act(async () => {
        observer.trigger(["performance-page-2"], false)
        expect(rasterSignal?.aborted).toBe(true)

        flushSync(() => renderFilmstrip(fixture.document.pages[2].id))
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(600)
      })
      expect(producer).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it("aborts the superseded raster when a visible page changes revision", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const requests: Array<{
      key: PageThumbnailRasterKey
      signal: AbortSignal
    }> = []
    const producer = vi.fn(
      (key: PageThumbnailRasterKey, signal: AbortSignal) => {
        requests.push({ key, signal })
        return new Promise<Blob>(() => undefined)
      }
    )
    const props = {
      document: fixture.document,
      activePageId: fixture.document.pages[0].id,
      reviewPending: false,
      onSelectPage: vi.fn(),
      onAddPage: vi.fn(),
      onDuplicatePage: vi.fn(),
      onRemovePage: vi.fn(),
      onReorderPage: vi.fn(),
    }

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-before-edit",
              rendererRevision: "renderer-reconcile",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.signal.aborted).toBe(false)

      const changedCanonicalDocument = {
        ...fixture.document,
        revision: fixture.document.revision + 1,
        pages: fixture.document.pages.map((page) =>
          page.id === "performance-page-2"
            ? { ...page, background: "#abcdef" }
            : page
        ),
      }
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            raster: {
              canonicalDocument: changedCanonicalDocument,
              documentSnapshotId: "snapshot-after-edit",
              rendererRevision: "renderer-reconcile",
              producer,
            },
          })
        )
      )

      expect(requests).toHaveLength(2)
      expect(requests[0]?.signal.aborted).toBe(true)
      expect(requests[1]?.signal.aborted).toBe(false)
      expect(requests[0]?.key.pageRevision).not.toBe(
        requests[1]?.key.pageRevision
      )
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("evicts cached and aborts active rasters when their pages are removed", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const signals = new Map<string, AbortSignal>()
    const producer = vi.fn(
      (key: PageThumbnailRasterKey, signal: AbortSignal) => {
        signals.set(key.pageId, signal)
        return key.pageId === "performance-page-2"
          ? Promise.resolve(new Blob([key.pageId], { type: "image/png" }))
          : new Promise<Blob>(() => undefined)
      }
    )
    const removedPageIds = new Set(["performance-page-2", "performance-page-3"])
    const retainedPages = fixture.document.pages.filter(
      (page) => !removedPageIds.has(page.id)
    )
    const retainedNodeIds = new Set(
      retainedPages.flatMap((page) => page.nodeIds)
    )
    const reducedDocument = {
      ...fixture.document,
      revision: fixture.document.revision + 1,
      pages: retainedPages,
      nodes: fixture.document.nodes.filter((node) =>
        retainedNodeIds.has(node.id)
      ),
      outputs: fixture.document.outputs.map((output) => ({
        ...output,
        pageIds: output.pageIds.filter((pageId) => !removedPageIds.has(pageId)),
      })),
    }
    const baseProps = {
      activePageId: fixture.document.pages[0].id,
      reviewPending: false,
      onSelectPage: vi.fn(),
      onAddPage: vi.fn(),
      onDuplicatePage: vi.fn(),
      onRemovePage: vi.fn(),
      onReorderPage: vi.fn(),
    }

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...baseProps,
            document: fixture.document,
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-before-remove",
              rendererRevision: "renderer-remove",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(["performance-page-2", "performance-page-3"], true)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(producer).toHaveBeenCalledTimes(2)
      expect(createObjectUrl).toHaveBeenCalledOnce()
      expect(signals.get("performance-page-3")?.aborted).toBe(false)

      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...baseProps,
            document: reducedDocument,
            raster: {
              canonicalDocument: reducedDocument,
              documentSnapshotId: "snapshot-after-remove",
              rendererRevision: "renderer-remove",
              producer,
            },
          })
        )
      )

      expect(signals.get("performance-page-3")?.aborted).toBe(true)
      expect(revokeObjectUrl).toHaveBeenCalledOnce()
      expect(pageSelectorButtons(host)).toHaveLength(98)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("falls back to a viewport-bounded live thumbnail after raster failure", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const producer = vi.fn(async () => {
      throw new Error("thumbnail service unavailable")
    })

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            document: fixture.document,
            activePageId: fixture.document.pages[0].id,
            reviewPending: false,
            onSelectPage: vi.fn(),
            onAddPage: vi.fn(),
            onDuplicatePage: vi.fn(),
            onRemovePage: vi.fn(),
            onReorderPage: vi.fn(),
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-failure",
              rendererRevision: "renderer-failure",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(producer).toHaveBeenCalledOnce()
      expect(renderedThumbnailIds(host)).toEqual([
        "performance-page-1",
        "performance-page-2",
      ])
      expect(host.querySelector('[data-thumbnail-state="error"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("recreates the raster cache across the Strict Mode effect probe", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const producer = vi.fn(async (key: PageThumbnailRasterKey) =>
      Promise.resolve(new Blob([key.pageId], { type: "image/png" }))
    )

    try {
      await act(async () =>
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(PageFilmstrip, {
              document: fixture.document,
              activePageId: fixture.document.pages[0].id,
              reviewPending: false,
              onSelectPage: vi.fn(),
              onAddPage: vi.fn(),
              onDuplicatePage: vi.fn(),
              onRemovePage: vi.fn(),
              onReorderPage: vi.fn(),
              raster: {
                canonicalDocument: fixture.document,
                documentSnapshotId: "snapshot-strict",
                rendererRevision: "renderer-strict",
                producer,
              },
            })
          )
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(producer).toHaveBeenCalled()
      expect(
        host.querySelector(
          '[data-page-thumbnail-id="performance-page-2"] img[data-thumbnail-state="ready"]'
        )
      ).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("atomically replaces a mounted raster producer without using the disposed cache", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const firstProducer = vi.fn(async (key: PageThumbnailRasterKey) =>
      Promise.resolve(new Blob([`first:${key.pageId}`], { type: "image/png" }))
    )
    const secondProducer = vi.fn(async (key: PageThumbnailRasterKey) =>
      Promise.resolve(new Blob([`second:${key.pageId}`], { type: "image/png" }))
    )
    const props = {
      document: fixture.document,
      activePageId: fixture.document.pages[0].id,
      reviewPending: false,
      onSelectPage: vi.fn(),
      onAddPage: vi.fn(),
      onDuplicatePage: vi.fn(),
      onRemovePage: vi.fn(),
      onReorderPage: vi.fn(),
    }

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-first-producer",
              rendererRevision: "renderer-producer-change",
              producer: firstProducer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")
      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(firstProducer).toHaveBeenCalledOnce()

      await act(async () => {
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-second-producer",
              rendererRevision: "renderer-producer-change",
              producer: secondProducer,
            },
          })
        )
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(secondProducer).toHaveBeenCalledOnce()
      expect(
        host.querySelector(
          '[data-page-thumbnail-id="performance-page-2"] img[data-thumbnail-state="ready"]'
        )
      ).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("retries a visible transient raster failure with bounded backoff", async () => {
    vi.useFakeTimers()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    let attempts = 0
    const producer = vi.fn(async (key: PageThumbnailRasterKey) => {
      attempts += 1
      if (attempts === 1) {
        throw new StudioPageThumbnailRasterError(
          "request_failed",
          "Thumbnail capacity is temporarily unavailable.",
          0
        )
      }
      return new Blob([key.pageId], { type: "image/png" })
    })

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            document: fixture.document,
            activePageId: fixture.document.pages[0].id,
            reviewPending: false,
            onSelectPage: vi.fn(),
            onAddPage: vi.fn(),
            onDuplicatePage: vi.fn(),
            onRemovePage: vi.fn(),
            onReorderPage: vi.fn(),
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-transient-retry",
              rendererRevision: "renderer-transient-retry",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")
      await act(async () => {
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(producer).toHaveBeenCalledOnce()
      expect(
        host.querySelector(
          '[data-page-thumbnail-id="performance-page-2"] [data-artboard-page-id="performance-page-2"]'
        )
      ).not.toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(producer).toHaveBeenCalledTimes(2)
      expect(
        host.querySelector(
          '[data-page-thumbnail-id="performance-page-2"] img[data-thumbnail-state="ready"]'
        )
      ).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it("touches a revisited raster before LRU eviction in the mounted UI path", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const producer = vi.fn(async (key: PageThumbnailRasterKey) =>
      Promise.resolve(new Blob([key.pageId], { type: "image/png" }))
    )
    const initiallyVisible = fixture.document.pages
      .slice(1, 65)
      .map((page) => page.id)

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            document: fixture.document,
            activePageId: fixture.document.pages[0].id,
            reviewPending: false,
            onSelectPage: vi.fn(),
            onAddPage: vi.fn(),
            onDuplicatePage: vi.fn(),
            onRemovePage: vi.fn(),
            onReorderPage: vi.fn(),
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-mounted-lru",
              rendererRevision: "renderer-mounted-lru",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")
      await act(async () => {
        observer.trigger(initiallyVisible, true)
        for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
      })
      expect(producer).toHaveBeenCalledTimes(64)

      await act(async () => {
        observer.trigger(["performance-page-2"], false)
        await Promise.resolve()
        observer.trigger(["performance-page-2"], true)
        await Promise.resolve()
      })
      expect(producer).toHaveBeenCalledTimes(64)

      await act(async () => {
        observer.trigger(["performance-page-66"], true)
        for (let turn = 0; turn < 4; turn += 1) await Promise.resolve()
      })

      expect(producer).toHaveBeenCalledTimes(65)
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:filmstrip-2")
      expect(revokeObjectUrl).not.toHaveBeenCalledWith("blob:filmstrip-1")
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("uses exact cached rasters for visible inactive pages and keeps the active page live", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const producer = vi.fn(async (key: PageThumbnailRasterKey) =>
      Promise.resolve(new Blob([key.pageId], { type: "image/png" }))
    )
    const props = {
      document: fixture.document,
      activePageId: fixture.document.pages[0].id,
      reviewPending: false,
      onSelectPage: vi.fn(),
      onAddPage: vi.fn(),
      onDuplicatePage: vi.fn(),
      onRemovePage: vi.fn(),
      onReorderPage: vi.fn(),
    }

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-1",
              rendererRevision: "renderer-1",
              producer,
            },
          })
        )
      )
      const observer = TestIntersectionObserver.instances.at(-1)
      if (!observer) throw new Error("Expected the shared thumbnail observer")

      await act(async () => {
        observer.trigger(
          [
            "performance-page-1",
            "performance-page-2",
            "performance-page-3",
            "performance-page-4",
          ],
          true
        )
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(renderedThumbnailIds(host)).toEqual(["performance-page-1"])
      expect(producer).toHaveBeenCalledTimes(3)
      expect(
        producer.mock.calls.map(([key]) => ({
          pageId: key.pageId,
          documentSnapshotId: key.documentSnapshotId,
          pixelWidth: key.pixelWidth,
          pixelHeight: key.pixelHeight,
        }))
      ).toEqual([
        {
          pageId: "performance-page-2",
          documentSnapshotId: "snapshot-1",
          pixelWidth: 88,
          pixelHeight: 57,
        },
        {
          pageId: "performance-page-3",
          documentSnapshotId: "snapshot-1",
          pixelWidth: 88,
          pixelHeight: 57,
        },
        {
          pageId: "performance-page-4",
          documentSnapshotId: "snapshot-1",
          pixelWidth: 88,
          pixelHeight: 57,
        },
      ])
      expect(
        host.querySelectorAll('img[data-thumbnail-state="ready"]')
      ).toHaveLength(3)
      const readyThumbnail = host.querySelector<HTMLImageElement>(
        '[data-page-thumbnail-id="performance-page-2"] img[data-thumbnail-state="ready"]'
      )
      const pageTwoGeometry = filmstripThumbnailGeometry(
        fixture.document.pages[1]
      )
      expect(readyThumbnail?.getAttribute("width")).toBe(
        String(Math.max(1, Math.round(pageTwoGeometry.width)))
      )
      expect(readyThumbnail?.getAttribute("height")).toBe(
        String(Math.max(1, Math.round(pageTwoGeometry.height)))
      )
      expect(createObjectUrl).toHaveBeenCalledTimes(3)

      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            raster: {
              canonicalDocument: fixture.document,
              documentSnapshotId: "snapshot-2",
              rendererRevision: "renderer-1",
              producer,
            },
          })
        )
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(producer).toHaveBeenCalledTimes(3)
      expect(revokeObjectUrl).not.toHaveBeenCalled()

      const changedCanonicalDocument = {
        ...fixture.document,
        revision: fixture.document.revision + 1,
        pages: fixture.document.pages.map((page) =>
          page.id === "performance-page-2"
            ? { ...page, background: "#abcdef" }
            : page
        ),
      }
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            raster: {
              canonicalDocument: changedCanonicalDocument,
              documentSnapshotId: "snapshot-3",
              rendererRevision: "renderer-1",
              producer,
            },
          })
        )
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(producer).toHaveBeenCalledTimes(4)
      expect(producer.mock.calls.at(3)?.[0]).toMatchObject({
        pageId: "performance-page-2",
        documentSnapshotId: "snapshot-3",
      })
      expect(createObjectUrl).toHaveBeenCalledTimes(4)
      expect(revokeObjectUrl).toHaveBeenCalledTimes(1)
      expect(
        host.querySelectorAll('img[data-thumbnail-state="ready"]')
      ).toHaveLength(3)
      expect(renderedThumbnailIds(host)).toEqual(["performance-page-1"])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }

    expect(revokeObjectUrl).toHaveBeenCalledTimes(4)
  })

  it("uses the canonical first page when a stale active ID is restored", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            document: fixture.document,
            activePageId: "removed-page",
            reviewPending: false,
            onSelectPage: vi.fn(),
            onAddPage: vi.fn(),
            onDuplicatePage: vi.fn(),
            onRemovePage: vi.fn(),
            onReorderPage: vi.fn(),
          })
        )
      )

      expect(
        host
          .querySelector('button[aria-label^="Open page 1:"]')
          ?.getAttribute("aria-current")
      ).toBe("page")
      expect(renderedThumbnailIds(host)).toEqual(["performance-page-1"])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it("reconciles removed pages and ignores a replaced observer's queued entries", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const retainedPages = fixture.document.pages.slice(0, 3)
    const retainedPageIds = new Set(retainedPages.map((page) => page.id))
    const reducedDocument = {
      ...fixture.document,
      pages: retainedPages,
      nodes: fixture.document.nodes.filter((node) =>
        retainedPages.some((page) => page.nodeIds.includes(node.id))
      ),
      outputs: fixture.document.outputs.map((output) => ({
        ...output,
        pageIds: output.pageIds.filter((pageId) => retainedPageIds.has(pageId)),
      })),
    }

    try {
      const props = {
        activePageId: retainedPages[0].id,
        reviewPending: false,
        onSelectPage: vi.fn(),
        onAddPage: vi.fn(),
        onDuplicatePage: vi.fn(),
        onRemovePage: vi.fn(),
        onReorderPage: vi.fn(),
      }
      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            document: fixture.document,
          })
        )
      )
      const originalObserver = TestIntersectionObserver.instances.at(-1)
      if (!originalObserver) throw new Error("Expected the original observer")

      await act(async () => {
        originalObserver.trigger(["performance-page-50"], true)
      })
      expect(renderedThumbnailIds(host)).toEqual([
        "performance-page-1",
        "performance-page-50",
      ])

      await act(async () =>
        root.render(
          createElement(PageFilmstrip, {
            ...props,
            document: reducedDocument,
          })
        )
      )
      const replacementObserver = TestIntersectionObserver.instances.at(-1)
      if (!replacementObserver || replacementObserver === originalObserver) {
        throw new Error("Expected a replacement observer")
      }

      expect(originalObserver.disconnected).toBe(true)
      expect(replacementObserver.observed).toHaveLength(3)
      expect(pageSelectorButtons(host)).toHaveLength(3)
      expect(renderedThumbnailIds(host)).toEqual(["performance-page-1"])

      await act(async () => {
        originalObserver.trigger(["performance-page-2"], true)
      })
      expect(renderedThumbnailIds(host)).toEqual(["performance-page-1"])

      await act(async () => {
        replacementObserver.trigger(["performance-page-2"], true)
      })
      expect(renderedThumbnailIds(host)).toEqual([
        "performance-page-1",
        "performance-page-2",
      ])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
