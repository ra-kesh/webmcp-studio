import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BackgroundRemovalClientError,
  backgroundRemovalMutationKey,
  cancelBackgroundRemoval,
  createBackgroundRemoval,
  getBackgroundRemovalProvenance,
  getLatestBackgroundRemoval,
  mutateBackgroundRemoval,
  retryBackgroundRemoval,
} from "./background-removal-client"
import type {
  BackgroundRemovalJob,
  BackgroundRemovalPolicy,
} from "./background-removal-client"

const now = "2026-08-31T12:00:00.000Z"
const sourceAssetId = "asset-0123456789abcdef0123456789abcdef"

const policy: BackgroundRemovalPolicy = {
  operation: "remove_background",
  privacyPolicyVersion: "privacy-v1",
  subprocessor: "Configured image processor",
  retention: "Deleted within 24 hours",
  region: "India",
  cost: "1 credit",
  cancellationLimits: "Cancellation is cooperative after dispatch",
}

const job = (state: BackgroundRemovalJob["state"]): BackgroundRemovalJob => ({
  id: "derivation-01234567-89ab-cdef-0123-456789abcdef",
  sourceAssetId,
  operation: "remove_background",
  state,
  outputAssetId:
    state === "succeeded" ? "asset-fedcba9876543210fedcba9876543210" : null,
  attemptCount: state === "queued" ? 0 : 1,
  maxAttempts: 3,
  retryable: state === "failed",
  safeFailureCode: state === "failed" ? "provider_unavailable" : null,
  createdAt: now,
  startedAt: state === "queued" ? null : now,
  completedAt:
    state === "succeeded" || state === "failed" || state === "cancelled"
      ? now
      : null,
  cancellationRequestedAt:
    state === "cancelling" || state === "cancelled" ? now : null,
  updatedAt: now,
})

afterEach(() => vi.unstubAllGlobals())

describe("background-removal client", () => {
  it("sends only the selected asset, operation, and exact policy consent", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _request?: RequestInit) =>
        Response.json(job("queued"))
    )
    vi.stubGlobal("fetch", fetch)

    await expect(
      createBackgroundRemoval(sourceAssetId, policy)
    ).resolves.toMatchObject({ state: "queued", sourceAssetId })

    const [url, request] = fetch.mock.lastCall ?? []
    expect(url).toBe(`/v1/studio/assets/${sourceAssetId}/derivations`)
    expect(request?.method).toBe("POST")
    expect(JSON.parse(String(request?.body))).toEqual({
      operation: "remove_background",
      parameters: {},
      consent: { accepted: true, privacyPolicyVersion: "privacy-v1" },
    })
    expect(String(request?.body)).not.toMatch(/provider|url|bytes/i)
    expect(request?.headers).toMatchObject({
      "Content-Type": "application/json",
    })
  })

  it("restores a durable result by source after reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ job: job("succeeded") }))
    )

    await expect(
      getLatestBackgroundRemoval(sourceAssetId)
    ).resolves.toMatchObject({
      state: "succeeded",
      outputAssetId: expect.any(String),
    })
  })

  it("accepts only safe public provenance fields", async () => {
    const outputAssetId = "asset-fedcba9876543210fedcba9876543210"
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _request?: RequestInit) =>
        Response.json({
          provenance: {
            outputAssetId,
            sourceAssetId,
            derivationJobId: job("succeeded").id,
            operation: "remove_background",
            privacyPolicyVersion: "privacy-v1",
            outputMediaType: "image/png",
            outputWidth: 800,
            outputHeight: 600,
            createdAt: now,
          },
        })
    )
    vi.stubGlobal("fetch", fetch)

    await expect(
      getBackgroundRemovalProvenance(outputAssetId)
    ).resolves.toMatchObject({ sourceAssetId, outputAssetId })
    expect(fetch.mock.lastCall?.[0]).toBe(
      `/v1/studio/assets/${outputAssetId}/derivation-provenance`
    )
  })

  it.each(["cancel", "retry"] as const)(
    "sends optimistic concurrency state when requesting %s",
    async (action) => {
      const current = job(action === "cancel" ? "running" : "failed")
      const fetch = vi.fn(
        async (_input: RequestInfo | URL, _request?: RequestInit) =>
          Response.json(job(action === "cancel" ? "cancelling" : "queued"))
      )
      vi.stubGlobal("fetch", fetch)

      await (action === "cancel"
        ? cancelBackgroundRemoval(current)
        : retryBackgroundRemoval(current))

      const [url, request] = fetch.mock.lastCall ?? []
      expect(url).toContain(`/${action}`)
      expect(JSON.parse(String(request?.body))).toEqual({
        expectedUpdatedAt: now,
      })
      expect(request?.headers).toMatchObject({
        "Idempotency-Key": expect.any(String),
        "X-Request-Id": expect.any(String),
      })
    }
  )

  it("reuses a deterministic WebMCP mutation receipt key", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _request?: RequestInit) =>
        Response.json(job("queued"))
    )
    vi.stubGlobal("fetch", fetch)
    const key = await backgroundRemovalMutationKey(
      "retry",
      job("failed").id,
      now
    )

    await mutateBackgroundRemoval(
      job("failed").id,
      now,
      "retry",
      undefined,
      key
    )
    await mutateBackgroundRemoval(
      job("failed").id,
      now,
      "retry",
      undefined,
      key
    )

    expect(key).toMatch(/^webmcp:[a-f0-9]{64}$/)
    expect(fetch.mock.calls.map(([, request]) => request?.headers)).toEqual([
      expect.objectContaining({ "Idempotency-Key": key }),
      expect.objectContaining({ "Idempotency-Key": key }),
    ])
  })

  it("surfaces canonical safe API errors without inventing provider detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "derivation_quota_exceeded",
              message: "The workspace has reached its background-removal limit",
            },
          },
          { status: 429 }
        )
      )
    )

    await expect(
      createBackgroundRemoval(sourceAssetId, policy)
    ).rejects.toEqual(
      new BackgroundRemovalClientError(
        "derivation_quota_exceeded",
        429,
        "The workspace has reached its background-removal limit"
      )
    )
  })
})
