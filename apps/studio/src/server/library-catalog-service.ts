import {
  LibraryCatalogIndex,
  libraryCatalogItemDetailSchema,
  libraryCatalogQuerySchema,
  libraryItemIdentityKey,
  projectPublicMediaDetail,
  projectPublicMediaSummary,
} from "@webmcp/document"
import type {
  LibraryCatalogItemDetail,
  LibraryCatalogItemSummary,
  LibraryCatalogPage,
  LibraryCatalogQueryInput,
  LibraryPermissionProjection,
  LibraryItemIdentity,
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
  getCurrent: (
    workspaceId: string,
    assetId: string
  ) => Promise<ManagedMediaCatalogEntry | null>
}>

type LibraryCatalogServiceOptions = Readonly<{
  baseCatalogRevision?: string
  baseSummaries?: readonly LibraryCatalogItemSummary[]
  resolveBaseDetail?: (
    identity: LibraryItemIdentity
  ) => LibraryCatalogItemDetail | null
  managedMedia?: ManagedMediaLibraryCatalogReader
}>

const identityKey = libraryItemIdentityKey

const identityForSummary = (
  summary: LibraryCatalogItemSummary
): LibraryItemIdentity =>
  summary.itemKind === "media"
    ? {
        itemKind: "media",
        id: summary.id,
        version: summary.version,
        mediaSource: summary.mediaSource,
      }
    : { itemKind: "template", id: summary.id, version: summary.version }

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
      ((identity) =>
        identity.itemKind === "template"
          ? getStudioLibraryCatalogDetail(
              "template",
              identity.id,
              identity.version
            )
          : getStudioLibraryCatalogDetail(
              "media",
              identity.id,
              identity.version,
              identity.mediaSource
            ))
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
    identity: LibraryItemIdentity
  ): Promise<LibraryCatalogServiceDetailResult | null> {
    let base = this.#resolveBaseDetail(identity)
    if (
      !base &&
      identity.itemKind === "media" &&
      identity.mediaSource === "managed" &&
      this.#managedMedia
    ) {
      const entry = await this.#managedMedia.getExact(
        workspaceId,
        identity.id,
        identity.version
      )
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
          byIdentity.get(identityKey(identityForSummary(base.summary))),
          base.summary.permissions
        ),
      },
    })
    return { workspaceRevision: projection.workspaceRevision, detail }
  }

  async getCurrentManagedDetail(
    workspaceId: string,
    principalId: string,
    assetId: string
  ): Promise<LibraryCatalogServiceDetailResult | null> {
    if (!this.#managedMedia) return null
    const current = await this.#managedMedia.getCurrent(workspaceId, assetId)
    if (!current) return null
    return this.getDetail(workspaceId, principalId, {
      itemKind: "media",
      id: current.asset.id,
      version: current.metadata.catalogVersion,
      mediaSource: "managed",
    })
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
          mediaSource: "managed",
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
          byIdentity.get(
            identityKey(
              summary.itemKind === "media"
                ? {
                    itemKind: "media",
                    id: summary.id,
                    version: summary.version,
                    mediaSource: summary.mediaSource,
                  }
                : {
                    itemKind: "template",
                    id: summary.id,
                    version: summary.version,
                  }
            )
          ),
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
