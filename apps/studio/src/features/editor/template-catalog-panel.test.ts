import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import { TemplateCatalogPanel } from "./template-catalog-panel"
import type {
  TemplateCatalogLoadState,
  TemplateCatalogPanelProps,
} from "./template-catalog-panel"

const items = builtInDesignTemplateRepository.list()

const defaultProps: TemplateCatalogPanelProps = {
  items,
  loadState: { status: "ready" },
  hasQuotationSource: false,
  reviewPending: false,
  onRetry: vi.fn(),
  onCreate: vi.fn(),
  onApply: vi.fn(),
  getApplicationImpact: vi.fn(() => {
    throw new Error("Impact is only requested by an apply interaction.")
  }),
}

const renderPanel = (overrides: Partial<TemplateCatalogPanelProps> = {}) =>
  renderToStaticMarkup(
    createElement(TemplateCatalogPanel, { ...defaultProps, ...overrides })
  )

describe("TemplateCatalogPanel", () => {
  it("renders repository-backed preview content and complete template metadata", () => {
    const html = renderPanel()

    expect(html).toContain("data-page-id")
    expect(html).toContain("Preview of Editorial one-pager")
    expect(html).toContain("A clear story,")
    expect(html).toContain("1240 × 1754 px")
    expect(html).toContain("Studio originals")
    expect(html).toContain("Internal")
    expect(html).toContain("Create new")
    expect(html).toContain("Apply to this design")
  })

  it("renders design-system loading and recoverable failure states", () => {
    const loadingState: TemplateCatalogLoadState = { status: "loading" }
    expect(renderPanel({ loadState: loadingState })).toContain(
      "Loading design templates"
    )

    const errorState: TemplateCatalogLoadState = {
      status: "error",
      message: "The catalog service is unavailable.",
    }
    const errorHtml = renderPanel({ loadState: errorState })
    expect(errorHtml).toContain("Templates could not be loaded")
    expect(errorHtml).toContain("The catalog service is unavailable.")
    expect(errorHtml).toContain("Try again")
  })

  it("explains quotation incompatibility and review mutation lockout", () => {
    const quotation = items.find((item) => item.kind === "quotation_style")
    expect(quotation).toBeDefined()
    if (!quotation) return

    const incompatibleHtml = renderPanel({ items: [quotation] })
    expect(incompatibleHtml).toContain("Quotation required")
    expect(incompatibleHtml).toContain(
      "Link a Stuwiz quotation before creating or applying"
    )
    expect(incompatibleHtml).toContain('disabled=""')

    const reviewHtml = renderPanel({ reviewPending: true })
    expect(reviewHtml).toContain(
      "Resolve the pending WebMCP review before creating or applying"
    )
    expect(reviewHtml).toContain('disabled=""')
  })

  it("opens on the active template when no explicit card was selected", () => {
    const active = items.find((item) => item.id === "quotation-midnight-film")
    expect(active).toBeDefined()
    if (!active) return

    const html = renderPanel({
      activeTemplate: { id: active.id, version: active.version },
      hasQuotationSource: true,
    })

    expect(html).toContain('id="selected-template-title">Midnight Film</h3>')
    expect(html).toContain("Applying this style changes the visual system")
  })
})
