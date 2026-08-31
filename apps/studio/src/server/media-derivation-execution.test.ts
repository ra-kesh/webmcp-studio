import { describe, expect, it, vi } from "vitest"
import { executeMediaDerivation } from "./media-derivation-execution"
import { DeterministicMediaDerivationProvider } from "./media-derivation-provider"
import { sanitizeProviderInput } from "./media-derivation-provider"
import type { MediaDerivationJob } from "./media-derivations"

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
)
const hash = "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"
const jobId = "derivation-01234567-89ab-cdef-0123-456789abcdef"
const attemptId = "derivation-attempt-01234567-89ab-cdef-0123-456789abcdef"

const job = (state: MediaDerivationJob["state"]): MediaDerivationJob => ({
  id: jobId,
  workspaceId: "workspace-a",
  sourceAssetId: "asset-0123456789abcdef0123456789abcdef",
  sourceContentHash: hash,
  operation: "remove_background",
  parameters: {},
  parametersHash: "a".repeat(64),
  providerKey: "deterministic-local-fake",
  providerModelVersion: "fixture-v1",
  privacyPolicyVersion: "privacy-v1",
  requestFingerprint: "b".repeat(64),
  state,
  outputAssetId: null,
  activeAttemptId: state === "queued" ? null : attemptId,
  attemptCount: state === "queued" ? 0 : 1,
  maxAttempts: 3,
  retryable: false,
  safeFailureCode: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  startedAt: state === "queued" ? null : "2026-08-31T12:00:01.000Z",
  completedAt: null,
  cancellationRequestedAt:
    state === "cancelling" ? "2026-08-31T12:00:02.000Z" : null,
  updatedAt: "2026-08-31T12:00:01.000Z",
})

const dependencies = () => {
  let current = job("queued")
  const jobs = {
    claim: vi.fn(async () => {
      current = job("running")
      return {
        job: current,
        attempt: {
          id: attemptId,
          workspaceId: "workspace-a",
          jobId,
          attemptNumber: 1,
          providerExecutionId: null,
          state: "running" as const,
          safeFailureCode: null,
          retryable: false,
          startedAt: "2026-08-31T12:00:01.000Z",
          finishedAt: null,
        },
      }
    }),
    get: vi.fn(async () => current),
    fail: vi.fn(async () => {
      current = { ...current, state: "failed" as const }
      return current
    }),
    settleCancellation: vi.fn(async () => {
      current = { ...current, state: "cancelled" as const }
      return current
    }),
  }
  const provider = new DeterministicMediaDerivationProvider({
    mediaType: "image/png",
    bytes: png,
  })
  const settleOutput = vi.fn(async () => ({
    job: { ...current, state: "succeeded" as const },
    provenance: {
      workspaceId: "workspace-a",
      outputAssetId: "asset-fedcba9876543210fedcba9876543210",
      sourceAssetId: current.sourceAssetId,
      sourceContentHash: hash,
      derivationJobId: jobId,
      operation: "remove_background" as const,
      providerKey: provider.key,
      providerModelVersion: provider.modelVersion,
      privacyPolicyVersion: "privacy-v1",
      outputContentHash: hash,
      outputMediaType: "image/png" as const,
      outputWidth: 1,
      outputHeight: 1,
      createdAt: "2026-08-31T12:00:02.000Z",
    },
  }))
  return {
    value: {
      jobs,
      assets: {
        content: vi.fn(async () => ({
          asset: {
            id: current.sourceAssetId,
            mediaType: "image/png" as const,
            bytes: png.byteLength,
            width: 1,
            height: 1,
            status: "ready" as const,
            revision: 1,
          },
          contentHash: hash,
          body: new Blob([png]).stream(),
        })),
      },
      provider,
      admitAttempt: vi.fn(async () => undefined),
      settleOutput,
      timeoutMs: 1_000,
      maxPolls: 2,
    },
    jobs,
    provider,
    settleOutput,
    cancel: () => {
      current = job("cancelling")
    },
  }
}

describe("media derivation execution", () => {
  it("strips PNG ancillary metadata before provider dispatch", () => {
    const withPhysicalMetadata = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQI12NgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg==",
        "base64"
      )
    )
    const sanitized = sanitizeProviderInput({
      jobId,
      attemptId,
      workspaceId: "workspace-a",
      sourceAssetId: job("running").sourceAssetId,
      sourceContentHash: hash,
      mediaType: "image/png",
      width: 1,
      height: 1,
      bytes: withPhysicalMetadata,
    })
    expect(Buffer.from(sanitized.bytes).toString("base64")).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg=="
    )
    expect(() =>
      sanitizeProviderInput({ ...sanitized, mediaType: "image/jpeg" })
    ).toThrowError(expect.objectContaining({ code: "unsupported_input" }))
  })

  it("verifies source identity before the adapter and delegates settlement", async () => {
    const fixture = dependencies()
    const result = await executeMediaDerivation(
      fixture.value,
      "workspace-a",
      jobId
    )
    expect(result.status).toBe("succeeded")
    expect(fixture.provider.starts[0]).toMatchObject({
      workspaceId: "workspace-a",
      sourceContentHash: hash,
    })
    expect(fixture.settleOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        output: { mediaType: "image/png", bytes: png },
      })
    )
    expect(result).toMatchObject({
      status: "succeeded",
      settlement: {
        provenance: {
          providerKey: job("running").providerKey,
          providerModelVersion: job("running").providerModelVersion,
        },
      },
    })
  })

  it.each([
    ["provider key", { key: "different-provider" }],
    ["model version", { modelVersion: "different-model" }],
  ])(
    "rejects a current %s mismatch before provider start",
    async (_, mismatch) => {
      const fixture = dependencies()
      Object.defineProperty(fixture.value.provider, "key", {
        value: mismatch.key ?? fixture.value.provider.key,
      })
      Object.defineProperty(fixture.value.provider, "modelVersion", {
        value: mismatch.modelVersion ?? fixture.value.provider.modelVersion,
      })

      const result = await executeMediaDerivation(
        fixture.value,
        "workspace-a",
        jobId
      )

      expect(result.status).toBe("failed")
      expect(fixture.provider.starts).toHaveLength(0)
      expect(fixture.value.admitAttempt).not.toHaveBeenCalled()
      expect(fixture.jobs.fail).toHaveBeenCalledWith(
        "workspace-a",
        jobId,
        attemptId,
        { code: "provider_configuration_mismatch", retryable: false }
      )
    }
  )

  it("rejects late provider success after cancellation", async () => {
    const fixture = dependencies()
    fixture.jobs.get.mockImplementationOnce(async () => {
      fixture.cancel()
      return job("cancelling")
    })
    const result = await executeMediaDerivation(
      fixture.value,
      "workspace-a",
      jobId
    )
    expect(result.status).toBe("cancelled")
    expect(fixture.provider.cancellations).toEqual([`fake:${attemptId}`])
    expect(fixture.settleOutput).not.toHaveBeenCalled()
  })

  it("maps adapter failures to safe retryable job failures", async () => {
    const fixture = dependencies()
    fixture.value.provider = new DeterministicMediaDerivationProvider(
      { mediaType: "image/png", bytes: png },
      "failed"
    )
    const result = await executeMediaDerivation(
      fixture.value,
      "workspace-a",
      jobId
    )
    expect(result.status).toBe("failed")
    expect(fixture.jobs.fail).toHaveBeenCalledWith(
      "workspace-a",
      jobId,
      attemptId,
      { state: "failed", code: "provider_unavailable", retryable: true }
    )
  })
})
