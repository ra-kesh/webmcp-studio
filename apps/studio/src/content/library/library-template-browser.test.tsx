// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getStudioLibraryCatalogDetail } from "./catalog"
import { LibraryTemplateBrowser } from "./library-template-browser"
import {
  catalogTemplates,
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

describe("LibraryTemplateBrowser", () => {
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
    expect(host.textContent).toContain("No matching templates")
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
    await act(async () => {
      root.render(
        <DiscoveryTestRoot controller={controller}>
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
            onToggleFavorite={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const item = catalogTemplates[0]!
    const favorite = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Add ${item.name} to favorites"]`
    )!
    await act(async () => {
      favorite.focus()
      controller.updateState(discoveryState())
    })
    expect(document.activeElement).toBe(favorite)

    const actions = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Actions for ${item.name}"]`
    )!
    await act(async () => {
      actions.focus()
      controller.updateState(discoveryState())
    })
    expect(document.activeElement).toBe(actions)
  })
})
