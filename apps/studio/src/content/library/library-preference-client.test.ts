import { describe, expect, it, vi } from "vitest"
import type { LibraryPreferenceSnapshot } from "@webmcp/document"
import {
  createLibraryPreferenceClient,
  LibraryPreferenceHttpError,
} from "./library-preference-client"
import type { LibraryPreferenceFetch } from "./library-preference-client"

const identity = {
  itemKind: "template" as const,
  id: "proposal-template",
  version: 2,
}

const snapshot = (workspaceRevision = 4): LibraryPreferenceSnapshot => ({
  workspaceRevision,
  preferences: [
    {
      identity,
      favorite: false,
      lastUsedAt: null,
      collectionIds: [],
      revision: 3,
      updatedAt: "2026-08-31T08:00:00.000Z",
    },
  ],
  collections: [],
})

const response = (
  body: unknown,
  options: { status?: number; requestId?: string; etag?: string } = {}
) =>
  Response.json(body, {
    status: options.status ?? 200,
    headers: {
      "X-Request-Id": options.requestId ?? "request-library-1",
      ...(options.etag ? { ETag: options.etag } : {}),
    },
  })

describe("library preference HTTP client", () => {
  it("strictly reads an authoritative snapshot with its request and revision identities", async () => {
    const fetchRequest = vi.fn<LibraryPreferenceFetch>(async () =>
      response(
        { schemaVersion: 1, snapshot: snapshot() },
        { etag: '"library-workspace-revision-4"' }
      )
    )
    const client = createLibraryPreferenceClient(fetchRequest)

    await expect(client.readSnapshot()).resolves.toEqual({
      value: snapshot(),
      requestId: "request-library-1",
      etag: '"library-workspace-revision-4"',
    })
    expect(fetchRequest).toHaveBeenCalledWith(
      "/v1/studio/library/preferences",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    )
  })

  it("sends exact favorite precondition, idempotency, identity, and body data", async () => {
    const receipt = {
      schemaVersion: 1 as const,
      operation: "set_favorite" as const,
      preference: {
        ...snapshot().preferences[0],
        favorite: true,
        revision: 4,
        updatedAt: "2026-08-31T08:01:00.000Z",
      },
      workspaceRevision: 5,
    }
    const fetchRequest = vi.fn<LibraryPreferenceFetch>(async () =>
      response(
        { schemaVersion: 1, receipt },
        { etag: '"library-preference-revision-4"' }
      )
    )
    const client = createLibraryPreferenceClient(fetchRequest)

    await expect(
      client.setFavorite(identity, {
        favorite: true,
        expectedRevision: 3,
        idempotencyKey: "favorite-request-1",
      })
    ).resolves.toMatchObject({ value: receipt })

    const [url, init] = fetchRequest.mock.calls[0]
    expect(url).toBe(
      "/v1/studio/library/items/template/proposal-template/versions/2/favorite"
    )
    expect(init?.method).toBe("PUT")
    expect(new Headers(init?.headers).get("If-Match")).toBe(
      '"library-preference-revision-3"'
    )
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
      "favorite-request-1"
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      favorite: true,
    })
  })

  it("round-trips an assign-field Recent receipt with the exact request body", async () => {
    const receipt = {
      schemaVersion: 1 as const,
      operation: "record_used" as const,
      completedAction: "assign_field" as const,
      completionId: "field-assignment-1",
      preference: {
        ...snapshot().preferences[0],
        lastUsedAt: "2026-08-31T08:01:00.000Z",
        revision: 4,
        updatedAt: "2026-08-31T08:01:00.000Z",
      },
      workspaceRevision: 5,
    }
    const fetchRequest = vi.fn<LibraryPreferenceFetch>(async () =>
      response(
        { schemaVersion: 1, receipt },
        { etag: '"library-preference-revision-4"' }
      )
    )
    const client = createLibraryPreferenceClient(fetchRequest)

    await expect(
      client.recordUsed(identity, {
        completedAction: "assign_field",
        completionId: "field-assignment-1",
        idempotencyKey: "recent-field-assignment-1",
      })
    ).resolves.toMatchObject({ value: receipt })

    const [url, init] = fetchRequest.mock.calls[0]
    expect(url).toBe(
      "/v1/studio/library/items/template/proposal-template/versions/2/used"
    )
    expect(init?.method).toBe("POST")
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
      "recent-field-assignment-1"
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      completedAction: "assign_field",
      completionId: "field-assignment-1",
    })
  })

  it("fails closed on missing request identity, invalid schema, and inconsistent ETag", async () => {
    const missingRequest = createLibraryPreferenceClient(async () =>
      Response.json(
        { schemaVersion: 1, snapshot: snapshot() },
        { headers: { ETag: '"library-workspace-revision-4"' } }
      )
    )
    await expect(missingRequest.readSnapshot()).rejects.toMatchObject({
      code: "library_invalid_response",
      requestId: null,
    })

    const malformed = createLibraryPreferenceClient(async () =>
      response(
        { schemaVersion: 1, snapshot: { ...snapshot(), extra: true } },
        { etag: '"library-workspace-revision-4"' }
      )
    )
    await expect(malformed.readSnapshot()).rejects.toMatchObject({
      code: "library_invalid_response",
    })

    const wrongEtag = createLibraryPreferenceClient(async () =>
      response(
        { schemaVersion: 1, snapshot: snapshot() },
        { etag: '"library-workspace-revision-3"' }
      )
    )
    await expect(wrongEtag.readSnapshot()).rejects.toMatchObject({
      code: "library_invalid_response",
      requestId: "request-library-1",
    })
  })

  it("preserves structured 412 failure identity and treats mutation network loss as unknown status", async () => {
    const conflict = createLibraryPreferenceClient(async () =>
      response(
        {
          error: {
            code: "library_preference_revision_mismatch",
            message: "Preference changed elsewhere.",
            requestId: "request-conflict-1",
            retryable: false,
          },
        },
        { status: 412, requestId: "request-conflict-1" }
      )
    )
    await expect(
      conflict.setFavorite(identity, {
        favorite: true,
        expectedRevision: 3,
        idempotencyKey: "favorite-conflict-1",
      })
    ).rejects.toMatchObject({
      code: "library_preference_revision_mismatch",
      status: 412,
      requestId: "request-conflict-1",
      commitStatus: "known",
    })

    const offline = createLibraryPreferenceClient(async () => {
      throw new TypeError("offline")
    })
    let caught: unknown
    try {
      await offline.setFavorite(identity, {
        favorite: true,
        expectedRevision: 3,
        idempotencyKey: "favorite-offline-1",
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(LibraryPreferenceHttpError)
    expect(caught).toMatchObject({
      code: "library_network_error",
      status: 0,
      retryable: true,
      commitStatus: "unknown",
    })
  })

  it.each([408, 425, 500, 503])(
    "treats a dispatched mutation HTTP %s outcome as commit-status unknown",
    async (status) => {
      const client = createLibraryPreferenceClient(async () =>
        response(
          {
            error: {
              code: "library_request_failed",
              message: "Ambiguous.",
              requestId: `request-${status}`,
              retryable: false,
            },
          },
          { status, requestId: `request-${status}` }
        )
      )
      await expect(
        client.setFavorite(identity, {
          favorite: true,
          expectedRevision: 3,
          idempotencyKey: `favorite-${status}`,
        })
      ).rejects.toMatchObject({
        status,
        requestId: `request-${status}`,
        commitStatus: "unknown",
      })
    }
  )

  it("treats a verified status-unknown error code as ambiguous even on HTTP 409", async () => {
    const client = createLibraryPreferenceClient(async () =>
      response(
        {
          error: {
            code: "library_mutation_status_unknown",
            message: "The request completed, but its result could not be read.",
            requestId: "request-status-unknown-1",
            retryable: false,
          },
        },
        { status: 409, requestId: "request-status-unknown-1" }
      )
    )

    await expect(
      client.setFavorite(identity, {
        favorite: true,
        expectedRevision: 3,
        idempotencyKey: "favorite-status-unknown",
      })
    ).rejects.toMatchObject({
      code: "library_mutation_status_unknown",
      status: 409,
      requestId: "request-status-unknown-1",
      commitStatus: "unknown",
    })
  })

  it("treats unverifiable errors and malformed mutation success data as unknown", async () => {
    const missingIdentity = createLibraryPreferenceClient(async () =>
      response(
        {
          error: {
            code: "library_request_failed",
            message: "Missing identity.",
            retryable: false,
          },
        },
        { status: 409, requestId: "request-header-only" }
      )
    )
    await expect(
      missingIdentity.setFavorite(identity, {
        favorite: true,
        expectedRevision: 3,
        idempotencyKey: "favorite-missing-identity",
      })
    ).rejects.toMatchObject({
      requestId: null,
      commitStatus: "unknown",
    })

    const malformedSuccess = createLibraryPreferenceClient(async () =>
      response(
        { schemaVersion: 1, receipt: { operation: "set_favorite" } },
        { etag: '"library-preference-revision-4"' }
      )
    )
    await expect(
      malformedSuccess.setFavorite(identity, {
        favorite: true,
        expectedRevision: 3,
        idempotencyKey: "favorite-malformed-success",
      })
    ).rejects.toMatchObject({
      code: "library_invalid_response",
      commitStatus: "unknown",
    })

    const validReceipt = {
      schemaVersion: 1 as const,
      operation: "set_favorite" as const,
      preference: {
        ...snapshot().preferences[0],
        favorite: true,
        revision: 4,
        updatedAt: "2026-08-31T08:01:00.000Z",
      },
      workspaceRevision: 5,
    }
    const wrongEtag = createLibraryPreferenceClient(async () =>
      response(
        { schemaVersion: 1, receipt: validReceipt },
        { etag: '"library-preference-revision-3"' }
      )
    )
    await expect(
      wrongEtag.setFavorite(identity, {
        favorite: true,
        expectedRevision: 3,
        idempotencyKey: "favorite-wrong-etag",
      })
    ).rejects.toMatchObject({
      code: "library_invalid_response",
      requestId: "request-library-1",
      commitStatus: "unknown",
    })
  })

  it("treats an abort after mutation dispatch as status unknown", async () => {
    const fetchRequest: LibraryPreferenceFetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true }
        )
      })
    const client = createLibraryPreferenceClient(fetchRequest)
    const controller = new AbortController()
    const request = client.setFavorite(identity, {
      favorite: true,
      expectedRevision: 3,
      idempotencyKey: "favorite-aborted",
      signal: controller.signal,
    })
    controller.abort()
    await expect(request).rejects.toMatchObject({
      code: "library_request_status_unknown",
      commitStatus: "unknown",
    })
  })

  it("rejects a mismatched header/body request identity", async () => {
    const client = createLibraryPreferenceClient(async () =>
      response(
        {
          error: {
            code: "library_collection_not_found",
            message: "Missing.",
            requestId: "request-other-1",
            retryable: false,
          },
        },
        { status: 404, requestId: "request-header-1" }
      )
    )
    await expect(
      client.getCollection("collection-missing")
    ).rejects.toMatchObject({
      code: "library_collection_not_found",
      requestId: null,
    })
  })
})
