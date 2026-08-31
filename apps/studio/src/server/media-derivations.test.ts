import { describe, expect, it } from "vitest"
import {
  mediaDerivationRequestIdentity,
  parseMediaDerivationConfiguration,
  parseMediaDerivationCreateInput,
  publicMediaDerivationJob,
} from "./media-derivations"
import type { MediaDerivationJob } from "./media-derivations"

const createInput = {
  sourceAssetId: "asset-0000000000000001",
  operation: "remove_background" as const,
  parameters: {},
}

const configuration = {
  providerKey: "configured-adapter",
  providerModelVersion: "model-2026-08",
  privacyPolicyVersion: "privacy-2026-08",
  maxAttempts: 3,
}

describe("media derivation contract", () => {
  it("accepts only the provider-neutral background-removal input", () => {
    expect(parseMediaDerivationCreateInput(createInput)).toEqual(createInput)
    expect(() =>
      parseMediaDerivationCreateInput({
        ...createInput,
        providerKey: "caller-selected-provider",
      })
    ).toThrowError(
      expect.objectContaining({ code: "invalid_derivation_request" })
    )
    expect(() =>
      parseMediaDerivationCreateInput({
        ...createInput,
        parameters: { threshold: 0.5 },
      })
    ).toThrowError(
      expect.objectContaining({ code: "invalid_derivation_request" })
    )
    expect(() =>
      parseMediaDerivationCreateInput({
        ...createInput,
        sourceUrl: "https://example.test/private.png",
      })
    ).toThrowError(
      expect.objectContaining({ code: "invalid_derivation_request" })
    )
  })

  it("freezes provider, model, policy, source bytes, and canonical parameters into identity", async () => {
    const parsedConfiguration = parseMediaDerivationConfiguration(configuration)
    const baseline = await mediaDerivationRequestIdentity({
      workspaceId: "workspace-a",
      sourceAssetId: createInput.sourceAssetId,
      sourceContentHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operation: createInput.operation,
      parameters: createInput.parameters,
      configuration: parsedConfiguration,
    })
    expect(baseline.parametersJson).toBe("{}")
    expect(baseline.parametersHash).toMatch(/^[a-f0-9]{64}$/)
    expect(baseline.requestFingerprint).toMatch(/^[a-f0-9]{64}$/)

    for (const changed of [
      { ...configuration, providerKey: "other-adapter" },
      { ...configuration, providerModelVersion: "model-2026-09" },
      { ...configuration, privacyPolicyVersion: "privacy-2026-09" },
    ]) {
      const identity = await mediaDerivationRequestIdentity({
        workspaceId: "workspace-a",
        sourceAssetId: createInput.sourceAssetId,
        sourceContentHash:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        operation: createInput.operation,
        parameters: createInput.parameters,
        configuration: parseMediaDerivationConfiguration(changed),
      })
      expect(identity.requestFingerprint).not.toBe(baseline.requestFingerprint)
      expect(identity.parametersHash).toBe(baseline.parametersHash)
    }
  })

  it("projects safe job state without provider or fingerprint data", () => {
    const job: MediaDerivationJob = {
      id: "derivation-00000000000000001",
      workspaceId: "workspace-a",
      sourceAssetId: createInput.sourceAssetId,
      sourceContentHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operation: "remove_background",
      parameters: {},
      parametersHash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      providerKey: configuration.providerKey,
      providerModelVersion: configuration.providerModelVersion,
      privacyPolicyVersion: configuration.privacyPolicyVersion,
      requestFingerprint:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      state: "queued",
      outputAssetId: null,
      activeAttemptId: null,
      attemptCount: 0,
      maxAttempts: configuration.maxAttempts,
      retryable: false,
      safeFailureCode: null,
      createdAt: "2026-08-31T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      cancellationRequestedAt: null,
      updatedAt: "2026-08-31T00:00:00.000Z",
    }
    const projection = publicMediaDerivationJob(job)
    expect(projection).toMatchObject({
      id: job.id,
      sourceAssetId: job.sourceAssetId,
      operation: "remove_background",
      state: "queued",
    })
    expect(projection).not.toHaveProperty("workspaceId")
    expect(projection).not.toHaveProperty("sourceContentHash")
    expect(projection).not.toHaveProperty("parametersHash")
    expect(projection).not.toHaveProperty("providerKey")
    expect(projection).not.toHaveProperty("providerModelVersion")
    expect(projection).not.toHaveProperty("privacyPolicyVersion")
    expect(projection).not.toHaveProperty("requestFingerprint")
    expect(projection).not.toHaveProperty("activeAttemptId")
  })
})
