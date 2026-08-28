import { describe, expect, it } from "vitest"
import {
  createQuotationStarter,
  deriveStarterDocumentMetadata,
  quotationStarter,
} from "./quotation-starter"

describe("quotation starter metadata", () => {
  it("describes the exact aggregate restored by the editor", () => {
    const { document, metadata } = quotationStarter

    expect(metadata).toEqual({
      id: document.id,
      name: document.name,
      pageCount: document.pages.length,
      outputCount: document.outputs.length,
      outputs: document.outputs.map((output) => ({
        id: output.id,
        name: output.name,
        kind: output.kind,
        pageCount: output.pageIds.length,
        exportFormats: output.exportFormats,
      })),
      fieldCount: document.fields.length,
      bindingCount: document.bindings.length,
    })
  })

  it("recomputes page and output claims when composition changes", () => {
    const expandedSource = structuredClone(quotationStarter.source)
    expandedSource.document.fixedTerms = Array.from(
      { length: 36 },
      (_, index) => ({
        key: `starter-metadata-term-${index + 1}`,
        text: `Operational term ${index + 1} requires written confirmation before production begins.`,
      })
    )

    const expandedStarter = createQuotationStarter(
      expandedSource,
      quotationStarter.templateId
    )

    expect(expandedStarter.document.pages.length).toBeGreaterThan(
      quotationStarter.document.pages.length
    )
    expect(expandedStarter.metadata).toEqual(
      deriveStarterDocumentMetadata(expandedStarter.document)
    )
    expect(expandedStarter.metadata.pageCount).toBe(
      expandedStarter.document.pages.length
    )
    expect(
      expandedStarter.metadata.outputs.map((output) => output.name)
    ).toEqual(expandedStarter.document.outputs.map((output) => output.name))
    expect(
      expandedStarter.metadata.outputs.map((output) => output.pageCount)
    ).toEqual(
      expandedStarter.document.outputs.map((output) => output.pageIds.length)
    )
  })
})
