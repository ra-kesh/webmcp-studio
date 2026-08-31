export class ManagedMediaCatalogError extends Error {
  constructor(
    readonly code:
      | "invalid_asset_catalog_metadata"
      | "invalid_asset_catalog_version"
      | "asset_catalog_version_mismatch",
    readonly status: 400 | 412,
    message: string
  ) {
    super(message)
    this.name = "ManagedMediaCatalogError"
  }
}

export type ManagedMediaCatalogProvenance = {
  sourceName: string
  sourceUrl: string | null
  license: {
    id: string
    name: string
    url: string | null
  }
  attribution: {
    required: boolean
    text: string | null
  }
}

export type ManagedMediaCatalogMetadata = {
  description: string
  tags: string[]
  categoryId: string
  useCaseIds: string[]
  provenance: ManagedMediaCatalogProvenance
  catalogVersion: number
  createdAt: string
  updatedAt: string
}

export type ManagedMediaCatalogMetadataUpdate = Partial<{
  description: string
  tags: readonly string[]
  categoryId: string
  useCaseIds: readonly string[]
  provenance: ManagedMediaCatalogProvenance
}>

export const defaultManagedMediaCatalogMetadata = Object.freeze({
  description: "Customer-provided workspace upload",
  tags: Object.freeze([]),
  categoryId: "workspace-upload",
  useCaseIds: Object.freeze([]),
  provenance: Object.freeze({
    sourceName: "Workspace upload",
    sourceUrl: null,
    license: Object.freeze({
      id: "customer-provided",
      name: "Customer-provided; rights not verified",
      url: null,
    }),
    attribution: Object.freeze({ required: false, text: null }),
  }),
})

const invalidMetadata = (message: string) =>
  new ManagedMediaCatalogError("invalid_asset_catalog_metadata", 400, message)

const normalizedText = (value: string, maximum: number, label: string) => {
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ")
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  if (!normalized || normalized.length > maximum || hasControlCharacter) {
    throw invalidMetadata(`${label} must contain 1-${maximum} characters`)
  }
  return normalized
}

const normalizedCatalogToken = (value: string, label: string) => {
  const normalized = value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!normalized || normalized.length > 200) {
    throw invalidMetadata(`${label} must produce a 1-200 character catalog ID`)
  }
  return normalized
}

const normalizedCatalogValues = (
  values: readonly string[],
  maximum: number,
  label: string
) => {
  if (values.length > maximum) {
    throw invalidMetadata(`${label} cannot contain more than ${maximum} values`)
  }
  return [
    ...new Set(values.map((value) => normalizedCatalogToken(value, label))),
  ].sort()
}

const normalizedPublicUrl = (value: string | null, label: string) => {
  if (value === null) return null
  const normalized = value.trim()
  if (normalized.length > 2_048) {
    throw invalidMetadata(`${label} cannot exceed 2048 characters`)
  }
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw invalidMetadata(`${label} must be a valid HTTP or HTTPS URL`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidMetadata(`${label} must be a valid HTTP or HTTPS URL`)
  }
  return parsed.toString()
}

const normalizedProvenance = (
  provenance: ManagedMediaCatalogProvenance
): ManagedMediaCatalogProvenance => {
  const attributionText = provenance.attribution.text
    ? normalizedText(provenance.attribution.text, 500, "Attribution")
    : null
  if (provenance.attribution.required && !attributionText) {
    throw invalidMetadata("Required attribution must include display text")
  }
  return {
    sourceName: normalizedText(provenance.sourceName, 200, "Source name"),
    sourceUrl: normalizedPublicUrl(provenance.sourceUrl, "Source URL"),
    license: {
      id: normalizedCatalogToken(provenance.license.id, "License ID"),
      name: normalizedText(provenance.license.name, 200, "License name"),
      url: normalizedPublicUrl(provenance.license.url, "License URL"),
    },
    attribution: {
      required: provenance.attribution.required,
      text: attributionText,
    },
  }
}

export function normalizeManagedMediaCatalogMetadataUpdate(
  update: ManagedMediaCatalogMetadataUpdate,
  current: ManagedMediaCatalogMetadata
): Omit<
  ManagedMediaCatalogMetadata,
  "catalogVersion" | "createdAt" | "updatedAt"
> {
  return {
    description:
      update.description === undefined
        ? current.description
        : normalizedText(update.description, 1_000, "Description"),
    tags:
      update.tags === undefined
        ? [...current.tags]
        : normalizedCatalogValues(update.tags, 50, "Tags"),
    categoryId:
      update.categoryId === undefined
        ? current.categoryId
        : normalizedCatalogToken(update.categoryId, "Category"),
    useCaseIds:
      update.useCaseIds === undefined
        ? [...current.useCaseIds]
        : normalizedCatalogValues(update.useCaseIds, 30, "Use cases"),
    provenance:
      update.provenance === undefined
        ? current.provenance
        : normalizedProvenance(update.provenance),
  }
}

export function managedMediaCatalogMetadataEqual(
  left: Omit<
    ManagedMediaCatalogMetadata,
    "catalogVersion" | "createdAt" | "updatedAt"
  >,
  right: Omit<
    ManagedMediaCatalogMetadata,
    "catalogVersion" | "createdAt" | "updatedAt"
  >
) {
  const searchableFields = (
    value: Omit<
      ManagedMediaCatalogMetadata,
      "catalogVersion" | "createdAt" | "updatedAt"
    >
  ) => ({
    description: value.description,
    tags: value.tags,
    categoryId: value.categoryId,
    useCaseIds: value.useCaseIds,
    provenance: value.provenance,
  })
  return (
    JSON.stringify(searchableFields(left)) ===
    JSON.stringify(searchableFields(right))
  )
}
