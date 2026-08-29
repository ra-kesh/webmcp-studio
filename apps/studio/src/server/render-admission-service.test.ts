import { describe, expect, it, vi } from "vitest"
import type { RenderResourcePlan } from "@webmcp/document"

import { renderBudgetLimitsFor } from "./render-admission-policy"
import {
  completeRenderLeaseWithRetry,
  failRenderLeaseWithRetry,
  RenderAdmissionCompletionError,
  reserveMediaUploadCapacity,
  reserveThumbnailCapacity,
} from "./render-admission-service"
import type { StudioPrincipal } from "./studio-principal"

const principal: StudioPrincipal = {
  id: "principal-test",
  budgetKey: "workspace-test",
  workspaceId: "workspace-test",
  expiresAt: "2099-01-01T00:00:00.000Z",
  mode: "cloudflare_access",
  respond: (response) => response,
}

const plan: RenderResourcePlan = {
  outputId: "proposal",
  format: "png",
  pageIds: ["cover"],
  pageCount: 1,
  pixelArea: 14_688,
  estimatedStorageBytes: 58_752,
}

describe("thumbnail render admission", () => {
  it("isolates upload admission by workspace budget and current storage", async () => {
    const reserve = vi.fn(async () => ({
      admitted: true as const,
      reservationId: "media-upload-1",
      expiresAt: Date.now() + 60_000,
    }))
    const getByName = vi.fn(() => ({
      reserve,
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    }))
    const env = {
      RENDER_ADMISSION: { getByName },
    } as unknown as Env

    await reserveMediaUploadCapacity(env, principal, {
      reservationId: "media-upload-1",
      estimatedStorageBytes: 5_000_000,
      currentStorageBytes: 10_000_000,
      currentAssetCount: 12,
    })

    expect(getByName).toHaveBeenCalledWith("upload:workspace-test")
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "media-upload-1",
        workload: "upload",
        estimatedStorageBytes: 5_000_000,
        currentStorageBytes: 10_000_000,
        currentAssetCount: 12,
      })
    )
  })

  it("uses an isolated budget aligned with three client producers", async () => {
    const reserve = vi.fn(async () => ({
      admitted: true as const,
      reservationId: "thumbnail-test",
      expiresAt: Date.now() + 60_000,
    }))
    const complete = vi.fn(async () => undefined)
    const fail = vi.fn(async () => undefined)
    const getByName = vi.fn(() => ({ reserve, complete, fail }))
    const env = {
      RENDER_ADMISSION: { getByName },
    } as unknown as Env

    const lease = await reserveThumbnailCapacity(
      env,
      principal,
      plan,
      "thumbnail-test"
    )

    expect(renderBudgetLimitsFor("artifact").maxConcurrent).toBe(2)
    expect(renderBudgetLimitsFor("artifact").maxRequestsPerDay).toBe(100)
    expect(renderBudgetLimitsFor("thumbnail").maxConcurrent).toBe(3)
    expect(renderBudgetLimitsFor("thumbnail").maxRequestsPerDay).toBe(2_000)
    expect(getByName).toHaveBeenCalledWith("thumbnail:workspace-test")
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        ...plan,
        reservationId: "thumbnail-test",
        workload: "thumbnail",
      })
    )

    await lease.complete(1_024)
    expect(complete).toHaveBeenCalledWith(
      "thumbnail-test",
      1_024,
      expect.any(Number)
    )
    expect(fail).not.toHaveBeenCalled()
  })

  it("allows failure settlement after a completion RPC rejects", async () => {
    const reserve = vi.fn(async () => ({
      admitted: true as const,
      reservationId: "thumbnail-retry",
      expiresAt: Date.now() + 60_000,
    }))
    const completeError = new Error("completion transport failed")
    const complete = vi.fn(async () => {
      throw completeError
    })
    const fail = vi.fn(async () => undefined)
    const env = {
      RENDER_ADMISSION: {
        getByName: vi.fn(() => ({ reserve, complete, fail })),
      },
    } as unknown as Env
    const lease = await reserveThumbnailCapacity(
      env,
      principal,
      plan,
      "thumbnail-retry"
    )

    await expect(lease.complete(1_024)).rejects.toBe(completeError)
    await expect(lease.fail()).resolves.toBeUndefined()

    expect(complete).toHaveBeenCalledOnce()
    expect(fail).toHaveBeenCalledOnce()
  })

  it("allows a failed settlement RPC to be retried", async () => {
    const reserve = vi.fn(async () => ({
      admitted: true as const,
      reservationId: "thumbnail-fail-retry",
      expiresAt: Date.now() + 60_000,
    }))
    const complete = vi.fn(async () => undefined)
    const fail = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("failure transport failed"))
      .mockResolvedValueOnce(undefined)
    const env = {
      RENDER_ADMISSION: {
        getByName: vi.fn(() => ({ reserve, complete, fail })),
      },
    } as unknown as Env
    const lease = await reserveThumbnailCapacity(
      env,
      principal,
      plan,
      "thumbnail-fail-retry"
    )

    await expect(lease.fail()).rejects.toThrow("failure transport failed")
    await expect(lease.fail()).resolves.toBeUndefined()

    expect(fail).toHaveBeenCalledTimes(2)
    expect(complete).not.toHaveBeenCalled()
  })

  it("retries a transient failure settlement without waiting for lease expiry", async () => {
    const fail = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("transient transport failure"))
      .mockResolvedValueOnce(undefined)

    await expect(
      failRenderLeaseWithRetry({
        reservationId: "render-failure-retry",
        complete: vi.fn(async () => undefined),
        fail,
      })
    ).resolves.toBeUndefined()

    expect(fail).toHaveBeenCalledTimes(2)
  })

  it("reports both settlement failures so TTL recovery remains observable", async () => {
    const first = new Error("first transport failure")
    const second = new Error("second transport failure")
    const fail = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)

    await expect(
      failRenderLeaseWithRetry({
        reservationId: "render-failure-exhausted",
        complete: vi.fn(async () => undefined),
        fail,
      })
    ).rejects.toMatchObject({
      name: "AggregateError",
      errors: [first, second],
    })

    expect(fail).toHaveBeenCalledTimes(2)
  })

  it("retries completion acknowledgement before finalization is published", async () => {
    const complete = vi
      .fn<(actualBytes: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("transient completion failure"))
      .mockResolvedValueOnce(undefined)

    await expect(
      completeRenderLeaseWithRetry(
        {
          reservationId: "render-completion-retry",
          complete,
          fail: vi.fn(async () => undefined),
        },
        4_096
      )
    ).resolves.toBeUndefined()

    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenNthCalledWith(1, 4_096)
    expect(complete).toHaveBeenNthCalledWith(2, 4_096)
  })

  it("preserves ambiguous completion as an explicit reconciliation state", async () => {
    const complete = vi
      .fn<(actualBytes: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("first completion failure"))
      .mockRejectedValueOnce(new Error("second completion failure"))

    await expect(
      completeRenderLeaseWithRetry(
        {
          reservationId: "render-completion-unknown",
          complete,
          fail: vi.fn(async () => undefined),
        },
        4_096
      )
    ).rejects.toBeInstanceOf(RenderAdmissionCompletionError)

    expect(complete).toHaveBeenCalledTimes(2)
  })
})
