import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMediaDerivationHttpHandlers } from "./media-derivation-http"
import { MediaDerivationError } from "./media-derivations"
import type { MediaDerivationJob } from "./media-derivations"
import type { StudioPrincipal } from "./studio-principal"

const now = "2026-08-31T12:00:00.000Z"
const sourceAssetId = "asset-0123456789abcdef0123456789abcdef"
const jobId = "derivation-01234567-89ab-cdef-0123-456789abcdef"

const job = (state: MediaDerivationJob["state"] = "queued") =>
  ({
    id: jobId,
    workspaceId: "workspace-a",
    sourceAssetId,
    sourceContentHash: "a".repeat(64),
    operation: "remove_background" as const,
    parameters: {},
    parametersHash: "b".repeat(64),
    providerKey: "configured-adapter",
    providerModelVersion: "model-v1",
    privacyPolicyVersion: "privacy-v1",
    requestFingerprint: "c".repeat(64),
    state,
    outputAssetId: null,
    activeAttemptId: null,
    attemptCount: 0,
    maxAttempts: 3,
    retryable: state === "failed",
    safeFailureCode: state === "failed" ? "provider_unavailable" : null,
    createdAt: now,
    startedAt: null,
    completedAt: state === "failed" ? now : null,
    cancellationRequestedAt: null,
    updatedAt: now,
  }) satisfies MediaDerivationJob

const principal: StudioPrincipal = {
  id: "principal-a",
  budgetKey: "workspace-a",
  workspaceId: "workspace-a",
  expiresAt: "2026-09-01T00:00:00.000Z",
  mode: "local_demo",
  respond: (response) => response,
}

const repository = {
  create: vi.fn(),
  get: vi.fn(),
  latestForSource: vi.fn(),
  retry: vi.fn(),
  requestCancellation: vi.fn(),
}
const dispatch = vi.fn(async () => undefined)
const admitCreate = vi.fn(async () => undefined)

const handlers = createMediaDerivationHttpHandlers({
  db: {} as D1Database,
  requirePrincipal: async () => principal,
  configuration: {
    providerKey: "configured-adapter",
    providerModelVersion: "model-v1",
    privacyPolicyVersion: "privacy-v1",
    maxAttempts: 3,
  },
  disclosure: {
    subprocessor: "Local deterministic adapter",
    retention: "No external retention",
    region: null,
    cost: "No charge",
    cancellationLimits: "Cancellation is cooperative after dispatch",
  },
  dispatcher: { dispatch },
  repository,
  admitCreate,
})

const jsonRequest = (url: string, body: unknown, key = "request-key") =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(JSON.stringify(body).length),
      "idempotency-key": key,
      "x-request-id": "request-1",
    },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("media derivation HTTP", () => {
  it("requires exact consent and dispatches one workspace-owned job", async () => {
    repository.create.mockResolvedValue({ job: job(), created: true })
    const response = await handlers.create(
      jsonRequest(
        `https://studio.test/v1/studio/assets/${sourceAssetId}/derivations`,
        {
          operation: "remove_background",
          parameters: {},
          consent: {
            accepted: true,
            privacyPolicyVersion: "privacy-v1",
          },
        }
      ),
      sourceAssetId
    )

    expect(response.status).toBe(202)
    expect(admitCreate).toHaveBeenCalledWith(principal, sourceAssetId)
    expect(repository.create).toHaveBeenCalledWith(
      "workspace-a",
      "request-key",
      { sourceAssetId, operation: "remove_background", parameters: {} },
      expect.objectContaining({ privacyPolicyVersion: "privacy-v1" })
    )
    expect(dispatch).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      jobId,
    })
    expect(await response.json()).not.toHaveProperty("providerKey")
  })

  it("rejects stale or missing consent before persistence", async () => {
    const response = await handlers.create(
      jsonRequest(
        `https://studio.test/v1/studio/assets/${sourceAssetId}/derivations`,
        {
          operation: "remove_background",
          parameters: {},
          consent: {
            accepted: true,
            privacyPolicyVersion: "privacy-old",
          },
        }
      ),
      sourceAssetId
    )

    expect(response.status).toBe(400)
    expect(repository.create).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("keeps lookup inside the authenticated workspace", async () => {
    repository.get.mockResolvedValue(job("succeeded"))
    const response = await handlers.get(
      new Request(`https://studio.test/v1/studio/media-derivations/${jobId}`),
      jobId
    )
    expect(repository.get).toHaveBeenCalledWith("workspace-a", jobId)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("restores the latest source job without exposing provider state", async () => {
    repository.latestForSource.mockResolvedValue(job("succeeded"))
    const response = await handlers.latest(
      new Request(
        `https://studio.test/v1/studio/assets/${sourceAssetId}/derivations`
      ),
      sourceAssetId
    )

    expect(repository.latestForSource).toHaveBeenCalledWith(
      "workspace-a",
      sourceAssetId
    )
    expect(await response.json()).toEqual({
      job: expect.not.objectContaining({ providerKey: expect.anything() }),
    })
  })

  it("rejects stale cancellation and never calls the mutation", async () => {
    repository.get.mockResolvedValue(job("running"))
    const response = await handlers.cancel(
      jsonRequest(
        `https://studio.test/v1/studio/media-derivations/${jobId}/cancel`,
        { expectedUpdatedAt: "2026-08-31T11:59:00.000Z" }
      ),
      jobId
    )
    expect(response.status).toBe(409)
    expect(repository.requestCancellation).not.toHaveBeenCalled()
  })

  it("requeues an eligible failure and redispatches it", async () => {
    repository.get.mockResolvedValue(job("failed"))
    repository.retry.mockResolvedValue(job("queued"))
    const response = await handlers.retry(
      jsonRequest(
        `https://studio.test/v1/studio/media-derivations/${jobId}/retry`,
        { expectedUpdatedAt: now }
      ),
      jobId
    )
    expect(response.status).toBe(202)
    expect(repository.retry).toHaveBeenCalledWith("workspace-a", jobId)
    expect(dispatch).toHaveBeenCalledWith({ workspaceId: "workspace-a", jobId })
  })

  it("returns canonical repository conflicts without leaking internals", async () => {
    repository.get.mockRejectedValue(
      new MediaDerivationError(
        "derivation_job_not_found",
        404,
        "Media derivation was not found in this workspace"
      )
    )
    const response = await handlers.get(
      new Request(`https://studio.test/v1/studio/media-derivations/${jobId}`, {
        headers: { "x-request-id": "lookup-1" },
      }),
      jobId
    )
    expect(await response.json()).toEqual({
      error: {
        code: "derivation_job_not_found",
        message: "Media derivation was not found in this workspace",
        requestId: "lookup-1",
      },
    })
  })
})
