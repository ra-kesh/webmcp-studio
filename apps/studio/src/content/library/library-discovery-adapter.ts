import type {
  LibraryCatalogItemDetail,
  LibraryCatalogItemSummary,
  LibraryCatalogQueryInput,
} from "@webmcp/document"
import {
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogIndex,
} from "./catalog"
import { libraryTaxonomySchema } from "./discovery-controller"
import type {
  LibraryDiscoveryDependencies,
  LibraryTaxonomy,
} from "./discovery-controller"

export type StudioLibraryDiscoveryAdapter = Pick<
  LibraryDiscoveryDependencies,
  "list" | "getDetail" | "getTaxonomy"
>

export type StudioLibraryDiscoveryAdapterOptions = Readonly<{
  scheduleAsyncBoundary?: () => Promise<void>
}>

export class StudioLibraryDetailNotFoundError extends Error {
  readonly code = "library_detail_not_found"

  constructor(
    readonly itemKind: "template" | "media",
    readonly itemId: string,
    readonly itemVersion: number
  ) {
    super(`Library ${itemKind} ${itemId}@${itemVersion} was not found.`)
    this.name = "StudioLibraryDetailNotFoundError"
  }
}

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const throwIfAborted = (signal: AbortSignal) => {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("The library request was aborted.", "AbortError")
}

const titleLabel = (id: string) => {
  const words = id.split(/[-_]/).map((word) => {
    if (word.toLowerCase() === "a4") return "A4"
    if (/^\d+x\d+$/i.test(word)) return word.toLowerCase().replace("x", ":")
    return word.toLowerCase()
  })
  const label = words.join(" ")
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

const optionsFor = (ids: Iterable<string>) =>
  [...new Set(ids)]
    .sort((left, right) => (left === right ? 0 : left < right ? -1 : 1))
    .map((id) => ({ id, label: titleLabel(id) }))

const collectCompleteActiveCatalog = () => {
  const items: LibraryCatalogItemSummary[] = []
  const identities = new Set<string>()
  let cursor: string | null = null
  let expectedTotal: number | null = null
  do {
    const page = studioLibraryCatalogIndex.list({
      generation: "studio-library-taxonomy-v1",
      limit: 50,
      cursor,
    })
    expectedTotal ??= page.total
    if (page.total !== expectedTotal) {
      throw new Error("Library catalog changed while taxonomy was projected.")
    }
    for (const item of page.items) {
      const identity = `${item.itemKind}:${item.id}@${item.version}`
      if (identities.has(identity)) {
        throw new Error(`Duplicate library taxonomy item: ${identity}`)
      }
      identities.add(identity)
      items.push(item)
    }
    cursor = page.nextCursor
  } while (cursor)
  if (items.length !== expectedTotal) {
    throw new Error(
      `Library taxonomy expected ${expectedTotal} items but projected ${items.length}.`
    )
  }
  return items
}

const completeActiveCatalog = collectCompleteActiveCatalog()

const studioLibraryTaxonomy: LibraryTaxonomy = immutable(
  libraryTaxonomySchema.parse({
    schemaVersion: 1,
    categories: optionsFor(
      completeActiveCatalog.map((item) => item.categoryId)
    ),
    useCases: optionsFor(
      completeActiveCatalog.flatMap((item) => item.useCaseIds)
    ),
    formatFamilies: optionsFor(
      completeActiveCatalog.map((item) => item.formatFamily)
    ),
    orientations: [
      { id: "portrait", label: "Portrait" },
      { id: "landscape", label: "Landscape" },
      { id: "square", label: "Square" },
      { id: "mixed", label: "Mixed" },
    ],
    owners: [
      { id: "studio", label: "Studio" },
      { id: "workspace", label: "Your workspace" },
    ],
  })
)

const defaultAsyncBoundary = () => Promise.resolve()

export function createStudioLibraryDiscoveryAdapter(
  options: StudioLibraryDiscoveryAdapterOptions = {}
): StudioLibraryDiscoveryAdapter {
  const scheduleAsyncBoundary =
    options.scheduleAsyncBoundary ?? defaultAsyncBoundary

  const runAsync = async <TValue>(
    signal: AbortSignal,
    lookup: () => TValue
  ) => {
    throwIfAborted(signal)
    await scheduleAsyncBoundary()
    throwIfAborted(signal)
    const value = lookup()
    throwIfAborted(signal)
    await scheduleAsyncBoundary()
    throwIfAborted(signal)
    return value
  }

  return Object.freeze({
    list(query: LibraryCatalogQueryInput, signal: AbortSignal) {
      return runAsync(signal, () => studioLibraryCatalogIndex.list(query))
    },
    getDetail(
      itemKind: "template" | "media",
      id: string,
      version: number,
      signal: AbortSignal
    ): Promise<LibraryCatalogItemDetail> {
      return runAsync(signal, () => {
        const detail =
          itemKind === "template"
            ? getStudioLibraryCatalogDetail("template", id, version)
            : getStudioLibraryCatalogDetail("media", id, version)
        if (!detail) {
          throw new StudioLibraryDetailNotFoundError(itemKind, id, version)
        }
        return detail
      })
    },
    getTaxonomy() {
      return studioLibraryTaxonomy
    },
  })
}

export const studioLibraryDiscoveryAdapter =
  createStudioLibraryDiscoveryAdapter()
