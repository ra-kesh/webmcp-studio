import { z } from "zod"
import {
  catalogIdSchema,
  libraryCatalogItemDetailSchema,
  libraryCatalogPageSchema,
} from "./library-catalog"

export const LIBRARY_COLLECTION_LIMIT = 100
export const LIBRARY_ITEM_COLLECTION_LIMIT = 100
export const LIBRARY_COLLECTION_MEMBER_LIMIT = 500
export const LIBRARY_COLLECTION_NAME_MAX_CHARACTERS = 100

const dateTimeSchema = z.iso.datetime()
const workspaceRevisionSchema = z.number().int().nonnegative()
const preferenceRevisionSchema = z.number().int().nonnegative()
const collectionRevisionSchema = z.number().int().positive()

const identityKey = (identity: LibraryItemIdentity) =>
  `${identity.itemKind}:${identity.id}@${identity.version}`

const rejectDuplicateIdentities = (
  identities: readonly LibraryItemIdentity[],
  context: z.RefinementCtx
) => {
  const seen = new Set<string>()
  for (const [index, identity] of identities.entries()) {
    const key = identityKey(identity)
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: "Library item identities must be unique",
      })
    }
    seen.add(key)
  }
}

const rejectDuplicateStrings = (
  values: readonly string[],
  context: z.RefinementCtx,
  message: string
) => {
  const seen = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({ code: "custom", path: [index], message })
    }
    seen.add(value)
  }
}

const normalizeCollectionName = (value: string) =>
  value.trim().replace(/\s+/gu, " ")

const countGraphemeClusters = (value: string) =>
  [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
    .length

export const libraryCollectionNameSchema = z
  .string()
  .transform(normalizeCollectionName)
  .pipe(
    z
      .string()
      .min(1)
      .refine(
        (value) =>
          value.replace(/\p{Default_Ignorable_Code_Point}/gu, "").trim()
            .length > 0,
        "Collection names must contain at least one visible character"
      )
      .refine(
        (value) =>
          countGraphemeClusters(value) <=
          LIBRARY_COLLECTION_NAME_MAX_CHARACTERS,
        `Collection names must contain at most ${LIBRARY_COLLECTION_NAME_MAX_CHARACTERS} visible characters`
      )
      .refine(
        (value) =>
          !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(
            value.replace(/[\u200C\u200D]/gu, "")
          ),
        "Collection names cannot contain control characters"
      )
  )

export const libraryCollectionIdSchema = catalogIdSchema.refine(
  (value) => /^collection-[A-Za-z0-9][A-Za-z0-9._:-]{0,188}$/.test(value),
  "Collection IDs must use the collection- prefix"
)

export const libraryItemIdentitySchema = z
  .object({
    itemKind: z.enum(["template", "media"]),
    id: catalogIdSchema,
    version: z.number().int().positive(),
  })
  .strict()

export type LibraryItemIdentity = z.infer<typeof libraryItemIdentitySchema>

const collectionIdsSchema = z
  .array(libraryCollectionIdSchema)
  .max(LIBRARY_ITEM_COLLECTION_LIMIT)
  .superRefine((ids, context) =>
    rejectDuplicateStrings(ids, context, "Collection IDs must be unique")
  )

export const libraryPreferenceStateSchema = z
  .object({
    identity: libraryItemIdentitySchema,
    favorite: z.boolean(),
    lastUsedAt: dateTimeSchema.nullable(),
    collectionIds: collectionIdsSchema,
    revision: preferenceRevisionSchema,
    updatedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((preference, context) => {
    if (
      preference.lastUsedAt !== null &&
      preference.lastUsedAt > preference.updatedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["lastUsedAt"],
        message: "Preference lastUsedAt cannot follow updatedAt",
      })
    }
  })

export type LibraryPreferenceState = z.infer<
  typeof libraryPreferenceStateSchema
>

export const libraryCollectionSummarySchema = z
  .object({
    id: libraryCollectionIdSchema,
    name: libraryCollectionNameSchema,
    scope: z.literal("workspace"),
    revision: collectionRevisionSchema,
    itemCount: z
      .number()
      .int()
      .nonnegative()
      .max(LIBRARY_COLLECTION_MEMBER_LIMIT),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((collection, context) => {
    if (collection.updatedAt < collection.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Collection updatedAt cannot precede createdAt",
      })
    }
  })

export type LibraryCollectionSummary = z.infer<
  typeof libraryCollectionSummarySchema
>

const collectionMembersSchema = z
  .array(libraryItemIdentitySchema)
  .max(LIBRARY_COLLECTION_MEMBER_LIMIT)
  .superRefine(rejectDuplicateIdentities)

export const libraryCollectionDetailSchema = z
  .object({
    summary: libraryCollectionSummarySchema,
    members: collectionMembersSchema,
  })
  .strict()
  .superRefine((collection, context) => {
    if (collection.summary.itemCount !== collection.members.length) {
      context.addIssue({
        code: "custom",
        path: ["summary", "itemCount"],
        message: "Collection itemCount must match its ordered members",
      })
    }
  })

export type LibraryCollectionDetail = z.infer<
  typeof libraryCollectionDetailSchema
>

const preferenceStatesSchema = z
  .array(libraryPreferenceStateSchema)
  .superRefine((states, context) =>
    rejectDuplicateIdentities(
      states.map(({ identity }) => identity),
      context
    )
  )

const collectionSummariesSchema = z
  .array(libraryCollectionSummarySchema)
  .max(LIBRARY_COLLECTION_LIMIT)
  .superRefine((collections, context) => {
    rejectDuplicateStrings(
      collections.map(({ id }) => id),
      context,
      "Collection IDs must be unique"
    )
    rejectDuplicateStrings(
      collections.map(({ name }) => name.toLowerCase()),
      context,
      "Collection names must be unique after normalization"
    )
  })

export const libraryPreferenceSnapshotSchema = z
  .object({
    workspaceRevision: workspaceRevisionSchema,
    preferences: preferenceStatesSchema,
    collections: collectionSummariesSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const collectionIds = new Set(
      snapshot.collections.map((collection) => collection.id)
    )
    for (const [
      preferenceIndex,
      preference,
    ] of snapshot.preferences.entries()) {
      for (const [
        collectionIndex,
        collectionId,
      ] of preference.collectionIds.entries()) {
        if (collectionIds.has(collectionId)) continue
        context.addIssue({
          code: "custom",
          path: [
            "preferences",
            preferenceIndex,
            "collectionIds",
            collectionIndex,
          ],
          message: "Preference references an unknown collection",
        })
      }
    }
  })

export type LibraryPreferenceSnapshot = z.infer<
  typeof libraryPreferenceSnapshotSchema
>

export const librarySetFavoriteRequestSchema = z
  .object({ schemaVersion: z.literal(1), favorite: z.boolean() })
  .strict()

export const libraryRecordUseRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    completedAction: z.enum(["create", "insert", "replace"]),
    completionId: catalogIdSchema,
  })
  .strict()

export const libraryCreateCollectionRequestSchema = z
  .object({ schemaVersion: z.literal(1), name: libraryCollectionNameSchema })
  .strict()

export const libraryRenameCollectionRequestSchema = z
  .object({ schemaVersion: z.literal(1), name: libraryCollectionNameSchema })
  .strict()

export const libraryDeleteCollectionRequestSchema = z
  .object({ schemaVersion: z.literal(1) })
  .strict()

export const libraryAddCollectionMemberRequestSchema = z
  .object({ schemaVersion: z.literal(1) })
  .strict()

export const libraryRemoveCollectionMemberRequestSchema = z
  .object({ schemaVersion: z.literal(1) })
  .strict()

export const libraryReorderCollectionMembersRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderedIdentities: collectionMembersSchema,
  })
  .strict()

export type LibrarySetFavoriteRequest = z.infer<
  typeof librarySetFavoriteRequestSchema
>
export type LibraryRecordUseRequest = z.infer<
  typeof libraryRecordUseRequestSchema
>
export type LibraryCreateCollectionRequest = z.infer<
  typeof libraryCreateCollectionRequestSchema
>
export type LibraryRenameCollectionRequest = z.infer<
  typeof libraryRenameCollectionRequestSchema
>
export type LibraryDeleteCollectionRequest = z.infer<
  typeof libraryDeleteCollectionRequestSchema
>
export type LibraryAddCollectionMemberRequest = z.infer<
  typeof libraryAddCollectionMemberRequestSchema
>
export type LibraryRemoveCollectionMemberRequest = z.infer<
  typeof libraryRemoveCollectionMemberRequestSchema
>
export type LibraryReorderCollectionMembersRequest = z.infer<
  typeof libraryReorderCollectionMembersRequestSchema
>

const preferenceReceiptFields = {
  schemaVersion: z.literal(1),
  preference: libraryPreferenceStateSchema,
  workspaceRevision: workspaceRevisionSchema,
}

export const librarySetFavoriteReceiptSchema = z
  .object({ ...preferenceReceiptFields, operation: z.literal("set_favorite") })
  .strict()

export const libraryRecordUseReceiptSchema = z
  .object({
    ...preferenceReceiptFields,
    operation: z.literal("record_used"),
    completedAction: z.enum(["create", "insert", "replace"]),
    completionId: catalogIdSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.preference.lastUsedAt !== null) return
    context.addIssue({
      code: "custom",
      path: ["preference", "lastUsedAt"],
      message: "A record-used receipt must include lastUsedAt",
    })
  })

export const libraryPreferenceMutationReceiptSchema = z.discriminatedUnion(
  "operation",
  [librarySetFavoriteReceiptSchema, libraryRecordUseReceiptSchema]
)

const collectionReceiptFields = {
  schemaVersion: z.literal(1),
  collection: libraryCollectionDetailSchema,
  workspaceRevision: workspaceRevisionSchema,
}

export const libraryCreateCollectionReceiptSchema = z
  .object({
    ...collectionReceiptFields,
    operation: z.literal("create_collection"),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.collection.summary.revision !== 1) {
      context.addIssue({
        code: "custom",
        path: ["collection", "summary", "revision"],
        message: "A newly created collection must start at revision 1",
      })
    }
    if (receipt.collection.members.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["collection", "members"],
        message: "A newly created collection must be empty",
      })
    }
  })

export const libraryRenameCollectionReceiptSchema = z
  .object({
    ...collectionReceiptFields,
    operation: z.literal("rename_collection"),
  })
  .strict()

export const libraryDeleteCollectionReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    operation: z.literal("delete_collection"),
    collectionId: libraryCollectionIdSchema,
    deletedRevision: collectionRevisionSchema,
    workspaceRevision: workspaceRevisionSchema,
  })
  .strict()

export const libraryAddCollectionMemberReceiptSchema = z
  .object({
    ...collectionReceiptFields,
    operation: z.literal("add_collection_member"),
    identity: libraryItemIdentitySchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const expected = identityKey(receipt.identity)
    if (
      receipt.collection.members.some(
        (member) => identityKey(member) === expected
      )
    )
      return
    context.addIssue({
      code: "custom",
      path: ["collection", "members"],
      message: "An add-member receipt must contain the added identity",
    })
  })

export const libraryRemoveCollectionMemberReceiptSchema = z
  .object({
    ...collectionReceiptFields,
    operation: z.literal("remove_collection_member"),
    identity: libraryItemIdentitySchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const removed = identityKey(receipt.identity)
    if (
      !receipt.collection.members.some(
        (member) => identityKey(member) === removed
      )
    )
      return
    context.addIssue({
      code: "custom",
      path: ["collection", "members"],
      message: "A remove-member receipt cannot contain the removed identity",
    })
  })

export const libraryReorderCollectionMembersReceiptSchema = z
  .object({
    ...collectionReceiptFields,
    operation: z.literal("reorder_collection_members"),
  })
  .strict()

export const libraryCollectionMutationReceiptSchema = z.discriminatedUnion(
  "operation",
  [
    libraryCreateCollectionReceiptSchema,
    libraryRenameCollectionReceiptSchema,
    libraryDeleteCollectionReceiptSchema,
    libraryAddCollectionMemberReceiptSchema,
    libraryRemoveCollectionMemberReceiptSchema,
    libraryReorderCollectionMembersReceiptSchema,
  ]
)

export type LibrarySetFavoriteReceipt = z.infer<
  typeof librarySetFavoriteReceiptSchema
>
export type LibraryRecordUseReceipt = z.infer<
  typeof libraryRecordUseReceiptSchema
>
export type LibraryPreferenceMutationReceipt = z.infer<
  typeof libraryPreferenceMutationReceiptSchema
>
export type LibraryCreateCollectionReceipt = z.infer<
  typeof libraryCreateCollectionReceiptSchema
>
export type LibraryRenameCollectionReceipt = z.infer<
  typeof libraryRenameCollectionReceiptSchema
>
export type LibraryDeleteCollectionReceipt = z.infer<
  typeof libraryDeleteCollectionReceiptSchema
>
export type LibraryAddCollectionMemberReceipt = z.infer<
  typeof libraryAddCollectionMemberReceiptSchema
>
export type LibraryRemoveCollectionMemberReceipt = z.infer<
  typeof libraryRemoveCollectionMemberReceiptSchema
>
export type LibraryReorderCollectionMembersReceipt = z.infer<
  typeof libraryReorderCollectionMembersReceiptSchema
>
export type LibraryCollectionMutationReceipt = z.infer<
  typeof libraryCollectionMutationReceiptSchema
>

export const libraryCatalogListResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceRevision: workspaceRevisionSchema,
    page: libraryCatalogPageSchema,
  })
  .strict()

export const libraryCatalogDetailResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceRevision: workspaceRevisionSchema,
    detail: libraryCatalogItemDetailSchema,
  })
  .strict()

export const libraryPreferenceSnapshotResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshot: libraryPreferenceSnapshotSchema,
  })
  .strict()

export const libraryPreferenceMutationResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    receipt: libraryPreferenceMutationReceiptSchema,
  })
  .strict()

export const libraryCollectionListResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceRevision: workspaceRevisionSchema,
    collections: collectionSummariesSchema,
  })
  .strict()

export const libraryCollectionDetailResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceRevision: workspaceRevisionSchema,
    collection: libraryCollectionDetailSchema,
  })
  .strict()

export const libraryCollectionMutationResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    receipt: libraryCollectionMutationReceiptSchema,
  })
  .strict()

export type LibraryCatalogListResponse = z.infer<
  typeof libraryCatalogListResponseSchema
>
export type LibraryCatalogDetailResponse = z.infer<
  typeof libraryCatalogDetailResponseSchema
>
export type LibraryPreferenceSnapshotResponse = z.infer<
  typeof libraryPreferenceSnapshotResponseSchema
>
export type LibraryPreferenceMutationResponse = z.infer<
  typeof libraryPreferenceMutationResponseSchema
>
export type LibraryCollectionListResponse = z.infer<
  typeof libraryCollectionListResponseSchema
>
export type LibraryCollectionDetailResponse = z.infer<
  typeof libraryCollectionDetailResponseSchema
>
export type LibraryCollectionMutationResponse = z.infer<
  typeof libraryCollectionMutationResponseSchema
>

export function parseLibraryCollectionReorderRequest(
  input: unknown,
  currentMembers: readonly LibraryItemIdentity[]
): LibraryReorderCollectionMembersRequest {
  const request = libraryReorderCollectionMembersRequestSchema.parse(input)
  const current = collectionMembersSchema.parse(currentMembers)
  const currentKeys = new Set(current.map(identityKey))
  const orderedKeys = new Set(request.orderedIdentities.map(identityKey))
  if (
    currentKeys.size !== orderedKeys.size ||
    [...currentKeys].some((key) => !orderedKeys.has(key))
  ) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["orderedIdentities"],
        message:
          "Reorder identities must be an exact permutation of current members",
      },
    ])
  }
  return request
}
