import { z } from "zod"
import {
  libraryAddCollectionMemberRequestSchema,
  libraryCollectionDetailResponseSchema,
  libraryCollectionIdSchema,
  libraryCollectionListResponseSchema,
  libraryCollectionMutationResponseSchema,
  libraryCreateCollectionRequestSchema,
  libraryDeleteCollectionRequestSchema,
  libraryItemIdentitySchema,
  libraryPreferenceMutationResponseSchema,
  libraryPreferenceSnapshotResponseSchema,
  libraryRecordUseRequestSchema,
  libraryRemoveCollectionMemberRequestSchema,
  libraryRenameCollectionRequestSchema,
  libraryReorderCollectionMembersRequestSchema,
  librarySetFavoriteRequestSchema,
} from "@webmcp/document"
import type {
  LibraryCollectionDetailResponse,
  LibraryCollectionListResponse,
  LibraryCollectionMutationReceipt,
  LibraryItemIdentity,
  LibraryPreferenceMutationReceipt,
  LibraryPreferenceSnapshot,
} from "@webmcp/document"

const requestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/)

export type LibraryPreferenceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export class LibraryPreferenceHttpError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | null
  readonly retryable: boolean
  readonly commitStatus: "known" | "unknown"

  constructor(input: {
    code: string
    status: number
    message: string
    requestId?: string | null
    retryable: boolean
    commitStatus?: "known" | "unknown"
  }) {
    super(input.message)
    this.name = "LibraryPreferenceHttpError"
    this.code = input.code
    this.status = input.status
    this.requestId = input.requestId ?? null
    this.retryable = input.retryable
    this.commitStatus = input.commitStatus ?? "known"
  }
}

export type LibraryPreferenceClientResult<TValue> = Readonly<{
  value: TValue
  requestId: string
  etag: string | null
}>

export type LibraryPreferenceClient = Readonly<{
  readSnapshot: (
    signal?: AbortSignal
  ) => Promise<LibraryPreferenceClientResult<LibraryPreferenceSnapshot>>
  listCollections: (
    signal?: AbortSignal
  ) => Promise<LibraryPreferenceClientResult<LibraryCollectionListResponse>>
  getCollection: (
    collectionId: string,
    signal?: AbortSignal
  ) => Promise<LibraryPreferenceClientResult<LibraryCollectionDetailResponse>>
  setFavorite: (
    identity: LibraryItemIdentity,
    input: Readonly<{
      favorite: boolean
      expectedRevision: number
      idempotencyKey: string
      signal?: AbortSignal
    }>
  ) => Promise<LibraryPreferenceClientResult<LibraryPreferenceMutationReceipt>>
  recordUsed: (
    identity: LibraryItemIdentity,
    input: Readonly<{
      completedAction: "create" | "insert" | "replace"
      completionId: string
      idempotencyKey: string
      signal?: AbortSignal
    }>
  ) => Promise<LibraryPreferenceClientResult<LibraryPreferenceMutationReceipt>>
  createCollection: (input: {
    name: string
    idempotencyKey: string
    signal?: AbortSignal
  }) => Promise<LibraryPreferenceClientResult<LibraryCollectionMutationReceipt>>
  renameCollection: (
    collectionId: string,
    input: {
      name: string
      expectedRevision: number
      idempotencyKey: string
      signal?: AbortSignal
    }
  ) => Promise<LibraryPreferenceClientResult<LibraryCollectionMutationReceipt>>
  deleteCollection: (
    collectionId: string,
    input: {
      expectedRevision: number
      idempotencyKey: string
      signal?: AbortSignal
    }
  ) => Promise<LibraryPreferenceClientResult<LibraryCollectionMutationReceipt>>
  addCollectionMember: (
    collectionId: string,
    identity: LibraryItemIdentity,
    input: {
      expectedRevision: number
      idempotencyKey: string
      signal?: AbortSignal
    }
  ) => Promise<LibraryPreferenceClientResult<LibraryCollectionMutationReceipt>>
  removeCollectionMember: (
    collectionId: string,
    identity: LibraryItemIdentity,
    input: {
      expectedRevision: number
      idempotencyKey: string
      signal?: AbortSignal
    }
  ) => Promise<LibraryPreferenceClientResult<LibraryCollectionMutationReceipt>>
  reorderCollectionMembers: (
    collectionId: string,
    input: {
      orderedIdentities: readonly LibraryItemIdentity[]
      expectedRevision: number
      idempotencyKey: string
      signal?: AbortSignal
    }
  ) => Promise<LibraryPreferenceClientResult<LibraryCollectionMutationReceipt>>
}>

const identityPath = (identityInput: LibraryItemIdentity) => {
  const identity = libraryItemIdentitySchema.parse(identityInput)
  return `${encodeURIComponent(identity.itemKind)}/${encodeURIComponent(identity.id)}/versions/${identity.version}`
}

const collectionPath = (collectionId: string) =>
  `/v1/studio/library/collections/${encodeURIComponent(
    libraryCollectionIdSchema.parse(collectionId)
  )}`

const requestIdFromHeaders = (headers: Headers) => {
  const parsed = requestIdSchema.safeParse(headers.get("X-Request-Id"))
  return parsed.success ? parsed.data : null
}

const retryableFor = (status: number, code: string) =>
  [408, 425, 429, 502, 503, 504].includes(status) ||
  /(?:capacity|concurrency|rate|connection|timeout|timed_out|temporarily|unavailable|status_unknown)/.test(
    code
  )

const parseErrorDetail = (value: unknown) => {
  if (!value || typeof value !== "object" || !("error" in value)) return null
  const error = (value as { error?: unknown }).error
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : null
}

const errorFromResponse = (
  response: Response,
  value: unknown,
  headerRequestId: string | null,
  mutationDispatched: boolean
) => {
  const detail = parseErrorDetail(value)
  const parsedCode = errorCodeSchema.safeParse(detail?.code)
  const code = parsedCode.success ? parsedCode.data : "library_request_failed"
  const explicitlyUnknownStatus =
    parsedCode.success && parsedCode.data.includes("status_unknown")
  const parsedBodyRequestId = requestIdSchema.safeParse(detail?.requestId)
  const bodyRequestId = parsedBodyRequestId.success
    ? parsedBodyRequestId.data
    : null
  const requestId =
    headerRequestId && bodyRequestId === headerRequestId
      ? headerRequestId
      : null
  return new LibraryPreferenceHttpError({
    code,
    status: response.status,
    message:
      typeof detail?.message === "string" && detail.message.length > 0
        ? detail.message.slice(0, 512)
        : `Studio could not complete the library request (${response.status}).`,
    requestId,
    retryable:
      typeof detail?.retryable === "boolean"
        ? detail.retryable
        : retryableFor(response.status, code),
    commitStatus:
      mutationDispatched &&
      (explicitlyUnknownStatus ||
        requestId === null ||
        response.status === 408 ||
        response.status === 425 ||
        response.status >= 500)
        ? "unknown"
        : "known",
  })
}

const invalidResponse = (
  status: number,
  requestId: string | null,
  message: string,
  commitStatus: "known" | "unknown" = "known"
) =>
  new LibraryPreferenceHttpError({
    code: "library_invalid_response",
    status,
    message,
    requestId,
    retryable: true,
    commitStatus,
  })

const requireSuccessfulRequestId = (
  response: Response,
  requestId: string | null,
  mutationDispatched: boolean
) => {
  if (requestId) return requestId
  throw invalidResponse(
    response.status,
    null,
    "Studio returned library data without a valid request identity.",
    mutationDispatched ? "unknown" : "known"
  )
}

const readJson = async (response: Response) => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const workspaceEtag = (revision: number) =>
  `"library-workspace-revision-${revision}"`
const preferenceEtag = (revision: number) =>
  `"library-preference-revision-${revision}"`
const collectionEtag = (revision: number) =>
  `"library-collection-revision-${revision}"`

const validateEtag = (
  response: Response,
  expected: string,
  requestId: string,
  mutationDispatched: boolean
) => {
  const etag = response.headers.get("ETag")
  if (etag !== expected) {
    throw invalidResponse(
      response.status,
      requestId,
      "Studio returned library data with an inconsistent revision tag.",
      mutationDispatched ? "unknown" : "known"
    )
  }
  return etag
}

const preconditionHeaders = (
  revision: number,
  kind: "preference" | "collection"
) => {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("Expected revision must be a non-negative integer.")
  }
  if (kind === "collection" && revision === 0) {
    throw new Error("Collection revision must be positive.")
  }
  return kind === "preference"
    ? preferenceEtag(revision)
    : collectionEtag(revision)
}

export function createLibraryPreferenceClient(
  fetchRequest: LibraryPreferenceFetch = globalThis.fetch
): LibraryPreferenceClient {
  const request = async <TValue>(input: {
    path: string
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
    body?: unknown
    schema: z.ZodType<TValue>
    signal?: AbortSignal
    idempotencyKey?: string
    ifMatch?: string
    commitMayBeUnknown?: boolean
    etagFor?: (value: TValue) => string
  }): Promise<LibraryPreferenceClientResult<TValue>> => {
    input.signal?.throwIfAborted()
    const headers = new Headers({ Accept: "application/json" })
    if (input.body !== undefined) {
      headers.set("Content-Type", "application/json")
    }
    if (input.idempotencyKey) {
      headers.set(
        "Idempotency-Key",
        idempotencyKeySchema.parse(input.idempotencyKey)
      )
    }
    if (input.ifMatch) headers.set("If-Match", input.ifMatch)
    let response: Response
    try {
      response = await fetchRequest(input.path, {
        method: input.method ?? "GET",
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        cache: "no-store",
        signal: input.signal,
      })
    } catch (error) {
      if (input.signal?.aborted && !input.commitMayBeUnknown) {
        throw input.signal.reason
      }
      throw new LibraryPreferenceHttpError({
        code: input.signal?.aborted
          ? "library_request_status_unknown"
          : "library_network_error",
        status: 0,
        message: input.signal?.aborted
          ? "Studio could not confirm whether the library change completed."
          : "Studio could not reach the library preference service.",
        retryable: true,
        commitStatus: input.commitMayBeUnknown ? "unknown" : "known",
      })
    }
    const requestId = requestIdFromHeaders(response.headers)
    const value = await readJson(response)
    if (!response.ok) {
      throw errorFromResponse(
        response,
        value,
        requestId,
        input.commitMayBeUnknown === true
      )
    }
    const parsed = input.schema.safeParse(value)
    if (!parsed.success) {
      throw invalidResponse(
        response.status,
        requestId,
        "Studio returned invalid library preference data.",
        input.commitMayBeUnknown ? "unknown" : "known"
      )
    }
    const validRequestId = requireSuccessfulRequestId(
      response,
      requestId,
      input.commitMayBeUnknown === true
    )
    const expectedEtag = input.etagFor?.(parsed.data)
    const etag = expectedEtag
      ? validateEtag(
          response,
          expectedEtag,
          validRequestId,
          input.commitMayBeUnknown === true
        )
      : response.headers.get("ETag")
    return { value: parsed.data, requestId: validRequestId, etag }
  }

  const preferenceMutation = async (input: {
    path: string
    method: "POST" | "PUT"
    body: unknown
    signal?: AbortSignal
    idempotencyKey: string
    ifMatch?: string
  }) => {
    const response = await request({
      ...input,
      schema: libraryPreferenceMutationResponseSchema,
      commitMayBeUnknown: true,
      etagFor: ({ receipt }) => preferenceEtag(receipt.preference.revision),
    })
    return { ...response, value: response.value.receipt }
  }

  const collectionMutation = async (input: {
    path: string
    method: "POST" | "PUT" | "PATCH" | "DELETE"
    body: unknown
    signal?: AbortSignal
    idempotencyKey: string
    ifMatch?: string
  }) => {
    const response = await request({
      ...input,
      schema: libraryCollectionMutationResponseSchema,
      commitMayBeUnknown: true,
      etagFor: ({ receipt }) =>
        receipt.operation === "delete_collection"
          ? collectionEtag(receipt.deletedRevision)
          : collectionEtag(receipt.collection.summary.revision),
    })
    return { ...response, value: response.value.receipt }
  }

  return {
    readSnapshot: async (signal) => {
      const response = await request({
        path: "/v1/studio/library/preferences",
        schema: libraryPreferenceSnapshotResponseSchema,
        signal,
        etagFor: ({ snapshot }) => workspaceEtag(snapshot.workspaceRevision),
      })
      return { ...response, value: response.value.snapshot }
    },
    listCollections: (signal) =>
      request({
        path: "/v1/studio/library/collections",
        schema: libraryCollectionListResponseSchema,
        signal,
        etagFor: ({ workspaceRevision }) => workspaceEtag(workspaceRevision),
      }),
    getCollection: (collectionId, signal) =>
      request({
        path: collectionPath(collectionId),
        schema: libraryCollectionDetailResponseSchema,
        signal,
        etagFor: ({ collection }) =>
          collectionEtag(collection.summary.revision),
      }),
    setFavorite: (identity, input) =>
      preferenceMutation({
        path: `/v1/studio/library/items/${identityPath(identity)}/favorite`,
        method: "PUT",
        body: librarySetFavoriteRequestSchema.parse({
          schemaVersion: 1,
          favorite: input.favorite,
        }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
        ifMatch: preconditionHeaders(input.expectedRevision, "preference"),
      }),
    recordUsed: (identity, input) =>
      preferenceMutation({
        path: `/v1/studio/library/items/${identityPath(identity)}/used`,
        method: "POST",
        body: libraryRecordUseRequestSchema.parse({
          schemaVersion: 1,
          completedAction: input.completedAction,
          completionId: input.completionId,
        }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
      }),
    createCollection: (input) =>
      collectionMutation({
        path: "/v1/studio/library/collections",
        method: "POST",
        body: libraryCreateCollectionRequestSchema.parse({
          schemaVersion: 1,
          name: input.name,
        }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
      }),
    renameCollection: (collectionId, input) =>
      collectionMutation({
        path: collectionPath(collectionId),
        method: "PATCH",
        body: libraryRenameCollectionRequestSchema.parse({
          schemaVersion: 1,
          name: input.name,
        }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
        ifMatch: preconditionHeaders(input.expectedRevision, "collection"),
      }),
    deleteCollection: (collectionId, input) =>
      collectionMutation({
        path: collectionPath(collectionId),
        method: "DELETE",
        body: libraryDeleteCollectionRequestSchema.parse({ schemaVersion: 1 }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
        ifMatch: preconditionHeaders(input.expectedRevision, "collection"),
      }),
    addCollectionMember: (collectionId, identity, input) =>
      collectionMutation({
        path: `${collectionPath(collectionId)}/items/${identityPath(identity)}`,
        method: "PUT",
        body: libraryAddCollectionMemberRequestSchema.parse({
          schemaVersion: 1,
        }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
        ifMatch: preconditionHeaders(input.expectedRevision, "collection"),
      }),
    removeCollectionMember: (collectionId, identity, input) =>
      collectionMutation({
        path: `${collectionPath(collectionId)}/items/${identityPath(identity)}`,
        method: "DELETE",
        body: libraryRemoveCollectionMemberRequestSchema.parse({
          schemaVersion: 1,
        }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
        ifMatch: preconditionHeaders(input.expectedRevision, "collection"),
      }),
    reorderCollectionMembers: (collectionId, input) =>
      collectionMutation({
        path: `${collectionPath(collectionId)}/order`,
        method: "PUT",
        body: libraryReorderCollectionMembersRequestSchema.parse({
          schemaVersion: 1,
          orderedIdentities: input.orderedIdentities,
        }),
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
        ifMatch: preconditionHeaders(input.expectedRevision, "collection"),
      }),
  }
}
