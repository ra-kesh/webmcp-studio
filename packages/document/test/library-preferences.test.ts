import { describe, expect, it } from "vitest"
import {
  LIBRARY_COLLECTION_LIMIT,
  LIBRARY_COLLECTION_MEMBER_LIMIT,
  LIBRARY_ITEM_COLLECTION_LIMIT,
  libraryAddCollectionMemberReceiptSchema,
  libraryAddCollectionMemberRequestSchema,
  libraryCatalogDetailResponseSchema,
  libraryCatalogListResponseSchema,
  libraryCollectionDetailResponseSchema,
  libraryCollectionDetailSchema,
  libraryCollectionListResponseSchema,
  libraryCollectionMutationResponseSchema,
  libraryCollectionNameSchema,
  libraryCompletedActionSchema,
  libraryCreateCollectionReceiptSchema,
  libraryCreateCollectionRequestSchema,
  libraryDeleteCollectionReceiptSchema,
  libraryDeleteCollectionRequestSchema,
  libraryItemIdentitySchema,
  libraryPreferenceMutationResponseSchema,
  libraryPreferenceSnapshotResponseSchema,
  libraryPreferenceSnapshotSchema,
  libraryPreferenceStateSchema,
  libraryRecordUseReceiptSchema,
  libraryRecordUseRequestSchema,
  libraryRemoveCollectionMemberReceiptSchema,
  libraryRemoveCollectionMemberRequestSchema,
  libraryRenameCollectionReceiptSchema,
  libraryRenameCollectionRequestSchema,
  libraryReorderCollectionMembersReceiptSchema,
  libraryReorderCollectionMembersRequestSchema,
  librarySetFavoriteReceiptSchema,
  librarySetFavoriteRequestSchema,
  libraryTemplateDetailSchema,
  libraryTemplateSummarySchema,
  parseLibraryCollectionReorderRequest,
} from "../src"

const createdAt = "2026-08-31T10:00:00.000Z"
const updatedAt = "2026-08-31T11:00:00.000Z"
const identity = {
  itemKind: "template",
  id: "proposal-starter",
  version: 2,
} as const
const secondIdentity = {
  itemKind: "media",
  id: "editorial-grid",
  version: 1,
} as const

const preference = () =>
  libraryPreferenceStateSchema.parse({
    identity,
    favorite: true,
    lastUsedAt: updatedAt,
    collectionIds: ["collection-client-work"],
    revision: 3,
    updatedAt,
  })

const collection = (members = [identity, secondIdentity], revision = 4) =>
  libraryCollectionDetailSchema.parse({
    summary: {
      id: "collection-client-work",
      name: "Client work",
      scope: "workspace",
      revision,
      itemCount: members.length,
      createdAt,
      updatedAt,
    },
    members,
  })

const templateDetail = () => {
  const summary = libraryTemplateSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "template",
    id: identity.id,
    version: identity.version,
    templateKind: "document_starter",
    name: "Proposal starter",
    description: "A polished client proposal.",
    categoryId: "documents",
    useCaseIds: ["proposal"],
    formatFamily: "document",
    orientation: "portrait",
    dimensions: [{ width: 1240, height: 1754 }],
    pageCount: 1,
    tags: ["proposal"],
    owner: { kind: "studio" },
    permissions: {
      canView: true,
      canUse: true,
      canFavorite: true,
      canAddToCollection: true,
    },
    provenance: {
      sourceName: "Studio originals",
      sourceUrl: null,
      license: { id: "studio-internal", name: "Studio internal", url: null },
      attribution: { required: false, text: null },
      contentSha256: null,
    },
    compatibility: {
      availability: "available",
      requirements: [],
      supportedActions: ["create"],
      reason: null,
    },
    preview: {
      kind: "live_fallback",
      itemId: identity.id,
      itemVersion: identity.version,
      pageId: "proposal-page",
      width: 310,
      height: 438,
      resourcePath: null,
      mediaType: null,
      contentSha256: null,
      rendererRevision: null,
    },
    preferences: {
      favorite: true,
      lastUsedAt: updatedAt,
      collectionIds: ["collection-client-work"],
    },
    catalogStatus: "active",
    curatedRank: 1,
    createdAt,
    updatedAt,
  })
  return libraryTemplateDetailSchema.parse({
    schemaVersion: 1,
    summary,
    materialization: {
      repository: "design_template",
      templateId: identity.id,
      templateVersion: identity.version,
      sourceContext: "none",
    },
  })
}

const catalogPage = () => ({
  schemaVersion: 1 as const,
  catalogRevision: "catalog-r1:w8",
  generation: "browse-1",
  queryIdentity: "libq_0123456789abcdef",
  items: [],
  nextCursor: null,
  total: 0,
})

describe("library preference identity and state contracts", () => {
  it("accepts only exact immutable identities and strict state", () => {
    expect(libraryItemIdentitySchema.parse(identity)).toEqual(identity)
    expect(
      libraryItemIdentitySchema.safeParse({ ...identity, version: 0 }).success
    ).toBe(false)
    expect(
      libraryItemIdentitySchema.safeParse({ ...identity, privatePath: "/r2" })
        .success
    ).toBe(false)
    expect(
      libraryPreferenceStateSchema.safeParse({
        ...preference(),
        collectionIds: [
          ...Array.from(
            { length: LIBRARY_ITEM_COLLECTION_LIMIT },
            (_, index) => `collection-${index + 1}`
          ),
          "collection-over-limit",
        ],
      }).success
    ).toBe(false)
    expect(
      libraryPreferenceStateSchema.safeParse({
        ...preference(),
        collectionIds: ["collection-client-work", "collection-client-work"],
      }).success
    ).toBe(false)
  })

  it("normalizes bounded visible collection names and rejects controls", () => {
    expect(libraryCollectionNameSchema.parse("  Client\n\t work  ")).toBe(
      "Client work"
    )
    expect(libraryCollectionNameSchema.safeParse(" \n\t ").success).toBe(false)
    expect(libraryCollectionNameSchema.safeParse("\u200D").success).toBe(false)
    expect(libraryCollectionNameSchema.safeParse("\u200C").success).toBe(false)
    expect(libraryCollectionNameSchema.safeParse("\u200D\u200C").success).toBe(
      false
    )
    expect(libraryCollectionNameSchema.safeParse("\uFE0E").success).toBe(false)
    expect(libraryCollectionNameSchema.safeParse("\uFE0F").success).toBe(false)
    expect(libraryCollectionNameSchema.safeParse("a".repeat(101)).success).toBe(
      false
    )
    expect(
      libraryCollectionNameSchema.safeParse("Client\u0000work").success
    ).toBe(false)
    expect(
      libraryCollectionNameSchema.safeParse("✨".repeat(100)).success
    ).toBe(true)
    const family = "👨‍👩‍👧‍👦"
    expect(
      libraryCollectionNameSchema.safeParse(family.repeat(100)).success
    ).toBe(true)
    expect(
      libraryCollectionNameSchema.safeParse(family.repeat(101)).success
    ).toBe(false)
  })

  it("rejects preference timestamps that claim future use", () => {
    expect(
      libraryPreferenceStateSchema.safeParse({
        ...preference(),
        lastUsedAt: "2026-08-31T12:00:00.000Z",
        updatedAt: "2026-08-31T11:00:00.000Z",
      }).success
    ).toBe(false)
  })

  it("rejects duplicate identities, inconsistent counts, and duplicate snapshot rows", () => {
    expect(
      libraryCollectionDetailSchema.safeParse({
        ...collection(),
        members: [identity, identity],
      }).success
    ).toBe(false)
    expect(
      libraryCollectionDetailSchema.safeParse({
        ...collection(),
        summary: { ...collection().summary, itemCount: 1 },
      }).success
    ).toBe(false)
    expect(
      libraryPreferenceSnapshotSchema.safeParse({
        workspaceRevision: 8,
        preferences: [preference(), preference()],
        collections: [collection().summary],
      }).success
    ).toBe(false)
    expect(
      libraryPreferenceSnapshotSchema.safeParse({
        workspaceRevision: 8,
        preferences: [
          {
            ...preference(),
            collectionIds: ["collection-missing"],
          },
        ],
        collections: [collection().summary],
      }).success
    ).toBe(false)
    expect(
      libraryPreferenceSnapshotSchema.safeParse({
        workspaceRevision: 8,
        preferences: [],
        collections: [
          collection().summary,
          {
            ...collection().summary,
            id: "collection-client-work-copy",
            name: "  CLIENT   WORK ",
          },
        ],
      }).success
    ).toBe(false)
    expect(
      libraryPreferenceSnapshotSchema.safeParse({
        workspaceRevision: 8,
        preferences: [preference()],
        collections: [collection().summary, collection().summary],
      }).success
    ).toBe(false)
    expect(
      libraryCollectionDetailSchema.safeParse({
        summary: {
          ...collection().summary,
          itemCount: LIBRARY_COLLECTION_MEMBER_LIMIT + 1,
        },
        members: [],
      }).success
    ).toBe(false)
  })
})

describe("library preference mutation contracts", () => {
  const requestCases = [
    [librarySetFavoriteRequestSchema, { schemaVersion: 1, favorite: false }],
    [
      libraryRecordUseRequestSchema,
      {
        schemaVersion: 1,
        completedAction: "create",
        completionId: "document-1",
      },
    ],
    [
      libraryCreateCollectionRequestSchema,
      { schemaVersion: 1, name: "Moodboards" },
    ],
    [
      libraryRenameCollectionRequestSchema,
      { schemaVersion: 1, name: "Campaign" },
    ],
    [libraryDeleteCollectionRequestSchema, { schemaVersion: 1 }],
    [libraryAddCollectionMemberRequestSchema, { schemaVersion: 1 }],
    [libraryRemoveCollectionMemberRequestSchema, { schemaVersion: 1 }],
    [
      libraryReorderCollectionMembersRequestSchema,
      { schemaVersion: 1, orderedIdentities: [secondIdentity, identity] },
    ],
  ] as const

  it("strictly parses every request body and limits completed actions", () => {
    for (const [schema, request] of requestCases) {
      expect(schema.safeParse(request).success).toBe(true)
      expect(schema.safeParse({ ...request, unknown: true }).success).toBe(
        false
      )
    }
    expect(libraryCompletedActionSchema.options).toEqual([
      "create",
      "insert",
      "replace",
      "assign_field",
    ])
    for (const completedAction of libraryCompletedActionSchema.options) {
      expect(
        libraryRecordUseRequestSchema.safeParse({
          schemaVersion: 1,
          completedAction,
          completionId: "document-1",
        }).success
      ).toBe(true)
    }
    for (const unsupportedAction of ["apply", "delete"]) {
      expect(
        libraryRecordUseRequestSchema.safeParse({
          schemaVersion: 1,
          completedAction: unsupportedAction,
          completionId: "document-1",
        }).success
      ).toBe(false)
    }
  })

  it("accepts only a duplicate-free exact reorder permutation", () => {
    const current = [identity, secondIdentity]
    expect(
      parseLibraryCollectionReorderRequest(
        { schemaVersion: 1, orderedIdentities: [secondIdentity, identity] },
        current
      ).orderedIdentities
    ).toEqual([secondIdentity, identity])
    expect(() =>
      parseLibraryCollectionReorderRequest(
        { schemaVersion: 1, orderedIdentities: [identity, identity] },
        current
      )
    ).toThrow()
    expect(() =>
      parseLibraryCollectionReorderRequest(
        { schemaVersion: 1, orderedIdentities: [identity] },
        current
      )
    ).toThrow("exact permutation")
    expect(() =>
      parseLibraryCollectionReorderRequest(
        {
          schemaVersion: 1,
          orderedIdentities: [identity, { ...secondIdentity, version: 2 }],
        },
        current
      )
    ).toThrow("exact permutation")
  })

  it("strictly parses each exact receipt", () => {
    const detail = collection()
    const createdDetail = collection([], 1)
    const removedDetail = collection([secondIdentity])
    const receipts = [
      [
        librarySetFavoriteReceiptSchema,
        {
          schemaVersion: 1,
          operation: "set_favorite",
          preference: preference(),
          workspaceRevision: 8,
        },
      ],
      [
        libraryRecordUseReceiptSchema,
        {
          schemaVersion: 1,
          operation: "record_used",
          completedAction: "assign_field",
          completionId: "field-assignment-1",
          preference: preference(),
          workspaceRevision: 8,
        },
      ],
      [
        libraryCreateCollectionReceiptSchema,
        collectionReceipt("create_collection", createdDetail),
      ],
      [
        libraryRenameCollectionReceiptSchema,
        collectionReceipt("rename_collection", detail),
      ],
      [
        libraryDeleteCollectionReceiptSchema,
        {
          schemaVersion: 1,
          operation: "delete_collection",
          collectionId: detail.summary.id,
          deletedRevision: detail.summary.revision,
          workspaceRevision: 8,
        },
      ],
      [
        libraryAddCollectionMemberReceiptSchema,
        { ...collectionReceipt("add_collection_member", detail), identity },
      ],
      [
        libraryRemoveCollectionMemberReceiptSchema,
        {
          ...collectionReceipt("remove_collection_member", removedDetail),
          identity,
        },
      ],
      [
        libraryReorderCollectionMembersReceiptSchema,
        collectionReceipt("reorder_collection_members", detail),
      ],
    ] as const

    for (const [schema, receipt] of receipts) {
      expect(schema.safeParse(receipt).success).toBe(true)
      expect(schema.safeParse({ ...receipt, unknown: true }).success).toBe(
        false
      )
    }
  })

  it("rejects semantically impossible successful receipts", () => {
    expect(
      libraryCreateCollectionReceiptSchema.safeParse(
        collectionReceipt("create_collection", collection())
      ).success
    ).toBe(false)
    expect(
      libraryAddCollectionMemberReceiptSchema.safeParse({
        ...collectionReceipt(
          "add_collection_member",
          collection([secondIdentity])
        ),
        identity,
      }).success
    ).toBe(false)
    expect(
      libraryRemoveCollectionMemberReceiptSchema.safeParse({
        ...collectionReceipt("remove_collection_member", collection()),
        identity,
      }).success
    ).toBe(false)
    expect(
      libraryRecordUseReceiptSchema.safeParse({
        schemaVersion: 1,
        operation: "record_used",
        completedAction: "create",
        completionId: "document-1",
        preference: { ...preference(), lastUsedAt: null },
        workspaceRevision: 8,
      }).success
    ).toBe(false)
  })
})

describe("library preference response envelopes", () => {
  it("strictly parses every response envelope", () => {
    const detail = collection()
    const snapshot = {
      workspaceRevision: 8,
      preferences: [preference()],
      collections: [detail.summary],
    }
    const preferenceReceipt = {
      schemaVersion: 1,
      operation: "set_favorite",
      preference: preference(),
      workspaceRevision: 8,
    }
    const collectionMutationReceipt = collectionReceipt(
      "rename_collection",
      detail
    )
    const responseCases = [
      [
        libraryCatalogListResponseSchema,
        { schemaVersion: 1, workspaceRevision: 8, page: catalogPage() },
      ],
      [
        libraryCatalogDetailResponseSchema,
        { schemaVersion: 1, workspaceRevision: 8, detail: templateDetail() },
      ],
      [libraryPreferenceSnapshotResponseSchema, { schemaVersion: 1, snapshot }],
      [
        libraryPreferenceMutationResponseSchema,
        { schemaVersion: 1, receipt: preferenceReceipt },
      ],
      [
        libraryCollectionListResponseSchema,
        {
          schemaVersion: 1,
          workspaceRevision: 8,
          collections: [detail.summary],
        },
      ],
      [
        libraryCollectionDetailResponseSchema,
        { schemaVersion: 1, workspaceRevision: 8, collection: detail },
      ],
      [
        libraryCollectionMutationResponseSchema,
        { schemaVersion: 1, receipt: collectionMutationReceipt },
      ],
    ] as const

    for (const [schema, response] of responseCases) {
      expect(schema.safeParse(response).success).toBe(true)
      expect(schema.safeParse({ ...response, privateData: true }).success).toBe(
        false
      )
    }
  })

  it("enforces the collection-count limit in snapshots and lists", () => {
    const collections = Array.from(
      { length: LIBRARY_COLLECTION_LIMIT + 1 },
      (_, index) => ({
        ...collection([]).summary,
        id: `collection-${index + 1}`,
      })
    )
    expect(
      libraryPreferenceSnapshotSchema.safeParse({
        workspaceRevision: 1,
        preferences: [],
        collections,
      }).success
    ).toBe(false)
    expect(
      libraryCollectionListResponseSchema.safeParse({
        schemaVersion: 1,
        workspaceRevision: 1,
        collections,
      }).success
    ).toBe(false)
  })
})

function collectionReceipt(
  operation:
    | "create_collection"
    | "rename_collection"
    | "add_collection_member"
    | "remove_collection_member"
    | "reorder_collection_members",
  detail: ReturnType<typeof collection>
) {
  return {
    schemaVersion: 1 as const,
    operation,
    collection: detail,
    workspaceRevision: 8,
  }
}
