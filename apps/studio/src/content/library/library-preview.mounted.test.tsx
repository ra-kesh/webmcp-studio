// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { studioLibraryCatalogIndex } from "./catalog"
import { LibraryPreviewController } from "./library-preview-controller"
import { LibraryPreviewProvider } from "./library-preview-provider"
import { LibraryPreview } from "./library-preview"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

class VisibleIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "240px"
  readonly scrollMargin = "0px"
  readonly thresholds = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect() {}
  observe(target: Element) {
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry,
      ],
      this
    )
  }
  takeRecords() {
    return []
  }
  unobserve() {}
}

describe("LibraryPreview retry target", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  it("keeps a failed preview Retry control at least 44px in both axes", async () => {
    const template = studioLibraryCatalogIndex.list({
      generation: "preview-button-test",
      itemKinds: ["template"],
      limit: 1,
    }).items[0]
    expect(template?.itemKind).toBe("template")
    const controller = new LibraryPreviewController({
      fetch: vi.fn(async () => new Response("Unavailable", { status: 503 })),
    })

    await act(async () => {
      root.render(
        <LibraryPreviewProvider createController={() => controller}>
          <LibraryPreview
            descriptor={template!.preview}
            label={template!.name}
          />
        </LibraryPreviewProvider>
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const retry = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Retry ${template!.name}"]`
    )
    expect(retry).not.toBeNull()
    expect(retry?.className).toContain("min-h-11")
    expect(retry?.className).toContain("min-w-11")
  })
})
