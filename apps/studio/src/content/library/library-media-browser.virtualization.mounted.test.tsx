// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { projectLocalMediaSummary } from "@webmcp/document"
import type {
  LibraryMediaSummary,
  LocalLibraryMediaMetadata,
} from "@webmcp/document"
import {
  LIBRARY_MEDIA_VIRTUALIZATION_THRESHOLD,
  LibraryMediaCollection,
} from "./library-media-collection"
import type {
  LibraryMediaCollectionCardRenderProps,
  LibraryMediaCollectionSourceGroup,
} from "./library-media-collection"
import { libraryMediaUiIdentity } from "./library-media-discovery"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const metadata: LocalLibraryMediaMetadata = {
  description: "A media collection fixture",
  categoryId: "workspace-upload",
  useCaseIds: ["proposal"],
  formatFamily: "raster",
  tags: ["fixture"],
  permissions: {
    canView: true,
    canUse: true,
    canFavorite: false,
    canAddToCollection: false,
  },
  provenance: {
    sourceName: "Mounted collection fixture",
    sourceUrl: null,
    license: { id: "fixture", name: "Fixture", url: null },
    attribution: { required: false, text: null },
    contentSha256: null,
  },
}

const media = (
  index: number,
  mediaSource: LibraryMediaSummary["mediaSource"] = "managed"
) => {
  const local = projectLocalMediaSummary(
    {
      id: `asset-${index}`,
      name: `Media ${index}`,
      mediaType: "image/png",
      size: 4096 + index,
      width: 1200,
      height: 800,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      lastUsedAt: "2026-08-31T00:00:00.000Z",
      archivedAt: null,
      revision: 1,
      integrity: "ready",
    },
    metadata
  )
  return { ...local, mediaSource }
}

const group = (
  label: string,
  count: number,
  mediaSource: LibraryMediaSummary["mediaSource"] = "managed",
  offset = 0
): LibraryMediaCollectionSourceGroup => ({
  label,
  items: Array.from({ length: count }, (_, index) =>
    media(index + offset, mediaSource)
  ),
})

const renderCard = ({
  item,
  identity,
  selected,
  focused,
  cardRef,
  onFocus,
}: LibraryMediaCollectionCardRenderProps) => (
  <article data-media-card={identity}>
    <button
      ref={cardRef}
      aria-label={`Use ${item.name}`}
      data-focused={focused ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      type="button"
      onFocus={onFocus}
    >
      {item.name}
    </button>
  </article>
)

describe("LibraryMediaCollection measurement and virtualization", () => {
  let host: HTMLDivElement
  let scrollHost: HTMLDivElement
  let root: Root
  let width: number
  let resizeCallbacks: Set<ResizeObserverCallback>

  beforeEach(() => {
    host = document.createElement("div")
    scrollHost = document.createElement("div")
    scrollHost.setAttribute("data-shared-scroll-host", "true")
    scrollHost.appendChild(host)
    document.body.appendChild(scrollHost)
    root = createRoot(host)
    width = 880
    resizeCallbacks = new Set()
    Object.defineProperty(scrollHost, "clientHeight", {
      configurable: true,
      value: 640,
    })
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const elementWidth = this.hasAttribute("data-library-media-grid-host")
          ? width
          : 900
        const elementHeight = this.hasAttribute("data-shared-scroll-host")
          ? 640
          : 260
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
          const contentRect = target.getBoundingClientRect()
          this.callback(
            [
              {
                target,
                contentRect,
                borderBoxSize: [
                  {
                    inlineSize: contentRect.width,
                    blockSize: contentRect.height,
                  },
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
        return window.setTimeout(() => callback(0), 0)
      })
    )
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((handle: number) => window.clearTimeout(handle))
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    scrollHost.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const notifyResize = async () => {
    await act(async () => {
      for (const callback of resizeCallbacks) {
        const target = host.querySelector("[data-library-media-grid-host]")!
        const contentRect = target.getBoundingClientRect()
        callback(
          [
            {
              target,
              contentRect,
              borderBoxSize: [
                {
                  inlineSize: contentRect.width,
                  blockSize: contentRect.height,
                },
              ],
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver
        )
      }
    })
  }

  const mount = async (
    serverGroup: LibraryMediaCollectionSourceGroup,
    options: {
      localGroup?: LibraryMediaCollectionSourceGroup | null
      selectedIdentity?: string | null
      focusedIdentity?: string | null
      forceFocusIdentity?: boolean
      renderServerLoadMore?: () => React.ReactNode
      renderServerFinalStatus?: () => React.ReactNode
      onCardFocus?: (
        identity: string,
        index: number,
        authority: "server" | "local"
      ) => void
      onFocusIntentHandled?: () => void
    } = {}
  ) => {
    await act(async () => {
      root.render(
        <LibraryMediaCollection
          serverGroup={serverGroup}
          localGroup={options.localGroup}
          selectedIdentity={options.selectedIdentity}
          focusedIdentity={options.focusedIdentity}
          forceFocusIdentity={options.forceFocusIdentity}
          getScrollElement={() => scrollHost}
          renderCard={renderCard}
          renderServerLoadMore={options.renderServerLoadMore}
          renderServerFinalStatus={options.renderServerFinalStatus}
          onCardFocus={options.onCardFocus}
          onFocusIntentHandled={options.onFocusIntentHandled}
        />
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }

  it("keeps 48 cards semantic and virtualizes at exactly 49", async () => {
    await mount(group("Studio library", LIBRARY_MEDIA_VIRTUALIZATION_THRESHOLD))
    expect(
      host.querySelector('[data-library-media-semantic-list="server"]')
    ).not.toBeNull()
    expect(
      host.querySelector("[data-library-media-virtual-content]")
    ).toBeNull()
    expect(host.querySelectorAll("[data-media-card]")).toHaveLength(48)

    await mount(group("Studio library", 49))
    expect(
      host.querySelector("[data-library-media-virtual-content]")
    ).not.toBeNull()
    expect(host.querySelector("[data-library-media-semantic-list]")).toBeNull()
    expect(host.querySelector('[aria-setsize="49"]')).not.toBeNull()
  })

  it("keeps a 1,000-item media catalog within the mounted-card budget", async () => {
    await mount(group("Studio library", 1_000))

    const mountedCards = host.querySelectorAll("[data-media-card]").length
    expect(
      host.querySelector("[data-library-media-virtual-content]")
    ).not.toBeNull()
    expect(host.querySelector('[aria-setsize="1000"]')).not.toBeNull()
    expect(mountedCards).toBeGreaterThan(0)
    expect(mountedCards).toBeLessThanOrEqual(32)
  })

  it.each([
    [320, 1],
    [360, 2],
    [620, 3],
    [860, 4],
  ])(
    "derives %i px as %i columns from only the measured host",
    async (nextWidth, columns) => {
      width = nextWidth
      await mount(group("Studio library", 8))
      const list = host.querySelector<HTMLElement>(
        '[data-library-media-semantic-list="server"]'
      )!
      expect(list.style.gridTemplateColumns).toContain(`repeat(${columns}`)
    }
  )

  it("retains selected and focused virtual rows across a column remount", async () => {
    const items = group("Studio library", 49)
    const selected = libraryMediaUiIdentity(items.items[40])
    const focused = libraryMediaUiIdentity(items.items[48])
    const handled = vi.fn()
    await mount(items, {
      selectedIdentity: selected,
      focusedIdentity: focused,
      forceFocusIdentity: true,
      onFocusIntentHandled: handled,
    })

    expect(host.querySelector(`[data-media-card="${selected}"]`)).not.toBeNull()
    expect(host.querySelector(`[data-media-card="${focused}"]`)).not.toBeNull()
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Use Media 48"
    )

    width = 620
    await notifyResize()
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Use Media 48"
    )
    expect(handled).toHaveBeenCalled()
  })

  it("renders local authority once with independent positions and keeps pagination server-owned", async () => {
    const loadMore = vi.fn(() => (
      <button type="button">Load cloud media</button>
    ))
    const finalStatus = vi.fn(() => <p tabIndex={-1}>12 of 30 cloud results</p>)
    await mount(group("Workspace uploads", 3), {
      localGroup: group("On this device", 2, "local", 100),
      renderServerLoadMore: loadMore,
      renderServerFinalStatus: finalStatus,
    })

    expect(host.querySelectorAll('[data-media-group="local"]')).toHaveLength(1)
    expect(
      host.querySelectorAll(
        '[data-library-media-semantic-list="local"] [role], [data-library-media-semantic-list="local"] li'
      )
    ).toHaveLength(2)
    expect(
      host.querySelector(
        '[data-library-media-semantic-list="local"] [aria-posinset="1"][aria-setsize="2"]'
      )
    ).not.toBeNull()
    expect(
      host.querySelector(
        '[data-library-media-semantic-list="server"] [aria-posinset="3"][aria-setsize="3"]'
      )
    ).not.toBeNull()
    const pagination = host.querySelector("[data-media-server-pagination]")!
    expect(pagination.closest('[data-media-group="local"]')).toBeNull()
    expect(pagination.textContent).toContain("12 of 30 cloud results")
    expect(pagination.textContent).not.toContain("5")
    expect(loadMore).toHaveBeenCalled()
    expect(finalStatus).toHaveBeenCalled()
  })

  it("uses source-aware keys and native group/list semantics for collisions", async () => {
    const managed = media(7, "managed")
    const local = media(7, "local")
    await mount(
      { label: "Workspace uploads", items: [managed] },
      {
        localGroup: { label: "On this device", items: [local] },
      }
    )

    const managedIdentity = libraryMediaUiIdentity(managed)
    const localIdentity = libraryMediaUiIdentity(local)
    expect(managedIdentity).not.toBe(localIdentity)
    expect(
      host.querySelector(`[data-media-card="${managedIdentity}"]`)
    ).not.toBeNull()
    expect(
      host.querySelector(`[data-media-card="${localIdentity}"]`)
    ).not.toBeNull()
    expect(host.querySelectorAll("section[aria-labelledby]")).toHaveLength(2)
    expect(host.querySelectorAll("ul")).toHaveLength(2)
    expect(
      host.querySelectorAll("li[aria-posinset='1'][aria-setsize='1']")
    ).toHaveLength(2)
    expect(host.querySelectorAll("button[type='button']")).toHaveLength(2)
  })
})
