import type {
  Document,
  RenderImageResourceExpectation,
  TemplateModifications,
  TemplateVersion,
} from "@webmcp/document"
import {
  curatedAssetIdentityFromSource,
  curatedImageAssetIdentity,
  managedImageAssetIdentity,
  sceneNodeImageReferences,
  validateAssetFieldPublicationIdentities,
} from "@webmcp/document"
import {
  studioAssetIdForValue,
  studioAssetIdentityForValue,
  studioAssets,
  studioCompatibilityAssetForValue,
  studioCompatibilityAssetPathForValue,
} from "../features/editor/asset-catalog"
import type { VerifiedCuratedMediaContent } from "../content/library/media/curated-media-content"
import { studioMediaManifest } from "../content/library/media/manifest"
import { managedAssetIdFromSource, managedAssetSource } from "./media-assets"
import type {
  MediaAssetReference,
  VerifiedManagedAssetResource,
} from "./media-assets"

type ManagedAssetResolver = (
  assetId: string,
  signal?: AbortSignal
) => Promise<VerifiedManagedAssetResource>

type CuratedAssetResolver = (
  assetId: string,
  version: number,
  signal?: AbortSignal
) => Promise<VerifiedCuratedMediaContent>

export type ManagedImageResourceExpectation = RenderImageResourceExpectation

export type ResolvedRenderFieldAssets = {
  modifications: TemplateModifications
  resources: VerifiedManagedAssetResource[]
}

const compatibilityRendererResource = (value: unknown) => {
  const asset = studioCompatibilityAssetForValue(value)
  return asset
    ? ({
        assetId: asset.id,
        src: asset.src,
        width: asset.width,
        height: asset.height,
        contentHash: asset.contentSha256,
        revision: asset.version,
      } satisfies VerifiedManagedAssetResource)
    : null
}

export type MaterializedManagedDocument = {
  document: Document
  resources: ManagedImageResourceExpectation[]
}

const contentHashPattern = /^[a-f0-9]{64}$/

const curatedRendererResource = (
  content: VerifiedCuratedMediaContent
): VerifiedManagedAssetResource => ({
  assetId: content.identity.assetId,
  src: content.src,
  width: content.item.width,
  height: content.item.height,
  contentHash: content.identity.contentSha256,
  revision: content.identity.version,
})

function assertVerifiedManagedAssetResource(
  expectedAssetId: string,
  resource: VerifiedManagedAssetResource
) {
  if (
    resource.assetId !== expectedAssetId ||
    !resource.src.startsWith("data:image/") ||
    !Number.isInteger(resource.width) ||
    resource.width < 1 ||
    !Number.isInteger(resource.height) ||
    resource.height < 1 ||
    !contentHashPattern.test(resource.contentHash) ||
    !Number.isInteger(resource.revision) ||
    resource.revision < 1
  ) {
    throw new Error(
      `Managed asset ${expectedAssetId} did not resolve to a verified renderer resource`
    )
  }
  return resource
}

export class ManagedAssetMaterializationError extends Error {
  readonly code = "managed_asset_materialization_failed"

  constructor(
    readonly assetId: string,
    readonly nodeId: string,
    cause: unknown
  ) {
    super(`Managed image node ${nodeId} failed resource integrity validation`, {
      cause,
    })
    this.name = "ManagedAssetMaterializationError"
  }
}

export class CuratedAssetMaterializationError extends Error {
  readonly code = "curated_asset_materialization_failed"

  constructor(
    readonly assetId: string,
    readonly nodeId: string,
    cause: unknown
  ) {
    super(`Curated image node ${nodeId} failed resource integrity validation`, {
      cause,
    })
    this.name = "CuratedAssetMaterializationError"
  }
}

export function resolveRenderFieldAssetIds(
  version: Pick<TemplateVersion, "manifest">,
  modifications: TemplateModifications
): TemplateModifications {
  return Object.fromEntries(
    Object.entries(modifications).map(([key, value]) => {
      const parameter = version.manifest.parameters.find(
        (candidate) => candidate.key === key
      )
      if (parameter?.type === "currency" && typeof value !== "string") {
        throw new Error(
          `${parameter.label} must use an exact decimal string to avoid money precision loss`
        )
      }
      if (parameter?.type !== "asset") return [key, value]
      if (value === "" && !parameter.required) return [key, value]
      if (typeof value !== "string") {
        throw new Error(`${parameter.label} must use an approved asset ID`)
      }
      const asset = studioAssets.find((candidate) => candidate.id === value)
      if (/^asset-[A-Za-z0-9_-]{10,90}$/.test(value)) return [key, value]
      if (asset) return [key, asset.src]
      const curatedIdentity = studioAssetIdentityForValue(value)
      if (!curatedIdentity) {
        throw new Error(
          `Unknown approved asset ID for ${parameter.label}: ${value}`
        )
      }
      const manifestItem = studioMediaManifest.find(
        (candidate) =>
          candidate.id === curatedIdentity.assetId &&
          candidate.version === curatedIdentity.version &&
          candidate.contentSha256 === curatedIdentity.contentSha256
      )
      if (!manifestItem) throw new Error(`Unknown approved asset ID: ${value}`)
      return [key, manifestItem.resourcePath]
    })
  )
}

function resolveRenderFieldAssetIdentities(
  version: Pick<TemplateVersion, "manifest">,
  modifications: TemplateModifications
): TemplateModifications {
  return Object.fromEntries(
    Object.entries(modifications).map(([key, value]) => {
      const parameter = version.manifest.parameters.find(
        (candidate) => candidate.key === key
      )
      if (parameter?.type === "currency" && typeof value !== "string") {
        throw new Error(
          `${parameter.label} must use an exact decimal string to avoid money precision loss`
        )
      }
      if (parameter?.type !== "asset") return [key, value]
      if (value === "" && !parameter.required) return [key, value]
      if (typeof value !== "string" || value.startsWith("data:image/")) {
        throw new Error(`${parameter.label} must use an approved asset ID`)
      }
      if (/^asset-[A-Za-z0-9_-]{10,90}$/.test(value)) return [key, value]
      if (studioCompatibilityAssetPathForValue(value) === value) {
        return [key, value]
      }
      const identity = studioAssetIdentityForValue(value)
      if (!identity) {
        throw new Error(
          `Unknown approved asset ID for ${parameter.label}: ${value}`
        )
      }
      const item = studioMediaManifest.find(
        (candidate) =>
          candidate.id === identity.assetId &&
          candidate.version === identity.version &&
          candidate.contentSha256 === identity.contentSha256
      )
      if (!item) {
        throw new Error(
          `Unknown approved asset ID for ${parameter.label}: ${value}`
        )
      }
      return [key, item.resourcePath]
    })
  )
}

export async function resolveRenderFieldAssetIdsForWorkspace(
  version: Pick<TemplateVersion, "manifest">,
  modifications: TemplateModifications,
  resolveManagedAsset: ManagedAssetResolver,
  resolveCuratedAsset?: CuratedAssetResolver,
  signal?: AbortSignal
): Promise<ResolvedRenderFieldAssets> {
  signal?.throwIfAborted()
  const resolved = resolveRenderFieldAssetIdentities(version, modifications)
  const resourcesById = new Map<string, Promise<VerifiedManagedAssetResource>>()
  const entries = await Promise.all(
    Object.entries(resolved).map(async ([key, value]) => {
      const parameter = version.manifest.parameters.find(
        (candidate) => candidate.key === key
      )
      if (parameter?.type !== "asset" || typeof value !== "string") {
        return [key, value] as const
      }
      if (value === "") return [key, value] as const
      // Built-in IDs are already converted by the synchronous resolver.
      if (value.startsWith("data:image/")) return [key, value] as const
      const compatibility = compatibilityRendererResource(value)
      if (compatibility) {
        resourcesById.set(
          `curated:${compatibility.assetId}@${compatibility.revision}`,
          Promise.resolve(compatibility)
        )
        return [key, value] as const
      }
      const curatedIdentity = curatedAssetIdentityFromSource(value)
      if (curatedIdentity) {
        try {
          if (!resolveCuratedAsset) {
            throw new Error(
              `Curated media resolver is unavailable for ${parameter.label}`
            )
          }
          const resourceKey = `curated:${curatedIdentity.assetId}@${curatedIdentity.version}`
          let pending = resourcesById.get(resourceKey)
          if (!pending) {
            pending = resolveCuratedAsset(
              curatedIdentity.assetId,
              curatedIdentity.version,
              signal
            ).then((content) => {
              signal?.throwIfAborted()
              if (
                content.identity.contentSha256 !== curatedIdentity.contentSha256
              ) {
                throw new Error(
                  `Curated media ${curatedIdentity.assetId}@${curatedIdentity.version} did not match its canonical source`
                )
              }
              return assertVerifiedManagedAssetResource(
                curatedIdentity.assetId,
                curatedRendererResource(content)
              )
            })
            resourcesById.set(resourceKey, pending)
          }
          await pending
        } catch (error) {
          signal?.throwIfAborted()
          throw new CuratedAssetMaterializationError(
            curatedIdentity.assetId,
            `field:${parameter.id}:modification`,
            error
          )
        }
        return [key, value] as const
      }
      const assetId = managedAssetIdFromSource(managedAssetSource(value))
      if (!assetId) {
        throw new Error(
          `Unknown approved asset ID for ${parameter.label}: ${value}`
        )
      }
      let pending = resourcesById.get(assetId)
      if (!pending) {
        pending = resolveManagedAsset(assetId, signal).then((resource) => {
          signal?.throwIfAborted()
          return assertVerifiedManagedAssetResource(assetId, resource)
        })
        resourcesById.set(assetId, pending)
      }
      let resource: VerifiedManagedAssetResource
      try {
        resource = await pending
      } catch (error) {
        signal?.throwIfAborted()
        throw new ManagedAssetMaterializationError(
          assetId,
          `field:${parameter.id}:modification`,
          error
        )
      }
      return [key, resource.src] as const
    })
  )
  return {
    modifications: Object.fromEntries(entries),
    resources: await Promise.all(resourcesById.values()),
  }
}

export function collectManagedDocumentAssetReferences(
  input: Document,
  referenceKind: MediaAssetReference["referenceKind"],
  sourceId: string
): MediaAssetReference[] {
  const document = input
  const references: MediaAssetReference[] = []
  const pageByNode = new Map(
    document.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.id] as const)
    )
  )
  for (const node of document.nodes) {
    for (const imageReference of sceneNodeImageReferences(node)) {
      const identity = managedImageAssetIdentity(
        imageReference.assetId,
        imageReference.src
      )
      if (identity.managed && !identity.coherent) {
        throw new Error(
          `Managed image ${node.name} has mismatched assetId and src identities`
        )
      }
      const assetId = managedAssetIdFromSource(imageReference.src)
      if (!assetId) continue
      const property =
        imageReference.location === "fill"
          ? `fills.${imageReference.paintId}.src`
          : "src"
      references.push({
        assetId,
        referenceKind,
        sourceId,
        referenceKey: `node:${node.id}:${property}`,
        documentId: document.id,
        pageId: pageByNode.get(node.id) ?? null,
        nodeId: node.id,
        fieldId: null,
        property,
      })
    }
  }

  for (const field of document.fields) {
    if (field.type !== "asset") continue
    const values = [
      ["default", field.defaultValue] as const,
      ["current", document.fieldValues[field.id]] as const,
    ]
    for (const [slot, value] of values) {
      if (typeof value !== "string") continue
      const assetId = managedAssetIdFromSource(value)
      if (!assetId) continue
      const bindings = document.bindings.filter(
        (binding) => binding.fieldId === field.id
      )
      if (!bindings.length) {
        references.push({
          assetId,
          referenceKind,
          sourceId,
          referenceKey: `field:${field.id}:${slot}`,
          documentId: document.id,
          pageId: null,
          nodeId: null,
          fieldId: field.id,
          property: slot,
        })
      }
      for (const binding of bindings) {
        references.push({
          assetId,
          referenceKind,
          sourceId,
          referenceKey: `field:${field.id}:${slot}:binding:${binding.id}`,
          documentId: document.id,
          pageId: pageByNode.get(binding.nodeId) ?? null,
          nodeId: binding.nodeId,
          fieldId: field.id,
          property: binding.property,
        })
      }
    }
  }
  return references
}

export async function materializeManagedDocumentAssets(
  input: Document,
  resolveManagedAsset: ManagedAssetResolver,
  initialResources: readonly VerifiedManagedAssetResource[] = [],
  signal?: AbortSignal,
  resolveCuratedAsset?: CuratedAssetResolver
): Promise<MaterializedManagedDocument> {
  signal?.throwIfAborted()
  const document = structuredClone(input)
  const resolvedById = new Map<string, Promise<VerifiedManagedAssetResource>>()
  for (const resource of initialResources) {
    const verified = Promise.resolve(
      assertVerifiedManagedAssetResource(resource.assetId, resource)
    )
    resolvedById.set(resource.assetId, verified)
    resolvedById.set(
      `curated:${resource.assetId}@${resource.revision}`,
      verified
    )
  }
  const resources: ManagedImageResourceExpectation[] = []
  const resolveSource = async (source: string) => {
    signal?.throwIfAborted()
    const compatibility = compatibilityRendererResource(source)
    if (compatibility) {
      const resourceKey = `curated:${compatibility.assetId}@${compatibility.revision}`
      const existing = resolvedById.get(resourceKey)
      if (existing) return existing
      const verified = Promise.resolve(
        assertVerifiedManagedAssetResource(compatibility.assetId, compatibility)
      )
      resolvedById.set(resourceKey, verified)
      return verified
    }
    const assetId = managedAssetIdFromSource(source)
    const curatedIdentity = curatedAssetIdentityFromSource(source)
    if (!assetId && !curatedIdentity) return null
    if (curatedIdentity) {
      if (!resolveCuratedAsset) {
        throw new Error(
          `Curated media resolver is unavailable for ${curatedIdentity.assetId}@${curatedIdentity.version}`
        )
      }
      const resourceKey = `curated:${curatedIdentity.assetId}@${curatedIdentity.version}`
      let pending = resolvedById.get(resourceKey)
      if (!pending) {
        pending = resolveCuratedAsset(
          curatedIdentity.assetId,
          curatedIdentity.version,
          signal
        ).then((content) => {
          if (
            content.identity.contentSha256 !== curatedIdentity.contentSha256
          ) {
            throw new Error(
              `Curated media ${curatedIdentity.assetId}@${curatedIdentity.version} did not match its canonical source`
            )
          }
          return assertVerifiedManagedAssetResource(
            curatedIdentity.assetId,
            curatedRendererResource(content)
          )
        })
        resolvedById.set(resourceKey, pending)
      }
      return pending
    }
    if (!assetId) return null
    let pending = resolvedById.get(assetId)
    if (!pending) {
      pending = resolveManagedAsset(assetId, signal).then((resource) => {
        signal?.throwIfAborted()
        return assertVerifiedManagedAssetResource(assetId, resource)
      })
      resolvedById.set(assetId, pending)
    }
    const resource = await pending
    return resource
  }
  for (const node of document.nodes) {
    signal?.throwIfAborted()
    for (const imageReference of sceneNodeImageReferences(node)) {
      const identity = managedImageAssetIdentity(
        imageReference.assetId,
        imageReference.src
      )
      const curatedIdentity = curatedImageAssetIdentity(
        imageReference.assetId,
        imageReference.src
      )
      if (identity.managed && !identity.coherent) {
        throw new Error(
          `Managed image ${node.name} has mismatched assetId and src identities`
        )
      }
      if (curatedIdentity.curated && !curatedIdentity.coherent) {
        throw new Error(
          `Curated image ${node.name} has mismatched assetId and src identities`
        )
      }
      const assetId =
        managedAssetIdFromSource(imageReference.src) ??
        (curatedIdentity.curated ? curatedIdentity.assetId : null)
      if (!assetId) continue
      try {
        const resource = await resolveSource(imageReference.src)
        if (!resource) continue
        if (imageReference.location === "node" && node.type === "image") {
          node.src = resource.src
        } else if ("fills" in node && node.fills) {
          node.fills = node.fills.map((paint) =>
            paint.type === "image" && paint.id === imageReference.paintId
              ? { ...paint, src: resource.src }
              : paint
          )
        }
        resources.push({
          nodeId: node.id,
          ...(imageReference.paintId
            ? { paintId: imageReference.paintId }
            : {}),
          assetId: resource.assetId,
          width: resource.width,
          height: resource.height,
          contentHash: resource.contentHash,
          revision: resource.revision,
        })
      } catch (error) {
        signal?.throwIfAborted()
        if (curatedIdentity.curated) {
          throw new CuratedAssetMaterializationError(assetId, node.id, error)
        }
        throw new ManagedAssetMaterializationError(assetId, node.id, error)
      }
    }
  }
  const resolveFieldSource = async (
    fieldId: string,
    source: string,
    slot: "default" | "current"
  ) => {
    try {
      return await resolveSource(source)
    } catch (error) {
      signal?.throwIfAborted()
      const curatedIdentity = curatedAssetIdentityFromSource(source)
      if (curatedIdentity) {
        throw new CuratedAssetMaterializationError(
          curatedIdentity.assetId,
          `field:${fieldId}:${slot}`,
          error
        )
      }
      const managedAssetId = managedAssetIdFromSource(source)
      if (managedAssetId) {
        throw new ManagedAssetMaterializationError(
          managedAssetId,
          `field:${fieldId}:${slot}`,
          error
        )
      }
      throw error
    }
  }
  for (const field of document.fields) {
    signal?.throwIfAborted()
    if (field.type !== "asset") continue
    if (typeof field.defaultValue === "string") {
      const resource = await resolveFieldSource(
        field.id,
        field.defaultValue,
        "default"
      )
      if (resource) field.defaultValue = resource.src
    }
    const current = document.fieldValues[field.id]
    if (typeof current === "string") {
      const resource = await resolveFieldSource(field.id, current, "current")
      if (resource) document.fieldValues[field.id] = resource.src
    }
  }
  signal?.throwIfAborted()
  return {
    document,
    resources,
  }
}

export const catalogAssetFieldIssues = (document: Document) => {
  const fieldIssues = validateAssetFieldPublicationIdentities(
    document,
    (value) =>
      Boolean(studioAssetIdForValue(value)) ||
      (typeof value === "string" && managedAssetIdFromSource(value) !== null)
  )
  const curatedNodeIssues = document.nodes.flatMap((node) =>
    sceneNodeImageReferences(node).flatMap((reference) =>
      reference.src.startsWith("/library/media/") &&
      !studioAssetIdentityForValue(reference.src)
        ? [
            {
              id: `node:${node.id}:${reference.paintId ?? "image"}:unknown-curated-asset`,
              severity: "error" as const,
              code: "unmanaged_asset" as const,
              message: `${node.name} does not use an exact approved Studio asset version`,
              nodeId: node.id,
            },
          ]
        : []
    )
  )
  return [...fieldIssues, ...curatedNodeIssues]
}

export function publicTemplateVersion(
  version: TemplateVersion
): TemplateVersion {
  const document = structuredClone(version.document)
  for (const node of document.nodes) {
    if (node.type === "image") {
      node.src = studioCompatibilityAssetPathForValue(node.src) ?? node.src
    } else if ("fills" in node && node.fills) {
      node.fills = node.fills.map((paint) =>
        paint.type === "image"
          ? {
              ...paint,
              src: studioCompatibilityAssetPathForValue(paint.src) ?? paint.src,
            }
          : paint
      )
    }
  }
  for (const field of document.fields) {
    if (field.type !== "asset") continue
    if (typeof field.defaultValue === "string") {
      field.defaultValue =
        studioCompatibilityAssetPathForValue(field.defaultValue) ??
        field.defaultValue
    }
    const current = document.fieldValues[field.id]
    if (typeof current === "string") {
      document.fieldValues[field.id] =
        studioCompatibilityAssetPathForValue(current) ?? current
    }
  }
  return {
    ...version,
    document,
    manifest: {
      ...version.manifest,
      parameters: version.manifest.parameters.map((parameter) => {
        if (parameter.type !== "asset") return parameter
        const publicId = (value: unknown): string | undefined => {
          const compatibilityPath = studioCompatibilityAssetPathForValue(value)
          if (compatibilityPath) return compatibilityPath
          if (
            typeof value === "string" &&
            /^asset-[A-Za-z0-9_-]{10,90}$/.test(value)
          ) {
            return value
          }
          if (typeof value === "string") {
            const managedId = managedAssetIdFromSource(value)
            if (managedId) return managedId
            if (curatedAssetIdentityFromSource(value)) return value
          }
          return studioAssetIdForValue(value)
        }
        const defaultValue =
          parameter.defaultValue === "" ? "" : publicId(parameter.defaultValue)
        const exampleValue =
          parameter.exampleValue === "" ? "" : publicId(parameter.exampleValue)
        if (defaultValue === undefined || exampleValue === undefined) {
          throw new Error(
            `${parameter.label} has no public approved asset identity`
          )
        }
        return { ...parameter, defaultValue, exampleValue }
      }),
    },
  }
}
