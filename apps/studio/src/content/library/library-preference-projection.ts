import type {
  LibraryCollectionSummary,
  LibraryPreferenceProjection,
  LibraryTemplateSummary,
} from "@webmcp/document"
import type { LibraryPreferenceStateOwner } from "./library-preference-controller"

const emptyPreference = (): LibraryPreferenceProjection => ({
  favorite: false,
  lastUsedAt: null,
  collectionIds: [],
})

const identityKey = (
  identity: Readonly<{
    itemKind: "template" | "media"
    id: string
    version: number
  }>
) => `${identity.itemKind}:${identity.id}@${identity.version}`

const sameProjection = (
  left: LibraryPreferenceProjection | null,
  right: LibraryPreferenceProjection
) =>
  left?.favorite === right.favorite &&
  left.lastUsedAt === right.lastUsedAt &&
  left.collectionIds.length === right.collectionIds.length &&
  left.collectionIds.every(
    (collectionId, index) => collectionId === right.collectionIds[index]
  )

/**
 * Resolves the current principal's preference for one immutable catalog item.
 * Discovery remains untouched: optimistic state is projected only for render.
 */
export type EffectiveLibraryPreferenceInput = Readonly<{
  item: LibraryTemplateSummary
  preferenceState: Pick<
    LibraryPreferenceStateOwner,
    "snapshot" | "snapshotStatus"
  >
  discoveryWorkspaceRevision: number
}>

export function effectiveLibraryPreference({
  item,
  preferenceState,
  discoveryWorkspaceRevision,
}: EffectiveLibraryPreferenceInput): LibraryPreferenceProjection | null {
  const snapshot = preferenceState.snapshot
  if (!snapshot) {
    return preferenceState.snapshotStatus === "ready"
      ? emptyPreference()
      : item.preferences
  }
  if (snapshot.workspaceRevision < discoveryWorkspaceRevision) {
    return item.preferences
  }

  const key = identityKey(item)
  const preference = snapshot.preferences.find(
    ({ identity }) => identityKey(identity) === key
  )
  if (!preference) return emptyPreference()
  return {
    favorite: item.permissions.canFavorite ? preference.favorite : false,
    lastUsedAt: preference.lastUsedAt,
    collectionIds: item.permissions.canAddToCollection
      ? preference.collectionIds
      : [],
  }
}

export type LibraryTemplatePreferenceProjectionInput = Readonly<{
  items: readonly LibraryTemplateSummary[]
  preferenceState: Pick<
    LibraryPreferenceStateOwner,
    "snapshot" | "snapshotStatus"
  >
  discoveryWorkspaceRevision: number
}>

export function projectLibraryTemplatePreferences({
  items,
  preferenceState,
  discoveryWorkspaceRevision,
}: LibraryTemplatePreferenceProjectionInput): readonly LibraryTemplateSummary[] {
  return items.map((item) => {
    const preferences = effectiveLibraryPreference({
      item,
      preferenceState,
      discoveryWorkspaceRevision,
    })
    return preferences && sameProjection(item.preferences, preferences)
      ? item
      : { ...item, preferences }
  })
}

export function projectLibraryCollectionOptions(
  state: Pick<LibraryPreferenceStateOwner, "snapshot">
): readonly Readonly<{ id: string; label: string }>[] {
  return (state.snapshot?.collections ?? []).map(
    (collection: LibraryCollectionSummary) => ({
      id: collection.id,
      label: collection.name,
    })
  )
}
