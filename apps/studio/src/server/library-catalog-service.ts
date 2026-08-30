import {
  LibraryCatalogIndex,
  libraryCatalogItemDetailSchema,
  libraryCatalogQuerySchema,
} from "@webmcp/document"
import type {
  LibraryCatalogItemDetail,
  LibraryCatalogItemSummary,
  LibraryCatalogPage,
  LibraryCatalogQueryInput,
  LibraryPreferenceState,
} from "@webmcp/document"
import {
  STUDIO_LIBRARY_CATALOG_REVISION,
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogSummaries,
} from "../content/library/catalog"

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

type LibraryCatalogServiceOptions = Readonly<{
  baseCatalogRevision?: string
  baseSummaries?: readonly LibraryCatalogItemSummary[]
  resolveBaseDetail?: (
    itemKind: LibraryCatalogItemSummary["itemKind"],
    id: string,
    version: number
  ) => LibraryCatalogItemDetail | null
}>

const identityKey = (identity: {
  itemKind: LibraryCatalogItemSummary["itemKind"]
  id: string
  version: number
}) => `${identity.itemKind}:${identity.id}@${identity.version}`

const compactProjection = (preference: LibraryPreferenceState | undefined) =>
  preference
    ? {
        favorite: preference.favorite,
        lastUsedAt: preference.lastUsedAt,
        collectionIds: [...preference.collectionIds],
      }
    : { favorite: false, lastUsedAt: null, collectionIds: [] }

export class LibraryCatalogService {
  readonly #preferences: LibraryPreferenceProjectionReader
  readonly #baseCatalogRevision: string
  readonly #baseSummaries: readonly LibraryCatalogItemSummary[]
  readonly #resolveBaseDetail: NonNullable<
    LibraryCatalogServiceOptions["resolveBaseDetail"]
  >

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
  }

  async list(
    workspaceId: string,
    principalId: string,
    input: LibraryCatalogQueryInput
  ): Promise<LibraryCatalogServiceListResult> {
    const query = libraryCatalogQuerySchema.parse(input)
    const projection = await this.#preferences.readProjection(
      workspaceId,
      principalId
    )
    const index = this.#projectedIndex(projection)
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
    const base = this.#resolveBaseDetail(itemKind, id, version)
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
          byIdentity.get(identityKey(base.summary))
        ),
      },
    })
    return { workspaceRevision: projection.workspaceRevision, detail }
  }

  #projectedIndex(projection: LibraryPreferenceProjectionSnapshot) {
    const byIdentity = this.#preferenceMap(projection.preferences)
    const summaries = this.#baseSummaries.map((summary) => ({
      ...summary,
      preferences: compactProjection(byIdentity.get(identityKey(summary))),
    }))
    return new LibraryCatalogIndex(
      `${this.#baseCatalogRevision}:w${projection.workspaceRevision}`,
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
