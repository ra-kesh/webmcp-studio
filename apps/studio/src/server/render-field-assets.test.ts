import { describe, expect, it, vi } from "vitest"
import { createTemplateVersion, northstarSeed } from "@webmcp/document"
import type { Document, TemplateVersion } from "@webmcp/document"
import { studioAssets } from "../features/editor/asset-catalog"
import {
  catalogAssetFieldIssues,
  collectManagedDocumentAssetReferences,
  materializeManagedDocumentAssets,
  publicTemplateVersion,
  resolveRenderFieldAssetIds,
} from "./render-field-assets"
import type { ManagedAssetMaterializationError } from "./render-field-assets"

const rendererResource = (assetId: string, src = studioAssets[0].src) => ({
  assetId,
  src,
  width: 1_200,
  height: 800,
  contentHash: "a".repeat(64),
  revision: 3,
})

const manifest: TemplateVersion["manifest"] = {
  schemaVersion: 1,
  parameters: [
    {
      id: "hero_asset",
      key: "hero_asset",
      label: "Hero asset",
      type: "asset",
      required: true,
      defaultValue: studioAssets[0].src,
      exampleValue: studioAssets[0].src,
      agentDescription: "Approved hero artwork",
      validation: {},
      bindings: [],
    },
    {
      id: "package_price",
      key: "package_price",
      label: "Package price",
      type: "currency",
      required: true,
      defaultValue: "385000",
      exampleValue: "385000",
      agentDescription: "Exact INR price",
      validation: {},
      bindings: [],
    },
  ],
  outputs: [],
}

describe("render field asset resolution", () => {
  it("resolves a public catalog ID to its private renderer source", () => {
    expect(
      resolveRenderFieldAssetIds(
        { manifest },
        { hero_asset: studioAssets[1].id }
      )
    ).toEqual({ hero_asset: studioAssets[1].src })
  })

  it("rejects raw or unknown asset values at the public render boundary", () => {
    expect(() =>
      resolveRenderFieldAssetIds(
        { manifest },
        { hero_asset: studioAssets[0].src }
      )
    ).toThrow("Unknown approved asset ID")
    expect(() =>
      resolveRenderFieldAssetIds(
        { manifest },
        { hero_asset: "https://example.test/unapproved.png" }
      )
    ).toThrow("Unknown approved asset ID")
  })

  it("rejects numeric currency before JavaScript can round money", () => {
    expect(() =>
      resolveRenderFieldAssetIds(
        { manifest },
        { package_price: 9_007_199_254_740_992 }
      )
    ).toThrow("must use an exact decimal string")
    expect(
      resolveRenderFieldAssetIds(
        { manifest },
        { package_price: "9007199254740993" }
      )
    ).toEqual({ package_price: "9007199254740993" })
  })

  it("blocks published asset fields that are not backed by the Studio catalog", () => {
    const catalogDocument = documentWithAsset(studioAssets[0].src)
    expect(catalogAssetFieldIssues(catalogDocument)).toEqual([])

    const unmanagedDocument = documentWithAsset(
      "https://example.test/unmanaged.png"
    )
    expect(catalogAssetFieldIssues(unmanagedDocument)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unmanaged_asset",
          severity: "error",
        }),
      ])
    )

    const inlineDocument = documentWithAsset(
      "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%3E%3C%2Fsvg%3E"
    )
    expect(catalogAssetFieldIssues(inlineDocument)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unmanaged_asset" }),
      ])
    )
  })

  it("allows an omitted optional current value to inherit its approved default", () => {
    const document = documentWithAsset(studioAssets[0].src)
    const field = document.fields.at(-1)
    if (!field) throw new Error("Expected asset field")
    field.required = false
    delete document.fieldValues[field.id]

    expect(catalogAssetFieldIssues(document)).toEqual([])
  })

  it("projects private catalog sources to stable IDs in the public manifest", () => {
    const document = documentWithAsset(studioAssets[0].src)
    const version = createTemplateVersion(document, {
      id: "version-with-asset",
      templateId: document.id,
      version: 1,
      sourceSnapshotId: `sha256-${"a".repeat(64)}`,
      publishedAt: "2026-08-28T00:00:00.000Z",
    })

    const publicVersion = publicTemplateVersion(version)
    expect(publicVersion.manifest.parameters.at(-1)).toMatchObject({
      key: "hero_asset",
      defaultValue: studioAssets[0].id,
      exampleValue: studioAssets[0].id,
    })
    expect(JSON.stringify(publicVersion.manifest)).not.toContain("data:image")
    expect(publicTemplateVersion(publicVersion)).toEqual(publicVersion)
  })

  it("keeps managed identities canonical at publication and resolves only in the render projection", async () => {
    const assetId = "asset-0123456789abcdef0123456789abcdef"
    const managed = `asset:managed/${assetId}`
    const document = documentWithAsset(managed)
    const page = document.pages[0]
    document.nodes.push({
      id: "managed-image",
      name: "Managed image",
      type: "image",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId,
      src: managed,
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      decorative: false,
      alt: "Portrait",
    })
    page.nodeIds.push("managed-image")

    const version = createTemplateVersion(document, {
      id: "version-with-managed-asset",
      templateId: document.id,
      version: 1,
      sourceSnapshotId: `sha256-${"b".repeat(64)}`,
      publishedAt: "2026-08-28T00:00:00.000Z",
    })
    expect(JSON.stringify(version.document)).toContain(managed)
    expect(JSON.stringify(version.document)).not.toContain("data:image")
    expect(
      publicTemplateVersion(version).manifest.parameters.at(-1)
    ).toMatchObject({
      defaultValue: assetId,
      exampleValue: assetId,
    })

    const references = collectManagedDocumentAssetReferences(
      version.document,
      "published_version",
      version.id
    )
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId,
          referenceKind: "published_version",
          sourceId: version.id,
        }),
      ])
    )

    const resolve = vi.fn(async () => rendererResource(assetId))
    const materialized = await materializeManagedDocumentAssets(
      version.document,
      resolve,
      [rendererResource(assetId)]
    )
    expect(JSON.stringify(materialized.document)).toContain("data:image")
    expect(materialized.resources).toEqual([
      expect.objectContaining({
        nodeId: "managed-image",
        assetId,
        width: 1_200,
        height: 800,
        contentHash: "a".repeat(64),
        revision: 3,
      }),
    ])
    expect(JSON.stringify(version.document)).toContain(managed)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("keeps node expectations exact when distinct managed assets have identical bytes", async () => {
    const document = structuredClone(northstarSeed)
    const firstAssetId = "asset-aaaaaaaaaa"
    const secondAssetId = "asset-bbbbbbbbbb"
    const base = {
      name: "Managed image",
      type: "image" as const,
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      placement: {
        mode: "fill" as const,
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" as const },
      decorative: false,
      alt: "Portrait",
    }
    document.nodes.push(
      {
        ...base,
        id: "managed-image-a",
        assetId: firstAssetId,
        src: `asset:managed/${firstAssetId}`,
      },
      {
        ...base,
        id: "managed-image-b",
        assetId: secondAssetId,
        src: `asset:managed/${secondAssetId}`,
      }
    )
    const firstPage = document.pages[0]
    firstPage.nodeIds.push("managed-image-a", "managed-image-b")

    const sharedSource = "data:image/png;base64,AQIDBA=="
    const materialized = await materializeManagedDocumentAssets(
      document,
      async (assetId) => rendererResource(assetId, sharedSource)
    )

    expect(materialized.resources).toEqual([
      expect.objectContaining({
        nodeId: "managed-image-a",
        assetId: firstAssetId,
      }),
      expect.objectContaining({
        nodeId: "managed-image-b",
        assetId: secondAssetId,
      }),
    ])
  })

  it("refuses mismatched managed image identities before reference accounting or render projection", async () => {
    const document = structuredClone(northstarSeed)
    document.nodes.push({
      id: "mismatched-managed-image",
      name: "Mismatched managed image",
      type: "image",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "asset-aaaaaaaaaa",
      src: "asset:managed/asset-bbbbbbbbbb",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      decorative: false,
      alt: "Portrait",
    })
    document.pages[0].nodeIds.push("mismatched-managed-image")

    expect(() =>
      collectManagedDocumentAssetReferences(
        document,
        "published_version",
        "version-mismatch"
      )
    ).toThrow("mismatched assetId and src identities")

    const resolve = vi.fn(async (assetId: string) => rendererResource(assetId))
    await expect(
      materializeManagedDocumentAssets(document, resolve)
    ).rejects.toThrow("mismatched assetId and src identities")
    expect(resolve).not.toHaveBeenCalledWith("asset-bbbbbbbbbb")
  })

  it("keeps the canonical document unchanged and identifies the node when a verified resource is invalid", async () => {
    const assetId = "asset-0123456789abcdef0123456789abcdef"
    const managed = `asset:managed/${assetId}`
    const document = structuredClone(northstarSeed)
    document.nodes.push({
      id: "managed-image",
      name: "Managed image",
      type: "image",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId,
      src: managed,
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      decorative: false,
      alt: "Portrait",
    })
    document.pages[0].nodeIds.push("managed-image")
    const before = structuredClone(document)

    await expect(
      materializeManagedDocumentAssets(document, async () => ({
        ...rendererResource(assetId),
        width: 0,
      }))
    ).rejects.toEqual(
      expect.objectContaining<Partial<ManagedAssetMaterializationError>>({
        code: "managed_asset_materialization_failed",
        assetId,
        nodeId: "managed-image",
      })
    )
    expect(document).toEqual(before)
  })

  it("preserves cancellation instead of wrapping it as a materialization failure", async () => {
    const assetId = "asset-0123456789abcdef0123456789abcdef"
    const document = structuredClone(northstarSeed)
    document.nodes.push({
      id: "aborted-managed-image",
      name: "Aborted managed image",
      type: "image",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId,
      src: `asset:managed/${assetId}`,
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      decorative: false,
      alt: "Portrait",
    })
    document.pages[0].nodeIds.push("aborted-managed-image")
    const controller = new AbortController()
    const reason = new DOMException("Thumbnail left the viewport", "AbortError")

    await expect(
      materializeManagedDocumentAssets(
        document,
        async () => {
          controller.abort(reason)
          controller.signal.throwIfAborted()
          return rendererResource(assetId)
        },
        [],
        controller.signal
      )
    ).rejects.toBe(reason)
  })
})

function documentWithAsset(value: string): Document {
  const document = structuredClone(northstarSeed)
  return {
    ...document,
    fields: [
      ...document.fields,
      {
        id: "hero_asset",
        key: "hero_asset",
        label: "Hero asset",
        type: "asset",
        required: true,
        defaultValue: value,
        agentDescription: "Approved hero artwork",
        validation: {},
      },
    ],
    fieldValues: {
      ...document.fieldValues,
      hero_asset: value,
    },
  }
}
