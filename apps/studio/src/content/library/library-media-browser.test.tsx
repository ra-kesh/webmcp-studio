// @vitest-environment jsdom

import { act, StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LibraryDiscoveryHttpError } from "./library-discovery-client"
import {
  LibraryMediaBrowser,
  libraryMediaScopeCriteria,
} from "./library-media-browser"
import type {
  LibraryMediaBrowserProps,
  LibraryMediaScope,
} from "./library-media-browser"
import {
  createMediaBrowserHarness,
  curatedMediaFixture,
  localMediaFixture,
  managedMediaFixture,
  MediaBrowserTestRoot,
} from "./library-media-browser.test-support"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

class DormantIntersectionObserver implements IntersectionObserver {
  static instances: DormantIntersectionObserver[] = []

  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly scrollMargin = "0px"
  readonly thresholds = [0]

  constructor(
    _callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.root = options.root ?? null
    this.rootMargin = options.rootMargin ?? "0px"
    DormantIntersectionObserver.instances.push(this)
  }

  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

describe("LibraryMediaBrowser", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    DormantIntersectionObserver.instances.length = 0
    host = document.createElement("div")
    host.style.height = "700px"
    document.body.appendChild(host)
    root = createRoot(host)
    vi.stubGlobal("IntersectionObserver", DormantIntersectionObserver)
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(readonly callback: ResizeObserverCallback) {}
        disconnect() {}
        observe(target: Element) {
          const contentRect = target.getBoundingClientRect()
          this.callback([{ target, contentRect } as ResizeObserverEntry], this)
        }
        unobserve() {}
      }
    )
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const width = this.hasAttribute("data-library-media-grid-host")
          ? 720
          : 900
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: 600,
          width,
          height: 600,
          toJSON: () => ({}),
        }
      }
    )
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        return globalThis.setTimeout(() => callback(performance.now()), 0)
      })
    )
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((handle: number) => globalThis.clearTimeout(handle))
    )
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => false,
    })
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const mount = async (
    harness: ReturnType<typeof createMediaBrowserHarness>,
    props: Partial<LibraryMediaBrowserProps> = {},
    strict = false
  ) => {
    const browser = (
      <MediaBrowserTestRoot harness={harness}>
        <LibraryMediaBrowser
          action="insert"
          scope={{ kind: "library" }}
          onScopeChange={vi.fn()}
          onSelect={vi.fn()}
          {...props}
        />
      </MediaBrowserTestRoot>
    )
    await act(async () => {
      root.render(strict ? <StrictMode>{browser}</StrictMode> : browser)
    })
    await vi.waitFor(() => expect(harness.requests.length).toBeGreaterThan(0))
  }

  const pointerDown = async (target: HTMLElement) => {
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 })
      )
    })
  }

  const openDetails = async (name: string) => {
    const trigger = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Actions for ${name}"]`
    )!
    await pointerDown(trigger)
    const detailsItem = await vi.waitFor(() => {
      const item = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((candidate) => candidate.textContent === "Details")
      expect(item).toBeDefined()
      return item!
    })
    await act(async () => detailsItem.click())
    return vi.waitFor(() => {
      const sheet = document.querySelector<HTMLElement>(
        '[data-media-details="true"]'
      )
      expect(sheet).not.toBeNull()
      return sheet!
    })
  }

  it.each([
    [
      { kind: "recent" } as const,
      { entryPoint: "recent", ownerKinds: [], collectionId: null },
    ],
    [
      { kind: "uploads" } as const,
      { entryPoint: "all", ownerKinds: ["workspace"], collectionId: null },
    ],
    [
      { kind: "library" } as const,
      { entryPoint: "featured", ownerKinds: ["studio"], collectionId: null },
    ],
    [
      { kind: "favorites" } as const,
      { entryPoint: "favorites", ownerKinds: [], collectionId: null },
    ],
    [
      {
        kind: "collection",
        collectionId: "collection-proposals",
        label: "Proposal picks",
      } as const,
      {
        entryPoint: "all",
        ownerKinds: [],
        collectionId: "collection-proposals",
      },
    ],
  ])("maps the controlled scope %# to exact criteria", (scope, expected) => {
    expect(libraryMediaScopeCriteria(scope)).toMatchObject(expected)
  })

  it("prepares the initial controlled scope before a StrictMode lease can request", async () => {
    const harness = createMediaBrowserHarness()
    await mount(
      harness,
      { scope: { kind: "uploads" }, onSelect: vi.fn() },
      true
    )

    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0]).toMatchObject({
      itemKinds: ["media"],
      ownerKinds: ["workspace"],
      collectionId: null,
      favoritesOnly: false,
      recentOnly: false,
    })
  })

  it("presents the Studio library as search-only when embedded in the editor rail", async () => {
    const harness = createMediaBrowserHarness()
    const onScopeChange = vi.fn()
    await mount(harness, {
      simpleLibrary: true,
      scope: { kind: "recent" },
      onScopeChange,
    })

    expect(harness.requests[0]).toMatchObject({
      ownerKinds: ["studio"],
      recentOnly: false,
      favoritesOnly: false,
    })
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    expect(host.querySelector('button[aria-label="Filter media"]')).toBeNull()
    expect(
      host.querySelector('input[aria-label="Search media"]')
    ).not.toBeNull()
    expect(onScopeChange).not.toHaveBeenCalled()
  })

  it("applies every active controlled scope with one atomic query", async () => {
    const harness = createMediaBrowserHarness({
      server: [managedMediaFixture()],
    })
    let updateScope: ((scope: LibraryMediaScope) => void) | null = null
    function ControlledBrowser() {
      const [scope, setScope] = useState<LibraryMediaScope>({ kind: "library" })
      updateScope = (nextScope) => setScope(nextScope)
      return (
        <LibraryMediaBrowser
          action="insert"
          scope={scope}
          onScopeChange={setScope}
          onSelect={vi.fn()}
        />
      )
    }
    await act(async () => {
      root.render(
        <MediaBrowserTestRoot harness={harness}>
          <ControlledBrowser />
        </MediaBrowserTestRoot>
      )
    })
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1))

    const transitions: Array<
      readonly [LibraryMediaScope, Record<string, unknown>]
    > = [
      [
        { kind: "recent" },
        {
          ownerKinds: [],
          collectionId: null,
          favoritesOnly: false,
          recentOnly: true,
          order: "recent",
        },
      ],
      [
        { kind: "uploads" },
        {
          ownerKinds: ["workspace"],
          collectionId: null,
          favoritesOnly: false,
          recentOnly: false,
        },
      ],
      [
        { kind: "favorites" },
        {
          ownerKinds: [],
          collectionId: null,
          favoritesOnly: true,
          recentOnly: false,
        },
      ],
      [
        {
          kind: "collection",
          collectionId: "collection-proposals",
          label: "Proposal picks",
        },
        {
          ownerKinds: [],
          collectionId: "collection-proposals",
          favoritesOnly: false,
          recentOnly: false,
        },
      ],
      [
        { kind: "library" },
        {
          ownerKinds: ["studio"],
          collectionId: null,
          favoritesOnly: false,
          recentOnly: false,
          order: "curated",
        },
      ],
    ]

    for (const [scope, expected] of transitions) {
      const previousRequestCount = harness.requests.length
      await act(async () => updateScope?.(scope))
      await vi.waitFor(() =>
        expect(harness.requests).toHaveLength(previousRequestCount + 1)
      )
      expect(harness.requests.at(-1)).toMatchObject({
        itemKinds: ["media"],
        ...expected,
      })
    }
  })

  it("keeps server and device-local collisions distinct with sibling native controls", async () => {
    const managed = managedMediaFixture()
    const local = localMediaFixture()
    const harness = createMediaBrowserHarness({
      server: [managed],
      local: [local],
    })
    await mount(harness, { scope: { kind: "uploads" } })
    await vi.waitFor(() =>
      expect(host.querySelectorAll("[data-media-card]")).toHaveLength(2)
    )

    expect(host.textContent).toContain("1 cloud result · 1 on this device")
    expect(host.querySelectorAll('[data-media-group="server"]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-media-group="local"]')).toHaveLength(1)
    expect(
      host.querySelector('[data-media-card^="media:managed:"]')
    ).not.toBeNull()
    expect(
      host.querySelector('[data-media-card^="media:local:"]')
    ).not.toBeNull()
    expect(host.querySelector("button button")).toBeNull()
    expect(
      host.querySelector(
        '[data-media-card^="media:local:"] button[aria-label^="Add"]'
      )
    ).toBeNull()
  })

  it("emits selection only after exact detail and reports an exact mismatch", async () => {
    const first = curatedMediaFixture(
      "asset-browserfixture01",
      "Olive botanical"
    )
    const onSelect = vi.fn()
    const harness = createMediaBrowserHarness({ server: [first], local: [] })
    await mount(harness, { onSelect })
    const primary = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Insert “Olive botanical”"]'
    )!
    await act(async () => primary.click())
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(harness.detailRequests).toEqual([
      {
        itemKind: "media",
        id: first.summary.id,
        version: first.summary.version,
        mediaSource: "curated",
      },
    ])
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        itemKind: "media",
        id: first.summary.id,
        mediaSource: "curated",
        detail: expect.objectContaining({
          summary: expect.objectContaining({ id: first.summary.id }),
        }),
      })
    )
    const intent = onSelect.mock.calls[0][0]
    expect(intent.selectionIdentity).toBe(intent.detail.selectionIdentity)
    expect(Object.isFrozen(intent)).toBe(true)
    expect(Object.isFrozen(intent.detail)).toBe(true)
    expect(Object.isFrozen(intent.detail.summary)).toBe(true)

    await act(async () => root.unmount())
    root = createRoot(host)
    const other = curatedMediaFixture("asset-browserfixture02", "Other")
    const mismatchHarness = createMediaBrowserHarness({
      server: [{ summary: first.summary, detail: other.detail }],
      local: [],
    })
    const mismatchSelect = vi.fn()
    await mount(mismatchHarness, { onSelect: mismatchSelect })
    const mismatchPrimary = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Insert “Olive botanical”"]'
    )!
    await act(async () => mismatchPrimary.click())
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Retry exact version")
    )
    expect(mismatchSelect).not.toHaveBeenCalled()
  })

  it("selects same-ID/version curated and managed results through distinct exact authorities", async () => {
    const id = "asset-sourcecollision01"
    const curated = curatedMediaFixture(id, "Curated collision")
    const managed = managedMediaFixture(id, "Managed collision")
    const onSelect = vi.fn()
    const harness = createMediaBrowserHarness({
      server: [curated, managed],
      local: [],
    })
    await mount(harness, { scope: { kind: "recent" }, onSelect })
    await vi.waitFor(() =>
      expect(host.querySelectorAll("[data-media-card]")).toHaveLength(2)
    )

    const curatedPrimary = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Insert “Curated collision” from Studio library"]'
    )!
    const managedPrimary = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Insert “Managed collision” from Workspace upload"]'
    )!
    await act(async () => curatedPrimary.click())
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    await act(async () => managedPrimary.click())
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2))

    expect(harness.detailRequests).toEqual([
      {
        itemKind: "media",
        id,
        version: 1,
        mediaSource: "curated",
      },
      {
        itemKind: "media",
        id,
        version: 1,
        mediaSource: "managed",
      },
    ])
    const [curatedIntent, managedIntent] = onSelect.mock.calls.map(
      ([intent]) => intent
    )
    expect(curatedIntent).toMatchObject({
      id,
      version: 1,
      mediaSource: "curated",
      detail: { summary: { id, version: 1, mediaSource: "curated" } },
    })
    expect(managedIntent).toMatchObject({
      id,
      version: 1,
      mediaSource: "managed",
      detail: { summary: { id, version: 1, mediaSource: "managed" } },
    })
    expect(curatedIntent.selectionIdentity).toBe(
      curatedIntent.detail.selectionIdentity
    )
    expect(managedIntent.selectionIdentity).toBe(
      managedIntent.detail.selectionIdentity
    )
  })

  it("renders exact ready details and rechecks exact authority at Sheet action time", async () => {
    const listed = curatedMediaFixture(
      "asset-browserfixture01",
      "Listed botanical"
    )
    const exact = curatedMediaFixture(
      "asset-browserfixture01",
      "Exact botanical"
    )
    const collectionId = "collection-proposals"
    const preference = {
      workspaceRevision: 4,
      preferences: [
        {
          identity: {
            itemKind: "media" as const,
            id: listed.summary.id,
            version: listed.summary.version,
            mediaSource: listed.summary.mediaSource,
          },
          favorite: true,
          lastUsedAt: "2026-08-31T08:00:00.000Z",
          collectionIds: [collectionId],
          revision: 1,
          updatedAt: "2026-08-31T08:00:00.000Z",
        },
      ],
      collections: [
        {
          id: collectionId,
          name: "Proposal picks",
          scope: "workspace" as const,
          revision: 1,
          itemCount: 1,
          createdAt: "2026-08-31T08:00:00.000Z",
          updatedAt: "2026-08-31T08:00:00.000Z",
        },
      ],
    }
    const onSelect = vi.fn()
    const harness = createMediaBrowserHarness({
      server: [{ summary: listed.summary, detail: exact.detail }],
      local: [],
      preference,
    })
    await mount(harness, { onSelect })

    const sheet = await openDetails(listed.summary.name)
    await vi.waitFor(() =>
      expect(sheet.textContent).toContain("Exact botanical")
    )
    expect(sheet.textContent).toContain("Studio library · version 1")
    expect(sheet.textContent).toContain("Saved to favorites")
    expect(sheet.textContent).toContain("Proposal picks")
    expect(sheet.textContent).toContain("Fixture license")
    expect(sheet.querySelectorAll("a")).toHaveLength(2)
    expect(
      [...sheet.querySelectorAll("a")].every((link) =>
        link.className.includes("min-h-11")
      )
    ).toBe(true)
    expect(harness.detailRequests).toHaveLength(1)

    const primary = [
      ...sheet.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent.includes("Insert “Exact botanical”"))!
    await act(async () => primary.click())
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(harness.detailRequests).toHaveLength(2)
  })

  it("uses viewport visibility for a portalled local detail preview", async () => {
    const local = localMediaFixture()
    const harness = createMediaBrowserHarness({ server: [], local: [local] })
    await mount(harness, { scope: { kind: "uploads" } })
    const gridRoot = host.querySelector(
      '[data-library-media-scroll-owner="true"]'
    )
    expect(
      DormantIntersectionObserver.instances.some(
        (observer) => observer.root === gridRoot
      )
    ).toBe(true)

    const sheet = await openDetails(local.summary.name)
    await vi.waitFor(() =>
      expect(sheet.textContent).toContain("local revision 1")
    )
    expect(
      DormantIntersectionObserver.instances.some(
        (observer) => observer.root === null
      )
    ).toBe(true)
  })

  it("shows an exact failure with request ID and truthful Retry", async () => {
    const fixture = curatedMediaFixture()
    const requestId = "request-media-detail-503"
    const onSelect = vi.fn()
    const harness = createMediaBrowserHarness({
      server: [fixture],
      local: [],
      detailFailure: new LibraryDiscoveryHttpError({
        code: "media_unavailable",
        status: 503,
        message: "Exact media is temporarily unavailable",
        requestId,
        retryable: true,
      }),
    })
    await mount(harness, { onSelect })
    const primary = host.querySelector<HTMLButtonElement>(
      `button[aria-label^="Insert “${fixture.summary.name}”"]`
    )!
    await act(async () => primary.click())
    await vi.waitFor(() => expect(host.textContent).toContain(requestId))
    const retry = host.querySelector<HTMLButtonElement>(
      `button[aria-label^="Retry exact version for “${fixture.summary.name}”"]`
    )!
    await act(async () => retry.click())
    await vi.waitFor(() => expect(harness.detailRequests).toHaveLength(2))

    const sheet = await openDetails(fixture.summary.name)
    await vi.waitFor(() => expect(sheet.textContent).toContain(requestId))
    expect(sheet.textContent).toContain("Retry details")
    const retryDetails = [...sheet.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Retry details")
    )!
    await act(async () => retryDetails.click())
    await vi.waitFor(() => expect(harness.detailRequests).toHaveLength(4))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("keeps compact filter and detail Sheets bounded with 44px targets", async () => {
    host.style.width = "320px"
    const fixture = curatedMediaFixture()
    const harness = createMediaBrowserHarness({ server: [fixture], local: [] })
    await mount(harness)

    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Filter media"]')!
        .click()
    )
    const filterSheet = await vi.waitFor(() => {
      const sheet = document.querySelector<HTMLElement>(
        '[data-slot="sheet-content"]'
      )
      expect(sheet).not.toBeNull()
      return sheet!
    })
    expect(filterSheet.className).toContain("w-full")
    expect(filterSheet.className).toContain("max-w-full")
    expect(filterSheet.className).toContain("overflow-hidden")
    expect(filterSheet.querySelectorAll("select")).toHaveLength(5)
    expect(
      [...filterSheet.querySelectorAll("select")].every((select) =>
        select.className.includes("h-11")
      )
    ).toBe(true)
    expect(
      filterSheet
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close media filters"]'
        )!
        .className.includes("size-11")
    ).toBe(true)
    await act(async () =>
      filterSheet
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close media filters"]'
        )!
        .click()
    )

    const detailsSheet = await openDetails(fixture.summary.name)
    expect(detailsSheet.className).toContain("w-full")
    expect(detailsSheet.className).toContain("max-w-full")
    expect(detailsSheet.className).toContain("overflow-hidden")
    expect(
      detailsSheet
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close media details"]'
        )!
        .className.includes("size-11")
    ).toBe(true)
    expect(detailsSheet.querySelector(".overflow-y-auto")).not.toBeNull()
    expect(
      host.querySelectorAll('[data-library-media-scroll-owner="true"]')
    ).toHaveLength(1)
  })

  it("routes allowed favorites through the shared preference authority", async () => {
    const fixture = curatedMediaFixture()
    const harness = createMediaBrowserHarness({ server: [fixture], local: [] })
    await mount(harness)
    const favorite = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Add ${fixture.summary.name} to favorites"]`
    )!
    await act(async () => favorite.click())
    expect(harness.preferenceController.setFavorite).toHaveBeenCalledWith(
      {
        itemKind: "media",
        id: fixture.summary.id,
        version: fixture.summary.version,
        mediaSource: fixture.summary.mediaSource,
      },
      fixture.summary.name,
      true
    )
  })

  it("applies search keyboard commands and enters the first result on Arrow Down", async () => {
    const fixture = curatedMediaFixture()
    const harness = createMediaBrowserHarness({ server: [fixture], local: [] })
    await mount(harness)
    const search = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search media"]'
    )!
    await act(async () => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    })
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        `Insert “${fixture.summary.name}” from Studio library`
      )
    )

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      setter?.call(search, "olive")
      search.dispatchEvent(new Event("input", { bubbles: true }))
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    })
    await vi.waitFor(() =>
      expect(harness.requests.at(-1)?.search).toBe("olive")
    )
  })

  it("keeps independent server and local failures recoverable", async () => {
    const failed = createMediaBrowserHarness({
      server: [],
      local: [],
      listFailure: new Error("Cloud catalog unavailable"),
    })
    await mount(failed)
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Cloud catalog unavailable")
    )
    expect(host.textContent).toContain("Try again")

    await act(async () => root.unmount())
    root = createRoot(host)
    const managed = managedMediaFixture()
    const localFailed = createMediaBrowserHarness({
      server: [managed],
      local: [],
      localFailure: new Error("Local inventory unavailable"),
    })
    await mount(localFailed, { scope: { kind: "uploads" } })
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Local inventory unavailable")
    )
    expect(
      host.querySelector('[data-media-card^="media:managed:"]')
    ).not.toBeNull()
    expect(host.textContent).toContain("Retry")
  })

  it("keeps cloud failure and Retry visible when local content survives", async () => {
    const local = localMediaFixture()
    const harness = createMediaBrowserHarness({
      server: [],
      local: [local],
      listFailure: new Error("Cloud catalog unavailable while offline"),
    })
    await mount(harness, { scope: { kind: "uploads" } })
    await vi.waitFor(() =>
      expect(
        host.querySelector('[data-media-card^="media:local:"]')
      ).not.toBeNull()
    )
    expect(host.textContent).toContain(
      "Cloud catalog unavailable while offline"
    )
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === "Retry"
      )
    ).toBe(true)
  })
})
