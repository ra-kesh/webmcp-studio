import type { DesignTemplateCatalogItem } from "./design-templates"
import {
  libraryMediaDetailSchema,
  libraryMediaSummarySchema,
  libraryTemplateDetailSchema,
  libraryTemplateSummarySchema,
} from "./library-catalog"
import type {
  LibraryMediaDetail,
  LibraryMediaSummary,
  LibraryPermissionProjection,
  LibraryPreferenceProjection,
  LibraryPreviewDescriptor,
  LibraryProvenance,
  LibraryTemplateDetail,
  LibraryTemplateSummary,
} from "./library-catalog"
import type { PublicMediaAsset } from "./media"

const defaultPermissions: LibraryPermissionProjection = {
  canView: true,
  canUse: true,
  canFavorite: true,
  canAddToCollection: true,
}

const noPreferences = null

type ProjectionOptions = {
  curatedRank?: number | null
  permissions?: LibraryPermissionProjection
  preferences?: LibraryPreferenceProjection | null
  preview?: LibraryPreviewDescriptor
}

export type DesignTemplateLibraryProjectionOptions = ProjectionOptions & {
  useCaseIds?: readonly string[]
}

export type CuratedLibraryMediaSource = Readonly<{
  id: string
  version: number
  contentSha256: string
  name: string
  description: string
  tags: readonly string[]
  width: number
  height: number
  mimeType: LibraryMediaSummary["mimeType"]
  bytes: number
  categoryId: string
  useCaseIds: readonly string[]
  formatFamily: string
  createdAt: string
  updatedAt: string
  provenance: LibraryProvenance
}>

export type CuratedLibraryMediaProjectionOptions = ProjectionOptions

export type WorkspaceLibraryMediaMetadata = ProjectionOptions & {
  catalogVersion: number
  description: string
  categoryId: string
  useCaseIds: readonly string[]
  formatFamily: string
  tags: readonly string[]
  provenance: LibraryProvenance
}

export type LocalLibraryMediaSource = Readonly<{
  id: string
  name: string
  mediaType: string
  size: number
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string
  archivedAt: string | null
  revision: number
  integrity: "ready" | "missing_bytes"
}>

export type LocalLibraryMediaMetadata = Omit<
  WorkspaceLibraryMediaMetadata,
  "catalogVersion"
>

type ProjectionFailureReason =
  | "unverifiable_use_case"
  | "invalid_curated_source"
  | "local_asset_archived"
  | "local_asset_missing_bytes"
  | "local_asset_missing_dimensions"

export class LibraryCatalogProjectionError extends Error {
  readonly code = "library_catalog_projection_failed"

  constructor(
    readonly reason: ProjectionFailureReason,
    message: string
  ) {
    super(message)
    this.name = "LibraryCatalogProjectionError"
  }
}

export function projectDesignTemplateSummary(
  item: DesignTemplateCatalogItem,
  options: DesignTemplateLibraryProjectionOptions = {}
): LibraryTemplateSummary {
  const useCaseIds = verifiedUseCaseIds(
    item.manifest.useCaseIds,
    options.useCaseIds ?? item.manifest.useCaseIds
  )
  const previewPage = item.previewDocument.pages.find(
    (page) => page.id === item.previewPageId
  )
  if (!previewPage) {
    throw new LibraryCatalogProjectionError(
      "invalid_curated_source",
      `Template ${item.id}@${item.version} has no matching preview page`
    )
  }
  const dimensions = item.dimensions.map(({ width, height }) => ({
    width,
    height,
  }))
  return libraryTemplateSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "template",
    id: item.id,
    version: item.version,
    templateKind: item.kind,
    name: item.name,
    description: item.description,
    categoryId: normalizeCatalogToken(item.category),
    useCaseIds,
    formatFamily: normalizeCatalogToken(item.manifest.formatFamily),
    orientation: orientationForDimensions(dimensions),
    dimensions,
    pageCount: item.pageCount,
    tags: normalizedValues(item.tags),
    owner: { kind: "studio" },
    permissions: options.permissions ?? defaultPermissions,
    provenance: {
      sourceName: item.manifest.provenance.sourceName,
      sourceUrl: item.manifest.provenance.sourceUrl,
      license: {
        id: item.manifest.provenance.license.id,
        name: item.manifest.provenance.license.name,
        url: item.manifest.provenance.license.url,
      },
      attribution: item.manifest.provenance.attribution,
      contentSha256: item.manifest.provenance.contentSha256,
    },
    compatibility: {
      availability:
        item.kind === "quotation_style" ? "requires_source" : "available",
      requirements: item.kind === "quotation_style" ? ["quotation_source"] : [],
      supportedActions: ["create", "apply"],
      reason: null,
    },
    preview:
      options.preview ??
      livePreview(
        item.id,
        item.version,
        previewPage.width,
        previewPage.height,
        {
          pageId: previewPage.id,
        }
      ),
    preferences: options.preferences ?? noPreferences,
    catalogStatus: item.catalogStatus ?? "active",
    curatedRank: options.curatedRank ?? null,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
  })
}

export function projectDesignTemplateDetail(
  item: DesignTemplateCatalogItem,
  options: DesignTemplateLibraryProjectionOptions = {}
): LibraryTemplateDetail {
  const summary = projectDesignTemplateSummary(item, options)
  return libraryTemplateDetailSchema.parse({
    schemaVersion: 1,
    summary,
    materialization: {
      repository: "design_template",
      templateId: item.id,
      templateVersion: item.version,
      sourceContext: item.kind === "quotation_style" ? "quotation" : "none",
    },
  })
}

export function projectCuratedMediaSummary(
  asset: CuratedLibraryMediaSource,
  options: CuratedLibraryMediaProjectionOptions = {}
): LibraryMediaSummary {
  return libraryMediaSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "media",
    id: asset.id,
    version: asset.version,
    mediaSource: "curated",
    name: asset.name,
    description: asset.description,
    categoryId: normalizeCatalogToken(asset.categoryId),
    useCaseIds: normalizedValues(asset.useCaseIds),
    formatFamily: normalizeCatalogToken(asset.formatFamily),
    orientation: orientationForDimensions([asset]),
    mimeType: asset.mimeType,
    dimensions: { width: asset.width, height: asset.height },
    bytes: asset.bytes,
    selectable: (options.permissions ?? defaultPermissions).canUse,
    tags: normalizedValues(asset.tags),
    owner: { kind: "studio" },
    permissions: options.permissions ?? defaultPermissions,
    provenance: asset.provenance,
    compatibility: mediaCompatibility(),
    preview:
      options.preview ??
      livePreview(asset.id, asset.version, asset.width, asset.height),
    preferences: options.preferences ?? noPreferences,
    catalogStatus: "active",
    curatedRank: options.curatedRank ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  })
}

export function projectCuratedMediaDetail(
  asset: CuratedLibraryMediaSource,
  options: CuratedLibraryMediaProjectionOptions
): LibraryMediaDetail {
  const summary = projectCuratedMediaSummary(asset, options)
  return libraryMediaDetailSchema.parse({
    schemaVersion: 1,
    summary,
    selectionIdentity: {
      source: "curated",
      assetId: summary.id,
      version: summary.version,
    },
  })
}

export function projectPublicMediaSummary(
  asset: PublicMediaAsset,
  metadata: WorkspaceLibraryMediaMetadata
): LibraryMediaSummary {
  return libraryMediaSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "media",
    id: asset.id,
    version: metadata.catalogVersion,
    mediaSource: "managed",
    name: asset.name,
    description: metadata.description,
    categoryId: normalizeCatalogToken(metadata.categoryId),
    useCaseIds: normalizedValues(metadata.useCaseIds),
    formatFamily: normalizeCatalogToken(metadata.formatFamily),
    orientation: orientationForDimensions([asset]),
    mimeType: asset.mediaType,
    dimensions: { width: asset.width, height: asset.height },
    bytes: asset.bytes,
    selectable: (metadata.permissions ?? defaultPermissions).canUse,
    tags: normalizedValues(metadata.tags),
    owner: { kind: "workspace" },
    permissions: metadata.permissions ?? defaultPermissions,
    provenance: metadata.provenance,
    compatibility: mediaCompatibility(),
    preview:
      metadata.preview ??
      livePreview(asset.id, metadata.catalogVersion, asset.width, asset.height),
    preferences: metadata.preferences ?? {
      favorite: false,
      lastUsedAt: asset.lastUsedAt,
      collectionIds: [],
    },
    catalogStatus: "active",
    curatedRank: metadata.curatedRank ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  })
}

export function projectPublicMediaDetail(
  asset: PublicMediaAsset,
  metadata: WorkspaceLibraryMediaMetadata
): LibraryMediaDetail {
  const summary = projectPublicMediaSummary(asset, metadata)
  return libraryMediaDetailSchema.parse({
    schemaVersion: 1,
    summary,
    selectionIdentity: {
      source: "managed",
      assetId: summary.id,
      catalogVersion: summary.version,
      refetch: "required",
    },
  })
}

export function projectLocalMediaSummary(
  asset: LocalLibraryMediaSource,
  metadata: LocalLibraryMediaMetadata
): LibraryMediaSummary {
  assertProjectableLocalAsset(asset)
  return libraryMediaSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "media",
    id: asset.id,
    version: asset.revision,
    mediaSource: "local",
    name: asset.name,
    description: metadata.description,
    categoryId: normalizeCatalogToken(metadata.categoryId),
    useCaseIds: normalizedValues(metadata.useCaseIds),
    formatFamily: normalizeCatalogToken(metadata.formatFamily),
    orientation: orientationForDimensions([
      { width: asset.width!, height: asset.height! },
    ]),
    mimeType: asset.mediaType,
    dimensions: { width: asset.width, height: asset.height },
    bytes: asset.size,
    selectable: (metadata.permissions ?? defaultPermissions).canUse,
    tags: normalizedValues(metadata.tags),
    owner: { kind: "workspace" },
    permissions: metadata.permissions ?? defaultPermissions,
    provenance: metadata.provenance,
    compatibility: mediaCompatibility(),
    preview:
      metadata.preview ??
      livePreview(asset.id, asset.revision, asset.width!, asset.height!),
    preferences: metadata.preferences ?? {
      favorite: false,
      lastUsedAt: asset.lastUsedAt,
      collectionIds: [],
    },
    catalogStatus: "active",
    curatedRank: metadata.curatedRank ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  })
}

export function projectLocalMediaDetail(
  asset: LocalLibraryMediaSource,
  metadata: LocalLibraryMediaMetadata
): LibraryMediaDetail {
  const summary = projectLocalMediaSummary(asset, metadata)
  return libraryMediaDetailSchema.parse({
    schemaVersion: 1,
    summary,
    selectionIdentity: {
      source: "local",
      assetId: summary.id,
      revision: asset.revision,
    },
  })
}

function verifiedUseCaseIds(
  sourceTags: readonly string[],
  requested: readonly string[]
) {
  const tags = new Set(normalizedValues(sourceTags))
  const useCaseIds = normalizedValues(requested)
  const unverified = useCaseIds.find((useCaseId) => !tags.has(useCaseId))
  if (unverified) {
    throw new LibraryCatalogProjectionError(
      "unverifiable_use_case",
      `Use case ${unverified} does not exist in the source metadata`
    )
  }
  return useCaseIds
}

function normalizedValues(values: readonly string[]) {
  return [...new Set(values.map(normalizeCatalogToken))]
}

function normalizeCatalogToken(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!normalized) {
    throw new LibraryCatalogProjectionError(
      "invalid_curated_source",
      "Catalog metadata contains an empty normalized identity"
    )
  }
  return normalized
}

function orientationForDimensions(
  dimensions: readonly { width: number; height: number }[]
) {
  const values = new Set(
    dimensions.map(({ width, height }) =>
      width === height ? "square" : width > height ? "landscape" : "portrait"
    )
  )
  return values.size === 1
    ? ([...values][0] as "portrait" | "landscape" | "square")
    : ("mixed" as const)
}

function livePreview(
  itemId: string,
  itemVersion: number,
  width: number,
  height: number,
  options: { pageId?: string } = {}
): LibraryPreviewDescriptor {
  return {
    kind: "live_fallback",
    itemId,
    itemVersion,
    pageId: options.pageId ?? null,
    width,
    height,
    resourcePath: null,
    mediaType: null,
    contentSha256: null,
    rendererRevision: null,
  }
}

function mediaCompatibility() {
  return {
    availability: "available" as const,
    requirements: [],
    supportedActions: ["insert", "replace", "assign_field"] as const,
    reason: null,
  }
}

function assertProjectableLocalAsset(
  asset: LocalLibraryMediaSource
): asserts asset is LocalLibraryMediaSource & {
  width: number
  height: number
} {
  if (asset.archivedAt) {
    throw new LibraryCatalogProjectionError(
      "local_asset_archived",
      `Local media ${asset.id} is archived`
    )
  }
  if (asset.integrity !== "ready") {
    throw new LibraryCatalogProjectionError(
      "local_asset_missing_bytes",
      `Local media ${asset.id} has no verified bytes`
    )
  }
  if (!asset.width || !asset.height) {
    throw new LibraryCatalogProjectionError(
      "local_asset_missing_dimensions",
      `Local media ${asset.id} has no verified dimensions`
    )
  }
}
