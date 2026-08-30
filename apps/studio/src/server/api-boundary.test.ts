import { describe, expect, it, vi } from "vitest"
import {
  apiIssuesFrom,
  finalizeApiResponse,
  requestIdFor,
  withApiPrincipalAudit,
  withApiRequestId,
} from "./api-boundary"

const database = () => ({
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({ run: vi.fn(async () => undefined) })),
  })),
})

describe("API boundary", () => {
  it("keeps conservative caller request IDs and replaces unsafe IDs", () => {
    expect(
      requestIdFor(
        new Request("https://studio.test/v1/studio/render", {
          headers: { "X-Request-Id": "client.request-42" },
        })
      )
    ).toBe("client.request-42")
    expect(
      requestIdFor(
        new Request("https://studio.test/v1/studio/render", {
          headers: { "X-Request-Id": "bad id with spaces" },
        })
      )
    ).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("removes caller-controlled audit identity before routing", () => {
    const request = withApiRequestId(
      new Request("https://studio.test/v1/studio/render", {
        headers: {
          "X-Studio-Audit-Principal": "forged",
          "X-Studio-Audit-Workspace": "forged",
        },
      }),
      "request-1"
    )
    expect(request.headers.get("X-Studio-Audit-Principal")).toBeNull()
    expect(request.headers.get("X-Studio-Audit-Workspace")).toBeNull()
    expect(request.headers.get("X-Request-Id")).toBe("request-1")
  })

  it("projects validation issues to stable code, message, and field path", () => {
    expect(
      apiIssuesFrom([
        {
          path: ["document", "pages", 0, Symbol("ignored")],
          code: "too_small",
          message: "A page is required",
        },
      ])
    ).toEqual([
      {
        path: ["document", "pages", 0],
        code: "too_small",
        message: "A page is required",
      },
    ])
  })

  it("normalizes legacy errors and strips internal audit headers", async () => {
    const db = database()
    const request = new Request(
      "https://studio.test/v1/renders/render-1?ignored=true"
    )
    const source = withApiPrincipalAudit(
      Response.json({ error: "render_connection_lost" }, { status: 503 }),
      "principal-1",
      "workspace-1"
    )
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      request,
      source,
      "request-1",
      performance.now()
    )
    await result.audit
    expect(result.response.headers.get("X-Request-Id")).toBe("request-1")
    expect(result.response.headers.get("X-Studio-Audit-Principal")).toBeNull()
    await expect(result.response.json()).resolves.toEqual({
      error: {
        code: "render_connection_lost",
        message: "render connection lost",
        requestId: "request-1",
        retryable: true,
      },
    })
    const bind = db.prepare.mock.results[0]?.value.bind
    expect(bind).toHaveBeenCalledWith(
      "request-1",
      expect.any(String),
      "GET",
      "/v1/renders/:renderId",
      503,
      expect.any(Number),
      "principal-1",
      "workspace-1",
      "render_connection_lost",
      1
    )
  })

  it("never exposes an unknown internal exception body", async () => {
    const db = database()
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      new Request("https://studio.test/v1/studio/render"),
      new Response("database password leaked", { status: 500 }),
      "request-2",
      performance.now()
    )
    await expect(result.response.json()).resolves.toEqual({
      error: {
        code: "internal_error",
        message: "The request could not be completed",
        requestId: "request-2",
        retryable: false,
      },
    })
  })

  it("does not inspect an oversized downstream error body", async () => {
    const db = database()
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      new Request("https://studio.test/v1/studio/render"),
      new Response(
        JSON.stringify({
          error: {
            code: "should_not_escape",
            message: "should not be parsed",
          },
        }),
        {
          status: 502,
          headers: { "Content-Length": "1000000" },
        }
      ),
      "request-3",
      performance.now()
    )
    await expect(result.response.json()).resolves.toEqual({
      error: {
        code: "internal_error",
        message: "The request could not be completed",
        requestId: "request-3",
        retryable: true,
      },
    })
  })

  it("normalizes promotion aliases before the generic managed asset route", async () => {
    const db = database()
    const request = new Request(
      "https://studio.test/v1/studio/assets/local-promotions/local-photo:1"
    )
    const source = withApiPrincipalAudit(
      Response.json({ promotion: {} }),
      "principal-1",
      "workspace-1"
    )
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      request,
      source,
      "request-promotion",
      performance.now()
    )
    await result.audit
    const bind = db.prepare.mock.results[0]?.value.bind
    expect(bind).toHaveBeenCalledWith(
      "request-promotion",
      expect.any(String),
      "GET",
      "/v1/studio/assets/local-promotions/:localAssetId",
      200,
      expect.any(Number),
      "principal-1",
      "workspace-1",
      null,
      0
    )
  })

  it("retains the static promotion resolve route identity", async () => {
    const db = database()
    const request = new Request(
      "https://studio.test/v1/studio/assets/local-promotions/resolve",
      { method: "POST" }
    )
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      request,
      Response.json({ results: [] }),
      "request-resolve",
      performance.now()
    )
    await result.audit
    const bind = db.prepare.mock.results[0]?.value.bind
    expect(bind).toHaveBeenCalledWith(
      "request-resolve",
      expect.any(String),
      "POST",
      "/v1/studio/assets/local-promotions/resolve",
      200,
      expect.any(Number),
      null,
      null,
      null,
      0
    )
  })

  it("normalizes managed-media use receipts without exposing asset identity in the audit path", async () => {
    const db = database()
    const request = new Request(
      "https://studio.test/v1/studio/assets/asset-0123456789abcdef/used",
      { method: "POST" }
    )
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      request,
      Response.json({ receipt: {} }),
      "request-use",
      performance.now()
    )
    await result.audit
    const bind = db.prepare.mock.results[0]?.value.bind
    expect(bind).toHaveBeenCalledWith(
      "request-use",
      expect.any(String),
      "POST",
      "/v1/studio/assets/:assetId/used",
      200,
      expect.any(Number),
      null,
      null,
      null,
      0
    )
  })

  it("normalizes every dynamic library identity out of audit paths", async () => {
    const cases = [
      [
        "PUT",
        "/v1/studio/library/items/template/private-proposal/versions/7/favorite",
        "/v1/studio/library/items/:itemKind/:itemId/versions/:version/favorite",
      ],
      [
        "GET",
        "/v1/studio/library/items/media/private-photo/versions/3",
        "/v1/studio/library/items/:itemKind/:itemId/versions/:version",
      ],
      [
        "PATCH",
        "/v1/studio/library/collections/collection-private-client",
        "/v1/studio/library/collections/:collectionId",
      ],
      [
        "PUT",
        "/v1/studio/library/collections/collection-private-client/order",
        "/v1/studio/library/collections/:collectionId/order",
      ],
      [
        "DELETE",
        "/v1/studio/library/collections/collection-private-client/items/template/private-proposal/versions/7",
        "/v1/studio/library/collections/:collectionId/items/:itemKind/:itemId/versions/:version",
      ],
    ] as const

    for (const [method, path, expectedPath] of cases) {
      const db = database()
      const requestId = `request-library-${method.toLowerCase()}`
      const result = await finalizeApiResponse(
        db as unknown as D1Database,
        new Request(`https://studio.test${path}`, { method }),
        Response.json({ ok: true }),
        requestId,
        performance.now()
      )
      await result.audit
      expect(db.prepare.mock.results[0]?.value.bind).toHaveBeenCalledWith(
        requestId,
        expect.any(String),
        method,
        expectedPath,
        200,
        expect.any(Number),
        null,
        null,
        null,
        0
      )
    }
  })

  it("normalizes GET on the static resolve file as the valid alias literal", async () => {
    const db = database()
    const request = new Request(
      "https://studio.test/v1/studio/assets/local-promotions/resolve"
    )
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      request,
      Response.json({ promotion: {} }),
      "request-resolve-alias",
      performance.now()
    )
    await result.audit
    const bind = db.prepare.mock.results[0]?.value.bind
    expect(bind).toHaveBeenCalledWith(
      "request-resolve-alias",
      expect.any(String),
      "GET",
      "/v1/studio/assets/local-promotions/:localAssetId",
      200,
      expect.any(Number),
      null,
      null,
      null,
      0
    )
  })

  it("retains the static promotion upload route identity", async () => {
    const db = database()
    const request = new Request(
      "https://studio.test/v1/studio/assets/local-promotions",
      { method: "POST" }
    )
    const result = await finalizeApiResponse(
      db as unknown as D1Database,
      request,
      Response.json({ promotion: {} }),
      "request-promotion-upload",
      performance.now()
    )
    await result.audit
    const bind = db.prepare.mock.results[0]?.value.bind
    expect(bind).toHaveBeenCalledWith(
      "request-promotion-upload",
      expect.any(String),
      "POST",
      "/v1/studio/assets/local-promotions",
      200,
      expect.any(Number),
      null,
      null,
      null,
      0
    )
  })
})
