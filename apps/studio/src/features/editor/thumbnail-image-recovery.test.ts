// @vitest-environment jsdom

import { act, createElement } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"

import { PageOutputPanel } from "./page-output-panel"

type MountedTree = Readonly<{
  host: HTMLDivElement
  root: Root
}>

const mountedTrees: MountedTree[] = []

async function mount(node: ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  mountedTrees.push({ host, root })
  await act(async () => root.render(node))
  return host
}

async function failFirstCandidateInside(selector: HTMLButtonElement) {
  const candidate = selector.querySelector<HTMLImageElement>(
    'img[data-image-resource-role="candidate"]'
  )
  expect(candidate).not.toBeNull()
  if (!candidate) return
  await act(async () => {
    candidate.dispatchEvent(new Event("error"))
  })
}

function expectDisplayOnlyFailure(selector: HTMLButtonElement) {
  expect(
    selector.querySelector('[data-image-resource-state="error"]')
  ).not.toBeNull()
  expect(
    selector.querySelector('[data-image-resource-state="error"]')?.textContent
  ).toContain("Image unavailable.")
  expect(selector.querySelector('[role="alert"], [role="status"]')).toBeNull()
  const unavailable = selector.querySelector(
    '[data-image-resource-feedback="error"]'
  )
  const candidate = selector.querySelector(
    'img[data-image-resource-role="candidate"]'
  )
  expect(unavailable?.getAttribute("aria-hidden")).toBe("true")
  expect(unavailable?.hasAttribute("aria-busy")).toBe(false)
  expect(candidate?.getAttribute("aria-hidden")).toBe("true")
  expect(candidate?.getAttribute("alt")).toBe("")
  expect(
    selector.querySelector('button[aria-label^="Retry loading"]')
  ).toBeNull()
}

afterEach(async () => {
  for (const mounted of mountedTrees.splice(0)) {
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  }
})

describe("thumbnail image recovery boundary", () => {
  it("keeps a failed page-output thumbnail display-only inside its page selector", async () => {
    const onSelectPage = vi.fn()
    const page = renderConformanceDocument.pages[0]
    const host = await mount(
      createElement(PageOutputPanel, {
        document: renderConformanceDocument,
        activePageId: page.id,
        reviewPending: false,
        onSelectPage,
        onAddPage: vi.fn(),
        onDuplicatePage: vi.fn(),
        onUpdatePage: vi.fn(),
        onRemovePage: vi.fn(),
        onReorderPage: vi.fn(),
        onAddOutput: vi.fn(),
        onUpdateOutput: vi.fn(),
        onRemoveOutput: vi.fn(),
      })
    )
    const pageSelector = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Open page 1: ${page.name}"]`
    )
    expect(pageSelector).not.toBeNull()
    if (!pageSelector) return

    await failFirstCandidateInside(pageSelector)

    expectDisplayOnlyFailure(pageSelector)
    expect(onSelectPage).not.toHaveBeenCalled()
  })
})
