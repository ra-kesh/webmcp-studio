// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { libraryMediaSummarySchema } from "@webmcp/document"
import type { LibraryMediaSummary } from "@webmcp/document"
import type { ExactDeviceLocalMediaPreview } from "./library-media-discovery"
import {
  LIBRARY_MEDIA_PREVIEW_ROOT_MARGIN,
  LibraryMediaPreview,
  libraryMediaPreviewPath,
} from "./library-media-preview"
import type { LibraryMediaPreviewLoader } from "./library-media-preview"

class Deferred<TValue> {
  readonly promise: Promise<TValue>
  resolve!: (value: TValue) => void
  reject!: (reason?: unknown) => void

  constructor() {
    this.promise = new Promise<TValue>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

class TestIntersectionObserver implements IntersectionObserver {
  static instances: TestIntersectionObserver[] = []

  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly scrollMargin = "0px"
  readonly thresholds: readonly number[] = [0]
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

  observe(target: Element) {
    this.observed.add(target)
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  unobserve(target: Element) {
    this.observed.delete(target)
  }

  trigger(isIntersecting: boolean) {
    const entries = [...this.observed].map((target) => ({
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: target.getBoundingClientRect(),
      isIntersecting,
      rootBounds: null,
      target,
      time: performance.now(),
    }))
    this.callback(entries, this)
  }
}

const summary = (
  mediaSource: LibraryMediaSummary["mediaSource"],
  id = "asset:hero",
  version = 3
): LibraryMediaSummary =>
  libraryMediaSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "media",
    id,
    version,
    mediaSource,
    name: `Preview ${id}`,
    description: "Exact preview fixture",
    categoryId: "workspace-upload",
    useCaseIds: [],
    formatFamily: "raster",
    orientation: "landscape",
    mimeType: "image/png",
    dimensions: { width: 1200, height: 800 },
    bytes: 4096,
    selectable: true,
    tags: ["preview"],
    owner: { kind: mediaSource === "curated" ? "studio" : "workspace" },
    permissions: {
      canView: true,
      canUse: true,
      canFavorite: mediaSource !== "local",
      canAddToCollection: mediaSource !== "local",
    },
    provenance: {
      sourceName: mediaSource === "local" ? "This device" : "Studio media",
      sourceUrl: null,
      license: { id: "fixture", name: "Fixture", url: null },
      attribution: { required: false, text: null },
      contentSha256: mediaSource === "curated" ? "a".repeat(64) : null,
    },
    compatibility: {
      availability: "available",
      requirements: [],
      supportedActions: ["insert", "replace", "assign_field"],
      reason: null,
    },
    preview: {
      kind: "live_fallback",
      itemId: id,
      itemVersion: version,
      pageId: null,
      width: 1200,
      height: 800,
      resourcePath: null,
      mediaType: null,
      contentSha256: null,
      rendererRevision: null,
    },
    preferences:
      mediaSource === "local"
        ? { favorite: false, lastUsedAt: null, collectionIds: [] }
        : null,
    catalogStatus: "active",
    curatedRank: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  })

const exactPreview = (
  item: LibraryMediaSummary,
  overrides: Partial<ExactDeviceLocalMediaPreview> = {}
): ExactDeviceLocalMediaPreview => ({
  identity: {
    source: "local",
    assetId: item.id,
    revision: item.version,
  },
  blob: new Blob([new Uint8Array(item.bytes)], { type: item.mimeType }),
  mimeType: item.mimeType,
  bytes: item.bytes,
  width: item.dimensions.width,
  height: item.dimensions.height,
  ...overrides,
})

const loaderHarness = () => {
  const requests: Array<{
    signal: AbortSignal | undefined
    deferred: Deferred<ExactDeviceLocalMediaPreview>
  }> = []
  const load: LibraryMediaPreviewLoader = vi.fn((_identity, signal) => {
    const deferred = new Deferred<ExactDeviceLocalMediaPreview>()
    requests.push({ signal, deferred })
    return deferred.promise
  })
  return { load, requests }
}

describe("LibraryMediaPreview mounted lifecycle", () => {
  let host: HTMLDivElement
  let root: Root
  let rootUnmounted: boolean
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let originalIntersectionObserver: typeof globalThis.IntersectionObserver
  let originalCreateObjectURL: PropertyDescriptor | undefined
  let originalRevokeObjectURL: PropertyDescriptor | undefined

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    rootUnmounted = false
    TestIntersectionObserver.instances.length = 0
    originalIntersectionObserver = globalThis.IntersectionObserver
    originalCreateObjectURL = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL"
    )
    originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL"
    )
    Object.assign(globalThis, {
      IntersectionObserver: TestIntersectionObserver,
    })
    let urlIndex = 0
    createObjectURL = vi.fn(() => `blob:media-preview-${++urlIndex}`)
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    host.remove()
    Object.assign(globalThis, {
      IntersectionObserver: originalIntersectionObserver,
    })
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL)
    } else {
      Reflect.deleteProperty(URL, "createObjectURL")
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL)
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL")
    }
    vi.restoreAllMocks()
  })

  it("derives encoded same-origin routes and preserves 4:3 geometry on failure", async () => {
    const load = vi.fn()
    const curated = summary("curated", "asset:hero", 7)
    expect(libraryMediaPreviewPath(curated)).toBe(
      "/v1/studio/library/media/asset%3Ahero/versions/7/content"
    )

    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={curated}
          loadLocalPreview={load}
          ownershipKey="library:query-1"
        />
      )
    )

    const image = host.querySelector("img")
    const frame = host.firstElementChild
    expect(frame?.className).toContain("aspect-4/3")
    expect(image?.getAttribute("loading")).toBe("lazy")
    expect(image?.getAttribute("decoding")).toBe("async")
    expect(image).toMatchObject({ width: 1200, height: 800 })
    expect(image?.getAttribute("src")).toBe(
      "/v1/studio/library/media/asset%3Ahero/versions/7/content"
    )
    expect(load).not.toHaveBeenCalled()

    const managed = summary("managed", "asset:hero", 9)
    expect(libraryMediaPreviewPath(managed)).toBe(
      "/v1/studio/assets/asset%3Ahero/content"
    )
    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={managed}
          loadLocalPreview={load}
          ownershipKey="uploads:query-2"
        />
      )
    )
    const managedImage = host.querySelector("img")
    expect(managedImage?.getAttribute("src")).toBe(
      "/v1/studio/assets/asset%3Ahero/content"
    )
    await act(async () =>
      managedImage?.dispatchEvent(new Event("error", { bubbles: false }))
    )
    expect(host.firstElementChild?.className).toContain("aspect-4/3")
    expect(host.querySelector("img")).toBeNull()
    expect(host.querySelector('[role="img"]')?.textContent).toContain(
      "Preview unavailable"
    )
    expect(host.innerHTML).not.toMatch(/r2|indexeddb|sha256|filesystem/i)
  })

  it("loads local bytes only near the viewport and revokes on exit, revision, and unmount", async () => {
    const first = summary("local", "local-preview", 3)
    const second = summary("local", "local-preview", 4)
    const harness = loaderHarness()
    const visibilityRoot = document.createElement("div")

    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={first}
          loadLocalPreview={harness.load}
          ownershipKey="uploads:query-1"
          visibilityRoot={visibilityRoot}
        />
      )
    )
    const firstObserver = TestIntersectionObserver.instances.at(-1)!
    expect(firstObserver.root).toBe(visibilityRoot)
    expect(firstObserver.rootMargin).toBe(LIBRARY_MEDIA_PREVIEW_ROOT_MARGIN)
    expect(harness.load).not.toHaveBeenCalled()
    expect(host.innerHTML).not.toContain("blob:")

    await act(async () => firstObserver.trigger(true))
    expect(harness.load).toHaveBeenCalledTimes(1)
    expect(harness.requests[0]?.signal?.aborted).toBe(false)
    await act(async () =>
      harness.requests[0]?.deferred.resolve(exactPreview(first))
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "blob:media-preview-1"
    )

    await act(async () => firstObserver.trigger(false))
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:media-preview-1"
    )
    expect(host.innerHTML).not.toContain("blob:")

    await act(async () => firstObserver.trigger(true))
    expect(harness.load).toHaveBeenCalledTimes(2)
    await act(async () =>
      harness.requests[1]?.deferred.resolve(exactPreview(first))
    )
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "blob:media-preview-2"
    )

    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={second}
          loadLocalPreview={harness.load}
          ownershipKey="uploads:query-2"
          visibilityRoot={visibilityRoot}
        />
      )
    )
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:media-preview-2")
    expect(firstObserver.disconnected).toBe(true)
    const secondObserver = TestIntersectionObserver.instances.at(-1)!
    await act(async () => secondObserver.trigger(true))
    expect(harness.load).toHaveBeenCalledTimes(3)
    expect(harness.requests[2]?.signal?.aborted).toBe(false)

    await act(async () => {
      root.unmount()
      rootUnmounted = true
    })
    expect(harness.requests[2]?.signal?.aborted).toBe(true)
    await act(async () =>
      harness.requests[2]?.deferred.resolve(exactPreview(second))
    )
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it("aborts and fences a mid-flight request when revision or ownership changes", async () => {
    const revisionOne = summary("local", "local-race", 1)
    const revisionTwo = summary("local", "local-race", 2)
    const harness = loaderHarness()

    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={revisionOne}
          loadLocalPreview={harness.load}
          ownershipKey="uploads:query-one"
        />
      )
    )
    await act(async () =>
      TestIntersectionObserver.instances.at(-1)?.trigger(true)
    )
    const revisionOneRequest = harness.requests[0]

    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={revisionTwo}
          loadLocalPreview={harness.load}
          ownershipKey="uploads:query-one"
        />
      )
    )
    expect(revisionOneRequest.signal?.aborted).toBe(true)
    await act(async () =>
      revisionOneRequest.deferred.resolve(exactPreview(revisionOne))
    )
    expect(createObjectURL).not.toHaveBeenCalled()

    await act(async () =>
      TestIntersectionObserver.instances.at(-1)?.trigger(true)
    )
    const revisionTwoRequest = harness.requests[1]
    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={revisionTwo}
          loadLocalPreview={harness.load}
          ownershipKey="uploads:query-two"
        />
      )
    )
    expect(revisionTwoRequest.signal?.aborted).toBe(true)
    await act(async () =>
      revisionTwoRequest.deferred.resolve(exactPreview(revisionTwo))
    )
    expect(createObjectURL).not.toHaveBeenCalled()

    await act(async () =>
      TestIntersectionObserver.instances.at(-1)?.trigger(true)
    )
    await act(async () =>
      harness.requests[2]?.deferred.resolve(exactPreview(revisionTwo))
    )
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "blob:media-preview-1"
    )
  })

  it("fails without shifting or creating a URL when exact local metadata mismatches", async () => {
    const item = summary("local", "local-mismatch", 2)
    const harness = loaderHarness()
    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={item}
          loadLocalPreview={harness.load}
          ownershipKey="uploads:mismatch"
        />
      )
    )
    await act(async () =>
      TestIntersectionObserver.instances.at(-1)?.trigger(true)
    )
    await act(async () =>
      harness.requests[0]?.deferred.resolve(
        exactPreview(item, {
          identity: { source: "local", assetId: item.id, revision: 3 },
        })
      )
    )

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(host.firstElementChild?.className).toContain("aspect-4/3")
    expect(
      host.querySelector('[data-local-preview-state="failed"]')
    ).not.toBeNull()
    expect(host.innerHTML).not.toContain("blob:")
  })

  it("rejects a wrong-source exact result without creating an object URL", async () => {
    const item = summary("local", "local-wrong-source", 2)
    const harness = loaderHarness()
    await act(async () =>
      root.render(
        <LibraryMediaPreview
          item={item}
          loadLocalPreview={harness.load}
          ownershipKey="uploads:wrong-source"
        />
      )
    )
    await act(async () =>
      TestIntersectionObserver.instances.at(-1)?.trigger(true)
    )
    const wrongSource = {
      ...exactPreview(item),
      identity: {
        source: "managed",
        assetId: item.id,
        revision: item.version,
      },
    } as unknown as ExactDeviceLocalMediaPreview
    await act(async () => harness.requests[0]?.deferred.resolve(wrongSource))

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(host.querySelector("img")).toBeNull()
    expect(
      host.querySelector('[data-local-preview-state="failed"]')
    ).not.toBeNull()
    expect(host.innerHTML).not.toContain("blob:")
  })

  it("keeps 1,000 local summaries metadata-only and bounds byte reads to observed cards", async () => {
    const items = Array.from({ length: 1_000 }, (_, index) =>
      summary("local", `local-${index + 1}`, 1)
    )
    const harness = loaderHarness()
    await act(async () =>
      root.render(
        <div>
          {items.map((item) => (
            <LibraryMediaPreview
              key={item.id}
              item={item}
              loadLocalPreview={harness.load}
              ownershipKey="uploads:thousand"
            />
          ))}
        </div>
      )
    )
    expect(TestIntersectionObserver.instances).toHaveLength(1_000)
    expect(harness.load).not.toHaveBeenCalled()

    await act(async () => {
      for (const observer of TestIntersectionObserver.instances.slice(0, 3)) {
        observer.trigger(true)
      }
    })
    expect(harness.load).toHaveBeenCalledTimes(3)
    await act(async () => {
      harness.requests.forEach((request, index) => {
        request.deferred.resolve(exactPreview(items[index]))
      })
    })
    expect(createObjectURL).toHaveBeenCalledTimes(3)
    expect(host.querySelectorAll('img[src^="blob:"]')).toHaveLength(3)

    await act(async () => {
      root.unmount()
      rootUnmounted = true
    })
    expect(revokeObjectURL).toHaveBeenCalledTimes(3)
  })
})
