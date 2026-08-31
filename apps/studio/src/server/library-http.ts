import { z } from "zod"
import {
  LibraryCatalogCursorError,
  libraryAddCollectionMemberRequestSchema,
  libraryCatalogDetailResponseSchema,
  libraryCatalogListResponseSchema,
  libraryCatalogQuerySchema,
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
  mediaIdempotencyKeySchema,
  type LibraryCatalogQueryInput,
  type LibraryItemIdentity,
} from "@webmcp/document"
import { JsonBodyError } from "@webmcp/worker-boundary"
import type { StudioPrincipal } from "./studio-principal"
import { apiErrorResponse, apiIssuesFrom } from "./api-boundary"
import {
  LibraryCatalogService,
  type LibraryCatalogServiceDetailResult,
  type LibraryCatalogServiceListResult,
} from "./library-catalog-service"
import {
  LibraryPreferenceError,
  LibraryPreferenceRepository,
} from "./library-preference-repository"
import { readStudioJsonBody } from "./json-request-policy"
import type { StudioJsonRoute } from "./json-request-policy"

type PrincipalResolver = (
  request: Request
) => Promise<StudioPrincipal | Response>

type LibraryRepositoryPort = Pick<
  LibraryPreferenceRepository,
  | "readProjection"
  | "readSnapshot"
  | "readCollectionSnapshot"
  | "setFavorite"
  | "recordUsed"
  | "createCollection"
  | "renameCollection"
  | "deleteCollection"
  | "addCollectionMember"
  | "removeCollectionMember"
  | "reorderCollectionMembers"
>

type LibraryCatalogPort = Pick<LibraryCatalogService, "list" | "getDetail">

export type LibraryHttpDependencies = Readonly<{
  db: D1Database
  requirePrincipal: PrincipalResolver
  repository?: LibraryRepositoryPort
  catalog?: LibraryCatalogPort
}>

class LibraryHttpError extends Error {
  constructor(
    readonly code:
      | "invalid_library_request"
      | "invalid_idempotency_key"
      | "library_item_not_found",
    readonly status: 400 | 404,
    message: string,
    readonly issues?: ReturnType<typeof apiIssuesFrom>
  ) {
    super(message)
    this.name = "LibraryHttpError"
  }
}

const boolParameter = (value: string | null, path: string) => {
  if (value === null) return undefined
  if (value === "true") return true
  if (value === "false") return false
  throw new LibraryHttpError(
    "invalid_library_request",
    400,
    `${path} must be true or false`
  )
}

const repeatedLibraryQueryParameters = new Set([
  "itemKind",
  "categoryId",
  "useCaseId",
  "formatFamily",
  "orientation",
  "ownerKind",
])

const scalarLibraryQueryParameters = new Set([
  "generation",
  "search",
  "favoritesOnly",
  "recentOnly",
  "collectionId",
  "order",
  "limit",
  "cursor",
])

const scalarParameter = (parameters: URLSearchParams, name: string) => {
  const values = parameters.getAll(name)
  if (values.length > 1) {
    throw new LibraryHttpError(
      "invalid_library_request",
      400,
      `${name} must be supplied at most once`
    )
  }
  return values[0] ?? null
}

const parseClientInput = <Output>(
  schema: z.ZodType<Output>,
  input: unknown
) => {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  throw new LibraryHttpError(
    "invalid_library_request",
    400,
    "Library request validation failed",
    apiIssuesFrom(parsed.error.issues)
  )
}

export const parseLibraryListRequest = (
  request: Request
): LibraryCatalogQueryInput => {
  const parameters = new URL(request.url).searchParams
  for (const name of parameters.keys()) {
    if (
      !repeatedLibraryQueryParameters.has(name) &&
      !scalarLibraryQueryParameters.has(name)
    ) {
      throw new LibraryHttpError(
        "invalid_library_request",
        400,
        `Unknown library query parameter: ${name}`
      )
    }
  }
  const rawLimit = scalarParameter(parameters, "limit")
  if (rawLimit !== null && !/^[1-9]\d*$/.test(rawLimit)) {
    throw new LibraryHttpError(
      "invalid_library_request",
      400,
      "limit must be a positive decimal integer"
    )
  }
  const itemKinds = parameters.getAll("itemKind")
  const input = {
    generation: scalarParameter(parameters, "generation"),
    search: scalarParameter(parameters, "search") ?? undefined,
    ...(itemKinds.length ? { itemKinds } : {}),
    categoryIds: parameters.getAll("categoryId"),
    useCaseIds: parameters.getAll("useCaseId"),
    formatFamilies: parameters.getAll("formatFamily"),
    orientations: parameters.getAll("orientation"),
    ownerKinds: parameters.getAll("ownerKind"),
    favoritesOnly: boolParameter(
      scalarParameter(parameters, "favoritesOnly"),
      "favoritesOnly"
    ),
    recentOnly: boolParameter(
      scalarParameter(parameters, "recentOnly"),
      "recentOnly"
    ),
    collectionId: scalarParameter(parameters, "collectionId"),
    order: scalarParameter(parameters, "order") ?? undefined,
    limit: rawLimit === null ? undefined : Number(rawLimit),
    cursor: scalarParameter(parameters, "cursor"),
  }
  return parseClientInput(libraryCatalogQuerySchema, input)
}

const itemIdentity = (itemKind: string, id: string, version: string | number) => {
  const parsedVersion =
    typeof version === "number"
      ? version
      : /^[1-9]\d*$/.test(version)
        ? Number(version)
        : Number.NaN
  return parseClientInput(libraryItemIdentitySchema, {
    itemKind,
    id,
    version: parsedVersion,
  })
}

const collectionId = (input: string) =>
  parseClientInput(libraryCollectionIdSchema, input)

const idempotencyKey = (request: Request) => {
  const parsed = mediaIdempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key")?.trim()
  )
  if (!parsed.success) {
    throw new LibraryHttpError(
      "invalid_idempotency_key",
      400,
      "A valid Idempotency-Key header is required"
    )
  }
  return parsed.data
}

const expectedRevision = (
  request: Request,
  kind: "preference" | "collection"
) => {
  const value = request.headers.get("if-match")
  const match = value?.match(
    new RegExp(`^"library-${kind}-revision-(0|[1-9]\\d*)"$`)
  )
  if (!match) {
    throw new LibraryHttpError(
      "invalid_library_request",
      400,
      `If-Match must contain a library ${kind} revision`
    )
  }
  const revision = Number(match[1])
  const valid =
    Number.isSafeInteger(revision) &&
    (kind === "preference" ? revision >= 0 : revision >= 1)
  if (!valid) {
    throw new LibraryHttpError(
      "invalid_library_request",
      400,
      `If-Match contains an invalid library ${kind} revision`
    )
  }
  return revision
}

const mutationBody = async <Output>(
  request: Request,
  route: StudioJsonRoute,
  schema: z.ZodType<Output>
) => parseClientInput(schema, await readStudioJsonBody(request, route))

const responseHeaders = (etag?: string) => {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  })
  if (etag) headers.set("ETag", `"${etag}"`)
  return headers
}

const withEtag = (body: unknown, etag: string, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: responseHeaders(etag) })

const errorResponse = (request: Request, error: unknown) => {
  if (error instanceof JsonBodyError) {
    return apiErrorResponse(
      request,
      {
        code: error.code,
        message: error.message,
        retryable: false,
      },
      { status: error.status }
    )
  }
  if (error instanceof z.ZodError) {
    return apiErrorResponse(
      request,
      {
        code: "internal_error",
        message: "The request could not be completed",
        retryable: false,
      },
      { status: 500 }
    )
  }
  if (error instanceof LibraryCatalogCursorError) {
    return apiErrorResponse(
      request,
      {
        code: "invalid_library_request",
        message: "Library cursor is no longer valid for this result set",
        retryable: false,
        cursorReason: error.reason,
      },
      { status: 400 }
    )
  }
  if (
    error instanceof LibraryPreferenceError ||
    error instanceof LibraryHttpError
  ) {
    const internal = error.status >= 500
    return apiErrorResponse(
      request,
      {
        code: internal ? "internal_error" : error.code,
        message: internal
          ? "The request could not be completed"
          : error.message,
        retryable: false,
        ...(error instanceof LibraryHttpError && error.issues
          ? { issues: error.issues }
          : {}),
      },
      { status: error.status }
    )
  }
  throw error
}

const withPrincipal = async (
  dependencies: LibraryHttpDependencies,
  request: Request,
  operation: (principal: StudioPrincipal) => Promise<Response>
) => {
  const principal = await dependencies.requirePrincipal(request)
  if (principal instanceof Response) return principal
  try {
    return principal.respond(await operation(principal))
  } catch (error) {
    return principal.respond(errorResponse(request, error))
  }
}

export const assertCatalogItemCapability = async (
  catalog: LibraryCatalogPort,
  workspaceId: string,
  principalId: string,
  identity: LibraryItemIdentity,
  capability: "use" | "favorite" | "add_to_collection"
) => {
  const result = await catalog.getDetail(
    workspaceId,
    principalId,
    identity.itemKind,
    identity.id,
    identity.version
  )
  const permissions = result?.detail.summary.permissions
  const capabilityAllowed =
    capability === "favorite"
      ? permissions?.canFavorite
      : capability === "add_to_collection"
        ? permissions?.canAddToCollection
        : permissions?.canUse
  if (
    !result ||
    result.detail.summary.catalogStatus !== "active" ||
    !permissions?.canView ||
    !capabilityAllowed ||
    (capability === "use" &&
      result.detail.summary.compatibility.availability === "unavailable")
  ) {
    throw new LibraryHttpError(
      "library_item_not_found",
      404,
      "Library item was not found"
    )
  }
}

export function createLibraryHttpHandlers(
  dependencies: LibraryHttpDependencies
) {
  let catalog: LibraryCatalogPort
  const repository: LibraryRepositoryPort =
    dependencies.repository ??
    new LibraryPreferenceRepository(dependencies.db, {
      assertCanFavorite: (workspaceId, principalId, identity) =>
        assertCatalogItemCapability(
          catalog,
          workspaceId,
          principalId,
          identity,
          "favorite"
        ),
      assertCanUse: (workspaceId, principalId, identity) =>
        assertCatalogItemCapability(
          catalog,
          workspaceId,
          principalId,
          identity,
          "use"
        ),
      assertCanAddToCollection: (workspaceId, principalId, identity) =>
        assertCatalogItemCapability(
          catalog,
          workspaceId,
          principalId,
          identity,
          "add_to_collection"
        ),
    })
  catalog = dependencies.catalog ?? new LibraryCatalogService(repository)

  const readCatalogList = async (
    principal: StudioPrincipal,
    request: Request
  ) => {
    const result: LibraryCatalogServiceListResult = await catalog.list(
      principal.workspaceId,
      principal.id,
      parseLibraryListRequest(request)
    )
    return withEtag(
      libraryCatalogListResponseSchema.parse({
        schemaVersion: 1,
        ...result,
      }),
      `library-workspace-revision-${result.workspaceRevision}`
    )
  }

  const readCatalogDetail = async (
    principal: StudioPrincipal,
    identity: LibraryItemIdentity
  ) => {
    const result: LibraryCatalogServiceDetailResult | null =
      await catalog.getDetail(
        principal.workspaceId,
        principal.id,
        identity.itemKind,
        identity.id,
        identity.version
      )
    if (!result) {
      throw new LibraryHttpError(
        "library_item_not_found",
        404,
        "Library item was not found"
      )
    }
    return withEtag(
      libraryCatalogDetailResponseSchema.parse({
        schemaVersion: 1,
        ...result,
      }),
      `library-workspace-revision-${result.workspaceRevision}`
    )
  }

  return {
    listItems: (request: Request) =>
      withPrincipal(dependencies, request, (principal) =>
        readCatalogList(principal, request)
      ),

    getItemDetail: (
      request: Request,
      itemKind: string,
      itemId: string,
      version: string | number
    ) =>
      withPrincipal(dependencies, request, (principal) =>
        readCatalogDetail(principal, itemIdentity(itemKind, itemId, version))
      ),

    getPreferences: (request: Request) =>
      withPrincipal(dependencies, request, async (principal) => {
        const snapshot = await repository.readSnapshot(
          principal.workspaceId,
          principal.id
        )
        return withEtag(
          libraryPreferenceSnapshotResponseSchema.parse({
            schemaVersion: 1,
            snapshot,
          }),
          `library-workspace-revision-${snapshot.workspaceRevision}`
        )
      }),

    setFavorite: (
      request: Request,
      itemKind: string,
      itemId: string,
      version: string | number
    ) =>
      withPrincipal(dependencies, request, async (principal) => {
        const input = await mutationBody(
          request,
          "/v1/studio/library/items/:itemKind/:itemId/versions/:version/favorite",
          librarySetFavoriteRequestSchema
        )
        const receipt = await repository.setFavorite(
          principal.workspaceId,
          principal.id,
          itemIdentity(itemKind, itemId, version),
          expectedRevision(request, "preference"),
          input.favorite,
          idempotencyKey(request)
        )
        return withEtag(
          libraryPreferenceMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-preference-revision-${receipt.preference.revision}`
        )
      }),

    recordUsed: (
      request: Request,
      itemKind: string,
      itemId: string,
      version: string | number
    ) =>
      withPrincipal(dependencies, request, async (principal) => {
        const input = await mutationBody(
          request,
          "/v1/studio/library/items/:itemKind/:itemId/versions/:version/used",
          libraryRecordUseRequestSchema
        )
        const receipt = await repository.recordUsed(
          principal.workspaceId,
          principal.id,
          itemIdentity(itemKind, itemId, version),
          input.completedAction,
          input.completionId,
          idempotencyKey(request)
        )
        return withEtag(
          libraryPreferenceMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-preference-revision-${receipt.preference.revision}`
        )
      }),

    listCollections: (request: Request) =>
      withPrincipal(dependencies, request, async (principal) => {
        const snapshot = await repository.readSnapshot(
          principal.workspaceId,
          principal.id
        )
        return withEtag(
          libraryCollectionListResponseSchema.parse({
            schemaVersion: 1,
            workspaceRevision: snapshot.workspaceRevision,
            collections: snapshot.collections,
          }),
          `library-workspace-revision-${snapshot.workspaceRevision}`
        )
      }),

    createCollection: (request: Request) =>
      withPrincipal(dependencies, request, async (principal) => {
        const input = await mutationBody(
          request,
          "/v1/studio/library/collections",
          libraryCreateCollectionRequestSchema
        )
        const receipt = await repository.createCollection(
          principal.workspaceId,
          principal.id,
          input.name,
          idempotencyKey(request)
        )
        return withEtag(
          libraryCollectionMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-collection-revision-${receipt.collection.summary.revision}`,
          { status: 201 }
        )
      }),

    getCollection: (request: Request, collectionIdInput: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const parsedCollectionId = collectionId(collectionIdInput)
        const snapshot = await repository.readCollectionSnapshot(
          principal.workspaceId,
          principal.id,
          parsedCollectionId
        )
        return withEtag(
          libraryCollectionDetailResponseSchema.parse({
            schemaVersion: 1,
            workspaceRevision: snapshot.workspaceRevision,
            collection: snapshot.collection,
          }),
          `library-collection-revision-${snapshot.collection.summary.revision}`
        )
      }),

    renameCollection: (request: Request, collectionIdInput: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const input = await mutationBody(
          request,
          "/v1/studio/library/collections/:collectionId",
          libraryRenameCollectionRequestSchema
        )
        const receipt = await repository.renameCollection(
          principal.workspaceId,
          principal.id,
          collectionId(collectionIdInput),
          expectedRevision(request, "collection"),
          input.name,
          idempotencyKey(request)
        )
        return withEtag(
          libraryCollectionMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-collection-revision-${receipt.collection.summary.revision}`
        )
      }),

    deleteCollection: (request: Request, collectionIdInput: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        await mutationBody(
          request,
          "/v1/studio/library/collections/:collectionId",
          libraryDeleteCollectionRequestSchema
        )
        const receipt = await repository.deleteCollection(
          principal.workspaceId,
          principal.id,
          collectionId(collectionIdInput),
          expectedRevision(request, "collection"),
          idempotencyKey(request)
        )
        return withEtag(
          libraryCollectionMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-collection-revision-${receipt.deletedRevision}`
        )
      }),

    addCollectionMember: (
      request: Request,
      collectionIdInput: string,
      itemKind: string,
      itemId: string,
      version: string | number
    ) =>
      withPrincipal(dependencies, request, async (principal) => {
        await mutationBody(
          request,
          "/v1/studio/library/collections/:collectionId/items/:itemKind/:itemId/versions/:version",
          libraryAddCollectionMemberRequestSchema
        )
        const receipt = await repository.addCollectionMember(
          principal.workspaceId,
          principal.id,
          collectionId(collectionIdInput),
          expectedRevision(request, "collection"),
          itemIdentity(itemKind, itemId, version),
          idempotencyKey(request)
        )
        return withEtag(
          libraryCollectionMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-collection-revision-${receipt.collection.summary.revision}`
        )
      }),

    removeCollectionMember: (
      request: Request,
      collectionIdInput: string,
      itemKind: string,
      itemId: string,
      version: string | number
    ) =>
      withPrincipal(dependencies, request, async (principal) => {
        await mutationBody(
          request,
          "/v1/studio/library/collections/:collectionId/items/:itemKind/:itemId/versions/:version",
          libraryRemoveCollectionMemberRequestSchema
        )
        const receipt = await repository.removeCollectionMember(
          principal.workspaceId,
          principal.id,
          collectionId(collectionIdInput),
          expectedRevision(request, "collection"),
          itemIdentity(itemKind, itemId, version),
          idempotencyKey(request)
        )
        return withEtag(
          libraryCollectionMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-collection-revision-${receipt.collection.summary.revision}`
        )
      }),

    reorderCollection: (request: Request, collectionIdInput: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const input = await mutationBody(
          request,
          "/v1/studio/library/collections/:collectionId/order",
          libraryReorderCollectionMembersRequestSchema
        )
        const receipt = await repository.reorderCollectionMembers(
          principal.workspaceId,
          principal.id,
          collectionId(collectionIdInput),
          expectedRevision(request, "collection"),
          input.orderedIdentities,
          idempotencyKey(request)
        )
        return withEtag(
          libraryCollectionMutationResponseSchema.parse({
            schemaVersion: 1,
            receipt,
          }),
          `library-collection-revision-${receipt.collection.summary.revision}`
        )
      }),
  }
}
