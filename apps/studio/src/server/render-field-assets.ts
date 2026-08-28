import type {
  Document,
  RenderImageResourceExpectation,
  TemplateModifications,
  TemplateVersion,
} from "@webmcp/document"
import {
  managedImageAssetIdentity,
  validateAssetFieldPublicationIdentities,
} from "@webmcp/document"
import {
  studioAssetIdForValue,
  studioAssets,
} from "../features/editor/asset-catalog"
import { managedAssetIdFromSource, managedAssetSource } from "./media-assets"
import type {
  MediaAssetReference,
  VerifiedManagedAssetResource,
} from "./media-assets"

type ManagedAssetResolver = (
  assetId: string,
  signal?: AbortSignal
) => Promise<VerifiedManagedAssetResource>

export type ManagedImageResourceExpectation = RenderImageResourceExpectation

export type ResolvedRenderFieldAssets = {
  modifications: TemplateModifications
  resources: VerifiedManagedAssetResource[]
}

export type MaterializedManagedDocument = {
  document: Document
  resources: ManagedImageResourceExpectation[]
}

const contentHashPattern = /^[a-f0-9]{64}$/

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
      if (!asset) {
        throw new Error(
          `Unknown approved asset ID for ${parameter.label}: ${value}`
        )
      }
      return [key, asset.src]
    })
  )
}

export async function resolveRenderFieldAssetIdsForWorkspace(
  version: Pick<TemplateVersion, "manifest">,
  modifications: TemplateModifications,
  resolveManagedAsset: ManagedAssetResolver
): Promise<ResolvedRenderFieldAssets> {
  const resolved = resolveRenderFieldAssetIds(version, modifications)
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
      const assetId = managedAssetIdFromSource(managedAssetSource(value))
      if (!assetId) {
        throw new Error(
          `Unknown approved asset ID for ${parameter.label}: ${value}`
        )
      }
      let pending = resourcesById.get(assetId)
      if (!pending) {
        pending = resolveManagedAsset(assetId).then((resource) =>
          assertVerifiedManagedAssetResource(assetId, resource)
        )
        resourcesById.set(assetId, pending)
      }
      const resource = await pending
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
    if (node.type !== "image") continue
    const identity = managedImageAssetIdentity(node.assetId, node.src)
    if (identity.managed && !identity.coherent) {
      throw new Error(
        `Managed image ${node.name} has mismatched assetId and src identities`
      )
    }
    const assetId = managedAssetIdFromSource(node.src)
    if (!assetId) continue
    references.push({
      assetId,
      referenceKind,
      sourceId,
      referenceKey: `node:${node.id}:src`,
      documentId: document.id,
      pageId: pageByNode.get(node.id) ?? null,
      nodeId: node.id,
      fieldId: null,
      property: "src",
    })
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
  signal?: AbortSignal
): Promise<MaterializedManagedDocument> {
  signal?.throwIfAborted()
  const document = structuredClone(input)
  const resolvedById = new Map(
    initialResources.map((resource) => [
      resource.assetId,
      Promise.resolve(
        assertVerifiedManagedAssetResource(resource.assetId, resource)
      ),
    ])
  )
  const resources: ManagedImageResourceExpectation[] = []
  const resolveSource = async (source: string) => {
    signal?.throwIfAborted()
    const assetId = managedAssetIdFromSource(source)
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
    if (node.type !== "image") continue
    const identity = managedImageAssetIdentity(node.assetId, node.src)
    if (identity.managed && !identity.coherent) {
      throw new Error(
        `Managed image ${node.name} has mismatched assetId and src identities`
      )
    }
    const assetId = managedAssetIdFromSource(node.src)
    if (!assetId) continue
    try {
      const resource = await resolveSource(node.src)
      if (!resource) continue
      node.src = resource.src
      resources.push({
        nodeId: node.id,
        assetId: resource.assetId,
        width: resource.width,
        height: resource.height,
        contentHash: resource.contentHash,
        revision: resource.revision,
      })
    } catch (error) {
      signal?.throwIfAborted()
      throw new ManagedAssetMaterializationError(assetId, node.id, error)
    }
  }
  for (const field of document.fields) {
    signal?.throwIfAborted()
    if (field.type !== "asset") continue
    if (typeof field.defaultValue === "string") {
      const resource = await resolveSource(field.defaultValue)
      if (resource) field.defaultValue = resource.src
    }
    const current = document.fieldValues[field.id]
    if (typeof current === "string") {
      const resource = await resolveSource(current)
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
  return validateAssetFieldPublicationIdentities(
    document,
    (value) =>
      Boolean(studioAssetIdForValue(value)) ||
      (typeof value === "string" && managedAssetIdFromSource(value) !== null)
  )
}

export function publicTemplateVersion(
  version: TemplateVersion
): TemplateVersion {
  return {
    ...version,
    manifest: {
      ...version.manifest,
      parameters: version.manifest.parameters.map((parameter) => {
        if (parameter.type !== "asset") return parameter
        const publicId = (value: unknown): string | undefined => {
          if (
            typeof value === "string" &&
            /^asset-[A-Za-z0-9_-]{10,90}$/.test(value)
          ) {
            return value
          }
          if (typeof value === "string") {
            const managedId = managedAssetIdFromSource(value)
            if (managedId) return managedId
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
