import { describe, expect, it } from "vitest"
import { createTemplateVersion } from "@webmcp/document"
import type { FieldDefinition } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
import { quotationStarter } from "./quotation-starter"
import {
  publishedVersionsForDocument,
  replaceAuthoritativePublishedVersions,
  restorePublishedVersions,
} from "./published-version-state"

describe("published version authority", () => {
  it("keeps same-style versions scoped to the exact document identity", () => {
    const firstDocument = structuredClone(quotationStarter.document)
    const secondDocument = {
      ...structuredClone(quotationStarter.document),
      id: "another-client-quotation",
      name: "Another client quotation",
    }
    const first = createTemplateVersion(firstDocument, {
      id: "first-client-v1",
      templateId: "editorial-olive",
      version: 1,
      sourceSnapshotId: `sha256-${"a".repeat(64)}`,
      publishedAt: "2026-08-28T13:00:00.000Z",
    })
    const second = createTemplateVersion(secondDocument, {
      id: "second-client-v1",
      templateId: "editorial-olive",
      version: 1,
      sourceSnapshotId: `sha256-${"b".repeat(64)}`,
      publishedAt: "2026-08-28T13:05:00.000Z",
    })

    expect(
      publishedVersionsForDocument(
        [first, second],
        "editorial-olive",
        secondDocument.id
      )
    ).toEqual([second])
    expect(replaceAuthoritativePublishedVersions([first], [second])).toEqual([
      first,
      second,
    ])
  })

  it("keeps the server-public asset identity after replacement and reload", async () => {
    const asset = studioAssets[0]
    const assetField: FieldDefinition = {
      id: "hero_asset",
      key: "hero_asset",
      label: "Hero asset",
      type: "asset",
      required: true,
      defaultValue: asset.src,
      agentDescription: "The approved hero image",
      validation: {},
    }
    const currencyField: FieldDefinition = {
      id: "legacy_budget",
      key: "legacy_budget",
      label: "Legacy budget",
      type: "currency",
      required: true,
      defaultValue: "₹3,85,000",
      agentDescription: "Historical published budget",
      validation: {},
    }
    const document = {
      ...structuredClone(quotationStarter.document),
      fields: [...quotationStarter.document.fields, assetField, currencyField],
      fieldValues: {
        ...quotationStarter.document.fieldValues,
        [assetField.id]: asset.src,
        [currencyField.id]: "₹3,85,000",
      },
    }
    const local = createTemplateVersion(document, {
      id: "asset-version",
      templateId: "asset-template",
      version: 1,
      sourceSnapshotId: `sha256-${"c".repeat(64)}`,
      publishedAt: "2026-08-28T13:30:00.000Z",
    })
    const authoritative = structuredClone(local)
    const parameter = authoritative.manifest.parameters.find(
      (candidate) => candidate.id === assetField.id
    )
    if (!parameter) throw new Error("Expected the asset parameter")
    parameter.defaultValue = asset.id
    parameter.exampleValue = asset.id

    const installed = replaceAuthoritativePublishedVersions(
      [local],
      [authoritative]
    )
    const restored = await restorePublishedVersions(JSON.stringify(installed))
    const restoredParameter = restored[0]?.manifest.parameters.find(
      (candidate) => candidate.id === assetField.id
    )

    expect(installed).toHaveLength(1)
    expect(restored[0]).toEqual(authoritative)
    expect(JSON.stringify(restored[0])).toBe(JSON.stringify(authoritative))
    expect(restored[0]?.sourceSnapshotId).toBe(authoritative.sourceSnapshotId)
    expect(restored[0]?.document.fieldValues[currencyField.id]).toBe(
      "₹3,85,000"
    )
    expect(restoredParameter).toMatchObject({
      type: "asset",
      defaultValue: asset.id,
      exampleValue: asset.id,
    })
    expect(JSON.stringify(restoredParameter)).not.toContain("data:image")
  })
})
