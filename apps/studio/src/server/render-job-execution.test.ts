import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CuratedAssetMaterializationError,
  ManagedAssetMaterializationError,
} from "./render-field-assets"
import {
  completeRenderAdmissionWithinDeadline,
  durableRenderFailureCode,
  durableRenderFailureMessage,
  failRenderJobAttempt,
  RenderDeadlineExceededError,
  withRenderDeadline,
} from "./render-job-execution"

type FailureJob = {
  id: string
  workspace_id: string
  template_public_id: string
  template_version: number
  status: "rendering"
  request_json: string
  attempt_count: number
  max_attempts: number
  cancellation_requested_at: null
  deadline_at: string
  admission_key: string
  active_attempt_id: string
  admission_settlement: "pending" | null
  workflow_instance_id: string
}

const plan = {
  renderId: "render-test",
  attempt: 1,
  attemptId: "render-test:attempt:1",
  reservationId: "render-test",
  storageRenderId: "render-test/attempt-1",
  deadlineAt: "2026-08-31T00:00:00.000Z",
  selections: [],
}

const failureJob = (
  admissionSettlement: "pending" | null = null
): FailureJob => ({
  id: plan.renderId,
  workspace_id: "workspace-test",
  template_public_id: "template-test",
  template_version: 1,
  status: "rendering",
  request_json: JSON.stringify({ invalidWithoutMaterialization: true }),
  attempt_count: 1,
  max_attempts: 3,
  cancellation_requested_at: null,
  deadline_at: plan.deadlineAt,
  admission_key: "workspace-test",
  active_attempt_id: plan.attemptId,
  admission_settlement: admissionSettlement,
  workflow_instance_id: "workflow-test",
})

const failureEnv = (job: FailureJob) => {
  const statements: Array<{ query: string; values: unknown[] }> = []
  const fail = vi.fn(async () => undefined)
  const reserve = vi.fn()
  const prepare = vi.fn((query: string) => ({
    bind: (...values: unknown[]) => ({
      first: async () => (query.includes("FROM render_jobs jobs") ? job : null),
      run: async () => {
        statements.push({ query, values })
        return { meta: { changes: 1 } }
      },
    }),
  }))
  const env = {
    DB: { prepare },
    RENDER_ADMISSION: {
      getByName: vi.fn(() => ({ fail, reserve })),
    },
    RENDERS: {
      list: vi.fn(async () => ({ objects: [], truncated: false })),
      delete: vi.fn(async () => undefined),
    },
  } as unknown as Env
  return { env, fail, prepare, reserve, statements }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("durable render deadline ownership", () => {
  it("aborts with a branded absolute deadline reason", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"))
    const deadlineAt = new Date(Date.now() + 25).toISOString()
    const pending = withRenderDeadline(
      deadlineAt,
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )
    const rejection = expect(pending).rejects.toMatchObject({
      name: "RenderDeadlineExceededError",
      code: "render_deadline_exceeded",
    })

    await vi.advanceTimersByTimeAsync(25)
    await rejection
  })

  it("does not classify an ordinary operation timeout as the job deadline", () => {
    expect(
      durableRenderFailureCode(
        new DOMException("Renderer invocation timed out", "TimeoutError")
      )
    ).toBe("renderer_failed")
    expect(durableRenderFailureCode(new RenderDeadlineExceededError())).toBe(
      "render_deadline_exceeded"
    )
  })

  it("stops finalization when the absolute deadline crosses during admission completion", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"))
    const deadlineAt = new Date(Date.now() + 25).toISOString()
    const complete = vi.fn(async () => {
      vi.setSystemTime(new Date("2026-08-31T12:00:00.030Z"))
    })
    const lease = {
      reservationId: "render-test",
      complete,
      fail: vi.fn(async () => undefined),
    }

    await expect(
      completeRenderAdmissionWithinDeadline(deadlineAt, lease, 512)
    ).resolves.toBe(false)
    expect(complete).toHaveBeenCalledWith(512)
  })

  it("does not begin admission completion after the absolute deadline", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"))
    const complete = vi.fn(async () => undefined)
    const lease = {
      reservationId: "render-test",
      complete,
      fail: vi.fn(async () => undefined),
    }

    await expect(
      completeRenderAdmissionWithinDeadline(
        "2026-08-31T11:59:59.999Z",
        lease,
        512
      )
    ).rejects.toMatchObject({
      name: "RenderDeadlineExceededError",
      code: "render_deadline_exceeded",
    })
    expect(complete).not.toHaveBeenCalled()
  })

  it("releases the known reservation and records an expired attempt without re-preparing", async () => {
    const { env, fail, prepare, reserve, statements } = failureEnv(
      failureJob("pending")
    )

    await expect(
      failRenderJobAttempt(env, plan, [], new RenderDeadlineExceededError())
    ).resolves.toEqual({
      status: "failed",
      message: "The render did not finish before its deadline",
    })

    expect(fail).toHaveBeenCalledWith(plan.reservationId, expect.any(Number))
    expect(reserve).not.toHaveBeenCalled()
    expect(
      prepare.mock.calls.some(([query]) =>
        String(query).includes("template_versions")
      )
    ).toBe(false)
    const jobUpdate = statements.find(({ query }) =>
      query.includes("UPDATE render_jobs")
    )
    expect(jobUpdate?.values).toEqual([
      plan.renderId,
      "render_deadline_exceeded",
      "The render did not finish before its deadline",
      expect.any(String),
      0,
      plan.attemptId,
      1,
    ])
  })

  it("records the terminal deadline when reservation release transport fails twice", async () => {
    const { env, fail, statements } = failureEnv(failureJob("pending"))
    fail.mockRejectedValue(new Error("admission transport unavailable"))

    await expect(
      failRenderJobAttempt(env, plan, [], new RenderDeadlineExceededError())
    ).resolves.toMatchObject({ status: "failed" })

    expect(fail).toHaveBeenCalledTimes(2)
    const jobUpdate = statements.find(({ query }) =>
      query.includes("UPDATE render_jobs")
    )
    expect(jobUpdate?.values[1]).toBe("render_deadline_exceeded")
    expect(jobUpdate?.values[6]).toBe(0)
  })
})

describe("durable render materialization failures", () => {
  it.each([
    [
      new CuratedAssetMaterializationError(
        "hero-curated",
        "field:hero_asset:default",
        new Error("hash mismatch")
      ),
      "curated_asset_materialization_failed",
      "field:hero_asset:default",
    ],
    [
      new ManagedAssetMaterializationError(
        "asset-managed",
        "field:hero_asset:current",
        new Error("asset unavailable")
      ),
      "managed_asset_materialization_failed",
      "field:hero_asset:current",
    ],
  ])(
    "records %s with its typed code and locator",
    async (error, code, locator) => {
      const { env, statements } = failureEnv(failureJob())

      await failRenderJobAttempt(env, plan, [], error)

      const jobUpdate = statements.find(({ query }) =>
        query.includes("UPDATE render_jobs")
      )
      const attemptUpdate = statements.find(({ query }) =>
        query.includes("UPDATE render_attempts")
      )
      expect(jobUpdate?.values[1]).toBe(code)
      expect(jobUpdate?.values[2]).toContain(locator)
      expect(attemptUpdate?.values[2]).toBe(code)
      expect(attemptUpdate?.values[3]).toContain(locator)
    }
  )

  it("keeps the typed code after a workflow error is reconstructed", () => {
    const reconstructed = {
      code: "curated_asset_materialization_failed",
      message:
        "Curated image node field:hero_asset:current failed resource integrity validation",
    }

    expect(durableRenderFailureCode(reconstructed)).toBe(
      "curated_asset_materialization_failed"
    )
    expect(durableRenderFailureMessage(reconstructed)).toContain(
      "field:hero_asset:current"
    )
  })
})
