import { describe, expect, it } from "vitest"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import type { TemplateApplicationImpact } from "@webmcp/document"
import {
  allTemplateCategoriesValue,
  filterTemplateCatalog,
  isSameTemplate,
  templateCatalogCategories,
  templateCatalogKey,
  templateCompatibility,
  templateDimensionsLabel,
  templateImpactRows,
  templatePreviewLayout,
} from "./template-catalog-model"

const items = builtInDesignTemplateRepository.list()

describe("template catalog model", () => {
  it("filters across metadata without mutating repository order", () => {
    const sourceOrder = items.map(templateCatalogKey)

    expect(
      filterTemplateCatalog(items, {
        search: "cinematic",
        category: allTemplateCategoriesValue,
      }).map((item) => item.id)
    ).toEqual(["quotation-midnight-film"])
    expect(
      filterTemplateCatalog(items, {
        search: "proposal",
        category: "Documents",
      }).map((item) => item.id)
    ).toEqual(["editorial-one-pager"])
    expect(items.map(templateCatalogKey)).toEqual(sourceOrder)
    expect(templateCatalogCategories(items)).toEqual([
      "Briefs",
      "Carousels",
      "Documents",
      "Invitations",
      "Media kits",
      "Presentations",
      "Proposals",
      "Reports",
      "Social",
      "Social posts",
      "Stories",
    ])
  })

  it("reports general and quotation compatibility explicitly", () => {
    const starter = items.find((item) => item.kind === "document_starter")
    const quotation = items.find((item) => item.kind === "quotation_style")
    expect(starter).toBeDefined()
    expect(quotation).toBeDefined()
    if (!starter || !quotation) return

    expect(templateCompatibility(starter, false)).toMatchObject({
      compatible: true,
      label: "Ready",
    })
    expect(templateCompatibility(quotation, false)).toMatchObject({
      compatible: false,
      label: "Quotation required",
    })
    expect(templateCompatibility(quotation, true)).toMatchObject({
      compatible: true,
      label: "Source linked",
    })
  })

  it("keeps preview layout aspect-correct inside its bounds", () => {
    for (const item of items) {
      const page = item.previewDocument.pages.find(
        (candidate) => candidate.id === item.previewPageId
      )
      expect(page).toBeDefined()
      if (!page) continue
      const layout = templatePreviewLayout(item)
      expect(layout.width).toBeLessThanOrEqual(196)
      expect(layout.height).toBeLessThanOrEqual(136)
      expect(layout.width / layout.height).toBeCloseTo(
        page.width / page.height,
        8
      )
    }
  })

  it("formats template identity, size, and active matching", () => {
    const template = items[0]
    expect(templateCatalogKey(template)).toBe(
      `${template.id}@${template.version}`
    )
    expect(
      isSameTemplate(template, {
        id: template.id,
        version: template.version,
      })
    ).toBe(true)
    expect(templateDimensionsLabel(template)).toMatch(/\d+ × \d+ px/)
  })

  it("projects every destructive impact dimension into confirmation rows", () => {
    const impact: TemplateApplicationImpact = {
      pages: { before: 6, after: 1 },
      outputs: { before: 1, after: 1 },
      nodes: { before: 41, after: 8 },
      groups: { before: 5, after: 0 },
      components: { before: 2, after: 0 },
      componentInstances: { before: 7, after: 0 },
      fields: { before: 12, after: 2 },
      bindings: { before: 12, after: 2 },
      imageAssets: { before: 3, after: 0 },
      disconnectsQuotationSource: true,
      rebuildsFromQuotationSource: false,
    }
    const rows = templateImpactRows(impact)

    expect(rows.map((row) => row.id)).toEqual([
      "pages",
      "outputs",
      "nodes",
      "groups",
      "components",
      "component-instances",
      "fields",
      "bindings",
      "image-assets",
      "quotation-source",
    ])
    expect(rows.find((row) => row.id === "pages")?.value).toBe("6 → 1")
    expect(rows.find((row) => row.id === "outputs")?.warning).toBe(false)
    expect(rows.find((row) => row.id === "quotation-source")).toMatchObject({
      value: "Will disconnect",
      warning: true,
    })
  })
})
