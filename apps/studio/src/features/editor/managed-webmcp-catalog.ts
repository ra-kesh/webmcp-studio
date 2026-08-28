import { managedAssetSource, mediaAssetIdSchema } from "@webmcp/document"
import type { MediaAssetLookup } from "@webmcp/document"
import type {
  StudioWebMcpAsset,
  StudioWebMcpAssetSearchInput,
  StudioWebMcpAssetSearchPage,
} from "@webmcp/webmcp"
import type { StudioAsset } from "./asset-catalog"
import { getManagedMedia, listManagedMedia } from "./managed-media-repository"

type CatalogCursor = {
  version: 1
  query: string
  orientation: StudioWebMcpAssetSearchInput["orientation"] | null
  tags: readonly string[]
  builtInOffset: number
  managedCursor: string | null
  managedStarted: boolean
}

const orientationFor = (width: number, height: number) => {
  const ratio = width / height
  if (Math.abs(ratio - 1) <= 0.08) return "square" as const
  return ratio > 1 ? ("landscape" as const) : ("portrait" as const)
}

const encodeCursor = (cursor: CatalogCursor) =>
  btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

const decodeCursor = (
  encoded: string,
  input: StudioWebMcpAssetSearchInput
): CatalogCursor => {
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/")
    const value = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
    ) as Partial<CatalogCursor>
    if (
      value.version !== 1 ||
      value.query !== input.query ||
      value.orientation !== (input.orientation ?? null) ||
      JSON.stringify(value.tags) !== JSON.stringify(input.tags) ||
      !Number.isInteger(value.builtInOffset) ||
      Number(value.builtInOffset) < 0 ||
      (value.managedCursor !== null &&
        typeof value.managedCursor !== "string") ||
      typeof value.managedStarted !== "boolean"
    ) {
      throw new Error("cursor_mismatch")
    }
    return value as CatalogCursor
  } catch {
    throw new Error("Asset search cursor is invalid for this query.")
  }
}

const builtInAsset = (asset: StudioAsset): StudioWebMcpAsset => ({
  ...asset,
  ownership: "built_in",
  selectable: true,
})

const workspaceAsset = (asset: MediaAssetLookup): StudioWebMcpAsset => ({
  id: asset.id,
  name: asset.name,
  tags: [],
  width: asset.width,
  height: asset.height,
  ownership: "workspace",
  selectable: asset.selectable,
  src: managedAssetSource(asset.id),
})

const readyWorkspaceAsset = (
  asset: Awaited<ReturnType<typeof listManagedMedia>>["assets"][number]
): StudioWebMcpAsset => ({
  id: asset.id,
  name: asset.name,
  tags: [],
  width: asset.width,
  height: asset.height,
  ownership: "workspace",
  selectable: true,
  src: managedAssetSource(asset.id),
})

const matchingBuiltIns = (
  assets: readonly StudioAsset[],
  input: StudioWebMcpAssetSearchInput
) => {
  const tokens = input.query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return assets
    .flatMap((asset, position) => {
      const tags = asset.tags.map((tag) => tag.toLocaleLowerCase())
      if (
        input.orientation &&
        orientationFor(asset.width, asset.height) !== input.orientation
      ) {
        return []
      }
      if (input.tags.some((tag) => !tags.includes(tag))) return []
      const name = asset.name.toLocaleLowerCase()
      const description = asset.description.toLocaleLowerCase()
      const score = tokens.reduce((total, token) => {
        if (name.includes(token)) return total + 6
        if (tags.some((tag) => tag.includes(token))) return total + 3
        if (description.includes(token)) return total + 1
        return total
      }, 0)
      if (tokens.length > 0 && score === 0) return []
      return [{ asset: builtInAsset(asset), position, score }]
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.position - right.position
    )
    .map(({ asset }) => asset)
}

export type ManagedWebMcpCatalog = {
  search: (
    input: StudioWebMcpAssetSearchInput
  ) => Promise<StudioWebMcpAssetSearchPage>
  resolve: (assetId: string) => Promise<StudioWebMcpAsset | null>
  dispose: () => void
}

export function createManagedWebMcpCatalog(
  builtIns: readonly StudioAsset[]
): ManagedWebMcpCatalog {
  const builtInById = new Map(
    builtIns.map((asset) => [asset.id, builtInAsset(asset)])
  )
  const pendingResolutions = new Map<
    string,
    Promise<StudioWebMcpAsset | null>
  >()

  return {
    async search(input) {
      const builtInMatches = matchingBuiltIns(builtIns, input)
      const state = input.cursor
        ? decodeCursor(input.cursor, input)
        : {
            version: 1 as const,
            query: input.query,
            orientation: input.orientation ?? null,
            tags: input.tags,
            builtInOffset: 0,
            managedCursor: null,
            managedStarted: false,
          }
      const assets = builtInMatches.slice(
        state.builtInOffset,
        state.builtInOffset + input.limit
      )
      const builtInOffset = state.builtInOffset + assets.length
      let managedCursor = state.managedCursor
      let managedStarted = state.managedStarted

      if (builtInOffset >= builtInMatches.length && input.tags.length === 0) {
        while (assets.length < input.limit) {
          const page = await listManagedMedia({
            collection: "uploads",
            query: input.query,
            cursor: managedStarted ? (managedCursor ?? undefined) : undefined,
            limit: input.limit - assets.length,
          })
          managedStarted = true
          managedCursor = page.nextCursor
          for (const item of page.assets) {
            const asset = readyWorkspaceAsset(item)
            if (
              !input.orientation ||
              orientationFor(asset.width, asset.height) === input.orientation
            ) {
              assets.push(asset)
            }
          }
          if (!managedCursor) break
        }
      }

      const hasMoreBuiltIns = builtInOffset < builtInMatches.length
      const canStartManaged = input.tags.length === 0 && !managedStarted
      const hasMoreManaged = Boolean(managedCursor) || canStartManaged
      return {
        assets,
        nextCursor:
          hasMoreBuiltIns || hasMoreManaged
            ? encodeCursor({
                version: 1,
                query: input.query,
                orientation: input.orientation ?? null,
                tags: input.tags,
                builtInOffset,
                managedCursor,
                managedStarted,
              })
            : null,
      }
    },

    async resolve(assetId) {
      const builtIn = builtInById.get(assetId)
      if (builtIn) return builtIn
      if (!mediaAssetIdSchema.safeParse(assetId).success) return null
      const existing = pendingResolutions.get(assetId)
      if (existing) return existing
      const pending = getManagedMedia(assetId)
        .then((managed) => (managed ? workspaceAsset(managed) : null))
        .finally(() => {
          if (pendingResolutions.get(assetId) === pending) {
            pendingResolutions.delete(assetId)
          }
        })
      pendingResolutions.set(assetId, pending)
      return pending
    },

    dispose() {
      pendingResolutions.clear()
    },
  }
}
