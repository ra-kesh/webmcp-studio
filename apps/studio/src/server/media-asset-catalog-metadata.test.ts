import { describe, expect, it } from "vitest"
import {
  defaultManagedMediaCatalogMetadata,
  normalizeManagedMediaCatalogMetadataUpdate,
} from "./media-asset-catalog-metadata"
import type { ManagedMediaCatalogMetadata } from "./media-asset-catalog-metadata"

const currentMetadata = (): ManagedMediaCatalogMetadata => ({
  description: defaultManagedMediaCatalogMetadata.description,
  tags: [...defaultManagedMediaCatalogMetadata.tags],
  categoryId: defaultManagedMediaCatalogMetadata.categoryId,
  useCaseIds: [...defaultManagedMediaCatalogMetadata.useCaseIds],
  provenance: structuredClone(defaultManagedMediaCatalogMetadata.provenance),
  catalogVersion: 1,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
})

describe("managed media catalog metadata", () => {
  it("uses honest workspace-upload defaults without claiming a public license", () => {
    expect(defaultManagedMediaCatalogMetadata).toMatchObject({
      description: "Customer-provided workspace upload",
      categoryId: "workspace-upload",
      provenance: {
        sourceName: "Workspace upload",
        sourceUrl: null,
        license: {
          id: "customer-provided",
          name: "Customer-provided; rights not verified",
          url: null,
        },
        attribution: { required: false, text: null },
      },
    })
  })

  it("normalizes searchable tags, categories, use cases, and prose", () => {
    expect(
      normalizeManagedMediaCatalogMetadataUpdate(
        {
          description: "  A   team\n portrait  ",
          tags: [" Team Portrait ", "team-portrait", "Café"],
          categoryId: " People & Portraits ",
          useCaseIds: [" About Page ", "profile"],
        },
        currentMetadata()
      )
    ).toMatchObject({
      description: "A team portrait",
      tags: ["cafe", "team-portrait"],
      categoryId: "people-portraits",
      useCaseIds: ["about-page", "profile"],
    })
  })

  it("rejects unverifiable provenance and unsupported source URLs", () => {
    const metadata = currentMetadata()
    expect(() =>
      normalizeManagedMediaCatalogMetadataUpdate(
        {
          provenance: {
            ...metadata.provenance,
            sourceUrl: "file:///private/source.png",
          },
        },
        metadata
      )
    ).toThrow("valid HTTP or HTTPS URL")
    expect(() =>
      normalizeManagedMediaCatalogMetadataUpdate(
        {
          provenance: {
            ...metadata.provenance,
            attribution: { required: true, text: null },
          },
        },
        metadata
      )
    ).toThrow("Required attribution")
  })
})
