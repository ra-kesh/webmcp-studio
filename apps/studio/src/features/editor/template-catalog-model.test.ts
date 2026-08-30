import { describe, expect, it } from "vitest"
import type { TemplateApplicationImpact } from "@webmcp/document"
import { templateImpactRows } from "./template-catalog-model"

describe("template catalog model", () => {
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
