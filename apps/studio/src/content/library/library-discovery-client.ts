import { z } from "zod"
import {
  libraryCatalogDetailResponseSchema,
  libraryCatalogListResponseSchema,
  libraryCatalogQueryIdentity,
  libraryCatalogQuerySchema,
  libraryItemIdentitySchema,
} from "@webmcp/document"
import type {
  LibraryCatalogItemDetail,
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryCatalogQueryInput,
  LibraryItemIdentity,
} from "@webmcp/document"

const requestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/)
const cursorReasonSchema = z.enum([
  "malformed",
  "catalog_revision_mismatch",
  "generation_mismatch",
  "query_mismatch",
  "offset_out_of_range",
])
const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1).max(512),
        requestId: requestIdSchema,
        retryable: z.boolean(),
        cursorReason: cursorReasonSchema.optional(),
      })
      .strict(),
  })
  .strict()

export type LibraryDiscoveryCursorReason = z.infer<typeof cursorReasonSchema>

export type LibraryDiscoveryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export type LibraryDiscoveryListResult = Readonly<{
  workspaceRevision: number
  page: LibraryCatalogPage
}>

export class LibraryDiscoveryHttpError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | null
  readonly retryable: boolean
  readonly cursorReason: LibraryDiscoveryCursorReason | null

  constructor(input: {
    code: string
    status: number
    message: string
    requestId?: string | null
    retryable: boolean
    cursorReason?: LibraryDiscoveryCursorReason | null
  }) {
    super(input.message)
    this.name = "LibraryDiscoveryHttpError"
    this.code = input.code
    this.status = input.status
    this.requestId = input.requestId ?? null
    this.retryable = input.retryable
    this.cursorReason = input.cursorReason ?? null
  }
}

export const isTrustedLibraryCursorInvalidation = (
  error: unknown
): error is LibraryDiscoveryHttpError & {
  requestId: string
  cursorReason: LibraryDiscoveryCursorReason
} =>
  error instanceof LibraryDiscoveryHttpError &&
  error.status === 400 &&
  error.code === "invalid_library_request" &&
  requestIdSchema.safeParse(error.requestId).success &&
  cursorReasonSchema.safeParse(error.cursorReason).success

export type LibraryDiscoveryClient = Readonly<{
  list: (
    query: LibraryCatalogQueryInput,
    signal: AbortSignal
  ) => Promise<LibraryDiscoveryListResult>
  getDetail: (
    identity: LibraryItemIdentity,
    signal: AbortSignal
  ) => Promise<LibraryCatalogItemDetail>
}>

const requestIdFromHeaders = (headers: Headers) => {
  const parsed = requestIdSchema.safeParse(headers.get("X-Request-Id"))
  return parsed.success ? parsed.data : null
}

const workspaceEtag = (revision: number) =>
  `"library-workspace-revision-${revision}"`

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const readJson = async (response: Response, signal: AbortSignal) => {
  try {
    return await response.json()
  } catch {
    signal.throwIfAborted()
    return null
  }
}

const invalidResponse = (
  status: number,
  requestId: string | null,
  message: string
) =>
  new LibraryDiscoveryHttpError({
    code: "library_invalid_response",
    status,
    message,
    requestId,
    retryable: true,
  })

const errorFromResponse = (
  response: Response,
  value: unknown,
  headerRequestId: string | null
) => {
  const parsed = errorEnvelopeSchema.safeParse(value)
  if (
    !headerRequestId ||
    !parsed.success ||
    parsed.data.error.requestId !== headerRequestId
  ) {
    return invalidResponse(
      response.status,
      null,
      "Studio returned an unverifiable library error."
    )
  }
  const detail = parsed.data.error
  return new LibraryDiscoveryHttpError({
    code: detail.code,
    status: response.status,
    message: detail.message,
    requestId: headerRequestId,
    retryable: detail.retryable,
    cursorReason:
      response.status === 400 &&
      detail.code === "invalid_library_request" &&
      detail.cursorReason
        ? detail.cursorReason
        : null,
  })
}

const canonicalListPath = (query: LibraryCatalogQuery) => {
  const parameters = new URLSearchParams()
  parameters.set("generation", query.generation)
  parameters.set("search", query.search)
  for (const itemKind of query.itemKinds)
    parameters.append("itemKind", itemKind)
  for (const categoryId of query.categoryIds)
    parameters.append("categoryId", categoryId)
  for (const useCaseId of query.useCaseIds)
    parameters.append("useCaseId", useCaseId)
  for (const formatFamily of query.formatFamilies)
    parameters.append("formatFamily", formatFamily)
  for (const orientation of query.orientations)
    parameters.append("orientation", orientation)
  for (const ownerKind of query.ownerKinds)
    parameters.append("ownerKind", ownerKind)
  parameters.set("favoritesOnly", String(query.favoritesOnly))
  parameters.set("recentOnly", String(query.recentOnly))
  if (query.collectionId !== null)
    parameters.set("collectionId", query.collectionId)
  parameters.set("order", query.order)
  parameters.set("limit", String(query.limit))
  if (query.cursor !== null) parameters.set("cursor", query.cursor)
  return `/v1/studio/library/items?${parameters.toString()}`
}

const detailPath = (identityInput: LibraryItemIdentity) => {
  const identity = libraryItemIdentitySchema.parse(identityInput)
  const path = `/v1/studio/library/items/${encodeURIComponent(
    identity.itemKind
  )}/${encodeURIComponent(identity.id)}/versions/${identity.version}`
  return identity.itemKind === "media"
    ? `${path}?mediaSource=${encodeURIComponent(identity.mediaSource)}`
    : path
}

export function createLibraryDiscoveryClient(
  fetchRequest: LibraryDiscoveryFetch = globalThis.fetch
): LibraryDiscoveryClient {
  const request = async <TValue, TResult>(input: {
    path: string
    schema: z.ZodType<TValue>
    signal: AbortSignal
    unwrap: (value: TValue) => TResult
    revision: (value: TValue) => number
    validate?: (value: TValue) => string | null
  }): Promise<TResult> => {
    input.signal.throwIfAborted()
    let response: Response
    try {
      response = await fetchRequest(input.path, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        signal: input.signal,
      })
    } catch {
      if (input.signal.aborted) input.signal.throwIfAborted()
      throw new LibraryDiscoveryHttpError({
        code: "library_network_error",
        status: 0,
        message: "Studio could not reach the library service.",
        retryable: true,
      })
    }
    input.signal.throwIfAborted()
    const requestId = requestIdFromHeaders(response.headers)
    const value = await readJson(response, input.signal)
    input.signal.throwIfAborted()
    if (!response.ok) {
      throw errorFromResponse(response, value, requestId)
    }
    const parsed = input.schema.safeParse(value)
    if (!parsed.success) {
      throw invalidResponse(
        response.status,
        requestId,
        "Studio returned invalid library data."
      )
    }
    if (!requestId) {
      throw invalidResponse(
        response.status,
        null,
        "Studio returned library data without a valid request identity."
      )
    }
    const validationMessage = input.validate?.(parsed.data)
    if (validationMessage) {
      throw invalidResponse(response.status, requestId, validationMessage)
    }
    if (
      response.headers.get("ETag") !==
      workspaceEtag(input.revision(parsed.data))
    ) {
      throw invalidResponse(
        response.status,
        requestId,
        "Studio returned library data with an inconsistent revision tag."
      )
    }
    return immutable(input.unwrap(parsed.data))
  }

  return Object.freeze({
    list: async (input, signal) => {
      const query = libraryCatalogQuerySchema.parse(input)
      return request({
        path: canonicalListPath(query),
        schema: libraryCatalogListResponseSchema,
        signal,
        unwrap: ({ workspaceRevision, page }) => ({
          workspaceRevision,
          page,
        }),
        revision: ({ workspaceRevision }) => workspaceRevision,
        validate: ({ page }) =>
          page.generation === query.generation &&
          page.queryIdentity === libraryCatalogQueryIdentity(query)
            ? null
            : "Studio returned library results for the wrong query.",
      })
    },
    getDetail: async (identityInput, signal) => {
      const identity = libraryItemIdentitySchema.parse(identityInput)
      return request({
        path: detailPath(identity),
        schema: libraryCatalogDetailResponseSchema,
        signal,
        unwrap: ({ detail }) => detail,
        revision: ({ workspaceRevision }) => workspaceRevision,
        validate: ({ detail }) =>
          detail.summary.itemKind === identity.itemKind &&
          detail.summary.id === identity.id &&
          detail.summary.version === identity.version &&
          (identity.itemKind !== "media" ||
            (detail.summary.itemKind === "media" &&
              detail.summary.mediaSource === identity.mediaSource))
            ? null
            : "Studio returned details for a different library item.",
      })
    },
  })
}
