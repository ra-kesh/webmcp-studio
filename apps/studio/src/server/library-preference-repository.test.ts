import { describe, expect, it } from "vitest"
import { LibraryPreferenceRepository } from "./library-preference-repository"
import { sha256Hex } from "./media-assets"

type Row = Record<string, any>

const identity = {
  itemKind: "template" as const,
  id: "template-editorial",
  version: 1,
}
const otherIdentity = {
  itemKind: "media" as const,
  id: "asset-library-0001",
  version: 2,
  mediaSource: "managed" as const,
}

const sourceFor = (value: {
  itemKind: "template" | "media"
  mediaSource?: string
}) => (value.itemKind === "media" ? value.mediaSource : "template")

const rowIdentityKey = (row: Row) =>
  row.item_kind === "media"
    ? `media:${row.item_source}:${row.item_id}@${row.item_version}`
    : `template:${row.item_id}@${row.item_version}`

const legacyHash = (value: unknown) =>
  sha256Hex(new TextEncoder().encode(JSON.stringify(value)))
const thirdIdentity = {
  itemKind: "template" as const,
  id: "template-modern",
  version: 3,
}

class FakeStatement {
  values: unknown[] = []

  constructor(
    readonly query: string,
    private readonly state: FakeD1
  ) {}

  bind(...values: unknown[]) {
    if (values.length > 100) {
      throw new Error(`D1 bound parameter limit exceeded: ${values.length}`)
    }
    this.values = values
    return this as unknown as D1PreparedStatement
  }

  async first<T>() {
    return (this.rows()[0] ?? null) as T | null
  }

  async all<T>() {
    return { results: this.rows() as T[] } as D1Result<T>
  }

  async run<T>() {
    return {
      meta: { changes: this.mutate() },
      results: [],
    } as unknown as D1Result<T>
  }

  marker() {
    return this.query.match(/\/\* (library:[^ ]+) \*\//)?.[1]
  }

  rows(): Row[] {
    const marker = this.marker()
    const [workspaceId, principalId, third] = this.values as string[]
    if (marker === "library:workspace-revision") {
      return [{ revision: this.state.revisions.get(workspaceId) ?? 0 }]
    }
    if (marker === "library:preference-list") {
      return this.state.preferences.filter(
        (row) =>
          row.workspace_id === workspaceId && row.principal_id === principalId
      )
    }
    if (marker === "library:membership-list") {
      const owned = new Set(
        this.state.collections
          .filter(
            (row) =>
              row.workspace_id === workspaceId &&
              row.owner_principal_id === principalId
          )
          .map((row) => row.id)
      )
      return this.state.members
        .filter(
          (row) =>
            row.workspace_id === workspaceId && owned.has(row.collection_id)
        )
        .sort((a, b) => a.collection_id.localeCompare(b.collection_id))
    }
    if (marker === "library:collection-list") {
      return this.state.collections
        .filter(
          (row) =>
            row.workspace_id === workspaceId &&
            row.owner_principal_id === principalId
        )
        .map((row) => ({
          ...row,
          item_count: this.state.members.filter(
            (member) =>
              member.workspace_id === workspaceId &&
              member.collection_id === row.id
          ).length,
        }))
    }
    if (marker === "library:collection-get") {
      return this.state.collections
        .filter(
          (row) =>
            row.workspace_id === workspaceId &&
            row.owner_principal_id === principalId &&
            row.id === third
        )
        .map((row) => ({
          ...row,
          item_count: this.state.members.filter(
            (member) =>
              member.workspace_id === workspaceId &&
              member.collection_id === row.id
          ).length,
        }))
    }
    if (marker === "library:collection-members") {
      return this.state.members
        .filter(
          (row) =>
            row.workspace_id === workspaceId &&
            row.collection_id === principalId
        )
        .sort((a, b) => a.position - b.position)
    }
    if (marker === "library:request-get") {
      return this.state.requests.filter(
        (row) =>
          row.workspace_id === workspaceId &&
          row.principal_id === principalId &&
          row.idempotency_key === third
      )
    }
    if (marker === "library:claim-get") {
      const target = [
        ...this.state.preferences,
        ...this.state.collections,
      ].find(
        (row) =>
          row.workspace_id === workspaceId &&
          (row.principal_id === principalId ||
            row.owner_principal_id === principalId) &&
          row.last_mutation_key === third
      )
      this.state.onClaimRead?.()
      this.state.onClaimRead = null
      return target
        ? [
            {
              operation: target.last_mutation_operation,
              request_hash: target.last_mutation_hash,
              result_kind:
                "principal_id" in target ? "preference" : "collection",
              result_identity:
                "principal_id" in target ? rowIdentityKey(target) : target.id,
              result_revision: target.revision,
            },
          ]
        : []
    }
    return []
  }

  mutate() {
    const marker = this.marker()
    const value = this.values as any[]
    if (marker === "library:set-favorite") {
      const [
        workspace,
        principal,
        kind,
        source,
        id,
        version,
        expected,
        favorite,
        key,
        now,
        hash,
      ] = value
      const current = this.state.preference(
        workspace,
        principal,
        kind,
        source,
        id,
        version
      )
      if (!current && expected === 0) {
        this.state.preferences.push({
          workspace_id: workspace,
          principal_id: principal,
          item_kind: kind,
          item_source: source,
          item_id: id,
          item_version: version,
          favorite,
          last_used_at: null,
          revision: 1,
          last_mutation_key: key,
          last_mutation_hash: hash,
          last_mutation_operation: "set_favorite",
          created_at: now,
          updated_at: now,
        })
        this.state.bump(workspace)
        return 1
      }
      if (
        current &&
        expected > 0 &&
        /^\s*\/\* library:set-favorite \*\/\s*UPDATE\b/.test(this.query) &&
        current.revision === expected &&
        current.last_mutation_key !== key
      ) {
        Object.assign(current, {
          favorite,
          revision: current.revision + 1,
          last_mutation_key: key,
          last_mutation_hash: hash,
          last_mutation_operation: "set_favorite",
          updated_at: now,
        })
        this.state.bump(workspace)
        return 1
      }
      return 0
    }
    if (marker === "library:record-used") {
      const [
        workspace,
        principal,
        kind,
        source,
        id,
        version,
        key,
        now,
        hash,
        expected,
      ] = value
      const current = this.state.preference(
        workspace,
        principal,
        kind,
        source,
        id,
        version
      )
      if (!current) {
        this.state.preferences.push({
          workspace_id: workspace,
          principal_id: principal,
          item_kind: kind,
          item_source: source,
          item_id: id,
          item_version: version,
          favorite: 0,
          last_used_at: now,
          revision: 1,
          last_mutation_key: key,
          last_mutation_hash: hash,
          last_mutation_operation: "record_used",
          created_at: now,
          updated_at: now,
        })
      } else if (
        current.revision === expected &&
        current.last_mutation_key !== key
      ) {
        current.last_used_at = [current.last_used_at, now]
          .filter(Boolean)
          .sort()
          .at(-1)
        current.updated_at = [current.updated_at, now].sort().at(-1)
        current.revision += 1
        current.last_mutation_key = key
        current.last_mutation_hash = hash
        current.last_mutation_operation = "record_used"
      } else {
        return 0
      }
      this.state.bump(workspace)
      return 1
    }
    if (marker === "library:preference-receipt") {
      const [
        workspace,
        principal,
        key,
        operation,
        hash,
        kind,
        id,
        version,
        now,
        completedAction,
        completionId,
        resultRevision,
      ] = value
      const row = this.state.preference(workspace, principal, kind, id, version)
      if (this.state.dropNextReceiptInsert) {
        this.state.dropNextReceiptInsert = false
        return 0
      }
      if (
        !row ||
        row.last_mutation_key !== key ||
        row.last_mutation_hash !== hash ||
        row.last_mutation_operation !== operation ||
        row.revision !== resultRevision
      )
        return 0
      const collectionIds = this.state.collectionIdsFor(
        workspace,
        principal,
        kind,
        id,
        version
      )
      const response: Row = {
        schemaVersion: 1,
        operation,
        preference: {
          identity: { itemKind: kind, id, version },
          favorite: Boolean(row.favorite),
          lastUsedAt: row.last_used_at,
          collectionIds,
          revision: row.revision,
          updatedAt: row.updated_at,
        },
        workspaceRevision: this.state.revisions.get(workspace) ?? 0,
      }
      if (operation === "record_used") {
        response.completedAction = completedAction
        response.completionId = completionId
      }
      this.state.insertRequest({
        workspace_id: workspace,
        principal_id: principal,
        idempotency_key: key,
        operation,
        request_hash: hash,
        result_kind: "preference",
        result_identity: `${kind}:${id}@${version}`,
        result_revision: row.revision,
        response_json: this.state.malformedNextReceipt
          ? "{not-json"
          : JSON.stringify(response),
        created_at: now,
      })
      this.state.malformedNextReceipt = false
      return 1
    }
    if (marker === "library:collection-create") {
      const [id, workspace, principal, name, normalized, key, now, hash] = value
      if (
        this.state.collections.some(
          (row) =>
            row.workspace_id === workspace &&
            row.owner_principal_id === principal &&
            row.normalized_name === normalized
        )
      ) {
        throw new Error(
          "UNIQUE constraint failed: library_collections.workspace_id, library_collections.owner_principal_id, library_collections.normalized_name"
        )
      }
      this.state.collections.push({
        id,
        workspace_id: workspace,
        owner_principal_id: principal,
        name,
        normalized_name: normalized,
        revision: 1,
        last_mutation_key: key,
        last_mutation_hash: hash,
        last_mutation_operation: "create_collection",
        created_at: now,
        updated_at: now,
      })
      this.state.bump(workspace)
      return 1
    }
    if (marker === "library:collection-receipt") {
      const [
        workspace,
        principal,
        key,
        operation,
        hash,
        id,
        revision,
        json,
        now,
      ] = value
      const collection = this.state.collection(workspace, principal, id)
      if (this.state.dropNextReceiptInsert) {
        this.state.dropNextReceiptInsert = false
        return 0
      }
      if (
        !collection ||
        collection.last_mutation_key !== key ||
        collection.last_mutation_hash !== hash ||
        collection.last_mutation_operation !== operation ||
        collection.revision !== revision
      ) {
        return 0
      }
      const response = JSON.parse(json)
      response.workspaceRevision = this.state.revisions.get(workspace) ?? 0
      this.state.insertRequest({
        workspace_id: workspace,
        principal_id: principal,
        idempotency_key: key,
        operation,
        request_hash: hash,
        result_kind: "collection",
        result_identity: id,
        result_revision: revision,
        response_json: JSON.stringify(response),
        created_at: now,
      })
      return 1
    }
    if (
      marker === "library:collection-rename" ||
      marker === "library:collection-claim-add" ||
      marker === "library:collection-claim-remove" ||
      marker === "library:collection-claim-reorder" ||
      marker === "library:collection-claim-delete"
    ) {
      const [workspace, principal, id, expected, key] = value
      const row = this.state.collection(workspace, principal, id)
      if (!row || row.revision !== expected) return 0
      if (marker === "library:collection-claim-add") {
        const [, , , , , , kind, itemId, version, , source] = value
        if (this.state.member(workspace, id, kind, source, itemId, version))
          return 0
      }
      if (marker === "library:collection-claim-remove") {
        const [, , , , , , kind, itemId, version, , source] = value
        if (!this.state.member(workspace, id, kind, source, itemId, version))
          return 0
      }
      if (marker === "library:collection-rename") {
        const [, , , , , name, normalized, now] = value
        if (
          this.state.collections.some(
            (candidate) =>
              candidate !== row &&
              candidate.workspace_id === workspace &&
              candidate.owner_principal_id === principal &&
              candidate.normalized_name === normalized
          )
        ) {
          throw new Error("UNIQUE constraint failed")
        }
        row.name = name
        row.normalized_name = normalized
        row.updated_at = now
      } else {
        row.updated_at = value[5]
      }
      row.revision += 1
      row.last_mutation_key = key
      const claim = {
        "library:collection-rename": [value[8], "rename_collection"],
        "library:collection-claim-add": [value[9], "add_collection_member"],
        "library:collection-claim-remove": [
          value[9],
          "remove_collection_member",
        ],
        "library:collection-claim-reorder": [
          value[7],
          "reorder_collection_members",
        ],
        "library:collection-claim-delete": [value[6], "delete_collection"],
      }[marker]!
      row.last_mutation_hash = claim[0]
      row.last_mutation_operation = claim[1]
      this.state.bump(workspace)
      return 1
    }
    if (marker === "library:member-add") {
      const [
        workspace,
        principal,
        collectionId,
        expected,
        key,
        kind,
        id,
        version,
        now,
        source,
      ] = value
      const collection = this.state.collection(
        workspace,
        principal,
        collectionId
      )
      if (
        !collection ||
        collection.revision !== expected + 1 ||
        collection.last_mutation_key !== key
      )
        return 0
      this.state.members.push({
        workspace_id: workspace,
        collection_id: collectionId,
        item_kind: kind,
        item_source: source,
        item_id: id,
        item_version: version,
        position: this.state.members.filter(
          (row) =>
            row.workspace_id === workspace && row.collection_id === collectionId
        ).length,
        added_at: now,
      })
      this.state.bump(workspace)
      return 1
    }
    if (marker === "library:member-remove") {
      const [
        workspace,
        principal,
        collectionId,
        expected,
        key,
        kind,
        id,
        version,
        source,
      ] = value
      const collection = this.state.collection(
        workspace,
        principal,
        collectionId
      )
      if (
        !collection ||
        collection.revision !== expected + 1 ||
        collection.last_mutation_key !== key
      )
        return 0
      const index = this.state.members.findIndex(
        (row) =>
          row.workspace_id === workspace &&
          row.collection_id === collectionId &&
          row.item_kind === kind &&
          row.item_source === source &&
          row.item_id === id &&
          row.item_version === version
      )
      if (index < 0) return 0
      this.state.members.splice(index, 1)
      this.state.bump(workspace)
      return 1
    }
    if (
      marker === "library:member-compact-offset" ||
      marker === "library:member-compact"
    ) {
      const [
        workspace,
        principal,
        collectionId,
        expected,
        key,
        removedPosition,
      ] = value
      const collection = this.state.collection(
        workspace,
        principal,
        collectionId
      )
      if (
        !collection ||
        collection.revision !== expected + 1 ||
        collection.last_mutation_key !== key
      )
        return 0
      for (const member of this.state.members) {
        if (
          member.workspace_id === workspace &&
          member.collection_id === collectionId &&
          member.position >
            (marker === "library:member-compact"
              ? 1000 + removedPosition
              : removedPosition)
        )
          member.position += marker === "library:member-compact" ? -1001 : 1000
      }
      return 1
    }
    if (marker === "library:member-offset") {
      const [workspace, principal, collectionId, expected, key] = value
      const collection = this.state.collection(
        workspace,
        principal,
        collectionId
      )
      if (
        !collection ||
        collection.revision !== expected + 1 ||
        collection.last_mutation_key !== key
      )
        return 0
      for (const member of this.state.members) {
        if (
          member.workspace_id === workspace &&
          member.collection_id === collectionId
        )
          member.position += 1000
      }
      return 1
    }
    if (marker === "library:member-reorder") {
      const [workspace, principal, collectionId, expected, key] = value
      const collection = this.state.collection(
        workspace,
        principal,
        collectionId
      )
      if (
        !collection ||
        collection.revision !== expected + 1 ||
        collection.last_mutation_key !== key
      )
        return 0
      for (const [position, ordered] of JSON.parse(value[5]).entries()) {
        const { itemKind: kind, id, version, mediaSource } = ordered
        const member = this.state.member(
          workspace,
          collectionId,
          kind,
          kind === "media" ? mediaSource : "template",
          id,
          version
        )
        if (member) member.position = position
      }
      return 1
    }
    if (marker === "library:collection-delete-receipt") {
      const [
        workspace,
        principal,
        key,
        operation,
        hash,
        id,
        revision,
        json,
        now,
      ] = value
      const row = this.state.collection(workspace, principal, id)
      if (this.state.dropNextReceiptInsert) {
        this.state.dropNextReceiptInsert = false
        return 0
      }
      if (
        !row ||
        row.revision !== revision ||
        row.last_mutation_key !== key ||
        row.last_mutation_hash !== hash ||
        row.last_mutation_operation !== operation
      )
        return 0
      this.state.insertRequest({
        workspace_id: workspace,
        principal_id: principal,
        idempotency_key: key,
        operation,
        request_hash: hash,
        result_kind: "collection",
        result_identity: id,
        result_revision: revision,
        response_json: json,
        created_at: now,
      })
      return 1
    }
    if (marker === "library:receipt-assert") {
      const [
        workspace,
        principal,
        key,
        operation,
        hash,
        kind,
        identity,
        revision,
      ] = value
      const request = this.state.requests.find(
        (row) =>
          row.workspace_id === workspace &&
          row.principal_id === principal &&
          row.idempotency_key === key &&
          row.operation === operation &&
          row.request_hash === hash &&
          row.result_kind === kind &&
          row.result_identity === identity &&
          row.result_revision === revision
      )
      if (!request) throw new Error("library receipt missing")
      return 0
    }
    if (marker === "library:receipt-value") {
      const [
        workspace,
        principal,
        key,
        operation,
        hash,
        kind,
        identity,
        revision,
        response,
        now,
      ] = value
      if (this.state.dropNextReceiptInsert) {
        this.state.dropNextReceiptInsert = false
        return 0
      }
      const target =
        kind === "preference"
          ? this.state.preferences.find(
              (row) =>
                row.workspace_id === workspace &&
                row.principal_id === principal &&
                rowIdentityKey(row) === identity
            )
          : this.state.collection(workspace, principal, identity)
      if (
        !target ||
        target.revision !== revision ||
        target.last_mutation_key !== key ||
        target.last_mutation_hash !== hash ||
        target.last_mutation_operation !== operation
      ) {
        throw new Error("claim guard")
      }
      this.state.insertRequest({
        workspace_id: workspace,
        principal_id: principal,
        idempotency_key: key,
        operation,
        request_hash: hash,
        result_kind: kind,
        result_identity: identity,
        result_revision: revision,
        response_json: this.state.malformedNextReceipt ? "{not-json" : response,
        created_at: now,
      })
      this.state.malformedNextReceipt = false
      return 1
    }
    if (marker === "library:collection-delete") {
      const [workspace, principal, id, revision, key] = value
      const index = this.state.collections.findIndex(
        (row) =>
          row.workspace_id === workspace &&
          row.owner_principal_id === principal &&
          row.id === id &&
          row.revision === revision &&
          row.last_mutation_key === key
      )
      if (index < 0) return 0
      this.state.collections.splice(index, 1)
      this.state.members = this.state.members.filter(
        (member) =>
          member.workspace_id !== workspace || member.collection_id !== id
      )
      this.state.bump(workspace)
      return 1
    }
    if (marker === "library:delete-receipt-revision") {
      const [workspace, principal, key, hash] = value
      const request = this.state.requests.find(
        (row) =>
          row.workspace_id === workspace &&
          row.principal_id === principal &&
          row.idempotency_key === key &&
          row.request_hash === hash
      )
      if (!request) return 0
      const response = JSON.parse(request.response_json)
      response.workspaceRevision = this.state.revisions.get(workspace) ?? 0
      request.response_json = JSON.stringify(response)
      return 1
    }
    return 0
  }
}

class FakeD1 {
  preferences: Row[] = []
  collections: Row[] = []
  members: Row[] = []
  requests: Row[] = []
  revisions = new Map<string, number>()
  malformedNextReceipt = false
  dropNextReceiptInsert = false
  batchMarkers: string[][] = []
  onClaimRead: (() => void) | null = null
  mutationBatchFailure: Error | null = null
  mutationBatchFailureMarker: string | null = null

  prepare(query: string) {
    return new FakeStatement(query, this) as unknown as D1PreparedStatement
  }

  async batch(statements: D1PreparedStatement[]) {
    const markers = statements.map(
      (statement) =>
        (statement as unknown as FakeStatement).marker() ?? "unknown"
    )
    this.batchMarkers.push(markers)
    const isReadBatch = statements.every((statement) =>
      [
        "library:workspace-revision",
        "library:preference-list",
        "library:membership-list",
        "library:collection-list",
        "library:collection-get",
        "library:collection-members",
      ].includes((statement as unknown as FakeStatement).marker() ?? "")
    )
    if (!isReadBatch && this.mutationBatchFailure) {
      const failure = this.mutationBatchFailure
      this.mutationBatchFailure = null
      throw failure
    }
    if (
      this.mutationBatchFailureMarker &&
      markers.includes(this.mutationBatchFailureMarker)
    ) {
      const marker = this.mutationBatchFailureMarker
      this.mutationBatchFailureMarker = null
      throw new Error(`D1 write unavailable at ${marker}`)
    }
    const snapshot = structuredClone({
      preferences: this.preferences,
      collections: this.collections,
      members: this.members,
      requests: this.requests,
      revisions: [...this.revisions],
    })
    try {
      return statements.map((statement) => {
        const fake = statement as unknown as FakeStatement
        const marker = fake.marker()
        if (
          marker === "library:workspace-revision" ||
          marker === "library:preference-list" ||
          marker === "library:membership-list" ||
          marker === "library:collection-list" ||
          marker === "library:collection-get" ||
          marker === "library:collection-members"
        ) {
          return {
            meta: { changes: 0 },
            results: fake.rows(),
          } as unknown as D1Result<unknown>
        }
        const changes = fake.mutate()
        return {
          meta: { changes },
          results: [],
        } as unknown as D1Result<unknown>
      })
    } catch (error) {
      this.preferences = snapshot.preferences
      this.collections = snapshot.collections
      this.members = snapshot.members
      this.requests = snapshot.requests
      this.revisions = new Map(snapshot.revisions)
      throw error
    }
  }

  bump(workspace: string) {
    this.revisions.set(workspace, (this.revisions.get(workspace) ?? 0) + 1)
  }

  preference(
    workspace: string,
    principal: string,
    kind: string,
    sourceOrId: string,
    idOrVersion: string | number,
    maybeVersion?: number
  ) {
    const source =
      maybeVersion === undefined
        ? kind === "media"
          ? "managed"
          : "template"
        : sourceOrId
    const id = maybeVersion === undefined ? sourceOrId : String(idOrVersion)
    const version =
      maybeVersion === undefined ? Number(idOrVersion) : maybeVersion
    return this.preferences.find(
      (row) =>
        row.workspace_id === workspace &&
        row.principal_id === principal &&
        row.item_kind === kind &&
        row.item_source === source &&
        row.item_id === id &&
        row.item_version === version
    )
  }

  collection(workspace: string, principal: string, id: string) {
    return this.collections.find(
      (row) =>
        row.workspace_id === workspace &&
        row.owner_principal_id === principal &&
        row.id === id
    )
  }

  member(
    workspace: string,
    collection: string,
    kind: string,
    sourceOrId: string,
    idOrVersion: string | number,
    maybeVersion?: number
  ) {
    const source =
      maybeVersion === undefined
        ? kind === "media"
          ? "managed"
          : "template"
        : sourceOrId
    const id = maybeVersion === undefined ? sourceOrId : String(idOrVersion)
    const version =
      maybeVersion === undefined ? Number(idOrVersion) : maybeVersion
    return this.members.find(
      (row) =>
        row.workspace_id === workspace &&
        row.collection_id === collection &&
        row.item_kind === kind &&
        row.item_source === source &&
        row.item_id === id &&
        row.item_version === version
    )
  }

  collectionIdsFor(
    workspace: string,
    principal: string,
    kind: string,
    id: string,
    version: number
  ) {
    const owned = new Set(
      this.collections
        .filter(
          (row) =>
            row.workspace_id === workspace &&
            row.owner_principal_id === principal
        )
        .map((row) => row.id)
    )
    return this.members
      .filter(
        (row) =>
          row.workspace_id === workspace &&
          owned.has(row.collection_id) &&
          row.item_kind === kind &&
          row.item_id === id &&
          row.item_version === version
      )
      .map((row) => row.collection_id)
  }

  insertRequest(row: Row) {
    if (
      this.requests.some(
        (candidate) =>
          candidate.workspace_id === row.workspace_id &&
          candidate.principal_id === row.principal_id &&
          candidate.idempotency_key === row.idempotency_key
      )
    ) {
      throw new Error("UNIQUE constraint failed")
    }
    this.requests.push(row)
  }
}

const fixture = () => {
  const db = new FakeD1()
  let tick = 0
  const admissions: string[] = []
  const repository = new LibraryPreferenceRepository(
    db as unknown as D1Database,
    {
      async assertCanFavorite(workspace, principal, item) {
        admissions.push(
          `favorite:${workspace}:${principal}:${item.itemKind}:${item.id}@${item.version}`
        )
      },
      async assertCanUse(workspace, principal, item) {
        admissions.push(
          `use:${workspace}:${principal}:${item.itemKind}:${item.id}@${item.version}`
        )
      },
      async assertCanAddToCollection(workspace, principal, item) {
        admissions.push(
          `collection:${workspace}:${principal}:${item.itemKind}:${item.id}@${item.version}`
        )
      },
    },
    {
      now: () => `2026-08-31T00:00:${String(tick++).padStart(2, "0")}.000Z`,
      createCollectionId: () => `collection-${String(tick).padStart(12, "0")}`,
    }
  )
  return { db, repository, admissions }
}

describe("LibraryPreferenceRepository", () => {
  it("replays migrated legacy media preference receipts only for the exact source", async () => {
    const { db, repository, admissions } = fixture()
    const curated = {
      itemKind: "media" as const,
      id: "shared-legacy-media",
      version: 1,
      mediaSource: "curated" as const,
    }
    const managed = { ...curated, mediaSource: "managed" as const }
    const sourceLess = {
      itemKind: "media" as const,
      id: curated.id,
      version: curated.version,
    }
    const favoriteHash = await legacyHash({
      operation: "set_favorite",
      identity: sourceLess,
      expectedRevision: 0,
      favorite: true,
    })
    const usedHash = await legacyHash({
      operation: "record_used",
      identity: sourceLess,
      completedAction: "insert",
      completionId: "legacy-use-completion",
    })
    const preference = (input: {
      source: "curated" | "managed"
      key: string
      hash: string
      operation: "set_favorite" | "record_used"
      lastUsedAt: string | null
    }) => ({
      workspace_id: "workspace-a",
      principal_id: "principal-a",
      item_kind: "media",
      item_source: input.source,
      item_id: curated.id,
      item_version: 1,
      favorite: 1,
      last_used_at: input.lastUsedAt,
      revision: 1,
      last_mutation_key: input.key,
      last_mutation_hash: input.hash,
      last_mutation_operation: input.operation,
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })
    const favoritePreference = preference({
      source: "curated",
      key: "legacy-favorite",
      hash: favoriteHash,
      operation: "set_favorite",
      lastUsedAt: null,
    })
    const usedPreference = preference({
      source: "managed",
      key: "legacy-used",
      hash: usedHash,
      operation: "record_used",
      lastUsedAt: "2026-08-31T00:00:00.000Z",
    })
    db.preferences.push(favoritePreference, usedPreference)
    db.requests.push(
      {
        workspace_id: "workspace-a",
        principal_id: "principal-a",
        idempotency_key: "legacy-favorite",
        operation: "set_favorite",
        request_hash: favoriteHash,
        result_kind: "preference",
        result_identity: `media:curated:${curated.id}@1`,
        result_revision: 1,
        response_json: JSON.stringify({
          schemaVersion: 1,
          operation: "set_favorite",
          preference: {
            identity: curated,
            favorite: true,
            lastUsedAt: null,
            collectionIds: [],
            revision: 1,
            updatedAt: "2026-08-31T00:00:00.000Z",
          },
          workspaceRevision: 1,
        }),
        created_at: "2026-08-31T00:00:00.000Z",
      },
      {
        workspace_id: "workspace-a",
        principal_id: "principal-a",
        idempotency_key: "legacy-used",
        operation: "record_used",
        request_hash: usedHash,
        result_kind: "preference",
        result_identity: `media:managed:${managed.id}@1`,
        result_revision: 1,
        response_json: JSON.stringify({
          schemaVersion: 1,
          operation: "record_used",
          completedAction: "insert",
          completionId: "legacy-use-completion",
          preference: {
            identity: managed,
            favorite: true,
            lastUsedAt: "2026-08-31T00:00:00.000Z",
            collectionIds: [],
            revision: 1,
            updatedAt: "2026-08-31T00:00:00.000Z",
          },
          workspaceRevision: 1,
        }),
        created_at: "2026-08-31T00:00:00.000Z",
      }
    )

    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        curated,
        0,
        true,
        "legacy-favorite"
      )
    ).resolves.toMatchObject({ preference: { identity: curated } })
    await expect(
      repository.recordUsed(
        "workspace-a",
        "principal-a",
        managed,
        "insert",
        "legacy-use-completion",
        "legacy-used"
      )
    ).resolves.toMatchObject({ preference: { identity: managed } })
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        managed,
        0,
        true,
        "legacy-favorite"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    await expect(
      repository.recordUsed(
        "workspace-a",
        "principal-a",
        curated,
        "insert",
        "legacy-use-completion",
        "legacy-used"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        curated,
        0,
        false,
        "legacy-favorite"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    expect(admissions).toEqual([])
  })

  it("repairs receiptless legacy favorite and Recent claims on the first exact-source retry", async () => {
    const { db, repository, admissions } = fixture()
    const curated = {
      itemKind: "media" as const,
      id: "receiptless-legacy-media",
      version: 1,
      mediaSource: "curated" as const,
    }
    const managed = { ...curated, mediaSource: "managed" as const }
    const sourceLess = {
      itemKind: "media" as const,
      id: curated.id,
      version: curated.version,
    }
    const favoriteHash = await legacyHash({
      operation: "set_favorite",
      identity: sourceLess,
      expectedRevision: 0,
      favorite: true,
    })
    const usedHash = await legacyHash({
      operation: "record_used",
      identity: sourceLess,
      completedAction: "insert",
      completionId: "receiptless-use-completion",
    })
    const preference = (input: {
      source: "curated" | "managed"
      key: string
      hash: string
      operation: "set_favorite" | "record_used"
      lastUsedAt: string | null
    }) => ({
      workspace_id: "workspace-a",
      principal_id: "principal-a",
      item_kind: "media",
      item_source: input.source,
      item_id: curated.id,
      item_version: curated.version,
      favorite: 1,
      last_used_at: input.lastUsedAt,
      revision: 1,
      last_mutation_key: input.key,
      last_mutation_hash: input.hash,
      last_mutation_operation: input.operation,
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })
    db.preferences.push(
      preference({
        source: "curated",
        key: "receiptless-legacy-favorite",
        hash: favoriteHash,
        operation: "set_favorite",
        lastUsedAt: null,
      }),
      preference({
        source: "managed",
        key: "receiptless-legacy-used",
        hash: usedHash,
        operation: "record_used",
        lastUsedAt: "2026-08-31T00:00:00.000Z",
      })
    )

    const favorite = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      curated,
      0,
      true,
      "receiptless-legacy-favorite"
    )
    const used = await repository.recordUsed(
      "workspace-a",
      "principal-a",
      managed,
      "insert",
      "receiptless-use-completion",
      "receiptless-legacy-used"
    )

    expect(favorite.preference.identity).toEqual(curated)
    expect(used.preference.identity).toEqual(managed)
    expect(db.requests).toHaveLength(2)
    expect(db.requests.map(({ request_hash }) => request_hash)).toEqual([
      favoriteHash,
      usedHash,
    ])
    expect(db.preferences.map(({ revision }) => revision)).toEqual([1, 1])

    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        curated,
        0,
        true,
        "receiptless-legacy-favorite"
      )
    ).resolves.toEqual(favorite)
    await expect(
      repository.recordUsed(
        "workspace-a",
        "principal-a",
        managed,
        "insert",
        "receiptless-use-completion",
        "receiptless-legacy-used"
      )
    ).resolves.toEqual(used)
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        managed,
        0,
        true,
        "receiptless-legacy-favorite"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    await expect(
      repository.recordUsed(
        "workspace-a",
        "principal-a",
        curated,
        "insert",
        "receiptless-use-completion",
        "receiptless-legacy-used"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    expect(db.requests).toHaveLength(2)
    expect(db.preferences.map(({ revision }) => revision)).toEqual([1, 1])
    expect(admissions).toEqual([])
  })

  it("replays migrated add, remove, and reorder receipts with exact member sources", async () => {
    const { db, repository, admissions } = fixture()
    const collectionId = "collection-legacy-media"
    const curated = {
      itemKind: "media" as const,
      id: "shared-legacy-collection-media",
      version: 1,
      mediaSource: "curated" as const,
    }
    const managed = { ...curated, mediaSource: "managed" as const }
    const managedSecond = {
      itemKind: "media" as const,
      id: "second-legacy-collection-media",
      version: 2,
      mediaSource: "managed" as const,
    }
    const curatedSecond = {
      ...managedSecond,
      mediaSource: "curated" as const,
    }
    const withoutSource = (item: typeof curated | typeof managedSecond) => ({
      itemKind: item.itemKind,
      id: item.id,
      version: item.version,
    })
    const addHash = await legacyHash({
      operation: "add_collection_member",
      collectionId,
      expectedRevision: 1,
      body: { identity: withoutSource(curated) },
    })
    const removeHash = await legacyHash({
      operation: "remove_collection_member",
      collectionId,
      expectedRevision: 2,
      body: { identity: withoutSource(curated) },
    })
    const ordered = [managedSecond, curated]
    const reorderHash = await legacyHash({
      operation: "reorder_collection_members",
      collectionId,
      expectedRevision: 3,
      body: { ordered: ordered.map(withoutSource) },
    })
    const collection = (
      revision: number,
      members: readonly (typeof curated | typeof managedSecond)[]
    ) => ({
      summary: {
        id: collectionId,
        name: "Legacy media",
        scope: "workspace" as const,
        revision,
        itemCount: members.length,
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: `2026-08-31T00:00:0${revision}.000Z`,
      },
      members,
    })
    const request = (input: {
      key: string
      operation:
        | "add_collection_member"
        | "remove_collection_member"
        | "reorder_collection_members"
      hash: string
      revision: number
      response: unknown
    }) => ({
      workspace_id: "workspace-a",
      principal_id: "principal-a",
      idempotency_key: input.key,
      operation: input.operation,
      request_hash: input.hash,
      result_kind: "collection",
      result_identity: collectionId,
      result_revision: input.revision,
      response_json: JSON.stringify(input.response),
      created_at: "2026-08-31T00:00:00.000Z",
    })
    db.requests.push(
      request({
        key: "legacy-add-media",
        operation: "add_collection_member",
        hash: addHash,
        revision: 2,
        response: {
          schemaVersion: 1,
          operation: "add_collection_member",
          identity: curated,
          collection: collection(2, [curated]),
          workspaceRevision: 2,
        },
      }),
      request({
        key: "legacy-remove-media",
        operation: "remove_collection_member",
        hash: removeHash,
        revision: 3,
        response: {
          schemaVersion: 1,
          operation: "remove_collection_member",
          identity: curated,
          collection: collection(3, []),
          workspaceRevision: 3,
        },
      }),
      request({
        key: "legacy-reorder-media",
        operation: "reorder_collection_members",
        hash: reorderHash,
        revision: 4,
        response: {
          schemaVersion: 1,
          operation: "reorder_collection_members",
          collection: collection(4, ordered),
          workspaceRevision: 4,
        },
      })
    )

    await expect(
      repository.addCollectionMember(
        "workspace-a",
        "principal-a",
        collectionId,
        1,
        curated,
        "legacy-add-media"
      )
    ).resolves.toMatchObject({ identity: curated })
    await expect(
      repository.removeCollectionMember(
        "workspace-a",
        "principal-a",
        collectionId,
        2,
        curated,
        "legacy-remove-media"
      )
    ).resolves.toMatchObject({ identity: curated })
    await expect(
      repository.reorderCollectionMembers(
        "workspace-a",
        "principal-a",
        collectionId,
        3,
        ordered,
        "legacy-reorder-media"
      )
    ).resolves.toMatchObject({ collection: { members: ordered } })

    await expect(
      repository.addCollectionMember(
        "workspace-a",
        "principal-a",
        collectionId,
        1,
        managed,
        "legacy-add-media"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    await expect(
      repository.removeCollectionMember(
        "workspace-a",
        "principal-a",
        collectionId,
        2,
        managed,
        "legacy-remove-media"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    await expect(
      repository.reorderCollectionMembers(
        "workspace-a",
        "principal-a",
        collectionId,
        3,
        [curatedSecond, curated],
        "legacy-reorder-media"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    await expect(
      repository.reorderCollectionMembers(
        "workspace-a",
        "principal-a",
        collectionId,
        4,
        ordered,
        "legacy-reorder-media"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    expect(admissions).toEqual([])
  })

  it("mutates same-id curated, managed, and local media as independent identities", async () => {
    const { repository } = fixture()
    const identities = (["curated", "managed", "local"] as const).map(
      (mediaSource) => ({
        itemKind: "media" as const,
        id: "shared-media",
        version: 1,
        mediaSource,
      })
    )
    for (const [index, mediaIdentity] of identities.entries()) {
      await repository.setFavorite(
        "workspace-a",
        "principal-a",
        mediaIdentity,
        0,
        true,
        `source-favorite-${index}`
      )
    }
    await repository.recordUsed(
      "workspace-a",
      "principal-a",
      identities[1],
      "insert",
      "source-completion-managed",
      "source-used-managed"
    )

    const projection = await repository.readProjection(
      "workspace-a",
      "principal-a"
    )
    expect(projection.preferences).toHaveLength(3)
    expect(
      projection.preferences.map((entry) => [
        entry.identity.itemKind === "media"
          ? entry.identity.mediaSource
          : "template",
        entry.favorite,
        entry.lastUsedAt !== null,
      ])
    ).toEqual([
      ["curated", true, false],
      ["managed", true, true],
      ["local", true, false],
    ])

    const created = await repository.createCollection(
      "workspace-a",
      "principal-a",
      "Source aware",
      "source-create-collection"
    )
    let revision = created.collection.summary.revision
    for (const [index, mediaIdentity] of identities.entries()) {
      const receipt = await repository.addCollectionMember(
        "workspace-a",
        "principal-a",
        created.collection.summary.id,
        revision,
        mediaIdentity,
        `source-add-${index}`
      )
      revision = receipt.collection.summary.revision
    }
    const collection = await repository.getCollection(
      "workspace-a",
      "principal-a",
      created.collection.summary.id
    )
    expect(collection.members).toEqual(identities)

    const reordered = await repository.reorderCollectionMembers(
      "workspace-a",
      "principal-a",
      created.collection.summary.id,
      revision,
      [identities[2], identities[0], identities[1]],
      "source-reorder"
    )
    const removed = await repository.removeCollectionMember(
      "workspace-a",
      "principal-a",
      created.collection.summary.id,
      reordered.collection.summary.revision,
      identities[0],
      "source-remove-curated"
    )
    expect(removed.collection.members).toEqual([identities[2], identities[1]])
  })

  it("keeps reads isolated by workspace and principal", async () => {
    const { db, repository } = fixture()
    db.preferences.push(
      {
        workspace_id: "workspace-a",
        principal_id: "principal-a",
        item_kind: identity.itemKind,
        item_source: sourceFor(identity),
        item_id: identity.id,
        item_version: identity.version,
        favorite: 1,
        last_used_at: null,
        revision: 3,
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:00:00.000Z",
      },
      {
        workspace_id: "workspace-a",
        principal_id: "principal-b",
        item_kind: otherIdentity.itemKind,
        item_source: sourceFor(otherIdentity),
        item_id: otherIdentity.id,
        item_version: otherIdentity.version,
        favorite: 1,
        last_used_at: null,
        revision: 1,
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:00:00.000Z",
      }
    )
    db.revisions.set("workspace-a", 7)

    await expect(
      repository.readProjection("workspace-a", "principal-a")
    ).resolves.toMatchObject({
      workspaceRevision: 7,
      preferences: [{ identity, favorite: true, revision: 3 }],
    })
    await expect(
      repository.readProjection("workspace-b", "principal-a")
    ).resolves.toEqual({
      workspaceRevision: 0,
      preferences: [],
    })
    expect(db.batchMarkers.slice(-2)).toEqual([
      [
        "library:workspace-revision",
        "library:preference-list",
        "library:membership-list",
      ],
      [
        "library:workspace-revision",
        "library:preference-list",
        "library:membership-list",
      ],
    ])
  })

  it("guards favorite revisions and replays only the exact durable receipt", async () => {
    const { db, repository, admissions } = fixture()
    const first = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "favorite-1"
    )
    const replay = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "favorite-1"
    )
    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      operation: "set_favorite",
      preference: { favorite: true, revision: 1 },
      workspaceRevision: 1,
    })
    expect(db.preferences).toHaveLength(1)
    expect(db.requests).toHaveLength(1)
    expect(admissions).toHaveLength(1)

    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        false,
        "favorite-1"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        false,
        "favorite-2"
      )
    ).rejects.toMatchObject({
      code: "library_preference_revision_mismatch",
      status: 412,
    })
  })

  it("requires favorite admission before expected revision zero can create a cleanup row", async () => {
    const { repository, admissions } = fixture()
    await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      false,
      "favorite-cleanup-new"
    )
    expect(admissions).toEqual([
      `favorite:workspace-a:principal-a:${identity.itemKind}:${identity.id}@${identity.version}`,
    ])
  })

  it("propagates a genuine favorite write failure when the revision did not drift", async () => {
    const { db, repository } = fixture()
    db.mutationBatchFailure = new Error("D1 write unavailable")
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        true,
        "favorite-storage-failure"
      )
    ).rejects.toThrow("D1 write unavailable")
  })

  it("repairs an exact current preference claim when its receipt is missing", async () => {
    const { db, repository } = fixture()
    await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "retained-claim"
    )
    db.requests = []

    const repaired = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "retained-claim"
    )
    expect(repaired).toMatchObject({
      operation: "set_favorite",
      preference: { favorite: true, revision: 1 },
    })
    expect(db.preferences[0]).toMatchObject({ favorite: 1, revision: 1 })
    expect(db.requests).toHaveLength(1)

    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        false,
        "retained-claim"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
  })

  it("repairs a preference target on retry when receipt persistence is interrupted", async () => {
    const { db, repository } = fixture()
    db.dropNextReceiptInsert = true

    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        true,
        "favorite-receipt-assert"
      )
    ).rejects.toMatchObject({ code: "library_receipt_invalid", status: 500 })
    expect(db.preferences).toHaveLength(1)
    expect(db.requests).toHaveLength(0)
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        true,
        "favorite-receipt-assert"
      )
    ).resolves.toMatchObject({
      operation: "set_favorite",
      preference: { revision: 1 },
    })
    expect(db.preferences).toHaveLength(1)
    expect(db.requests).toHaveLength(1)
  })

  it("adopts a receipt that commits between the first replay read and claim preflight", async () => {
    const { db, repository } = fixture()
    const first = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "claim-race"
    )
    const committed = structuredClone(db.requests[0])
    db.requests = []
    db.onClaimRead = () => db.requests.push(committed)

    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        true,
        "claim-race"
      )
    ).resolves.toEqual(first)
    expect(db.preferences[0].revision).toBe(1)
  })

  it("records use monotonically and does not increment on receipt replay", async () => {
    const { db, repository } = fixture()
    const first = await repository.recordUsed(
      "workspace-a",
      "principal-a",
      identity,
      "create",
      "document-created-1",
      "recent-1"
    )
    db.preferences[0].last_used_at = "2026-09-01T00:00:00.000Z"
    db.preferences[0].updated_at = "2026-09-01T00:00:00.000Z"
    const second = await repository.recordUsed(
      "workspace-a",
      "principal-a",
      identity,
      "assign_field",
      "field-assignment-2",
      "recent-2"
    )
    const replay = await repository.recordUsed(
      "workspace-a",
      "principal-a",
      identity,
      "assign_field",
      "field-assignment-2",
      "recent-2"
    )

    expect(first).toMatchObject({
      operation: "record_used",
      completedAction: "create",
      preference: { revision: 1 },
    })
    expect(second).toEqual(replay)
    expect(second).toMatchObject({
      completedAction: "assign_field",
      preference: {
        revision: 2,
        lastUsedAt: "2026-09-01T00:00:00.000Z",
      },
    })
    expect(db.preferences[0].revision).toBe(2)
    expect(db.requests).toHaveLength(2)
  })

  it("updates an existing favorite after Recent without losing use metadata", async () => {
    const { db, repository } = fixture()
    const favorited = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "favorite-before-recent"
    )
    const used = await repository.recordUsed(
      "workspace-a",
      "principal-a",
      identity,
      "create",
      "document-created-after-favorite",
      "recent-after-favorite"
    )
    const unfavorited = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      2,
      false,
      "unfavorite-after-recent"
    )
    const replay = await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      2,
      false,
      "unfavorite-after-recent"
    )

    expect(favorited.preference).toMatchObject({
      favorite: true,
      lastUsedAt: null,
      revision: 1,
    })
    expect(used.preference).toMatchObject({
      favorite: true,
      revision: 2,
    })
    expect(unfavorited).toEqual(replay)
    expect(unfavorited.preference).toMatchObject({
      favorite: false,
      lastUsedAt: used.preference.lastUsedAt,
      revision: 3,
    })
    expect(db.preferences[0]).toMatchObject({
      favorite: 0,
      last_used_at: used.preference.lastUsedAt,
      revision: 3,
      last_mutation_key: "unfavorite-after-recent",
      last_mutation_operation: "set_favorite",
    })
    expect(db.requests).toHaveLength(3)

    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        2,
        true,
        "stale-favorite-after-recent"
      )
    ).rejects.toMatchObject({
      code: "library_preference_revision_mismatch",
      status: 412,
    })
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        otherIdentity,
        1,
        false,
        "missing-favorite-update"
      )
    ).rejects.toMatchObject({
      code: "library_preference_revision_mismatch",
      status: 412,
    })
  })

  it("supports collection CRUD, ordered membership and exact revision checks", async () => {
    const { db, repository } = fixture()
    const created = await repository.createCollection(
      "workspace-a",
      "principal-a",
      "  Client   picks ",
      "collection-create-1"
    )
    expect(created).toMatchObject({
      operation: "create_collection",
      collection: { summary: { name: "Client picks", revision: 1 } },
    })
    if (created.operation !== "create_collection")
      throw new Error("unexpected receipt")
    const collectionId = created.collection.summary.id

    const renamed = await repository.renameCollection(
      "workspace-a",
      "principal-a",
      collectionId,
      1,
      "Portfolio",
      "collection-rename-1"
    )
    expect(renamed).toMatchObject({
      operation: "rename_collection",
      collection: { summary: { name: "Portfolio", revision: 2 } },
    })

    await repository.addCollectionMember(
      "workspace-a",
      "principal-a",
      collectionId,
      2,
      identity,
      "member-add-1"
    )
    const added = await repository.addCollectionMember(
      "workspace-a",
      "principal-a",
      collectionId,
      3,
      otherIdentity,
      "member-add-2"
    )
    expect(added).toMatchObject({
      operation: "add_collection_member",
      collection: { members: [identity, otherIdentity] },
    })

    const reordered = await repository.reorderCollectionMembers(
      "workspace-a",
      "principal-a",
      collectionId,
      4,
      [otherIdentity, identity],
      "member-reorder-1"
    )
    expect(reordered).toMatchObject({
      operation: "reorder_collection_members",
      collection: {
        members: [otherIdentity, identity],
        summary: { revision: 5 },
      },
    })
    await expect(
      repository.getCollection("workspace-a", "principal-a", collectionId)
    ).resolves.toMatchObject({ members: [otherIdentity, identity] })
    expect(db.batchMarkers.at(-1)).toEqual([
      "library:workspace-revision",
      "library:collection-get",
      "library:collection-members",
    ])

    const removed = await repository.removeCollectionMember(
      "workspace-a",
      "principal-a",
      collectionId,
      5,
      identity,
      "member-remove-1"
    )
    expect(removed).toMatchObject({
      operation: "remove_collection_member",
      collection: { members: [otherIdentity], summary: { revision: 6 } },
    })
    await expect(
      repository.removeCollectionMember(
        "workspace-a",
        "principal-a",
        collectionId,
        6,
        identity,
        "member-remove-missing"
      )
    ).rejects.toMatchObject({ code: "library_collection_member_conflict" })

    const deleted = await repository.deleteCollection(
      "workspace-a",
      "principal-a",
      collectionId,
      6,
      "collection-delete-1"
    )
    expect(deleted).toMatchObject({
      operation: "delete_collection",
      collectionId,
      deletedRevision: 7,
    })
    await expect(
      repository.getCollection("workspace-a", "principal-a", collectionId)
    ).rejects.toMatchObject({ code: "library_collection_not_found" })
  })

  it("repairs exact collection and member claims without repeating target writes", async () => {
    const { db, repository } = fixture()
    const created = await repository.createCollection(
      "workspace-a",
      "principal-a",
      "Repairable",
      "repair-collection-create"
    )
    if (created.operation !== "create_collection")
      throw new Error("unexpected receipt")
    const collectionId = created.collection.summary.id
    db.requests = []

    const repairedCreate = await repository.createCollection(
      "workspace-a",
      "principal-a",
      "Repairable",
      "repair-collection-create"
    )
    expect(repairedCreate).toMatchObject({
      operation: "create_collection",
      collection: { summary: { id: collectionId, revision: 1 } },
    })
    expect(db.collections).toHaveLength(1)

    const added = await repository.addCollectionMember(
      "workspace-a",
      "principal-a",
      collectionId,
      1,
      identity,
      "repair-member-add"
    )
    db.requests = db.requests.filter(
      (request) => request.idempotency_key !== "repair-member-add"
    )
    const repairedAdd = await repository.addCollectionMember(
      "workspace-a",
      "principal-a",
      collectionId,
      1,
      identity,
      "repair-member-add"
    )
    expect(repairedAdd).toEqual(added)
    expect(db.members).toHaveLength(1)
    expect(db.collections[0].revision).toBe(2)
  })

  it("repairs a collection target on retry when receipt persistence is interrupted", async () => {
    const { db, repository } = fixture()
    db.dropNextReceiptInsert = true

    await expect(
      repository.createCollection(
        "workspace-a",
        "principal-a",
        "Atomic collection",
        "collection-receipt-assert"
      )
    ).rejects.toMatchObject({ code: "library_receipt_invalid", status: 500 })
    expect(db.collections).toHaveLength(1)
    expect(db.requests).toHaveLength(0)
    await expect(
      repository.createCollection(
        "workspace-a",
        "principal-a",
        "Atomic collection",
        "collection-receipt-assert"
      )
    ).resolves.toMatchObject({
      operation: "create_collection",
      collection: { summary: { revision: 1 } },
    })
    expect(db.collections).toHaveLength(1)
    expect(db.requests).toHaveLength(1)
  })

  it("finishes a claimed delete when failure follows its durable receipt", async () => {
    const { db, repository } = fixture()
    const created = await repository.createCollection(
      "workspace-a",
      "principal-a",
      "Delete recovery",
      "delete-recovery-create"
    )
    if (created.operation !== "create_collection")
      throw new Error("unexpected receipt")
    const collectionId = created.collection.summary.id
    db.mutationBatchFailureMarker = "library:collection-delete"

    await expect(
      repository.deleteCollection(
        "workspace-a",
        "principal-a",
        collectionId,
        1,
        "delete-recovery"
      )
    ).rejects.toThrow("D1 write unavailable at library:collection-delete")
    expect(db.collections[0]).toMatchObject({
      id: collectionId,
      revision: 2,
      last_mutation_key: "delete-recovery",
    })
    expect(db.requests).toHaveLength(2)

    const repaired = await repository.deleteCollection(
      "workspace-a",
      "principal-a",
      collectionId,
      1,
      "delete-recovery"
    )
    expect(repaired).toMatchObject({
      operation: "delete_collection",
      collectionId,
      deletedRevision: 2,
    })
    expect(db.collections).toHaveLength(0)
    expect(repaired.workspaceRevision).toBeGreaterThan(0)
  })

  it("compacts positions safely when rows are stored in reverse order", async () => {
    const { db, repository } = fixture()
    const collectionId = "collection-reverse-order"
    db.collections.push({
      id: collectionId,
      workspace_id: "workspace-a",
      owner_principal_id: "principal-a",
      name: "Reverse",
      normalized_name: "reverse",
      revision: 7,
      last_mutation_key: "seed-key",
      last_mutation_hash: "a".repeat(64),
      last_mutation_operation: "create_collection",
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })
    db.members.push(
      {
        workspace_id: "workspace-a",
        collection_id: collectionId,
        item_kind: thirdIdentity.itemKind,
        item_source: sourceFor(thirdIdentity),
        item_id: thirdIdentity.id,
        item_version: thirdIdentity.version,
        position: 2,
        added_at: "2026-08-31T00:00:00.000Z",
      },
      {
        workspace_id: "workspace-a",
        collection_id: collectionId,
        item_kind: otherIdentity.itemKind,
        item_source: sourceFor(otherIdentity),
        item_id: otherIdentity.id,
        item_version: otherIdentity.version,
        position: 1,
        added_at: "2026-08-31T00:00:00.000Z",
      },
      {
        workspace_id: "workspace-a",
        collection_id: collectionId,
        item_kind: identity.itemKind,
        item_source: sourceFor(identity),
        item_id: identity.id,
        item_version: identity.version,
        position: 0,
        added_at: "2026-08-31T00:00:00.000Z",
      }
    )

    await repository.removeCollectionMember(
      "workspace-a",
      "principal-a",
      collectionId,
      7,
      identity,
      "reverse-remove"
    )

    expect(
      db.members
        .slice()
        .sort((left, right) => left.position - right.position)
        .map(({ item_id, position }) => [item_id, position])
    ).toEqual([
      [otherIdentity.id, 0],
      [thirdIdentity.id, 1],
    ])
    expect(
      db.batchMarkers.some((markers) =>
        markers.includes("library:member-compact-offset")
      )
    ).toBe(true)
  })

  it("reorders an empty collection without emitting invalid position SQL", async () => {
    const { db, repository } = fixture()
    const created = await repository.createCollection(
      "workspace-a",
      "principal-a",
      "Empty",
      "empty-create"
    )
    const receipt = await repository.reorderCollectionMembers(
      "workspace-a",
      "principal-a",
      created.collection.summary.id,
      1,
      [],
      "empty-reorder"
    )
    expect(receipt).toMatchObject({
      operation: "reorder_collection_members",
      collection: { members: [], summary: { revision: 2 } },
    })
    expect(db.batchMarkers.at(-1)).not.toContain("library:member-reorder")
  })

  it("reorders 500 members within D1's 100-bound-parameter limit", async () => {
    const { db, repository } = fixture()
    const collectionId = "collection-five-hundred"
    db.collections.push({
      id: collectionId,
      workspace_id: "workspace-a",
      owner_principal_id: "principal-a",
      name: "Large",
      normalized_name: "large",
      revision: 1,
      last_mutation_key: "large-seed",
      last_mutation_hash: "a".repeat(64),
      last_mutation_operation: "create_collection",
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })
    const members = Array.from({ length: 500 }, (_, position) => ({
      itemKind: "template" as const,
      id: `template-large-${position}`,
      version: 1,
    }))
    db.members.push(
      ...members.map((member, position) => ({
        workspace_id: "workspace-a",
        collection_id: collectionId,
        item_kind: member.itemKind,
        item_source: sourceFor(member),
        item_id: member.id,
        item_version: member.version,
        position,
        added_at: "2026-08-31T00:00:00.000Z",
      }))
    )
    const reversed = [...members].reverse()

    const receipt = await repository.reorderCollectionMembers(
      "workspace-a",
      "principal-a",
      collectionId,
      1,
      reversed,
      "large-reorder"
    )
    expect(receipt.collection.members).toHaveLength(500)
    expect(receipt.collection.members[0]).toEqual(reversed[0])
    expect(
      db.members
        .slice()
        .sort((left, right) => left.position - right.position)[0]?.item_id
    ).toBe(reversed[0]?.id)
  })

  it("returns a typed conflict at the 100-collection limit", async () => {
    const { db, repository } = fixture()
    db.collections.push(
      ...Array.from({ length: 100 }, (_, index) => ({
        id: `collection-limit-${index}`,
        workspace_id: "workspace-a",
        owner_principal_id: "principal-a",
        name: `Collection ${index}`,
        normalized_name: `collection ${index}`,
        revision: 1,
        last_mutation_key: `seed-${index}`,
        last_mutation_hash: "a".repeat(64),
        last_mutation_operation: "create_collection",
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:00:00.000Z",
      }))
    )
    await expect(
      repository.createCollection(
        "workspace-a",
        "principal-a",
        "One too many",
        "collection-over-limit"
      )
    ).rejects.toMatchObject({
      code: "library_collection_limit_reached",
      status: 409,
    })
  })

  it("does not misclassify unrelated unique constraints as name conflicts", async () => {
    const { db, repository } = fixture()
    db.mutationBatchFailure = new Error(
      "UNIQUE constraint failed: library_collections.id"
    )
    await expect(
      repository.createCollection(
        "workspace-a",
        "principal-a",
        "Distinct name",
        "collection-id-collision"
      )
    ).rejects.toThrow("UNIQUE constraint failed: library_collections.id")
  })

  it("makes foreign and missing collections indistinguishable", async () => {
    const { repository } = fixture()
    const created = await repository.createCollection(
      "workspace-a",
      "principal-a",
      "Private",
      "private-create"
    )
    if (created.operation !== "create_collection")
      throw new Error("unexpected receipt")
    const id = created.collection.summary.id
    await expect(
      repository.getCollection("workspace-a", "principal-b", id)
    ).rejects.toMatchObject({
      code: "library_collection_not_found",
      status: 404,
    })
    await expect(
      repository.getCollection("workspace-b", "principal-a", id)
    ).rejects.toMatchObject({
      code: "library_collection_not_found",
      status: 404,
    })
  })

  it("fails closed when a stored successful receipt is malformed", async () => {
    const { db, repository } = fixture()
    db.malformedNextReceipt = true
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        true,
        "malformed-receipt"
      )
    ).rejects.toMatchObject({ code: "library_receipt_invalid", status: 500 })
    expect(db.preferences).toHaveLength(1)
    expect(db.requests).toHaveLength(1)
  })

  it("fails closed when stored receipt metadata disagrees with its JSON", async () => {
    const { db, repository } = fixture()
    await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "metadata-receipt"
    )
    db.requests[0].result_revision = 99
    await expect(
      repository.setFavorite(
        "workspace-a",
        "principal-a",
        identity,
        0,
        true,
        "metadata-receipt"
      )
    ).rejects.toMatchObject({ code: "library_receipt_invalid", status: 500 })
  })

  it("does not admit cleanup mutations for retired items", async () => {
    const { repository, admissions } = fixture()
    await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      0,
      true,
      "favorite-on"
    )
    await repository.setFavorite(
      "workspace-a",
      "principal-a",
      identity,
      1,
      false,
      "favorite-off"
    )
    expect(admissions).toHaveLength(1)
  })
})
