import {
  catalogIdSchema,
  libraryCollectionDetailSchema,
  libraryCollectionIdSchema,
  libraryCollectionMutationReceiptSchema,
  libraryCollectionNameSchema,
  libraryItemIdentitySchema,
  libraryPreferenceMutationReceiptSchema,
  libraryPreferenceSnapshotSchema,
  libraryReorderCollectionMembersRequestSchema,
  mediaIdempotencyKeySchema,
  type LibraryCollectionDetail,
  type LibraryAddCollectionMemberReceipt,
  type LibraryCollectionMutationReceipt,
  type LibraryCollectionSummary,
  type LibraryCreateCollectionReceipt,
  type LibraryDeleteCollectionReceipt,
  type LibraryItemIdentity,
  type LibraryPreferenceMutationReceipt,
  type LibraryPreferenceSnapshot,
  type LibraryPreferenceState,
  type LibraryRecordUseReceipt,
  type LibraryRemoveCollectionMemberReceipt,
  type LibraryRenameCollectionReceipt,
  type LibraryReorderCollectionMembersReceipt,
  type LibrarySetFavoriteReceipt,
} from "@webmcp/document"
import { sha256Hex } from "./media-assets"

type PreferenceRow = {
  item_kind: LibraryItemIdentity["itemKind"]
  item_id: string
  item_version: number
  favorite: number
  last_used_at: string | null
  revision: number
  created_at: string
  updated_at: string
}

type CollectionRow = {
  id: string
  name: string
  revision: number
  created_at: string
  updated_at: string
  item_count: number
}

type MemberRow = {
  collection_id: string
  item_kind: LibraryItemIdentity["itemKind"]
  item_id: string
  item_version: number
  position: number
  added_at: string
}

type MutationRequestRow = {
  operation: string
  request_hash: string
  result_kind: "preference" | "collection"
  result_identity: string
  result_revision: number
  response_json: string
}
type MutationClaimRow = {
  operation: string
  request_hash: string
  result_kind: "preference" | "collection"
  result_identity: string
  result_revision: number
}

type WorkspaceRevisionRow = { revision: number }

export type LibraryCompletedAction = "create" | "insert" | "replace"

export type LibraryItemAdmission = {
  assertCanFavorite(
    workspaceId: string,
    principalId: string,
    identity: LibraryItemIdentity
  ): Promise<void>
  assertCanUse(
    workspaceId: string,
    principalId: string,
    identity: LibraryItemIdentity
  ): Promise<void>
  assertCanAddToCollection(
    workspaceId: string,
    principalId: string,
    identity: LibraryItemIdentity
  ): Promise<void>
}

export class LibraryPreferenceError extends Error {
  readonly code:
    | "invalid_idempotency_key"
    | "idempotency_key_reused"
    | "library_collection_not_found"
    | "library_collection_name_conflict"
    | "library_collection_member_conflict"
    | "library_collection_limit_reached"
    | "library_collection_revision_mismatch"
    | "library_preference_revision_mismatch"
    | "library_receipt_invalid"
  readonly status: 400 | 404 | 409 | 412 | 500

  constructor(
    code: LibraryPreferenceError["code"],
    status: LibraryPreferenceError["status"],
    message: string
  ) {
    super(message)
    this.name = "LibraryPreferenceError"
    this.code = code
    this.status = status
  }
}

const identityKey = (identity: LibraryItemIdentity) =>
  `${identity.itemKind}:${identity.id}@${identity.version}`

const preferenceIdentity = (row: PreferenceRow | MemberRow) => ({
  itemKind: row.item_kind,
  id: row.item_id,
  version: Number(row.item_version),
})

const collectionSummary = (row: CollectionRow): LibraryCollectionSummary => ({
  id: row.id,
  name: row.name,
  scope: "workspace",
  revision: Number(row.revision),
  itemCount: Number(row.item_count),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const canonicalHash = async (value: unknown) =>
  sha256Hex(new TextEncoder().encode(JSON.stringify(value)))

const assertIdempotencyKey = (input: string) => {
  const key = input.trim()
  if (!mediaIdempotencyKeySchema.safeParse(key).success) {
    throw new LibraryPreferenceError(
      "invalid_idempotency_key",
      400,
      "Idempotency-Key must contain 1-128 letters, numbers, dots, colons, underscores, or hyphens"
    )
  }
  return key
}

const normalizedCollectionName = (input: string) => {
  const name = libraryCollectionNameSchema.parse(input)
  return { name, normalizedName: name.toLocaleLowerCase("en-US") }
}

const isCollectionNameConstraint = (error: unknown) =>
  error instanceof Error &&
  /unique constraint failed:\s*library_collections\.workspace_id,\s*library_collections\.owner_principal_id,\s*library_collections\.normalized_name/iu.test(
    error.message
  )

export type LibraryPreferenceProjection = {
  workspaceRevision: number
  preferences: readonly LibraryPreferenceState[]
}
export type LibraryCollectionListSnapshot = {
  workspaceRevision: number
  collections: readonly LibraryCollectionSummary[]
}
export type LibraryCollectionSnapshot = {
  workspaceRevision: number
  collection: LibraryCollectionDetail
}

export class LibraryPreferenceRepository {
  constructor(
    private readonly db: D1Database,
    private readonly admission: LibraryItemAdmission,
    private readonly options: {
      now?: () => string
      createCollectionId?: () => string
    } = {}
  ) {}

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private createCollectionId() {
    return (
      this.options.createCollectionId?.() ?? `collection-${crypto.randomUUID()}`
    )
  }

  private workspaceRevisionStatement(workspaceId: string) {
    return this.db
      .prepare(
        `/* library:workspace-revision */ SELECT revision
         FROM library_workspace_state WHERE workspace_id = ?1`
      )
      .bind(workspaceId)
  }

  private preferenceListStatement(workspaceId: string, principalId: string) {
    return this.db
      .prepare(
        `/* library:preference-list */ SELECT item_kind, item_id, item_version,
           favorite, last_used_at, revision, created_at, updated_at
         FROM library_item_preferences
         WHERE workspace_id = ?1 AND principal_id = ?2
         ORDER BY item_kind, item_id, item_version`
      )
      .bind(workspaceId, principalId)
  }

  private membershipListStatement(workspaceId: string, principalId: string) {
    return this.db
      .prepare(
        `/* library:membership-list */ SELECT m.collection_id, m.item_kind,
           m.item_id, m.item_version, m.position, m.added_at
         FROM library_collection_members m
         INNER JOIN library_collections c
           ON c.workspace_id = m.workspace_id AND c.id = m.collection_id
         WHERE m.workspace_id = ?1 AND c.owner_principal_id = ?2
         ORDER BY m.item_kind, m.item_id, m.item_version, c.created_at, c.id`
      )
      .bind(workspaceId, principalId)
  }

  private collectionListStatement(workspaceId: string, principalId: string) {
    return this.db
      .prepare(
        `/* library:collection-list */ SELECT c.id, c.name, c.revision,
           c.created_at, c.updated_at, COUNT(m.item_id) AS item_count
         FROM library_collections c
         LEFT JOIN library_collection_members m
           ON m.workspace_id = c.workspace_id AND m.collection_id = c.id
         WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2
         GROUP BY c.workspace_id, c.id
         ORDER BY c.updated_at DESC, c.id`
      )
      .bind(workspaceId, principalId)
  }

  private projectPreferences(
    preferences: readonly PreferenceRow[],
    memberships: readonly MemberRow[]
  ): LibraryPreferenceState[] {
    const byIdentity = new Map<
      string,
      { row: PreferenceRow | null; members: MemberRow[] }
    >()
    for (const row of preferences) {
      byIdentity.set(identityKey(preferenceIdentity(row)), { row, members: [] })
    }
    for (const member of memberships) {
      const key = identityKey(preferenceIdentity(member))
      const entry = byIdentity.get(key) ?? { row: null, members: [] }
      entry.members.push(member)
      byIdentity.set(key, entry)
    }
    return [...byIdentity.values()].map(({ row, members }) => {
      const identity = preferenceIdentity(row ?? members[0]!)
      const membershipUpdatedAt = members.reduce(
        (latest, member) =>
          member.added_at > latest ? member.added_at : latest,
        "1970-01-01T00:00:00.000Z"
      )
      return {
        identity,
        favorite: Boolean(row?.favorite),
        lastUsedAt: row?.last_used_at ?? null,
        collectionIds: members.map(({ collection_id }) => collection_id),
        revision: Number(row?.revision ?? 0),
        updatedAt: row?.updated_at ?? membershipUpdatedAt,
      }
    })
  }

  async readProjection(
    workspaceId: string,
    principalId: string
  ): Promise<LibraryPreferenceProjection> {
    const [revisionResult, preferenceResult, membershipResult] =
      await this.db.batch([
        this.workspaceRevisionStatement(workspaceId),
        this.preferenceListStatement(workspaceId, principalId),
        this.membershipListStatement(workspaceId, principalId),
      ])
    const workspaceRevision = Number(
      (revisionResult?.results[0] as WorkspaceRevisionRow | undefined)
        ?.revision ?? 0
    )
    const preferences = (preferenceResult?.results ?? []) as PreferenceRow[]
    const memberships = (membershipResult?.results ?? []) as MemberRow[]
    return {
      workspaceRevision,
      preferences: this.projectPreferences(preferences, memberships),
    }
  }

  async readSnapshot(
    workspaceId: string,
    principalId: string
  ): Promise<LibraryPreferenceSnapshot> {
    const [
      revisionResult,
      preferenceResult,
      membershipResult,
      collectionResult,
    ] = await this.db.batch([
      this.workspaceRevisionStatement(workspaceId),
      this.preferenceListStatement(workspaceId, principalId),
      this.membershipListStatement(workspaceId, principalId),
      this.collectionListStatement(workspaceId, principalId),
    ])
    const workspaceRevision = Number(
      (revisionResult?.results[0] as WorkspaceRevisionRow | undefined)
        ?.revision ?? 0
    )
    const preferences = this.projectPreferences(
      (preferenceResult?.results ?? []) as PreferenceRow[],
      (membershipResult?.results ?? []) as MemberRow[]
    )
    const collections = (
      (collectionResult?.results ?? []) as CollectionRow[]
    ).map(collectionSummary)
    return libraryPreferenceSnapshotSchema.parse({
      workspaceRevision,
      preferences,
      collections,
    })
  }

  async readPreference(
    workspaceId: string,
    principalId: string,
    identityInput: LibraryItemIdentity
  ): Promise<LibraryPreferenceState> {
    const identity = libraryItemIdentitySchema.parse(identityInput)
    const projection = await this.readProjection(workspaceId, principalId)
    return (
      projection.preferences.find(
        (preference) =>
          identityKey(preference.identity) === identityKey(identity)
      ) ?? {
        identity,
        favorite: false,
        lastUsedAt: null,
        collectionIds: [],
        revision: 0,
        updatedAt: "1970-01-01T00:00:00.000Z",
      }
    )
  }

  async listCollections(workspaceId: string, principalId: string) {
    return (await this.readCollectionListSnapshot(workspaceId, principalId))
      .collections
  }

  async readCollectionListSnapshot(
    workspaceId: string,
    principalId: string
  ): Promise<LibraryCollectionListSnapshot> {
    const [revisionResult, collectionResult] = await this.db.batch([
      this.workspaceRevisionStatement(workspaceId),
      this.collectionListStatement(workspaceId, principalId),
    ])
    return {
      workspaceRevision: Number(
        (revisionResult?.results[0] as WorkspaceRevisionRow | undefined)
          ?.revision ?? 0
      ),
      collections: ((collectionResult?.results ?? []) as CollectionRow[]).map(
        collectionSummary
      ),
    }
  }

  private collectionGetStatement(
    workspaceId: string,
    principalId: string,
    collectionId: string
  ) {
    return this.db
      .prepare(
        `/* library:collection-get */ SELECT c.id, c.name, c.revision,
           c.created_at, c.updated_at, COUNT(m.item_id) AS item_count
         FROM library_collections c
         LEFT JOIN library_collection_members m
           ON m.workspace_id = c.workspace_id AND m.collection_id = c.id
         WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2 AND c.id = ?3
         GROUP BY c.workspace_id, c.id`
      )
      .bind(workspaceId, principalId, collectionId)
  }

  private collectionMembersStatement(
    workspaceId: string,
    collectionId: string
  ) {
    return this.db
      .prepare(
        `/* library:collection-members */ SELECT collection_id, item_kind,
           item_id, item_version, position, added_at
         FROM library_collection_members
         WHERE workspace_id = ?1 AND collection_id = ?2
         ORDER BY position`
      )
      .bind(workspaceId, collectionId)
  }

  async readCollectionSnapshot(
    workspaceId: string,
    principalId: string,
    collectionIdInput: string
  ): Promise<LibraryCollectionSnapshot> {
    const collectionId = libraryCollectionIdSchema.parse(collectionIdInput)
    const [revisionResult, collectionResult, memberResult] =
      await this.db.batch([
        this.workspaceRevisionStatement(workspaceId),
        this.collectionGetStatement(workspaceId, principalId, collectionId),
        this.collectionMembersStatement(workspaceId, collectionId),
      ])
    const row = collectionResult?.results[0] as CollectionRow | undefined
    if (!row) {
      throw new LibraryPreferenceError(
        "library_collection_not_found",
        404,
        "Library collection was not found"
      )
    }
    const members = (memberResult?.results ?? []) as MemberRow[]
    return {
      workspaceRevision: Number(
        (revisionResult?.results[0] as WorkspaceRevisionRow | undefined)
          ?.revision ?? 0
      ),
      collection: libraryCollectionDetailSchema.parse({
        summary: collectionSummary(row),
        members: members.map(preferenceIdentity),
      }),
    }
  }

  async getCollection(
    workspaceId: string,
    principalId: string,
    collectionIdInput: string
  ): Promise<LibraryCollectionDetail> {
    return (
      await this.readCollectionSnapshot(
        workspaceId,
        principalId,
        collectionIdInput
      )
    ).collection
  }

  private async requestRow(
    workspaceId: string,
    principalId: string,
    key: string
  ) {
    return this.db
      .prepare(
        `/* library:request-get */ SELECT operation, request_hash, result_kind,
           result_identity, result_revision, response_json
         FROM library_mutation_requests
         WHERE workspace_id = ?1 AND principal_id = ?2 AND idempotency_key = ?3`
      )
      .bind(workspaceId, principalId, key)
      .first<MutationRequestRow>()
  }

  private currentClaim(workspaceId: string, principalId: string, key: string) {
    return this.db
      .prepare(
        `/* library:claim-get */
         SELECT last_mutation_operation AS operation,
                last_mutation_hash AS request_hash,
                'preference' AS result_kind,
                item_kind || ':' || item_id || '@' || item_version AS result_identity,
                revision AS result_revision
         FROM library_item_preferences
         WHERE workspace_id = ?1 AND principal_id = ?2 AND last_mutation_key = ?3
         UNION ALL
         SELECT last_mutation_operation AS operation,
                last_mutation_hash AS request_hash,
                'collection' AS result_kind,
                id AS result_identity,
                revision AS result_revision
         FROM library_collections
         WHERE workspace_id = ?1 AND owner_principal_id = ?2
           AND last_mutation_key = ?3
         LIMIT 1`
      )
      .bind(workspaceId, principalId, key)
      .first<MutationClaimRow>()
  }

  private async reconcileClaim<
    T extends
      LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt,
  >(
    workspaceId: string,
    principalId: string,
    key: string,
    hash: string,
    operation: T["operation"],
    repair: (claim: MutationClaimRow) => Promise<T>
  ): Promise<T | null> {
    const claim = await this.currentClaim(workspaceId, principalId, key)
    if (!claim) return null
    const lateReplay = await this.replay<T>(
      workspaceId,
      principalId,
      key,
      hash,
      operation
    )
    if (lateReplay) return lateReplay
    if (claim.operation !== operation || claim.request_hash !== hash) {
      throw new LibraryPreferenceError(
        "idempotency_key_reused",
        409,
        "Idempotency-Key was already used for another library mutation"
      )
    }
    return repair({ ...claim, result_revision: Number(claim.result_revision) })
  }

  private receipt<
    T extends
      LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt,
  >(
    row: MutationRequestRow,
    expectedHash: string,
    operation: T["operation"]
  ): T {
    if (row.request_hash !== expectedHash || row.operation !== operation) {
      throw new LibraryPreferenceError(
        "idempotency_key_reused",
        409,
        "Idempotency-Key was already used for another library mutation"
      )
    }
    try {
      const value = JSON.parse(row.response_json)
      const parsed =
        operation === "set_favorite" || operation === "record_used"
          ? libraryPreferenceMutationReceiptSchema.parse(value)
          : libraryCollectionMutationReceiptSchema.parse(value)
      if (parsed.operation !== operation) throw new Error("Operation mismatch")
      const result =
        "preference" in parsed
          ? {
              kind: "preference",
              identity: identityKey(parsed.preference.identity),
              revision: parsed.preference.revision,
            }
          : parsed.operation === "delete_collection"
            ? {
                kind: "collection",
                identity: parsed.collectionId,
                revision: parsed.deletedRevision,
              }
            : {
                kind: "collection",
                identity: parsed.collection.summary.id,
                revision: parsed.collection.summary.revision,
              }
      if (
        row.result_kind !== result.kind ||
        row.result_identity !== result.identity ||
        Number(row.result_revision) !== result.revision
      ) {
        throw new Error("Receipt result metadata mismatch")
      }
      return parsed as T
    } catch (error) {
      if (error instanceof LibraryPreferenceError) throw error
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Stored library mutation receipt is invalid"
      )
    }
  }

  private async replay<
    T extends
      LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt,
  >(
    workspaceId: string,
    principalId: string,
    key: string,
    hash: string,
    operation: T["operation"]
  ): Promise<T | null> {
    const row = await this.requestRow(workspaceId, principalId, key)
    return row ? this.receipt<T>(row, hash, operation) : null
  }

  private receiptValueStatement(args: {
    workspaceId: string
    principalId: string
    key: string
    hash: string
    operation:
      | LibraryPreferenceMutationReceipt["operation"]
      | LibraryCollectionMutationReceipt["operation"]
    resultKind: MutationRequestRow["result_kind"]
    resultIdentity: string
    resultRevision: number
    response:
      LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt
    now: string
  }) {
    return this.db
      .prepare(
        `/* library:receipt-value */ INSERT INTO library_mutation_requests
         (workspace_id, principal_id, idempotency_key, operation, request_hash,
          result_kind, result_identity, result_revision, response_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      )
      .bind(
        args.workspaceId,
        args.principalId,
        args.key,
        args.operation,
        args.hash,
        args.resultKind,
        args.resultIdentity,
        args.resultRevision,
        JSON.stringify(args.response),
        args.now
      )
  }

  private async repairPreferenceClaim<
    T extends LibrarySetFavoriteReceipt | LibraryRecordUseReceipt,
  >(args: {
    workspaceId: string
    principalId: string
    key: string
    hash: string
    operation: T["operation"]
    identity: LibraryItemIdentity
    claim: MutationClaimRow
    completedAction?: LibraryCompletedAction
    completionId?: string
  }): Promise<T> {
    const resultIdentity = identityKey(args.identity)
    if (
      args.claim.result_kind !== "preference" ||
      args.claim.result_identity !== resultIdentity
    ) {
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Library preference claim metadata is invalid"
      )
    }
    const now = this.now()
    const projection = await this.readProjection(
      args.workspaceId,
      args.principalId
    )
    const preference = projection.preferences.find(
      (candidate) => identityKey(candidate.identity) === resultIdentity
    )
    if (!preference || preference.revision !== args.claim.result_revision) {
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Library preference claim revision is invalid"
      )
    }
    const response = {
      schemaVersion: 1 as const,
      operation: args.operation,
      preference,
      workspaceRevision: projection.workspaceRevision,
      ...(args.operation === "record_used"
        ? {
            completedAction: args.completedAction,
            completionId: args.completionId,
          }
        : {}),
    } as T
    const statement = this.receiptValueStatement({
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      key: args.key,
      hash: args.hash,
      operation: args.operation,
      resultKind: "preference",
      resultIdentity,
      resultRevision: args.claim.result_revision,
      response,
      now,
    })
    let writeError: unknown = null
    try {
      await statement.run()
    } catch (error) {
      writeError = error
    }
    const receipt = await this.replay<T>(
      args.workspaceId,
      args.principalId,
      args.key,
      args.hash,
      args.operation
    )
    if (receipt) return receipt
    if (writeError) throw writeError
    throw new LibraryPreferenceError(
      "library_receipt_invalid",
      500,
      "Library preference claim could not be repaired"
    )
  }

  private async repairCollectionClaim<
    T extends Exclude<
      LibraryCollectionMutationReceipt,
      LibraryDeleteCollectionReceipt
    >,
  >(args: {
    workspaceId: string
    principalId: string
    key: string
    hash: string
    operation: T["operation"]
    claim: MutationClaimRow
    identity?: LibraryItemIdentity
  }): Promise<T> {
    if (args.claim.result_kind !== "collection") {
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Library collection claim metadata is invalid"
      )
    }
    const snapshot = await this.readCollectionSnapshot(
      args.workspaceId,
      args.principalId,
      args.claim.result_identity
    )
    const collection = snapshot.collection
    if (collection.summary.revision !== args.claim.result_revision) {
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Library collection claim revision is invalid"
      )
    }
    const response = {
      schemaVersion: 1 as const,
      operation: args.operation,
      collection,
      ...(args.identity ? { identity: args.identity } : {}),
      workspaceRevision: snapshot.workspaceRevision,
    } as T
    const now = this.now()
    let writeError: unknown = null
    try {
      await this.receiptValueStatement({
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        key: args.key,
        hash: args.hash,
        operation: args.operation,
        resultKind: "collection",
        resultIdentity: args.claim.result_identity,
        resultRevision: args.claim.result_revision,
        response,
        now,
      }).run()
    } catch (error) {
      writeError = error
    }
    const receipt = await this.replay<T>(
      args.workspaceId,
      args.principalId,
      args.key,
      args.hash,
      args.operation
    )
    if (receipt) return receipt
    if (writeError) throw writeError
    throw new LibraryPreferenceError(
      "library_receipt_invalid",
      500,
      "Library collection claim could not be repaired"
    )
  }

  private async repairDeleteCollectionClaim(args: {
    workspaceId: string
    principalId: string
    key: string
    hash: string
    collectionId: string
    claim: MutationClaimRow
  }): Promise<LibraryDeleteCollectionReceipt> {
    const operation = "delete_collection" as const
    if (
      args.claim.result_kind !== "collection" ||
      args.claim.result_identity !== args.collectionId
    ) {
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Library collection delete claim metadata is invalid"
      )
    }
    const baseResponse = {
      schemaVersion: 1 as const,
      operation,
      collectionId: args.collectionId,
      deletedRevision: args.claim.result_revision,
      workspaceRevision: 0,
    }
    const now = this.now()
    let writeError: unknown = null
    try {
      await this.receiptValueStatement({
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        key: args.key,
        hash: args.hash,
        operation,
        resultKind: "collection",
        resultIdentity: args.collectionId,
        resultRevision: args.claim.result_revision,
        response: baseResponse,
        now,
      }).run()
    } catch (error) {
      writeError = error
    }
    const receipt = await this.replay<LibraryDeleteCollectionReceipt>(
      args.workspaceId,
      args.principalId,
      args.key,
      args.hash,
      operation
    )
    if (!receipt) {
      if (writeError) throw writeError
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Library collection delete claim could not be repaired"
      )
    }
    return this.completeDeleteCollectionReceipt({
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      key: args.key,
      hash: args.hash,
      collectionId: args.collectionId,
      deletedRevision: args.claim.result_revision,
    })
  }

  private async completeDeleteCollectionReceipt(args: {
    workspaceId: string
    principalId: string
    key: string
    hash: string
    collectionId: string
    deletedRevision: number
  }): Promise<LibraryDeleteCollectionReceipt> {
    const operation = "delete_collection" as const
    const statements = [
      this.db
        .prepare(
          `/* library:collection-delete */ DELETE FROM library_collections
         WHERE workspace_id = ?1 AND owner_principal_id = ?2 AND id = ?3
           AND revision = ?4 AND last_mutation_key = ?5`
        )
        .bind(
          args.workspaceId,
          args.principalId,
          args.collectionId,
          args.deletedRevision,
          args.key
        ),
      this.db
        .prepare(
          `/* library:delete-receipt-revision */ UPDATE library_mutation_requests
         SET response_json = json_set(response_json, '$.workspaceRevision',
           COALESCE((SELECT revision FROM library_workspace_state WHERE workspace_id = ?1), 0))
         WHERE workspace_id = ?1 AND principal_id = ?2 AND idempotency_key = ?3
           AND operation = 'delete_collection' AND request_hash = ?4
           AND json_extract(response_json, '$.workspaceRevision') = 0
           AND NOT EXISTS (
             SELECT 1 FROM library_collections c
             WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2
               AND c.id = ?5 AND c.revision = ?6
               AND c.last_mutation_key = ?3
               AND c.last_mutation_hash = ?4
               AND c.last_mutation_operation = 'delete_collection'
           )`
        )
        .bind(
          args.workspaceId,
          args.principalId,
          args.key,
          args.hash,
          args.collectionId,
          args.deletedRevision
        ),
    ]
    const { receipt, writeError } =
      await this.runAndReplay<LibraryDeleteCollectionReceipt>({
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        key: args.key,
        hash: args.hash,
        operation,
        statements,
      })
    const claim = await this.currentClaim(
      args.workspaceId,
      args.principalId,
      args.key
    )
    if (
      claim?.operation === operation &&
      claim.request_hash === args.hash &&
      claim.result_identity === args.collectionId &&
      Number(claim.result_revision) === args.deletedRevision
    ) {
      if (writeError) throw writeError
      throw new LibraryPreferenceError(
        "library_receipt_invalid",
        500,
        "Library collection delete target is still present"
      )
    }
    if (receipt?.workspaceRevision && receipt.workspaceRevision > 0)
      return receipt
    if (writeError) throw writeError
    throw new LibraryPreferenceError(
      "library_receipt_invalid",
      500,
      "Library collection delete receipt was not finalized"
    )
  }

  private async runAndReplay<
    T extends
      LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt,
  >(args: {
    workspaceId: string
    principalId: string
    key: string
    hash: string
    operation: T["operation"]
    statements: D1PreparedStatement[]
  }): Promise<{ receipt: T | null; writeError: unknown }> {
    let writeError: unknown = null
    try {
      await this.db.batch(args.statements)
    } catch (error) {
      writeError = error
    }
    const receipt = await this.replay<T>(
      args.workspaceId,
      args.principalId,
      args.key,
      args.hash,
      args.operation
    )
    return { receipt, writeError }
  }

  async setFavorite(
    workspaceId: string,
    principalId: string,
    identityInput: LibraryItemIdentity,
    expectedRevision: number,
    favorite: boolean,
    idempotencyKeyInput: string
  ): Promise<LibrarySetFavoriteReceipt> {
    const identity = libraryItemIdentitySchema.parse(identityInput)
    const key = assertIdempotencyKey(idempotencyKeyInput)
    const operation = "set_favorite" as const
    const hash = await canonicalHash({
      operation,
      identity,
      expectedRevision,
      favorite,
    })
    const replay = await this.replay<LibrarySetFavoriteReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation
    )
    if (replay) return replay
    const repair = (claim: MutationClaimRow) =>
      this.repairPreferenceClaim<LibrarySetFavoriteReceipt>({
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        identity,
        claim,
      })
    const claimReplay = await this.reconcileClaim<LibrarySetFavoriteReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation,
      repair
    )
    if (claimReplay) return claimReplay
    if (favorite) {
      await this.admission.assertCanFavorite(workspaceId, principalId, identity)
    } else {
      const existing = await this.readPreference(
        workspaceId,
        principalId,
        identity
      )
      if (existing.revision === 0) {
        await this.admission.assertCanFavorite(
          workspaceId,
          principalId,
          identity
        )
      }
    }
    const now = this.now()
    const statement =
      expectedRevision === 0
        ? this.db.prepare(
            `/* library:set-favorite */ INSERT INTO library_item_preferences
         (workspace_id, principal_id, item_kind, item_id, item_version, favorite,
          last_used_at, revision, last_mutation_key, last_mutation_hash,
          last_mutation_operation, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?7, NULL, 1, ?8, ?10,
           'set_favorite', ?9, ?9
         WHERE ?6 = 0`
          )
        : this.db.prepare(
            `/* library:set-favorite */ UPDATE library_item_preferences
         SET favorite = ?7, revision = revision + 1,
           last_mutation_key = ?8, last_mutation_hash = ?10,
           last_mutation_operation = 'set_favorite', updated_at = ?9
         WHERE workspace_id = ?1 AND principal_id = ?2 AND item_kind = ?3
           AND item_id = ?4 AND item_version = ?5 AND revision = ?6
           AND last_mutation_key <> ?8`
          )
    const statements = [
      statement.bind(
        workspaceId,
        principalId,
        identity.itemKind,
        identity.id,
        identity.version,
        expectedRevision,
        favorite ? 1 : 0,
        key,
        now,
        hash
      ),
    ]
    const { receipt, writeError } =
      await this.runAndReplay<LibrarySetFavoriteReceipt>({
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        statements,
      })
    if (receipt) return receipt
    const repaired = await this.reconcileClaim<LibrarySetFavoriteReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation,
      repair
    )
    if (repaired) return repaired
    const current = await this.readPreference(
      workspaceId,
      principalId,
      identity
    )
    if (current.revision !== expectedRevision) {
      throw new LibraryPreferenceError(
        "library_preference_revision_mismatch",
        412,
        "Library preference changed before this mutation"
      )
    }
    if (writeError) throw writeError
    throw new Error("library_preference_mutation_incomplete")
  }

  async recordUsed(
    workspaceId: string,
    principalId: string,
    identityInput: LibraryItemIdentity,
    completedAction: LibraryCompletedAction,
    completionId: string,
    idempotencyKeyInput: string
  ): Promise<LibraryRecordUseReceipt> {
    const identity = libraryItemIdentitySchema.parse(identityInput)
    const parsedCompletionId = catalogIdSchema.parse(completionId)
    const key = assertIdempotencyKey(idempotencyKeyInput)
    const operation = "record_used" as const
    const hash = await canonicalHash({
      operation,
      identity,
      completedAction,
      completionId: parsedCompletionId,
    })
    const replay = await this.replay<LibraryRecordUseReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation
    )
    if (replay) return replay
    const repair = (claim: MutationClaimRow) =>
      this.repairPreferenceClaim<LibraryRecordUseReceipt>({
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        identity,
        claim,
        completedAction,
        completionId: parsedCompletionId,
      })
    const claimReplay = await this.reconcileClaim<LibraryRecordUseReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation,
      repair
    )
    if (claimReplay) return claimReplay
    await this.admission.assertCanUse(workspaceId, principalId, identity)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.readPreference(
        workspaceId,
        principalId,
        identity
      )
      const expectedRevision = current.revision
      const now = this.now()
      const statements = [
        this.db
          .prepare(
            `/* library:record-used */ INSERT INTO library_item_preferences
         (workspace_id, principal_id, item_kind, item_id, item_version, favorite,
          last_used_at, revision, last_mutation_key, last_mutation_hash,
          last_mutation_operation, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?7, 1, ?6, ?8,
           'record_used', ?7, ?7)
         ON CONFLICT (workspace_id, principal_id, item_kind, item_id, item_version)
           DO UPDATE SET last_used_at = CASE
             WHEN last_used_at IS NULL OR last_used_at < excluded.last_used_at
             THEN excluded.last_used_at ELSE last_used_at END,
           updated_at = MAX(updated_at, excluded.updated_at), revision = revision + 1,
           last_mutation_key = excluded.last_mutation_key,
           last_mutation_hash = excluded.last_mutation_hash
           , last_mutation_operation = excluded.last_mutation_operation
         WHERE library_item_preferences.revision = ?9
           AND library_item_preferences.last_mutation_key <> excluded.last_mutation_key`
          )
          .bind(
            workspaceId,
            principalId,
            identity.itemKind,
            identity.id,
            identity.version,
            key,
            now,
            hash,
            expectedRevision
          ),
      ]
      const { receipt, writeError } =
        await this.runAndReplay<LibraryRecordUseReceipt>({
          workspaceId,
          principalId,
          key,
          hash,
          operation,
          statements,
        })
      if (receipt) return receipt
      const repaired = await this.reconcileClaim<LibraryRecordUseReceipt>(
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        repair
      )
      if (repaired) return repaired
      if (attempt === 1) {
        if (writeError) throw writeError
        throw new LibraryPreferenceError(
          "library_receipt_invalid",
          500,
          "Library use mutation could not produce a durable receipt"
        )
      }
    }
    throw new Error("library_record_use_incomplete")
  }

  async createCollection(
    workspaceId: string,
    principalId: string,
    nameInput: string,
    idempotencyKeyInput: string
  ): Promise<LibraryCreateCollectionReceipt> {
    const { name, normalizedName } = normalizedCollectionName(nameInput)
    const key = assertIdempotencyKey(idempotencyKeyInput)
    const operation = "create_collection" as const
    const hash = await canonicalHash({ operation, name })
    const replay = await this.replay<LibraryCreateCollectionReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation
    )
    if (replay) return replay
    const repair = (claim: MutationClaimRow) =>
      this.repairCollectionClaim<LibraryCreateCollectionReceipt>({
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        claim,
      })
    const claimReplay =
      await this.reconcileClaim<LibraryCreateCollectionReceipt>(
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        repair
      )
    if (claimReplay) return claimReplay
    if ((await this.listCollections(workspaceId, principalId)).length >= 100) {
      throw new LibraryPreferenceError(
        "library_collection_limit_reached",
        409,
        "A principal can create at most 100 library collections"
      )
    }
    const collectionId = libraryCollectionIdSchema.parse(
      this.createCollectionId()
    )
    const now = this.now()
    const statements = [
      this.db
        .prepare(
          `/* library:collection-create */ INSERT INTO library_collections
         (id, workspace_id, owner_principal_id, name, normalized_name, scope,
          revision, last_mutation_key, last_mutation_hash,
          last_mutation_operation, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'workspace', 1, ?6, ?8,
           'create_collection', ?7, ?7
         WHERE (SELECT COUNT(*) FROM library_collections
                WHERE workspace_id = ?2 AND owner_principal_id = ?3) < 100`
        )
        .bind(
          collectionId,
          workspaceId,
          principalId,
          name,
          normalizedName,
          key,
          now,
          hash
        ),
    ]
    const { receipt, writeError } =
      await this.runAndReplay<LibraryCreateCollectionReceipt>({
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        statements,
      })
    if (receipt) return receipt
    const repaired = await this.reconcileClaim<LibraryCreateCollectionReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation,
      repair
    )
    if (repaired) return repaired
    if (writeError && isCollectionNameConstraint(writeError)) {
      throw new LibraryPreferenceError(
        "library_collection_name_conflict",
        409,
        "A collection with this name already exists"
      )
    }
    if (writeError) throw writeError
    if ((await this.listCollections(workspaceId, principalId)).length >= 100) {
      throw new LibraryPreferenceError(
        "library_collection_limit_reached",
        409,
        "A principal can create at most 100 library collections"
      )
    }
    throw new Error("library_collection_create_incomplete")
  }

  private async mutateCollection(args: {
    workspaceId: string
    principalId: string
    collectionIdInput: string
    expectedRevision: number
    keyInput: string
    operation: Exclude<
      LibraryCollectionMutationReceipt["operation"],
      "create_collection" | "delete_collection"
    >
    hashBody: unknown
    receiptIdentity?: LibraryItemIdentity
    admit?: () => Promise<void>
    prepare: (
      current: LibraryCollectionDetail,
      collectionId: string,
      key: string,
      now: string,
      hash: string
    ) => {
      statements: D1PreparedStatement[]
      collection: LibraryCollectionDetail
      identity?: LibraryItemIdentity
    }
  }) {
    const collectionId = libraryCollectionIdSchema.parse(args.collectionIdInput)
    const key = assertIdempotencyKey(args.keyInput)
    const hash = await canonicalHash({
      operation: args.operation,
      collectionId,
      expectedRevision: args.expectedRevision,
      body: args.hashBody,
    })
    const replay = await this.replay<LibraryCollectionMutationReceipt>(
      args.workspaceId,
      args.principalId,
      key,
      hash,
      args.operation
    )
    if (replay) return replay
    const repair = (claim: MutationClaimRow) =>
      this.repairCollectionClaim({
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        key,
        hash,
        operation: args.operation,
        claim,
        identity: args.receiptIdentity,
      })
    const claimReplay =
      await this.reconcileClaim<LibraryCollectionMutationReceipt>(
        args.workspaceId,
        args.principalId,
        key,
        hash,
        args.operation,
        repair
      )
    if (claimReplay) return claimReplay
    await args.admit?.()
    const current = await this.getCollection(
      args.workspaceId,
      args.principalId,
      collectionId
    )
    if (current.summary.revision !== args.expectedRevision) {
      throw new LibraryPreferenceError(
        "library_collection_revision_mismatch",
        412,
        "Library collection changed before this mutation"
      )
    }
    const now = this.now()
    const prepared = args.prepare(current, collectionId, key, now, hash)
    const { receipt, writeError } =
      await this.runAndReplay<LibraryCollectionMutationReceipt>({
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        key,
        hash,
        operation: args.operation,
        statements: prepared.statements,
      })
    if (receipt) return receipt
    const repaired =
      await this.reconcileClaim<LibraryCollectionMutationReceipt>(
        args.workspaceId,
        args.principalId,
        key,
        hash,
        args.operation,
        repair
      )
    if (repaired) return repaired
    let latest: LibraryCollectionDetail
    try {
      latest = await this.getCollection(
        args.workspaceId,
        args.principalId,
        collectionId
      )
    } catch (error) {
      if (error instanceof LibraryPreferenceError) throw error
      throw error
    }
    if (latest.summary.revision !== args.expectedRevision) {
      throw new LibraryPreferenceError(
        "library_collection_revision_mismatch",
        412,
        "Library collection changed before this mutation"
      )
    }
    if (
      writeError &&
      isCollectionNameConstraint(writeError) &&
      args.operation === "rename_collection"
    ) {
      throw new LibraryPreferenceError(
        "library_collection_name_conflict",
        409,
        "A collection with this name already exists"
      )
    }
    if (writeError) throw writeError
    throw new LibraryPreferenceError(
      "library_collection_member_conflict",
      409,
      "Library collection membership conflicts with this mutation"
    )
  }

  async renameCollection(
    workspaceId: string,
    principalId: string,
    collectionId: string,
    expectedRevision: number,
    nameInput: string,
    key: string
  ): Promise<LibraryRenameCollectionReceipt> {
    const { name, normalizedName } = normalizedCollectionName(nameInput)
    return (await this.mutateCollection({
      workspaceId,
      principalId,
      collectionIdInput: collectionId,
      expectedRevision,
      keyInput: key,
      operation: "rename_collection",
      hashBody: { name },
      prepare: (current, id, mutationKey, now, mutationHash) => ({
        statements: [
          this.db
            .prepare(
              `/* library:collection-rename */ UPDATE library_collections
           SET name = ?6, normalized_name = ?7, revision = revision + 1,
             last_mutation_key = ?5, last_mutation_hash = ?9,
             last_mutation_operation = 'rename_collection', updated_at = ?8
           WHERE workspace_id = ?1 AND owner_principal_id = ?2 AND id = ?3
             AND revision = ?4`
            )
            .bind(
              workspaceId,
              principalId,
              id,
              expectedRevision,
              mutationKey,
              name,
              normalizedName,
              now,
              mutationHash
            ),
        ],
        collection: {
          summary: {
            ...current.summary,
            name,
            revision: expectedRevision + 1,
            updatedAt: now,
          },
          members: current.members,
        },
      }),
    })) as LibraryRenameCollectionReceipt
  }

  async addCollectionMember(
    workspaceId: string,
    principalId: string,
    collectionId: string,
    expectedRevision: number,
    identityInput: LibraryItemIdentity,
    key: string
  ): Promise<LibraryAddCollectionMemberReceipt> {
    const identity = libraryItemIdentitySchema.parse(identityInput)
    return (await this.mutateCollection({
      workspaceId,
      principalId,
      collectionIdInput: collectionId,
      expectedRevision,
      keyInput: key,
      operation: "add_collection_member",
      hashBody: { identity },
      receiptIdentity: identity,
      admit: () =>
        this.admission.assertCanAddToCollection(
          workspaceId,
          principalId,
          identity
        ),
      prepare: (current, id, mutationKey, now, mutationHash) => {
        if (
          current.members.some(
            (member) => identityKey(member) === identityKey(identity)
          )
        ) {
          throw new LibraryPreferenceError(
            "library_collection_member_conflict",
            409,
            "Library item is already in this collection"
          )
        }
        const members = [...current.members, identity]
        return {
          statements: [
            this.db
              .prepare(
                `/* library:collection-claim-add */ UPDATE library_collections
               SET revision = revision + 1, last_mutation_key = ?5, updated_at = ?6
                 , last_mutation_hash = ?10,
                 last_mutation_operation = 'add_collection_member'
               WHERE workspace_id = ?1 AND owner_principal_id = ?2 AND id = ?3
                 AND revision = ?4
                 AND (SELECT COUNT(*) FROM library_collection_members
                      WHERE workspace_id = ?1 AND collection_id = ?3) < 500
                 AND (SELECT COUNT(*) FROM library_collection_members m
                      INNER JOIN library_collections owned
                        ON owned.workspace_id = m.workspace_id
                       AND owned.id = m.collection_id
                      WHERE m.workspace_id = ?1 AND owned.owner_principal_id = ?2
                        AND m.item_kind = ?7 AND m.item_id = ?8
                        AND m.item_version = ?9) < 100
                 AND NOT EXISTS (SELECT 1 FROM library_collection_members
                   WHERE workspace_id = ?1 AND collection_id = ?3
                     AND item_kind = ?7 AND item_id = ?8 AND item_version = ?9)`
              )
              .bind(
                workspaceId,
                principalId,
                id,
                expectedRevision,
                mutationKey,
                now,
                identity.itemKind,
                identity.id,
                identity.version,
                mutationHash
              ),
            this.db
              .prepare(
                `/* library:member-add */ INSERT INTO library_collection_members
               (workspace_id, collection_id, item_kind, item_id, item_version, position, added_at)
               SELECT ?1, ?3, ?6, ?7, ?8,
                 (SELECT COUNT(*) FROM library_collection_members
                  WHERE workspace_id = ?1 AND collection_id = ?3), ?9
               FROM library_collections c
               WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2 AND c.id = ?3
                 AND c.revision = ?4 + 1 AND c.last_mutation_key = ?5`
              )
              .bind(
                workspaceId,
                principalId,
                id,
                expectedRevision,
                mutationKey,
                identity.itemKind,
                identity.id,
                identity.version,
                now
              ),
          ],
          collection: {
            summary: {
              ...current.summary,
              revision: expectedRevision + 1,
              itemCount: members.length,
              updatedAt: now,
            },
            members,
          },
          identity,
        }
      },
    })) as LibraryAddCollectionMemberReceipt
  }

  async removeCollectionMember(
    workspaceId: string,
    principalId: string,
    collectionId: string,
    expectedRevision: number,
    identityInput: LibraryItemIdentity,
    key: string
  ): Promise<LibraryRemoveCollectionMemberReceipt> {
    const identity = libraryItemIdentitySchema.parse(identityInput)
    return (await this.mutateCollection({
      workspaceId,
      principalId,
      collectionIdInput: collectionId,
      expectedRevision,
      keyInput: key,
      operation: "remove_collection_member",
      hashBody: { identity },
      receiptIdentity: identity,
      prepare: (current, id, mutationKey, now, mutationHash) => {
        const members = current.members.filter(
          (member) => identityKey(member) !== identityKey(identity)
        )
        if (members.length === current.members.length) {
          throw new LibraryPreferenceError(
            "library_collection_member_conflict",
            409,
            "Library item is not in this collection"
          )
        }
        return {
          statements: [
            this.db
              .prepare(
                `/* library:collection-claim-remove */ UPDATE library_collections
               SET revision = revision + 1, last_mutation_key = ?5, updated_at = ?6
                 , last_mutation_hash = ?10,
                 last_mutation_operation = 'remove_collection_member'
               WHERE workspace_id = ?1 AND owner_principal_id = ?2 AND id = ?3
                 AND revision = ?4 AND EXISTS (SELECT 1 FROM library_collection_members
                   WHERE workspace_id = ?1 AND collection_id = ?3
                     AND item_kind = ?7 AND item_id = ?8 AND item_version = ?9)`
              )
              .bind(
                workspaceId,
                principalId,
                id,
                expectedRevision,
                mutationKey,
                now,
                identity.itemKind,
                identity.id,
                identity.version,
                mutationHash
              ),
            this.db
              .prepare(
                `/* library:member-remove */ DELETE FROM library_collection_members
               WHERE workspace_id = ?1 AND collection_id = ?3
                 AND item_kind = ?6 AND item_id = ?7 AND item_version = ?8
                 AND EXISTS (SELECT 1 FROM library_collections c
                   WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2 AND c.id = ?3
                     AND c.revision = ?4 + 1 AND c.last_mutation_key = ?5)`
              )
              .bind(
                workspaceId,
                principalId,
                id,
                expectedRevision,
                mutationKey,
                identity.itemKind,
                identity.id,
                identity.version
              ),
            this.db
              .prepare(
                `/* library:member-compact-offset */ UPDATE library_collection_members
               SET position = position + 1000 WHERE workspace_id = ?1 AND collection_id = ?3
                 AND position > ?6 AND EXISTS (SELECT 1 FROM library_collections c
                   WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2 AND c.id = ?3
                     AND c.revision = ?4 + 1 AND c.last_mutation_key = ?5)`
              )
              .bind(
                workspaceId,
                principalId,
                id,
                expectedRevision,
                mutationKey,
                current.members.findIndex(
                  (member) => identityKey(member) === identityKey(identity)
                )
              ),
            this.db
              .prepare(
                `/* library:member-compact */ UPDATE library_collection_members
               SET position = position - 1001 WHERE workspace_id = ?1 AND collection_id = ?3
                 AND position > 1000 + ?6 AND EXISTS (SELECT 1 FROM library_collections c
                   WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2 AND c.id = ?3
                     AND c.revision = ?4 + 1 AND c.last_mutation_key = ?5)`
              )
              .bind(
                workspaceId,
                principalId,
                id,
                expectedRevision,
                mutationKey,
                current.members.findIndex(
                  (member) => identityKey(member) === identityKey(identity)
                )
              ),
          ],
          collection: {
            summary: {
              ...current.summary,
              revision: expectedRevision + 1,
              itemCount: members.length,
              updatedAt: now,
            },
            members,
          },
          identity,
        }
      },
    })) as LibraryRemoveCollectionMemberReceipt
  }

  async reorderCollectionMembers(
    workspaceId: string,
    principalId: string,
    collectionId: string,
    expectedRevision: number,
    orderedInput: readonly LibraryItemIdentity[],
    key: string
  ): Promise<LibraryReorderCollectionMembersReceipt> {
    const ordered = libraryReorderCollectionMembersRequestSchema.parse({
      schemaVersion: 1,
      orderedIdentities: orderedInput,
    }).orderedIdentities
    return (await this.mutateCollection({
      workspaceId,
      principalId,
      collectionIdInput: collectionId,
      expectedRevision,
      keyInput: key,
      operation: "reorder_collection_members",
      hashBody: { ordered },
      prepare: (current, id, mutationKey, now, mutationHash) => {
        const currentKeys = new Set(current.members.map(identityKey))
        const orderedKeys = new Set(ordered.map(identityKey))
        if (
          currentKeys.size !== ordered.length ||
          orderedKeys.size !== ordered.length ||
          [...currentKeys].some((candidate) => !orderedKeys.has(candidate))
        ) {
          throw new LibraryPreferenceError(
            "library_collection_member_conflict",
            409,
            "Reorder must contain the exact current collection members"
          )
        }
        const orderedJson = JSON.stringify(ordered)
        return {
          statements: [
            this.db
              .prepare(
                `/* library:collection-claim-reorder */ UPDATE library_collections
               SET revision = revision + 1, last_mutation_key = ?5, updated_at = ?6
                 , last_mutation_hash = ?8,
                 last_mutation_operation = 'reorder_collection_members'
               WHERE workspace_id = ?1 AND owner_principal_id = ?2 AND id = ?3
                 AND revision = ?4
                 AND (SELECT COUNT(*) FROM library_collection_members
                      WHERE workspace_id = ?1 AND collection_id = ?3) = ?7
                 AND NOT EXISTS (
                   SELECT item_kind, item_id, item_version FROM library_collection_members
                   WHERE workspace_id = ?1 AND collection_id = ?3
                   EXCEPT
                   SELECT json_extract(value, '$.itemKind'),
                          json_extract(value, '$.id'),
                          json_extract(value, '$.version')
                   FROM json_each(?9)
                 )`
              )
              .bind(
                workspaceId,
                principalId,
                id,
                expectedRevision,
                mutationKey,
                now,
                ordered.length,
                mutationHash,
                orderedJson
              ),
            ...(ordered.length === 0
              ? []
              : [
                  this.db
                    .prepare(
                      `/* library:member-offset */ UPDATE library_collection_members
               SET position = position + 1000 WHERE workspace_id = ?1 AND collection_id = ?3
                 AND EXISTS (SELECT 1 FROM library_collections c
                   WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2 AND c.id = ?3
                     AND c.revision = ?4 + 1 AND c.last_mutation_key = ?5)`
                    )
                    .bind(
                      workspaceId,
                      principalId,
                      id,
                      expectedRevision,
                      mutationKey
                    ),
                  this.db
                    .prepare(
                      `/* library:member-reorder */ UPDATE library_collection_members
               SET position = (
                 SELECT CAST(entry.key AS INTEGER)
                 FROM json_each(?6) AS entry
                 WHERE json_extract(entry.value, '$.itemKind') = item_kind
                   AND json_extract(entry.value, '$.id') = item_id
                   AND json_extract(entry.value, '$.version') = item_version
               )
               WHERE workspace_id = ?1 AND collection_id = ?3
                 AND EXISTS (SELECT 1 FROM library_collections c
                   WHERE c.workspace_id = ?1 AND c.owner_principal_id = ?2 AND c.id = ?3
                     AND c.revision = ?4 + 1 AND c.last_mutation_key = ?5)`
                    )
                    .bind(
                      workspaceId,
                      principalId,
                      id,
                      expectedRevision,
                      mutationKey,
                      orderedJson
                    ),
                ]),
          ],
          collection: {
            summary: {
              ...current.summary,
              revision: expectedRevision + 1,
              updatedAt: now,
            },
            members: [...ordered],
          },
        }
      },
    })) as LibraryReorderCollectionMembersReceipt
  }

  async deleteCollection(
    workspaceId: string,
    principalId: string,
    collectionIdInput: string,
    expectedRevision: number,
    keyInput: string
  ): Promise<LibraryDeleteCollectionReceipt> {
    const collectionId = libraryCollectionIdSchema.parse(collectionIdInput)
    const key = assertIdempotencyKey(keyInput)
    const operation = "delete_collection" as const
    const hash = await canonicalHash({
      operation,
      collectionId,
      expectedRevision,
    })
    const replay = await this.replay<LibraryDeleteCollectionReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation
    )
    if (replay) {
      return this.completeDeleteCollectionReceipt({
        workspaceId,
        principalId,
        key,
        hash,
        collectionId,
        deletedRevision: replay.deletedRevision,
      })
    }
    const repair = (claim: MutationClaimRow) =>
      this.repairDeleteCollectionClaim({
        workspaceId,
        principalId,
        key,
        hash,
        collectionId,
        claim,
      })
    const claimReplay =
      await this.reconcileClaim<LibraryDeleteCollectionReceipt>(
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        repair
      )
    if (claimReplay) return claimReplay
    const current = await this.getCollection(
      workspaceId,
      principalId,
      collectionId
    )
    if (current.summary.revision !== expectedRevision) {
      throw new LibraryPreferenceError(
        "library_collection_revision_mismatch",
        412,
        "Library collection changed before this mutation"
      )
    }
    const now = this.now()
    const statements = [
      this.db
        .prepare(
          `/* library:collection-claim-delete */ UPDATE library_collections
         SET revision = revision + 1, last_mutation_key = ?5, updated_at = ?6
           , last_mutation_hash = ?7,
           last_mutation_operation = 'delete_collection'
         WHERE workspace_id = ?1 AND owner_principal_id = ?2 AND id = ?3 AND revision = ?4`
        )
        .bind(
          workspaceId,
          principalId,
          collectionId,
          expectedRevision,
          key,
          now,
          hash
        ),
    ]
    const { receipt, writeError } =
      await this.runAndReplay<LibraryDeleteCollectionReceipt>({
        workspaceId,
        principalId,
        key,
        hash,
        operation,
        statements,
      })
    if (receipt) return receipt
    const repaired = await this.reconcileClaim<LibraryDeleteCollectionReceipt>(
      workspaceId,
      principalId,
      key,
      hash,
      operation,
      repair
    )
    if (repaired) return repaired
    try {
      const latest = await this.getCollection(
        workspaceId,
        principalId,
        collectionId
      )
      if (latest.summary.revision !== expectedRevision) {
        throw new LibraryPreferenceError(
          "library_collection_revision_mismatch",
          412,
          "Library collection changed before this mutation"
        )
      }
    } catch (error) {
      if (
        error instanceof LibraryPreferenceError &&
        error.code === "library_collection_not_found" &&
        writeError
      )
        throw writeError
      throw error
    }
    if (writeError) throw writeError
    throw new Error("library_collection_delete_incomplete")
  }
}
