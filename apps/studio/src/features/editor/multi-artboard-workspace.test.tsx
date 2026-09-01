import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { Document } from "@webmcp/document"
import { MultiArtboardLayoutController } from "@webmcp/editor/multi-artboard"
import { quotationStarter } from "./quotation-starter"
import { MultiArtboardWorkspace } from "./multi-artboard-workspace"

const hundredPageDocument = () => {
  const source = quotationStarter.document.pages[0]!
  const pages = Array.from({ length: 100 }, (_, index) => ({
    ...source,
    id: `page-${index + 1}`,
    name: `Page ${index + 1}`,
    width: index % 2 ? 1080 : 1240,
    height: index % 3 ? 1080 : 1754,
    nodeIds: [],
  }))
  return { ...quotationStarter.document, pages } as Document
}

describe("MultiArtboardWorkspace", () => {
  it("keeps 100 page shells while mounting only the visibility set", () => {
    const document = hundredPageDocument()
    const layout = new MultiArtboardLayoutController(document.pages)
    const renderArtboard = vi.fn((page: Document["pages"][number]) =>
      createElement("div", { "data-live-page": page.id })
    )
    const markup = renderToStaticMarkup(
      <MultiArtboardWorkspace
        document={document}
        layout={layout}
        zoom={0.1}
        activePageId="page-50"
        mountedPageIds={new Set(["page-49", "page-50", "page-51"])}
        interactionPageIds={new Set(["page-50"])}
        renderArtboard={renderArtboard}
        onActivatePage={vi.fn()}
        onFocusPage={vi.fn()}
        onAddPage={vi.fn()}
      />
    )

    expect(markup.match(/data-page-world-frame=/g)).toHaveLength(100)
    expect(markup.match(/data-live-page=/g)).toHaveLength(3)
    expect(markup.match(/data-artboard-placeholder=/g)).toHaveLength(97)
    expect(renderArtboard).toHaveBeenCalledTimes(3)
    expect(markup).toContain('data-add-page-after="page-50"')
    expect(markup).toContain('data-interaction-owner="true"')
  })

  it("marks the active page and disables its add affordance during mutation locks", () => {
    const document = hundredPageDocument()
    const layout = new MultiArtboardLayoutController(document.pages)
    const markup = renderToStaticMarkup(
      <MultiArtboardWorkspace
        document={document}
        layout={layout}
        zoom={0.2}
        activePageId="page-1"
        mountedPageIds={new Set(["page-1"])}
        interactionPageIds={new Set()}
        mutationDisabled
        renderArtboard={() => createElement("canvas")}
        onActivatePage={vi.fn()}
        onFocusPage={vi.fn()}
        onAddPage={vi.fn()}
      />
    )

    expect(markup).toContain('aria-current="page"')
    expect(markup).toMatch(/data-add-page-after="page-1"[^>]*disabled/)
  })
})
