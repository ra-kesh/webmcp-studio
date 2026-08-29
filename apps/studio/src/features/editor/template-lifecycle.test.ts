import { describe, expect, it } from "vitest"
import {
  builtInDesignTemplateRepository,
  northstarQuotationPayload,
} from "@webmcp/document"
import { quotationStarter } from "./quotation-starter"
import {
  prepareApplyTemplate,
  prepareCreateFromTemplate,
} from "./template-lifecycle"
import type { TemplateSourceContext } from "./template-lifecycle"

const linkedContext: TemplateSourceContext = {
  quotationSource: northstarQuotationPayload,
  quotationTemplateId: "editorial-olive",
  designTemplate: { id: "quotation-editorial-olive", version: 1 },
}

const stableIds = () => {
  let sequence = 0
  return (kind: string) => `${kind}-catalog-${++sequence}`
}

describe("design-template lifecycle", () => {
  it("creates a genuinely fresh starter and disconnects quotation source", () => {
    const mutation = prepareCreateFromTemplate({
      repository: builtInDesignTemplateRepository,
      templateId: "editorial-one-pager",
      version: 1,
      currentDocument: quotationStarter.document,
      sourceContext: linkedContext,
      now: "2026-08-28T12:00:00.000Z",
      createId: stableIds(),
    })

    expect(mutation.document.id).not.toBe(quotationStarter.document.id)
    expect(mutation.document.pages[0]?.id).toMatch(/^page-catalog-/)
    expect(mutation.document.revision).toBe(0)
    expect(mutation.sourceContext.quotationSource).toBeNull()
    expect(mutation.sourceContext.designTemplate).toEqual({
      id: "editorial-one-pager",
      version: 1,
    })
    expect(mutation.impact.disconnectsQuotationSource).toBe(true)
    expect(mutation.label).toBe("Create from Editorial one-pager")
  })

  it("applies a starter to the current identity with fresh internals and explicit impact", () => {
    const mutation = prepareApplyTemplate({
      repository: builtInDesignTemplateRepository,
      templateId: "bold-square-announcement",
      version: 1,
      currentDocument: quotationStarter.document,
      sourceContext: linkedContext,
      now: "2026-08-28T12:00:00.000Z",
      createId: stableIds(),
    })

    expect(mutation.document.id).toBe(quotationStarter.document.id)
    expect(mutation.document.name).toBe(quotationStarter.document.name)
    expect(mutation.document.createdAt).toBe(
      quotationStarter.document.createdAt
    )
    expect(mutation.document.revision).toBe(
      quotationStarter.document.revision + 1
    )
    expect(mutation.document.pages[0]?.id).toMatch(/^page-catalog-/)
    expect(mutation.impact.pages).toEqual({ before: 6, after: 1 })
    expect(mutation.impact.disconnectsQuotationSource).toBe(true)
    expect(mutation.sourceContext.quotationSource).toBeNull()
    expect(mutation.sourceContext.designTemplate).toEqual({
      id: "bold-square-announcement",
      version: 1,
    })
  })

  it("restyles a linked quotation without replacing its structure or content", () => {
    const edited = structuredClone(quotationStarter.document)
    const title = edited.nodes.find(
      (node) => node.id === "text-4" && node.type === "text"
    )
    if (!title || title.type !== "text") throw new Error("Missing title")
    title.text = "Client-approved copy"
    edited.pages[0].name = "Renamed by the user"

    const mutation = prepareApplyTemplate({
      repository: builtInDesignTemplateRepository,
      templateId: "quotation-midnight-film",
      version: 2,
      currentDocument: edited,
      sourceContext: linkedContext,
      now: "2026-08-28T12:00:00.000Z",
    })

    expect(mutation.document.id).toBe(edited.id)
    expect(mutation.document.pages.map((page) => page.id)).toEqual(
      edited.pages.map((page) => page.id)
    )
    expect(mutation.document.pages[0]?.name).toBe("Renamed by the user")
    expect(
      mutation.document.nodes.find((node) => node.id === "text-4")
    ).toEqual(expect.objectContaining({ text: "Client-approved copy" }))
    expect(mutation.sourceContext.quotationTemplateId).toBe("midnight-film")
    expect(mutation.sourceContext.designTemplate).toEqual({
      id: "quotation-midnight-film",
      version: 2,
    })
    expect(mutation.impact.disconnectsQuotationSource).toBe(false)
    expect(mutation.impact.rebuildsFromQuotationSource).toBe(false)
  })

  it("rejects quotation styles when no source is linked", () => {
    expect(() =>
      prepareCreateFromTemplate({
        repository: builtInDesignTemplateRepository,
        templateId: "quotation-warm-paper",
        version: 2,
        currentDocument: quotationStarter.document,
        sourceContext: {
          quotationSource: null,
          quotationTemplateId: "editorial-olive",
          designTemplate: null,
        },
      })
    ).toThrow("needs a linked quotation source")
  })
})
