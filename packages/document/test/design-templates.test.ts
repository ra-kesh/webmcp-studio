import { describe, expect, it } from "vitest"
import {
  builtInDesignTemplateDefinitions,
  builtInDesignTemplateRepository,
  cloneTemplateDocument,
  composeQuotationDocumentV3,
  DesignTemplateRepository,
  designTemplateDefinitionSchema,
  materializeComponentInstances,
  northstarQuotationPayload,
  QUOTATION_COMPOSER_VERSION,
  quotationSourceFingerprint,
  quotationStyleContent,
  templateContentSha256,
  templateApplicationImpact,
  validateDocument,
} from "../src"
import type { Document } from "../src"
import { maskRenderConformanceDocument } from "../src/mask-render-conformance"

function componentTemplateDocument(): Document {
  const document = structuredClone(
    builtInDesignTemplateRepository.materialize("editorial-one-pager", 1, {
      identity: "canonical",
    })
  )
  const page = document.pages[0]!
  const sourceNode = document.nodes.find((node) => node.id === page.nodeIds[0])!
  const instanceNodeId = "template-component-instance-node"
  const sourceGroupId = "template-component-source"
  const instanceGroupId = "template-component-instance-root"
  const componentId = "template-component"
  const variantId = "template-component-default"

  document.nodes.push({
    ...structuredClone(sourceNode),
    id: instanceNodeId,
    x: sourceNode.x + 120,
  })
  page.nodeIds.push(instanceNodeId)
  document.groups.push(
    {
      id: sourceGroupId,
      role: "organize",
      pageId: page.id,
      name: "Template component",
      nodeIds: [sourceNode.id],
    },
    {
      id: instanceGroupId,
      role: "organize",
      pageId: page.id,
      name: "Template component 1",
      nodeIds: [instanceNodeId],
    }
  )
  document.components = [
    {
      id: componentId,
      name: "Template component",
      description: "Reusable template content",
      sourceGroupId,
      defaultVariantId: variantId,
      variants: [
        {
          id: variantId,
          name: "Default",
          overrides: { [sourceNode.id]: { opacity: 0.9 } },
        },
      ],
    },
  ]
  document.componentInstances = [
    {
      id: "template-component-instance",
      name: "Template component 1",
      componentId,
      variantId,
      rootGroupId: instanceGroupId,
      transform: {
        x: sourceNode.x + 120,
        y: sourceNode.y,
        scale: 1,
        rotation: 0,
      },
      nodeMappings: [{ sourceNodeId: sourceNode.id, instanceNodeId }],
      groupMappings: [{ sourceGroupId, instanceGroupId }],
      overrides: { [sourceNode.id]: { opacity: 0.75 } },
    },
  ]
  return materializeComponentInstances(document)
}

describe("design template repository", () => {
  it("lists immutable, renderer-backed catalog items in deterministic order", () => {
    const items = builtInDesignTemplateRepository.list()
    expect(items).toHaveLength(21)
    expect(items.map((item) => item.id)).toEqual(
      builtInDesignTemplateRepository.list().map((item) => item.id)
    )
    expect(
      items.filter((item) => item.kind === "document_starter")
    ).toHaveLength(18)
    expect(
      items
        .filter((item) => item.kind === "quotation_style")
        .map((item) => [item.version, item.composerVersion])
    ).toEqual([
      [4, QUOTATION_COMPOSER_VERSION],
      [4, QUOTATION_COMPOSER_VERSION],
      [4, QUOTATION_COMPOSER_VERSION],
    ])
    expect(builtInDesignTemplateRepository.categories()).toEqual([
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
    ).toHaveLength(18)
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

  it("remaps nested mask parents and sources deterministically", () => {
    const source = structuredClone(maskRenderConformanceDocument)
    source.groups = [
      {
        id: "template-outer-mask",
        pageId: "mask-conformance-page",
        name: "Template outer mask",
        nodeIds: ["mask-conformance-below", "mask-conformance-above"],
        role: "mask",
        mask: { type: "vector", sourceNodeIds: ["mask-conformance-below"] },
      },
      {
        id: "template-child-mask",
        pageId: "mask-conformance-page",
        parentGroupId: "template-outer-mask",
        name: "Template child mask",
        nodeIds: ["mask-conformance-source", "mask-conformance-content"],
        role: "mask",
        mask: { type: "alpha", sourceNodeIds: ["mask-conformance-source"] },
      },
    ]
    source.commandReceipts = [
      { id: "mask-template-source", fingerprint: "a".repeat(64) },
    ]
    source.sceneTransactionMetadata = {
      schemaVersion: 1,
      receipts: [
        {
          idempotencyKey: "template-source",
          requestHash: "b".repeat(64),
        },
      ],
    }
    const createId = (kind: string, sourceId: string) =>
      `${kind}-template-copy-${sourceId}`
    const next = cloneTemplateDocument(source, {
      now: "2026-08-31T16:00:00.000Z",
      createId,
    })
    expect(next.groups).toEqual([
      expect.objectContaining({
        id: "group-template-copy-template-outer-mask",
        mask: {
          type: "vector",
          sourceNodeIds: ["node-template-copy-mask-conformance-below"],
        },
      }),
      expect.objectContaining({
        id: "group-template-copy-template-child-mask",
        parentGroupId: "group-template-copy-template-outer-mask",
        mask: {
          type: "alpha",
          sourceNodeIds: ["node-template-copy-mask-conformance-source"],
        },
      }),
    ])
    expect(next.commandReceipts).toBeUndefined()
    expect(next.sceneTransactionMetadata).toBeUndefined()
    expect(source.commandReceipts).toHaveLength(1)
    expect(source.sceneTransactionMetadata?.receipts).toHaveLength(1)
    expect(validateDocument(next)).toEqual([])
    expect(
      cloneTemplateDocument(source, {
        now: "2026-08-31T16:00:00.000Z",
        createId,
      })
    ).toEqual(next)
  })

  it("ports component resources and override ownership into fresh template identities", () => {
    let sequence = 0
    const source = componentTemplateDocument()
    const next = cloneTemplateDocument(source, {
      now: "2026-08-30T15:30:00.000Z",
      createId: (kind) => `${kind}-portable-${++sequence}`,
    })
    const sourceComponent = source.components[0]!
    const component = next.components[0]!
    const sourceInstance = source.componentInstances[0]!
    const instance = next.componentInstances[0]!

    expect(component.id).not.toBe(sourceComponent.id)
    expect(component.sourceGroupId).not.toBe(sourceComponent.sourceGroupId)
    expect(component.defaultVariantId).not.toBe(
      sourceComponent.defaultVariantId
    )
    expect(instance.id).not.toBe(sourceInstance.id)
    expect(instance.componentId).toBe(component.id)
    expect(instance.variantId).toBe(component.defaultVariantId)
    expect(instance.rootGroupId).not.toBe(sourceInstance.rootGroupId)
    expect(instance.nodeMappings[0]?.sourceNodeId).not.toBe(
      sourceInstance.nodeMappings[0]?.sourceNodeId
    )
    expect(instance.nodeMappings[0]?.instanceNodeId).not.toBe(
      sourceInstance.nodeMappings[0]?.instanceNodeId
    )
    expect(Object.keys(component.variants[0]!.overrides)).toEqual([
      instance.nodeMappings[0]!.sourceNodeId,
    ])
    expect(Object.keys(instance.overrides)).toEqual([
      instance.nodeMappings[0]!.sourceNodeId,
    ])
    expect(
      validateDocument(next).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("requires source data for quotation styles and supports canonical apply identity", () => {
    expect(() =>
      builtInDesignTemplateRepository.materialize("quotation-midnight-film", 4)
    ).toThrow("requires quotation source data")
    const canonical = builtInDesignTemplateRepository.materialize(
      "quotation-midnight-film",
      4,
      { quotation: northstarQuotationPayload, identity: "canonical" }
    )
    const fresh = builtInDesignTemplateRepository.materialize(
      "quotation-midnight-film",
      4,
      { quotation: northstarQuotationPayload }
    )
    expect(canonical.pages[0]?.id).toBe("quotation-page-1")
    expect(fresh.pages[0]?.id).not.toBe(canonical.pages[0]?.id)
    expect(canonical.pages).toHaveLength(6)
  })

  it("retains legacy identity without silently invoking the current composer", () => {
    const historicalChecksums = {
      "quotation-editorial-olive":
        "bf053bd31da14a50dd28bef67996086b0beeabf74cc7e82f2978cb389711856a",
      "quotation-warm-paper":
        "1e49119fa6e7070872ed5f3ddfa762350ca44e8e4871b3968f59e38f022c7b5e",
      "quotation-midnight-film":
        "e20ba6d14f33b1ee7f34761cb9b8d06a02585db42148bb139b2c02afffae7641",
    } as const
    for (const [id, checksum] of Object.entries(historicalChecksums)) {
      const definition = builtInDesignTemplateRepository.get(id, 3)
      if (definition.kind !== "quotation_style") {
        throw new Error("Expected quotation style")
      }
      const preview = composeQuotationDocumentV3(
        northstarQuotationPayload,
        definition.quotationTemplateId
      )
      expect(definition.manifest.provenance.contentSha256).toBe(checksum)
      expect(definition.manifest.provenance.contentSha256).toBe(
        templateContentSha256(
          quotationStyleContent(
            definition.quotationTemplateId,
            definition.composerVersion,
            preview
          )
        )
      )
    }
    const composerV3 = builtInDesignTemplateRepository.get(
      "quotation-editorial-olive",
      3
    )
    expect(composerV3).toMatchObject({
      version: 3,
      composerVersion: 3,
      catalogStatus: "retired",
    })
    if (composerV3.kind !== "quotation_style") {
      throw new Error("Expected quotation style")
    }
    const historicalPreview = composeQuotationDocumentV3(
      northstarQuotationPayload,
      composerV3.quotationTemplateId
    )
    expect(composerV3.manifest.contentIdentity).toMatchObject({
      kind: "quotation_style",
      composerVersion: 3,
      preview: "canonical",
    })
    expect(historicalPreview.nodes.every((node) => node.locked)).toBe(true)
    expect(() =>
      builtInDesignTemplateRepository.materialize(
        "quotation-editorial-olive",
        3,
        { quotation: northstarQuotationPayload }
      )
    ).toThrow("requires retired quotation composer 3")
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
      4,
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
      components: { before: 0, after: 0 },
      componentInstances: { before: 0, after: 0 },
      disconnectsQuotationSource: true,
      rebuildsFromQuotationSource: false,
    })
  })
})
