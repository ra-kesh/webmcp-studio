import { readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"
import {
  assertRenderImageResourceAdmission,
  assertRenderableDocument,
  createTemplateVersion,
  northstarSeed,
} from "@webmcp/document"
import type { Document, TemplateVersion } from "@webmcp/document"
import { studioAssets } from "../features/editor/asset-catalog"
import {
  legacyCuratedMediaCompatibilityItems,
  resolveCuratedMediaContent,
} from "../content/library/media/curated-media-content"
import { studioMediaManifest } from "../content/library/media/manifest"
import {
  catalogAssetFieldIssues,
  collectManagedDocumentAssetReferences,
  materializeManagedDocumentAssets,
  publicTemplateVersion,
  resolveRenderFieldAssetIds,
  resolveRenderFieldAssetIdsForWorkspace,
} from "./render-field-assets"
import type { ManagedAssetMaterializationError } from "./render-field-assets"
import { durableRenderFailureCode } from "./render-job-execution"

const rendererResource = (assetId: string, src = studioAssets[0].src) => ({
  assetId,
  src,
  width: 1_200,
  height: 800,
  contentHash: "a".repeat(64),
  revision: 3,
})

const resolveCurated = (assetId: string, version: number) =>
  resolveCuratedMediaContent({ assetId, version }, async (resourcePath) => {
    const item = [
      ...studioMediaManifest,
      ...legacyCuratedMediaCompatibilityItems,
    ].find((candidate) => candidate.resourcePath === resourcePath)!
    const bytes = new Uint8Array(
      await readFile(new URL(`../../public${resourcePath}`, import.meta.url))
    )
    return new Response(bytes.slice().buffer, {
      headers: {
        "Content-Length": String(bytes.byteLength),
        "Content-Type": item.mimeType,
      },
    })
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
  it("materializes every curated manifest ID through its exact immutable version", async () => {
    for (const item of studioMediaManifest) {
      const managed = vi.fn(async () => {
        throw new Error("Managed resolution must not run for curated media")
      })
      const curated = vi.fn(resolveCurated)
      const resolved = await resolveRenderFieldAssetIdsForWorkspace(
        { manifest },
        { hero_asset: item.id },
        managed,
        curated
      )

      expect(resolved.modifications.hero_asset).toBe(item.resourcePath)
      expect(resolved.resources).toEqual([
        {
          assetId: item.id,
          src: expect.stringMatching(/^data:image\//),
          width: item.width,
          height: item.height,
          contentHash: item.contentSha256,
          revision: item.version,
        },
      ])
      expect(curated).toHaveBeenCalledWith(item.id, item.version, undefined)
      expect(managed).not.toHaveBeenCalled()
    }
  })

  it("keeps curated identity canonical through publication and materializes only a render clone", async () => {
    const item = studioMediaManifest.find(
      (candidate) => !studioAssets.some((asset) => asset.id === candidate.id)
    )!
    const document = documentWithAsset(item.resourcePath)
    document.nodes.push({
      id: "curated-image",
      name: "Curated image",
      type: "image",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      assetId: item.id,
      src: item.resourcePath,
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
      alt: item.description,
    })
    document.pages[0].nodeIds.push("curated-image")
    const canonical = structuredClone(document)
    const version = createTemplateVersion(document, {
      id: "version-with-curated-asset",
      templateId: document.id,
      version: 1,
      sourceSnapshotId: `sha256-${"c".repeat(64)}`,
      publishedAt: "2026-08-31T00:00:00.000Z",
    })

    const published = publicTemplateVersion(version)
    expect(published.manifest.parameters.at(-1)).toMatchObject({
      defaultValue: item.resourcePath,
      exampleValue: item.resourcePath,
    })
    expect(JSON.stringify(published)).not.toContain("data:image")

    const materialized = await materializeManagedDocumentAssets(
      document,
      async () => {
        throw new Error("Managed resolution must not run for curated media")
      },
      [],
      undefined,
      resolveCurated
    )
    const materializedNode = materialized.document.nodes.find(
      (node) => node.id === "curated-image"
    )
    if (materializedNode?.type !== "image") {
      throw new Error("Expected the curated image node")
    }
    expect(materializedNode.assetId).toBe(item.id)
    expect(materializedNode.src).toMatch(/^data:image\//)
    expect(materialized.resources).toEqual([
      {
        nodeId: "curated-image",
        assetId: item.id,
        width: item.width,
        height: item.height,
        contentHash: item.contentSha256,
        revision: item.version,
      },
    ])
    await assertRenderImageResourceAdmission(
      materialized.document,
      materialized.resources
    )
    expect(() => assertRenderableDocument(materialized.document)).not.toThrow()
    expect(document).toEqual(canonical)
  })

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

  it("projects every compatibility source to an exact immutable v1 public identity", async () => {
    for (const asset of studioAssets) {
      const document = documentWithAsset(asset.src)
      const version = createTemplateVersion(document, {
        id: `version-with-${asset.id}`,
        templateId: document.id,
        version: 1,
        sourceSnapshotId: `sha256-${"a".repeat(64)}`,
        publishedAt: "2026-08-28T00:00:00.000Z",
      })
      const exactPath = `/library/media/${asset.id}/v${asset.version}/${asset.contentSha256}.svg`
      const publicVersion = publicTemplateVersion(version)
      expect(publicVersion.manifest.parameters.at(-1)).toMatchObject({
        key: "hero_asset",
        defaultValue: exactPath,
        exampleValue: exactPath,
      })
      expect(publicVersion.document.fields.at(-1)?.defaultValue).toBe(exactPath)
      expect(publicVersion.document.fieldValues.hero_asset).toBe(exactPath)
      expect(JSON.stringify(publicVersion)).not.toContain("data:image")

      const browserContent = await resolveCurated(asset.id, asset.version)
      expect(browserContent.canonicalSource).toBe(exactPath)
      expect(browserContent.identity.contentSha256).toBe(asset.contentSha256)
      expect(browserContent.src).toBe(asset.src)

      const curated = vi.fn(resolveCurated)
      const resolved = await resolveRenderFieldAssetIdsForWorkspace(
        publicVersion,
        { hero_asset: exactPath },
        async () => {
          throw new Error("Managed resolution must not run")
        },
        curated
      )
      expect(resolved.modifications.hero_asset).toBe(exactPath)
      expect(resolved.resources).toEqual([
        expect.objectContaining({
          assetId: asset.id,
          src: asset.src,
          contentHash: asset.contentSha256,
          revision: asset.version,
        }),
      ])
      expect(curated).not.toHaveBeenCalled()

      const renderProjection = await materializeManagedDocumentAssets(
        publicVersion.document,
        async () => {
          throw new Error("Managed resolution must not run")
        },
        [],
        undefined,
        curated
      )
      expect(renderProjection.document.fields.at(-1)?.defaultValue).toBe(
        asset.src
      )
      expect(renderProjection.document.fieldValues.hero_asset).toBe(asset.src)
      expect(publicVersion.document.fieldValues.hero_asset).toBe(exactPath)
    }
  })

  it("projects private catalog sources to stable exact identities in the public manifest", () => {
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
      defaultValue: `/library/media/${studioAssets[0].id}/v${studioAssets[0].version}/${studioAssets[0].contentSha256}.svg`,
      exampleValue: `/library/media/${studioAssets[0].id}/v${studioAssets[0].version}/${studioAssets[0].contentSha256}.svg`,
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
      constraints: { horizontal: "min", vertical: "min" },
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
      constraints: { horizontal: "min" as const, vertical: "min" as const },
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
      constraints: { horizontal: "min", vertical: "min" },
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
      constraints: { horizontal: "min", vertical: "min" },
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
      constraints: { horizontal: "min", vertical: "min" },
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

  it("passes cancellation and deadline signals through stalled curated field resolution", async () => {
    const item = studioMediaManifest.find(
      (candidate) => !studioAssets.some((asset) => asset.id === candidate.id)
    )!
    const cancelled = new AbortController()
    const cancellationReason = new DOMException(
      "Render cancellation requested",
      "AbortError"
    )
    cancelled.abort(cancellationReason)
    const neverCalled = vi.fn(resolveCurated)
    await expect(
      resolveRenderFieldAssetIdsForWorkspace(
        { manifest },
        { hero_asset: item.resourcePath },
        async () => rendererResource("unused"),
        neverCalled,
        cancelled.signal
      )
    ).rejects.toBe(cancellationReason)
    expect(neverCalled).not.toHaveBeenCalled()

    const deadlineController = new AbortController()
    const deadlineReason = new DOMException(
      "Render deadline exceeded",
      "TimeoutError"
    )
    setTimeout(() => deadlineController.abort(deadlineReason), 5)
    const deadline = deadlineController.signal
    const stalled = vi.fn(
      (_assetId: string, _version: number, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )
    await expect(
      resolveRenderFieldAssetIdsForWorkspace(
        { manifest },
        { hero_asset: item.resourcePath },
        async () => rendererResource("unused"),
        stalled,
        deadline
      )
    ).rejects.toMatchObject({ name: "TimeoutError" })
    expect(stalled).toHaveBeenCalledWith(item.id, item.version, deadline)
  })

  it("contains curated failures from unbound default and current asset fields", async () => {
    const item = studioMediaManifest.find(
      (candidate) => !studioAssets.some((asset) => asset.id === candidate.id)
    )!
    const document = documentWithAsset(item.resourcePath)
    const rejected = vi.fn(async () => {
      throw new Error("curated bytes drifted")
    })
    await expect(
      materializeManagedDocumentAssets(
        document,
        async () => rendererResource("unused"),
        [],
        undefined,
        rejected
      )
    ).rejects.toMatchObject({
      code: "curated_asset_materialization_failed",
      assetId: item.id,
      nodeId: "field:hero_asset:default",
    })

    const currentOnly = documentWithAsset("")
    const field = currentOnly.fields.at(-1)!
    field.required = false
    field.defaultValue = ""
    currentOnly.fieldValues[field.id] = item.resourcePath
    await expect(
      materializeManagedDocumentAssets(
        currentOnly,
        async () => rendererResource("unused"),
        [],
        undefined,
        rejected
      )
    ).rejects.toMatchObject({
      code: "curated_asset_materialization_failed",
      assetId: item.id,
      nodeId: "field:hero_asset:current",
    })
  })

  it("classifies curated and managed modification failures with exact field locators", async () => {
    const curated = studioMediaManifest.find(
      (candidate) => !studioAssets.some((asset) => asset.id === candidate.id)
    )!
    let curatedError: unknown
    try {
      await resolveRenderFieldAssetIdsForWorkspace(
        { manifest },
        { hero_asset: curated.resourcePath },
        async () => rendererResource("unused"),
        async () => {
          throw new Error("curated bytes drifted")
        }
      )
    } catch (error) {
      curatedError = error
    }
    expect(curatedError).toMatchObject({
      code: "curated_asset_materialization_failed",
      assetId: curated.id,
      nodeId: "field:hero_asset:modification",
    })
    expect(durableRenderFailureCode(curatedError)).toBe(
      "curated_asset_materialization_failed"
    )

    const managedAssetId = "asset-0123456789abcdef0123456789abcdef"
    let managedError: unknown
    try {
      await resolveRenderFieldAssetIdsForWorkspace(
        { manifest },
        { hero_asset: managedAssetId },
        async () => {
          throw new Error("managed bytes unavailable")
        }
      )
    } catch (error) {
      managedError = error
    }
    expect(managedError).toMatchObject({
      code: "managed_asset_materialization_failed",
      assetId: managedAssetId,
      nodeId: "field:hero_asset:modification",
    })
    expect(durableRenderFailureCode(managedError)).toBe(
      "managed_asset_materialization_failed"
    )
  })

  it("contains managed failures from unbound default and current asset fields", async () => {
    const assetId = "asset-0123456789abcdef0123456789abcdef"
    const source = `asset:managed/${assetId}`
    const rejected = vi.fn(async () => {
      throw new Error("managed bytes unavailable")
    })
    const document = documentWithAsset(source)
    await expect(
      materializeManagedDocumentAssets(document, rejected)
    ).rejects.toMatchObject({
      code: "managed_asset_materialization_failed",
      assetId,
      nodeId: "field:hero_asset:default",
    })

    const currentOnly = documentWithAsset("")
    const field = currentOnly.fields.at(-1)!
    field.required = false
    field.defaultValue = ""
    currentOnly.fieldValues[field.id] = source
    let currentError: unknown
    try {
      await materializeManagedDocumentAssets(currentOnly, rejected)
    } catch (error) {
      currentError = error
    }
    expect(currentError).toMatchObject({
      code: "managed_asset_materialization_failed",
      assetId,
      nodeId: "field:hero_asset:current",
    })
    expect(durableRenderFailureCode(currentError)).toBe(
      "managed_asset_materialization_failed"
    )
  })

  it("preserves abort reasons while containing modification failures", async () => {
    const assetId = "asset-0123456789abcdef0123456789abcdef"
    const controller = new AbortController()
    const reason = new DOMException("Render cancelled", "AbortError")
    await expect(
      resolveRenderFieldAssetIdsForWorkspace(
        { manifest },
        { hero_asset: assetId },
        async (_assetId, signal) => {
          controller.abort(reason)
          signal?.throwIfAborted()
          return rendererResource(assetId)
        },
        undefined,
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
