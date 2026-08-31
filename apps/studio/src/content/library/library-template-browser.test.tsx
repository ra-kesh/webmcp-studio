// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  LibraryItemIdentity,
  LibraryPreferenceMutationReceipt,
  LibraryPreferenceSnapshot,
} from "@webmcp/document"
import { getStudioLibraryCatalogDetail } from "./catalog"
import {
  libraryTemplateColumnCountFor,
  LibraryTemplateBrowser,
} from "./library-template-browser"
import {
  catalogTemplates,
  confirmedPage,
  DiscoveryTestRoot,
  discoveryState,
  preferenceSnapshot,
  preferenceState,
  staticController,
  staticPreferenceController,
} from "./library-template-browser.test-support"
import type { LibraryPreferenceFailure } from "./library-preference-controller"
import { LibraryPreferenceController } from "./library-preference-controller"
import { LibraryPreferenceHttpError } from "./library-preference-client"
import type {
  LibraryPreferenceClient,
  LibraryPreferenceClientResult,
} from "./library-preference-client"

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

const deferred = <TValue,>() => {
  let resolve!: (value: TValue) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<TValue>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const preferenceResult = <TValue,>(
  value: TValue
): LibraryPreferenceClientResult<TValue> => ({
  value,
  requestId: "request-library-browser-1",
  etag: null,
})

const snapshotFor = (
  identity: LibraryItemIdentity,
  workspaceRevision: number,
  revision = 0,
  favorite = false
): LibraryPreferenceSnapshot => ({
  workspaceRevision,
  preferences:
    revision === 0
      ? []
      : [
          {
            identity,
            favorite,
            lastUsedAt: null,
            collectionIds: [],
            revision,
            updatedAt: "2026-08-31T10:00:00.000Z",
          },
        ],
  collections: [],
})

const favoriteReceiptFor = (
  identity: LibraryItemIdentity,
  workspaceRevision: number,
  revision: number,
  favorite: boolean
): LibraryPreferenceMutationReceipt => ({
  schemaVersion: 1,
  operation: "set_favorite",
  workspaceRevision,
  preference: {
    identity,
    favorite,
    lastUsedAt: null,
    collectionIds: [],
    revision,
    updatedAt: "2026-08-31T10:01:00.000Z",
  },
})

const realPreferenceController = (
  overrides: Partial<LibraryPreferenceClient>,
  keys = ["mutation-browser-1", "mutation-browser-2"]
) => {
  const client: LibraryPreferenceClient = {
    readSnapshot: vi.fn(),
    listCollections: vi.fn(),
    getCollection: vi.fn(),
    setFavorite: vi.fn(),
    recordUsed: vi.fn(),
    createCollection: vi.fn(),
    renameCollection: vi.fn(),
    deleteCollection: vi.fn(),
    addCollectionMember: vi.fn(),
    removeCollectionMember: vi.fn(),
    reorderCollectionMembers: vi.fn(),
    ...overrides,
  }
  let keyIndex = 0
  const controller = new LibraryPreferenceController({
    client,
    sessionId: "session-browser-preferences",
    createIdempotencyKey: () =>
      keys[keyIndex++] ?? `mutation-browser-${keyIndex}`,
  })
  return { client, controller }
}

describe("LibraryTemplateBrowser", () => {
  it("uses a readable single-column start catalog on narrow containers", () => {
    expect(libraryTemplateColumnCountFor(0, "start")).toBe(1)
    expect(libraryTemplateColumnCountFor(559, "start")).toBe(1)
    expect(libraryTemplateColumnCountFor(560, "start")).toBe(2)
    expect(libraryTemplateColumnCountFor(760, "start")).toBe(3)
    expect(libraryTemplateColumnCountFor(1080, "start")).toBe(4)
    expect(libraryTemplateColumnCountFor(419, "editor")).toBe(1)
    expect(libraryTemplateColumnCountFor(420, "editor")).toBe(2)
  })

  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver)
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}
        disconnect() {}
        observe(target: Element) {
          this.callback(
            [
              {
                target,
                contentRect: {
                  width: 900,
                  height: 640,
                } as DOMRectReadOnly,
              } as ResizeObserverEntry,
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

  it("renders compact summaries, shared controls, and exact create intents without live artboards", async () => {
    const controller = staticController(discoveryState())
    const onCreate = vi.fn()

    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={onCreate}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(
      host.querySelector('[data-library-template-browser="start"]')
    ).not.toBeNull()
    expect(host.querySelector('[aria-label="Design templates"]')).not.toBeNull()
    expect(host.querySelectorAll("[data-template-card]")).toHaveLength(
      catalogTemplates.length
    )
    expect(host.querySelector("[data-page-id]")).toBeNull()
    expect(host.querySelector("button button")).toBeNull()
    expect(
      host.querySelector(
        'button[aria-label^="Add "][aria-label$=" to favorites"]'
      )
    ).not.toBeNull()
    expect(
      host.querySelector('button[aria-label^="Actions for "]')
    ).not.toBeNull()
    expect(
      host.querySelectorAll('[aria-live], [role="status"], [role="alert"]')
    ).toHaveLength(1)

    const create = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Create from template"
    )
    expect(create).not.toBeNull()
    await act(async () => create?.click())

    const selected = catalogTemplates[0]!
    expect(onCreate).toHaveBeenCalledWith({
      itemKind: "template",
      id: selected.id,
      version: selected.version,
    })
  })

  it("does not subscribe or resolve details while its responsive surface is hidden", async () => {
    const controller = staticController(discoveryState())

    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="editor"
            visible={false}
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(
      host.querySelector('[data-library-template-browser="editor"]')
    ).toBeNull()
    expect(controller.subscribe).not.toHaveBeenCalled()
    expect(controller.activate).not.toHaveBeenCalled()
    expect(controller.selectItem).not.toHaveBeenCalled()
  })

  it("keeps editor actions next to the selected card instead of after the catalog", async () => {
    const controller = staticController(discoveryState())
    const selected = catalogTemplates[0]!

    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="editor"
            onApply={vi.fn()}
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const card = host.querySelector(
      `article[data-template-card="template:${selected.id}@${selected.version}"]`
    )
    const listItem = card?.closest("li")
    expect(listItem).not.toBeNull()
    expect(listItem?.querySelector("[data-template-details]")).not.toBeNull()
    expect(listItem?.textContent).toContain("Create from template")
    expect(listItem?.textContent).toContain("Apply to this document")
  })

  it("keeps every library destination visible in the compact editor header", async () => {
    const controller = staticController(discoveryState())

    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="editor"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const navigation = host.querySelector<HTMLElement>(
      'nav[aria-label="Template collections"]'
    )!
    expect(navigation.className).not.toContain("overflow-x-auto")
    expect(
      navigation.querySelectorAll("[data-library-entry-point]")
    ).toHaveLength(3)
    expect(
      navigation.querySelector(
        'button[aria-label="Manage template collections"]'
      )
    ).not.toBeNull()
    expect(
      navigation.querySelector('[data-library-entry-point="featured"]')
        ?.className
    ).toContain("h-8")

    const search = host
      .querySelector('input[aria-label="Search design templates"]')
      ?.closest('[data-slot="input-group"]')
    expect(search?.className).toContain("h-8")
    expect(
      host.querySelector('button[aria-label="Filter templates"]')?.className
    ).toContain("size-8")
  })

  it("keeps catalog announcements audible after a persistent action error", async () => {
    const firstState = discoveryState({
      announcement: { id: 1, message: "4 results." },
    })
    const controller = staticController(firstState)

    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            actionError="The template could not be applied."
            hasQuotationSource
            variant="editor"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const liveRegion = host.querySelector('[aria-live="polite"]')
    expect(liveRegion?.textContent).toContain(
      "The template could not be applied."
    )
    expect(liveRegion?.textContent).toContain("4 results.")

    await act(async () => {
      controller.updateState(
        discoveryState({
          announcement: { id: 2, message: "2 results." },
        })
      )
    })

    expect(liveRegion?.textContent).toContain(
      "The template could not be applied."
    )
    expect(liveRegion?.textContent).toContain("2 results.")
    expect(liveRegion?.textContent).not.toContain("4 results.")
  })

  it("keeps source-dependent templates inspectable while disabling unsafe mutations", async () => {
    const quotation = catalogTemplates.find(
      (item) => item.compatibility.availability === "requires_source"
    )
    expect(quotation).toBeDefined()
    const controller = staticController(
      discoveryState({ confirmedPage: confirmedPage([quotation!]) })
    )

    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource={false}
            variant="editor"
            onApply={vi.fn()}
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(host.textContent).toContain(
      "Import a quotation before using this style."
    )
    const create = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Create from template"
    )
    const apply = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Apply to this document"
    )
    expect(create?.disabled).toBe(true)
    expect(apply?.disabled).toBe(true)
    expect(
      host.querySelector(
        `article[data-template-card="template:${quotation!.id}@${quotation!.version}"]`
      )
    ).not.toBeNull()
    expect(
      host.querySelector('button[aria-label="Filter templates"]')
    ).not.toBeNull()
  })

  it("uses exact ready detail, not the list summary, as mutation authority", async () => {
    const summary = catalogTemplates[0]!
    const detail = getStudioLibraryCatalogDetail(
      "template",
      summary.id,
      summary.version
    )!
    const deniedDetail = {
      ...detail,
      summary: {
        ...detail.summary,
        permissions: { ...detail.summary.permissions, canUse: false },
      },
    }
    const onCreate = vi.fn()
    const controller = staticController(
      discoveryState({
        confirmedPage: confirmedPage([summary]),
        detail: { status: "ready", detail: deniedDetail },
      })
    )

    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={onCreate}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(host.textContent).toContain("You do not have permission to use it.")
    const create = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Create from template"
    )
    expect(create?.disabled).toBe(true)
    await act(async () => create?.click())
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("renders retained results with explicit update and recoverable failure states", async () => {
    const retained = confirmedPage(catalogTemplates.slice(0, 2))
    const controller = staticController(
      discoveryState({
        confirmedPage: null,
        retainedPage: retained,
        updatingResults: true,
        replacementStatus: "loading",
      })
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

    expect(host.textContent).toContain("Updating results")
    expect(host.querySelectorAll("[data-template-card]")).toHaveLength(2)
    expect(
      host
        .querySelector('[data-library-template-browser="start"]')
        ?.getAttribute("aria-busy")
    ).toBe("true")

    await act(async () => root.unmount())
    root = createRoot(host)
    const failureController = staticController(
      discoveryState({
        confirmedPage: null,
        retainedPage: retained,
        replacementStatus: "failed",
        replacementFailure: {
          kind: "request_failed",
          message: "Catalog connection failed.",
        },
      })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={failureController}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(host.textContent).toContain("Catalog connection failed.")
    expect(host.querySelectorAll("[data-template-card]")).toHaveLength(2)
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry"
    )
    await act(async () => retry?.click())
    expect(failureController.retryReplacement).toHaveBeenCalledTimes(1)
  })

  it("emits discovery commands from search, filters, and entry chips", async () => {
    const controller = staticController(discoveryState())
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            collectionOptions={[
              { id: "saved-proposals", label: "Saved proposals" },
            ]}
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const search = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search design templates"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(search, "proposal")
      search.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText" })
      )
    })
    expect(controller.setRawSearch).toHaveBeenCalledWith("proposal")

    const favorites = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Favorites"
    )
    await act(async () => favorites?.click())
    expect(controller.setEntryPoint).toHaveBeenCalledWith("favorites")

    const category = host.querySelector(
      'select[aria-label="Filter templates by category"]'
    ) as unknown as HTMLSelectElement
    const categoryId = discoveryState().taxonomy.categories[0]!.id
    await act(async () => {
      category.value = categoryId
      category.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(controller.setFilters).toHaveBeenCalledWith({
      categoryIds: [categoryId],
    })

    expect(
      [...host.querySelectorAll("select")].every(
        (select) => Boolean(select.id) && Boolean(select.name)
      )
    ).toBe(true)
    expect(
      [...host.querySelectorAll("label")].every((label) =>
        label.htmlFor ? document.getElementById(label.htmlFor) !== null : true
      )
    ).toBe(true)

    expect(
      host.querySelector('select[aria-label="Filter templates by use case"]')
    ).not.toBeNull()
    expect(
      host.querySelector('select[aria-label="Filter templates by owner"]')
    ).not.toBeNull()
    const collection = host.querySelector(
      'select[aria-label="Filter templates by collection"]'
    ) as unknown as HTMLSelectElement
    await act(async () => {
      collection.value = "saved-proposals"
      collection.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(controller.setFilters).toHaveBeenCalledWith({
      collectionId: "saved-proposals",
    })

    const order = host.querySelector(
      'select[aria-label="Sort templates"]'
    ) as unknown as HTMLSelectElement
    await act(async () => {
      order.value = "newest"
      order.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(controller.setOrder).toHaveBeenCalledWith("newest")
  })

  it("preserves filter focus across replacement and enters results only on ArrowDown", async () => {
    const controller = staticController(discoveryState())
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

    const category = host.querySelector(
      'select[aria-label="Filter templates by category"]'
    ) as unknown as HTMLSelectElement
    category.focus()
    const retained = confirmedPage(catalogTemplates)
    await act(async () => {
      controller.updateState(
        discoveryState({
          confirmedPage: null,
          retainedPage: retained,
          updatingResults: true,
          replacementStatus: "loading",
          focusIntent: { id: 41, target: "results" },
        })
      )
    })
    expect(document.activeElement).toBe(category)
    expect(controller.clearFocusIntent).toHaveBeenCalledWith(41)

    const search = host.querySelector(
      'input[aria-label="Search design templates"]'
    ) as unknown as HTMLInputElement
    search.focus()
    await act(async () => {
      controller.updateState(discoveryState())
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    })
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^Show details for /
    )
  })

  it("distinguishes an empty catalog from a filtered no-results view", async () => {
    const emptyController = staticController(
      discoveryState({ confirmedPage: confirmedPage([]) })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={emptyController}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })
    expect(host.textContent).toContain("No templates available")
    expect(host.textContent).not.toContain("Show all templates")

    const filteredState = discoveryState({
      entryPoint: "favorites",
      appliedQuery: {
        ...discoveryState().appliedQuery,
        entryPoint: "favorites",
        favoritesOnly: true,
      },
      confirmedPage: confirmedPage([]),
    })
    await act(async () => {
      emptyController.updateState(filteredState)
    })
    expect(host.textContent).toContain("No favorite templates yet")
    const showAll = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Show all templates"
    )
    expect(showAll).toBeDefined()
    await act(async () => showAll?.click())
    expect(emptyController.setEntryPoint).toHaveBeenCalledWith("featured")
    expect(emptyController.setOrder).toHaveBeenCalledWith("curated")

    await act(async () => {
      emptyController.updateState(discoveryState())
      await vi.waitFor(() => {
        expect(document.activeElement?.getAttribute("aria-label")).toMatch(
          /^Show details for /
        )
      })
    })
  })

  it("moves focus to the deterministic successor when a focused card disappears", async () => {
    const initialItems = catalogTemplates.slice(0, 3)
    const controller = staticController(
      discoveryState({ confirmedPage: confirmedPage(initialItems) })
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

    const removed = initialItems[1]!
    const successor = initialItems[2]!
    const focusedButton = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Show details for ${removed.name}"]`
    )!
    await act(async () => focusedButton.focus())

    await act(async () => {
      controller.updateState(
        discoveryState({
          confirmedPage: confirmedPage([initialItems[0]!, successor]),
        })
      )
    })

    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      `Show details for ${successor.name}`
    )
  })

  it("does not steal focus back after focus leaves the results collection", async () => {
    const initialItems = catalogTemplates.slice(0, 3)
    const controller = staticController(
      discoveryState({ confirmedPage: confirmedPage(initialItems) })
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

    const removed = initialItems[1]!
    const focusedButton = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Show details for ${removed.name}"]`
    )!
    const search = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search design templates"]'
    )!
    await act(async () => {
      focusedButton.focus()
      search.focus()
    })

    await act(async () => {
      controller.updateState(
        discoveryState({
          confirmedPage: confirmedPage([initialItems[0]!, initialItems[2]!]),
        })
      )
    })

    expect(document.activeElement).toBe(search)
  })

  it("preserves focus on card actions while the collection updates", async () => {
    const controller = staticController(discoveryState())
    const onToggleFavorite = vi.fn()
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
            onToggleFavorite={onToggleFavorite}
          />
        </DiscoveryTestRoot>
      )
    })

    const item = catalogTemplates[0]
    const favorite = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Add ${item.name} to favorites"]`
    )!
    await act(async () => {
      favorite.focus()
      favorite.click()
      controller.updateState(discoveryState())
    })
    expect(document.activeElement).toBe(favorite)
    expect(onToggleFavorite).toHaveBeenCalledWith(
      { itemKind: "template", id: item.id, version: item.version },
      true
    )

    const actions = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Actions for ${item.name}"]`
    )!
    await act(async () => {
      actions.focus()
      controller.updateState(discoveryState())
    })
    expect(document.activeElement).toBe(actions)
  })

  it("drives optimistic favorite rollback through the shared controller while preserving focused pending control", async () => {
    const item = catalogTemplates[0]
    const identity: LibraryItemIdentity = {
      itemKind: "template",
      id: item.id,
      version: item.version,
    }
    const mutation =
      deferred<
        LibraryPreferenceClientResult<LibraryPreferenceMutationReceipt>
      >()
    const setFavorite = vi.fn(() => mutation.promise)
    const { controller: preferences } = realPreferenceController({
      readSnapshot: vi.fn(async () =>
        preferenceResult(snapshotFor(identity, 1))
      ),
      setFavorite,
    })

    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferences}
        >
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="editor"
            onApply={vi.fn()}
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const heart = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Add ${item.name} to favorites"]`
    )!
    await vi.waitFor(() => expect(heart.disabled).toBe(false))
    await act(async () => {
      heart.focus()
      heart.click()
    })

    expect(setFavorite).toHaveBeenCalledTimes(1)
    const saving = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Saving favorite for ${item.name}"]`
    )!
    expect(saving.getAttribute("aria-pressed")).toBe("true")
    expect(saving.disabled).toBe(true)
    expect(document.activeElement).toBe(saving)
    const create = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Create from template"
    )
    const apply = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Apply to this document"
    )
    expect(create?.disabled).toBe(false)
    expect(apply?.disabled).toBe(false)

    await act(async () => {
      mutation.reject(
        new LibraryPreferenceHttpError({
          code: "library_network_error",
          status: 0,
          message: "offline",
          requestId: "request-rollback-1",
          retryable: true,
          commitStatus: "unknown",
        })
      )
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(
        host
          .querySelector(`button[aria-label="Add ${item.name} to favorites"]`)
          ?.getAttribute("aria-pressed")
      ).toBe("false")
    )
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      `Add ${item.name} to favorites`
    )
    expect(host.textContent).toContain(`Couldn't add ${item.name} to Favorites`)
    expect(host.textContent).toContain("Request ID: request-rollback-1")
  })

  it("rolls back a failed heart and exposes transport and reconciled retry failures without blocking document actions", async () => {
    const item = catalogTemplates[0]
    const favoriteKey = `favorite:template:${item.id}@${item.version}`
    const favoriteFailure: LibraryPreferenceFailure = {
      key: favoriteKey,
      action: "set_favorite",
      message: `Couldn't add ${item.name} to Favorites`,
      code: "library_request_failed",
      status: 0,
      requestId: "request-transport-1",
      retryable: true,
      retryMode: "same_key",
      commitStatus: "unknown",
    }
    const conflictFailure: LibraryPreferenceFailure = {
      key: "collection:collection-proposals:rename",
      action: "rename_collection",
      message: "Couldn't rename Proposals",
      code: "library_collection_revision_mismatch",
      status: 412,
      requestId: "request-conflict-1",
      retryable: true,
      retryMode: "new_key",
      commitStatus: "known",
    }
    const preferences = staticPreferenceController(
      preferenceState({
        failures: new Map([
          [favoriteFailure.key, favoriteFailure],
          [conflictFailure.key, conflictFailure],
        ]),
      })
    )

    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferences}
        >
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="editor"
            onApply={vi.fn()}
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(
      host
        .querySelector(`button[aria-label="Add ${item.name} to favorites"]`)
        ?.getAttribute("aria-pressed")
    ).toBe("false")
    expect(host.textContent).toContain(favoriteFailure.message)
    expect(host.textContent).toContain("Request ID: request-transport-1")
    expect(host.textContent).toContain(conflictFailure.message)
    expect(host.textContent).toContain("Request ID: request-conflict-1")
    expect(
      host.querySelectorAll("[data-library-preference-failure] button")
    ).toHaveLength(4)
    expect(host.querySelector("button button")).toBeNull()

    const transportNotice = host.querySelector<HTMLElement>(
      `[data-library-preference-failure="${favoriteKey}"]`
    )!
    const retry = Array.from(transportNotice.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Retry"
    )!
    const dismiss = Array.from(transportNotice.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Dismiss"
    )!
    await act(async () => retry.click())
    await act(async () => dismiss.click())
    expect(preferences.retry).toHaveBeenCalledWith(favoriteKey)
    expect(preferences.dismissFailure).toHaveBeenCalledWith(favoriteKey)

    const create = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Create from template"
    )
    const apply = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Apply to this document"
    )
    expect(create?.disabled).toBe(false)
    expect(apply?.disabled).toBe(false)
  })

  it("invokes a reconciled 412 retry from the UI with the newer revision and a new key", async () => {
    const item = catalogTemplates[0]
    const identity: LibraryItemIdentity = {
      itemKind: "template",
      id: item.id,
      version: item.version,
    }
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(preferenceResult(snapshotFor(identity, 1)))
      .mockResolvedValueOnce(preferenceResult(snapshotFor(identity, 5, 2)))
    const setFavorite = vi
      .fn()
      .mockRejectedValueOnce(
        new LibraryPreferenceHttpError({
          code: "library_preference_revision_mismatch",
          status: 412,
          message: "changed",
          requestId: "request-reconciled-1",
          retryable: false,
          commitStatus: "known",
        })
      )
      .mockResolvedValueOnce(
        preferenceResult(favoriteReceiptFor(identity, 6, 3, true))
      )
    const { controller: preferences } = realPreferenceController({
      readSnapshot,
      setFavorite,
    })
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferences}
        >
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const heart = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Add ${item.name} to favorites"]`
    )!
    await vi.waitFor(() => expect(heart.disabled).toBe(false))
    await act(async () => heart.click())

    const failureKey = `favorite:template:${item.id}@${item.version}`
    await vi.waitFor(() =>
      expect(
        host.querySelector(`[data-library-preference-failure="${failureKey}"]`)
      ).not.toBeNull()
    )
    const failure = host.querySelector<HTMLElement>(
      `[data-library-preference-failure="${failureKey}"]`
    )!
    expect(failure.textContent).toContain("Request ID: request-reconciled-1")
    const retry = Array.from(failure.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Retry"
    )!
    await act(async () => retry.click())
    await vi.waitFor(() => expect(setFavorite).toHaveBeenCalledTimes(2))

    expect(setFavorite.mock.calls[0]?.[1]).toMatchObject({
      expectedRevision: 0,
      idempotencyKey: "mutation-browser-1",
    })
    expect(setFavorite.mock.calls[1]?.[1]).toMatchObject({
      expectedRevision: 2,
      idempotencyKey: "mutation-browser-2",
    })
    await vi.waitFor(() =>
      expect(
        host
          .querySelector(
            `button[aria-label="Remove ${item.name} from favorites"]`
          )
          ?.getAttribute("aria-pressed")
      ).toBe("true")
    )
  })

  it("keeps a snapshot outage nonblocking with request context, Retry, and Dismiss", async () => {
    const snapshotFailure: LibraryPreferenceFailure = {
      key: "snapshot",
      action: "refresh",
      message: "Studio couldn't refresh library preferences.",
      code: "library_request_failed",
      status: 503,
      requestId: "request-snapshot-1",
      retryable: true,
      retryMode: "refresh",
      commitStatus: "known",
    }
    const preferences = staticPreferenceController(
      preferenceState({
        snapshotStatus: "failed",
        snapshotFailure,
      })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferences}
        >
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const notice = host.querySelector<HTMLElement>(
      '[data-library-preference-failure="snapshot"]'
    )!
    expect(notice.textContent).toContain(snapshotFailure.message)
    expect(notice.textContent).toContain("Request ID: request-snapshot-1")
    const retry = Array.from(notice.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Retry"
    )!
    await act(async () => retry.click())
    expect(preferences.refreshAfterCurrent).toHaveBeenCalledTimes(1)

    const dismiss = Array.from(notice.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Dismiss"
    )!
    await act(async () => dismiss.click())
    expect(
      host.querySelector('[data-library-preference-failure="snapshot"]')
    ).toBeNull()
    const create = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Create from template"
    )
    expect(create?.disabled).toBe(false)
  })

  it("derives collection filters and truthful Favorites and Recent empty states from shared authority", async () => {
    const preferences = staticPreferenceController(
      preferenceState({
        snapshot: preferenceSnapshot({
          collections: [
            {
              id: "collection-proposals",
              name: "Proposals",
              scope: "workspace",
              revision: 1,
              itemCount: 0,
              createdAt: "2026-08-31T09:00:00.000Z",
              updatedAt: "2026-08-31T09:00:00.000Z",
            },
          ],
        }),
      })
    )
    const controller = staticController(
      discoveryState({
        entryPoint: "favorites",
        appliedQuery: {
          ...discoveryState().appliedQuery,
          entryPoint: "favorites",
          favoritesOnly: true,
        },
        confirmedPage: confirmedPage([]),
      })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={controller}
          preferenceController={preferences}
        >
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(host.textContent).toContain("No favorite templates yet")
    const collection = host.querySelector(
      'select[aria-label="Filter templates by collection"]'
    ) as unknown as HTMLSelectElement
    expect(Array.from(collection.options, ({ text }) => text)).toContain(
      "Proposals"
    )

    await act(async () => {
      controller.updateState(
        discoveryState({
          entryPoint: "recent",
          order: "recent",
          appliedQuery: {
            ...discoveryState().appliedQuery,
            entryPoint: "recent",
            order: "recent",
            recentOnly: true,
          },
          confirmedPage: confirmedPage([]),
        })
      )
    })
    expect(host.textContent).toContain("No recently used templates")
  })

  it("does not repaint a newer discovery page from an older retained preference snapshot", async () => {
    const item = catalogTemplates[0]
    const identity: LibraryItemIdentity = {
      itemKind: "template",
      id: item.id,
      version: item.version,
    }
    const discoveryItem = {
      ...item,
      preferences: {
        favorite: false,
        lastUsedAt: null,
        collectionIds: [],
      },
    }
    const preference = {
      identity,
      favorite: true,
      lastUsedAt: null,
      collectionIds: [],
      revision: 1,
      updatedAt: "2026-08-31T10:00:00.000Z",
    }
    const preferences = staticPreferenceController(
      preferenceState({
        snapshotStatus: "failed",
        snapshot: preferenceSnapshot({
          workspaceRevision: 4,
          preferences: [preference],
        }),
      })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(
            discoveryState({
              confirmedPage: confirmedPage([discoveryItem], {
                workspaceRevision: 5,
              }),
            })
          )}
          preferenceController={preferences}
        >
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    expect(
      host
        .querySelector(`button[aria-label="Add ${item.name} to favorites"]`)
        ?.getAttribute("aria-pressed")
    ).toBe("false")

    await act(async () => {
      preferences.updateState(
        preferenceState({
          snapshot: preferenceSnapshot({
            workspaceRevision: 5,
            preferences: [preference],
          }),
        })
      )
    })
    expect(
      host
        .querySelector(
          `button[aria-label="Remove ${item.name} from favorites"]`
        )
        ?.getAttribute("aria-pressed")
    ).toBe("true")
  })
})
