import {
  LibraryCatalogIndex,
  libraryCatalogItemDetailSchema,
  libraryCatalogQuerySchema,
  projectPublicMediaDetail,
  projectPublicMediaSummary,
} from "@webmcp/document"
import type {
  LibraryCatalogItemDetail,
  LibraryCatalogItemSummary,
  LibraryCatalogPage,
  LibraryCatalogQueryInput,
  LibraryPermissionProjection,
  LibraryPreferenceState,
} from "@webmcp/document"
import {
  STUDIO_LIBRARY_CATALOG_REVISION,
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogSummaries,
} from "../content/library/catalog"
import type {
  ManagedMediaCatalogEntry,
  ManagedMediaLibraryCatalogSnapshot,
} from "./media-asset-repository"

export type LibraryPreferenceProjectionSnapshot = Readonly<{
  workspaceRevision: number
  preferences: readonly LibraryPreferenceState[]
}>

export type LibraryPreferenceProjectionReader = Readonly<{
  readProjection: (
    workspaceId: string,
    principalId: string
  ) => Promise<LibraryPreferenceProjectionSnapshot>
}>

export type LibraryCatalogServiceListResult = Readonly<{
  workspaceRevision: number
  page: LibraryCatalogPage
}>

export type LibraryCatalogServiceDetailResult = Readonly<{
  workspaceRevision: number
  detail: LibraryCatalogItemDetail
}>

export type ManagedMediaLibraryCatalogReader = Readonly<{
  readRevision: (workspaceId: string) => Promise<number>
  readSnapshot: (
    workspaceId: string
  ) => Promise<ManagedMediaLibraryCatalogSnapshot>
  getExact: (
    workspaceId: string,
    assetId: string,
    catalogVersion: number
  ) => Promise<ManagedMediaCatalogEntry | null>
}>

type LibraryCatalogServiceOptions = Readonly<{
  baseCatalogRevision?: string
  baseSummaries?: readonly LibraryCatalogItemSummary[]
  resolveBaseDetail?: (
    itemKind: LibraryCatalogItemSummary["itemKind"],
    id: string,
    version: number
  ) => LibraryCatalogItemDetail | null
  managedMedia?: ManagedMediaLibraryCatalogReader
}>

const identityKey = (identity: {
  itemKind: LibraryCatalogItemSummary["itemKind"]
  id: string
  version: number
}) => `${identity.itemKind}:${identity.id}@${identity.version}`

const compactProjection = (
  preference: LibraryPreferenceState | undefined,
  permissions: LibraryPermissionProjection
) =>
  preference
    ? {
        favorite: permissions.canFavorite ? preference.favorite : false,
        lastUsedAt: preference.lastUsedAt,
        collectionIds: permissions.canAddToCollection
          ? [...preference.collectionIds]
          : [],
      }
    : { favorite: false, lastUsedAt: null, collectionIds: [] }

const emptyManagedSnapshot: ManagedMediaLibraryCatalogSnapshot = {
  entries: [],
  catalogRevision: 0,
}

const managedProjectionMetadata = (
  entry: ManagedMediaCatalogEntry,
  preferences: LibraryMediaPreferenceProjection
) => ({
  catalogVersion: entry.metadata.catalogVersion,
  description: entry.metadata.description,
  categoryId: entry.metadata.categoryId,
  useCaseIds: entry.metadata.useCaseIds,
  formatFamily: "image",
  tags: entry.metadata.tags,
  provenance: {
    ...entry.metadata.provenance,
    contentSha256: null,
  },
  preferences,
})

type LibraryMediaPreferenceProjection = ReturnType<typeof compactProjection>

const managedAssetForProjection = (entry: ManagedMediaCatalogEntry) => ({
  ...entry.asset,
  updatedAt:
    entry.metadata.updatedAt > entry.asset.updatedAt
      ? entry.metadata.updatedAt
      : entry.asset.updatedAt,
})

export class LibraryCatalogService {
  readonly #preferences: LibraryPreferenceProjectionReader
  readonly #baseCatalogRevision: string
  readonly #baseSummaries: readonly LibraryCatalogItemSummary[]
  readonly #resolveBaseDetail: NonNullable<
    LibraryCatalogServiceOptions["resolveBaseDetail"]
  >
  readonly #managedMedia: ManagedMediaLibraryCatalogReader | null

  constructor(
    preferences: LibraryPreferenceProjectionReader,
    options: LibraryCatalogServiceOptions = {}
  ) {
    this.#preferences = preferences
    this.#baseCatalogRevision =
      options.baseCatalogRevision ?? STUDIO_LIBRARY_CATALOG_REVISION
    this.#baseSummaries = options.baseSummaries ?? studioLibraryCatalogSummaries
    this.#resolveBaseDetail =
      options.resolveBaseDetail ??
      ((itemKind, id, version) =>
        itemKind === "template"
          ? getStudioLibraryCatalogDetail("template", id, version)
          : getStudioLibraryCatalogDetail("media", id, version))
    this.#managedMedia = options.managedMedia ?? null
  }

  async list(
    workspaceId: string,
    principalId: string,
    input: LibraryCatalogQueryInput
  ): Promise<LibraryCatalogServiceListResult> {
    const query = libraryCatalogQuerySchema.parse(input)
    const managedRead = query.itemKinds.includes("media")
      ? (this.#managedMedia?.readSnapshot(workspaceId) ?? emptyManagedSnapshot)
      : this.#managedMedia
        ? this.#managedMedia
            .readRevision(workspaceId)
            .then((catalogRevision) => ({
              entries: [],
              catalogRevision,
            }))
        : emptyManagedSnapshot
    const [projection, managed] = await Promise.all([
      this.#preferences.readProjection(workspaceId, principalId),
      managedRead,
    ])
    const index = this.#projectedIndex(projection, managed)
    return {
      workspaceRevision: projection.workspaceRevision,
      page: index.list(query),
    }
  }

  async getDetail(
    workspaceId: string,
    principalId: string,
    itemKind: LibraryCatalogItemSummary["itemKind"],
    id: string,
    version: number
  ): Promise<LibraryCatalogServiceDetailResult | null> {
    let base = this.#resolveBaseDetail(itemKind, id, version)
    if (!base && itemKind === "media" && this.#managedMedia) {
      const entry = await this.#managedMedia.getExact(workspaceId, id, version)
      if (entry) {
        base = projectPublicMediaDetail(
          managedAssetForProjection(entry),
          managedProjectionMetadata(entry, {
            favorite: false,
            lastUsedAt: null,
            collectionIds: [],
          })
        )
      }
    }
    if (!base) return null
    const projection = await this.#preferences.readProjection(
      workspaceId,
      principalId
    )
    const byIdentity = this.#preferenceMap(projection.preferences)
    const detail = libraryCatalogItemDetailSchema.parse({
      ...base,
      summary: {
        ...base.summary,
        preferences: compactProjection(
          byIdentity.get(identityKey(base.summary)),
          base.summary.permissions
        ),
      },
    })
    return { workspaceRevision: projection.workspaceRevision, detail }
  }

  #projectedIndex(
    projection: LibraryPreferenceProjectionSnapshot,
    managed: ManagedMediaLibraryCatalogSnapshot
  ) {
    const byIdentity = this.#preferenceMap(projection.preferences)
    const managedSummaries = managed.entries.map((entry) => {
      const preference = byIdentity.get(
        identityKey({
          itemKind: "media",
          id: entry.asset.id,
          version: entry.metadata.catalogVersion,
        })
      )
      return projectPublicMediaSummary(
        managedAssetForProjection(entry),
        managedProjectionMetadata(
          entry,
          compactProjection(preference, {
            canView: true,
            canUse: true,
            canFavorite: true,
            canAddToCollection: true,
          })
        )
      )
    })
    const summaries = [
      ...this.#baseSummaries.map((summary) => ({
        ...summary,
        preferences: compactProjection(
          byIdentity.get(identityKey(summary)),
          summary.permissions
        ),
      })),
      ...managedSummaries,
    ]
    return new LibraryCatalogIndex(
      `${this.#baseCatalogRevision}:w${projection.workspaceRevision}:m${managed.catalogRevision}`,
      summaries
    )
  }

  #preferenceMap(preferences: readonly LibraryPreferenceState[]) {
    return new Map(
      preferences.map((preference) => [
        identityKey(preference.identity),
        preference,
      ])
    )
  }
}
