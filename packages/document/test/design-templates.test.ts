import { describe, expect, it } from "vitest"
import {
  builtInDesignTemplateDefinitions,
  builtInDesignTemplateRepository,
  DesignTemplateRepository,
  designTemplateDefinitionSchema,
  northstarQuotationPayload,
  QUOTATION_COMPOSER_VERSION,
  quotationSourceFingerprint,
  templateApplicationImpact,
  validateDocument,
} from "../src"

describe("design template repository", () => {
  it("lists immutable, renderer-backed catalog items in deterministic order", () => {
    const items = builtInDesignTemplateRepository.list()
    expect(items).toHaveLength(5)
    expect(items.map((item) => item.name)).toEqual([
      "Editorial one-pager",
      "Editorial Olive",
      "Midnight Film",
      "Warm Paper",
      "Bold square announcement",
    ])
    expect(
      items
        .filter((item) => item.kind === "quotation_style")
        .map((item) => [item.version, item.composerVersion])
    ).toEqual([
      [2, QUOTATION_COMPOSER_VERSION],
      [2, QUOTATION_COMPOSER_VERSION],
      [2, QUOTATION_COMPOSER_VERSION],
    ])
    expect(builtInDesignTemplateRepository.categories()).toEqual([
      "Documents",
      "Proposals",
      "Social",
    ])
    for (const item of items) {
      expect(item.previewDocument.pages).toHaveLength(item.pageCount)
      expect(
        item.previewDocument.pages.some(
          (page) => page.id === item.previewPageId
        )
      ).toBe(true)
      expect(Object.isFrozen(item)).toBe(true)
      expect(Object.isFrozen(item.previewDocument)).toBe(true)
    }
  })

  it("searches names, descriptions, categories, and tags", () => {
    expect(
      builtInDesignTemplateRepository.list({ search: "cinematic" })[0]?.id
    ).toBe("quotation-midnight-film")
    expect(
      builtInDesignTemplateRepository.list({ category: "social" })[0]?.id
    ).toBe("bold-square-announcement")
    expect(
      builtInDesignTemplateRepository.list({ kind: "document_starter" })
    ).toHaveLength(2)
    expect(
      builtInDesignTemplateRepository.list({ search: "not present" })
    ).toEqual([])
  })

  it("materializes general templates with fresh relational identities", () => {
    let sequence = 0
    const next = builtInDesignTemplateRepository.materialize(
      "editorial-one-pager",
      1,
      {
        now: "2026-08-28T00:00:00.000Z",
        name: "Client brief",
        createId: (kind) => `${kind}-fresh-${++sequence}`,
      }
    )
    const source = builtInDesignTemplateRepository.get("editorial-one-pager", 1)
    expect(source.kind).toBe("document_starter")
    if (source.kind !== "document_starter") return
    expect(next.id).not.toBe(source.document.id)
    expect(next.name).toBe("Client brief")
    expect(next.revision).toBe(0)
    expect(next.createdAt).toBe("2026-08-28T00:00:00.000Z")
    expect(next.outputs[0]?.pageIds).toEqual([next.pages[0]?.id])
    expect(next.bindings[0]?.fieldId).toBe(next.fields[0]?.id)
    expect(next.bindings[0]?.nodeId).toBe(next.nodes[2]?.id)
    expect(
      validateDocument(next).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("requires source data for quotation styles and supports canonical apply identity", () => {
    expect(() =>
      builtInDesignTemplateRepository.materialize("quotation-midnight-film", 2)
    ).toThrow("requires quotation source data")
    const canonical = builtInDesignTemplateRepository.materialize(
      "quotation-midnight-film",
      2,
      { quotation: northstarQuotationPayload, identity: "canonical" }
    )
    const fresh = builtInDesignTemplateRepository.materialize(
      "quotation-midnight-film",
      2,
      { quotation: northstarQuotationPayload }
    )
    expect(canonical.pages[0]?.id).toBe("quotation-page-1")
    expect(fresh.pages[0]?.id).not.toBe(canonical.pages[0]?.id)
    expect(canonical.pages).toHaveLength(6)
  })

  it("retains legacy identity without silently invoking the current composer", () => {
    expect(
      builtInDesignTemplateRepository.get("quotation-editorial-olive", 1)
    ).toMatchObject({
      version: 1,
      composerVersion: 1,
      catalogStatus: "retired",
    })
    expect(() =>
      builtInDesignTemplateRepository.materialize(
        "quotation-editorial-olive",
        1,
        { quotation: northstarQuotationPayload }
      )
    ).toThrow("requires retired quotation composer 1")
  })

  it("fingerprints canonical source content independent of object key order", async () => {
    const reordered = Object.fromEntries(
      Object.entries(northstarQuotationPayload).reverse()
    ) as typeof northstarQuotationPayload
    expect(await quotationSourceFingerprint(reordered)).toBe(
      await quotationSourceFingerprint(northstarQuotationPayload)
    )
    expect(
      await quotationSourceFingerprint({
        ...northstarQuotationPayload,
        source: {
          ...northstarQuotationPayload.source,
          revision: northstarQuotationPayload.source.revision + 1,
        },
      })
    ).not.toBe(await quotationSourceFingerprint(northstarQuotationPayload))
  })

  it("fingerprints optional undefined values exactly like persisted JSON", async () => {
    const withUndefined = structuredClone(northstarQuotationPayload)
    withUndefined.branding.logoUrl = undefined
    const roundTripped = JSON.parse(
      JSON.stringify(withUndefined)
    ) as typeof withUndefined

    expect(await quotationSourceFingerprint(withUndefined)).toBe(
      await quotationSourceFingerprint(roundTripped)
    )
  })

  it("rejects duplicate versions and aggregate-invalid starter snapshots", () => {
    expect(
      designTemplateDefinitionSchema.safeParse(
        builtInDesignTemplateDefinitions[0]
      ).success
    ).toBe(true)
    expect(
      () =>
        new DesignTemplateRepository(
          [
            builtInDesignTemplateDefinitions[0]!,
            builtInDesignTemplateDefinitions[0]!,
          ],
          northstarQuotationPayload
        )
    ).toThrow("Duplicate design template version")

    const definition = structuredClone(builtInDesignTemplateDefinitions[0]!)
    if (definition.kind !== "document_starter") return
    definition.document.pages[0]!.nodeIds.push("missing-node")
    expect(
      () =>
        new DesignTemplateRepository([definition], northstarQuotationPayload)
    ).toThrow("points to a missing node")
  })
})

describe("template application impact", () => {
  it("reports structural and source-link transitions before replacement", () => {
    const current = builtInDesignTemplateRepository.materialize(
      "quotation-editorial-olive",
      2,
      { quotation: northstarQuotationPayload, identity: "canonical" }
    )
    const next = builtInDesignTemplateRepository.materialize(
      "bold-square-announcement",
      1,
      { identity: "canonical" }
    )
    expect(
      templateApplicationImpact(current, next, {
        currentHasQuotationSource: true,
        nextHasQuotationSource: false,
      })
    ).toMatchObject({
      pages: { before: 6, after: 1 },
      outputs: { before: 1, after: 1 },
      disconnectsQuotationSource: true,
      rebuildsFromQuotationSource: false,
    })
  })
})
