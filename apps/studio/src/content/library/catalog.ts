import {
  LibraryCatalogIndex,
  builtInDesignTemplateRepository,
  projectCuratedMediaDetail,
  projectCuratedMediaSummary,
  projectDesignTemplateDetail,
  projectDesignTemplateSummary,
} from "@webmcp/document"
import type {
  LibraryCatalogItemSummary,
  LibraryMediaDetail,
  LibraryMediaSummary,
  LibraryTemplateDetail,
} from "@webmcp/document"
import { studioMediaManifest } from "./media/manifest"
import { getStudioTemplatePreviewDescriptor } from "./templates/preview-manifest"

type StudioLibraryCatalogDetail = LibraryTemplateDetail | LibraryMediaDetail

const activeTemplates = builtInDesignTemplateRepository.list()

const projectedTemplates = activeTemplates.map((template, curatedRank) => {
  const preview = getStudioTemplatePreviewDescriptor(
    template.id,
    template.version
  )
  return {
    summary: projectDesignTemplateSummary(template, { curatedRank, preview }),
    detail: projectDesignTemplateDetail(template, { curatedRank, preview }),
  }
})

const projectedMedia = studioMediaManifest.map((media, mediaIndex) => {
  const curatedRank = activeTemplates.length + mediaIndex
  return {
    summary: projectCuratedMediaSummary(media, { curatedRank }),
    detail: projectCuratedMediaDetail(media, { curatedRank }),
  }
})

const projectedItems = [...projectedTemplates, ...projectedMedia]

export const studioLibraryCatalogSummaries = deepFreeze(
  projectedItems.map(({ summary }) => summary)
)

export const STUDIO_LIBRARY_CATALOG_REVISION = revisionFor(
  projectedItems.map(({ summary }) => summary)
)

export const studioLibraryCatalogIndex = new LibraryCatalogIndex(
  STUDIO_LIBRARY_CATALOG_REVISION,
  studioLibraryCatalogSummaries
)

const detailByIdentity = new Map<string, StudioLibraryCatalogDetail>(
  projectedItems.map(({ summary, detail }) => [
    identityFor(summary),
    deepFreeze(detail),
  ])
)

const latestDetailIdentity = new Map<
  string,
  Readonly<{ version: number; identity: string }>
>()
for (const { summary } of projectedItems) {
  const latestKey =
    summary.itemKind === "media"
      ? `media:${summary.mediaSource}:${summary.id}`
      : `template:${summary.id}`
  const current = latestDetailIdentity.get(latestKey)
  if (!current || summary.version > current.version) {
    latestDetailIdentity.set(latestKey, {
      version: summary.version,
      identity: identityFor(summary),
    })
  }
}

export function getStudioLibraryCatalogDetail(
  itemKind: "template",
  id: string,
  version?: number
): LibraryTemplateDetail | null
export function getStudioLibraryCatalogDetail(
  itemKind: "media",
  id: string,
  version?: number,
  mediaSource?: LibraryMediaSummary["mediaSource"]
): LibraryMediaDetail | null
export function getStudioLibraryCatalogDetail(
  itemKind: LibraryCatalogItemSummary["itemKind"],
  id: string,
  version?: number,
  mediaSource: LibraryMediaSummary["mediaSource"] = "curated"
): StudioLibraryCatalogDetail | null {
  if (itemKind === "media" && mediaSource !== "curated") return null
  const identity =
    version === undefined
      ? latestDetailIdentity.get(
          itemKind === "media" ? `media:${mediaSource}:${id}` : `template:${id}`
        )?.identity
      : itemKind === "media"
        ? identityFor({ itemKind, id, version, mediaSource })
        : identityFor({ itemKind, id, version })
  return identity ? (detailByIdentity.get(identity) ?? null) : null
}

function identityFor(
  item:
    | Pick<LibraryCatalogItemSummary, "itemKind" | "id" | "version">
    | Pick<LibraryMediaSummary, "itemKind" | "id" | "version" | "mediaSource">
) {
  return item.itemKind === "media"
    ? `media:${(item as Pick<LibraryMediaSummary, "mediaSource">).mediaSource}:${item.id}@${item.version}`
    : `template:${item.id}@${item.version}`
}

function revisionFor(items: readonly LibraryCatalogItemSummary[]) {
  const identity = items
    .map(
      (item) =>
        `${identityFor(item)}:${item.provenance.contentSha256 ?? "unhashed"}`
    )
    .sort()
    .join("|")
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= BigInt(identity.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `studio-library-${hash.toString(16).padStart(16, "0")}`
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
