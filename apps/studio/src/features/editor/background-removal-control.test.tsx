import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BackgroundRemovalControl } from "./background-removal-control"
import type { BackgroundRemovalJob } from "./background-removal-client"
import type { BackgroundRemovalModel } from "./use-background-removal"

const now = "2026-08-31T12:00:00.000Z"
const sourceAssetId = "asset-0123456789abcdef0123456789abcdef"

const model = (
  state?: BackgroundRemovalJob["state"]
): BackgroundRemovalModel => ({
  available: true,
  unavailableReason: null,
  policy: {
    operation: "remove_background",
    privacyPolicyVersion: "privacy-v1",
    subprocessor: "Configured image processor",
    retention: "Deleted within 24 hours",
    region: "India",
    cost: "1 credit",
    cancellationLimits: "Cancellation is cooperative after dispatch",
  },
  policyLoading: false,
  job: state
    ? {
        id: "derivation-01234567-89ab-cdef-0123-456789abcdef",
        sourceAssetId,
        operation: "remove_background",
        state,
        outputAssetId:
          state === "succeeded"
            ? "asset-fedcba9876543210fedcba9876543210"
            : null,
        attemptCount: 1,
        maxAttempts: 3,
        retryable: state === "failed",
        safeFailureCode: state === "failed" ? "provider_unavailable" : null,
        createdAt: now,
        startedAt: now,
        completedAt: state === "running" ? null : now,
        cancellationRequestedAt: state === "cancelled" ? now : null,
        updatedAt: now,
      }
    : null,
  busy: state === "queued" || state === "running" || state === "cancelling",
  applying: false,
  applied: false,
  error: null,
  start: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  apply: vi.fn(),
})

const render = (state?: BackgroundRemovalJob["state"]) =>
  renderToStaticMarkup(
    <BackgroundRemovalControl
      model={model(state)}
      sourceAssetId={sourceAssetId}
    />
  )

describe("BackgroundRemovalControl", () => {
  it("discloses processor terms and requires explicit consent before start", () => {
    const markup = render()
    expect(markup).toContain("Configured image processor")
    expect(markup).toContain("Deleted within 24 hours")
    expect(markup).toContain("Cancellation is cooperative after dispatch")
    expect(markup).toContain("privacy-v1")
    expect(markup).toContain("disabled")
  })

  it("renders cancellable progress and safe retryable failure states", () => {
    expect(render("running")).toContain("Processing attempt 1 of 3")
    expect(render("running")).toContain("Cancel")
    expect(render("failed")).toContain(
      "The image processor is temporarily unavailable."
    )
    expect(render("failed")).toContain("Retry")
  })

  it("renders durable before/after previews and an explicit apply action", () => {
    const markup = render("succeeded")
    expect(markup).toContain("Before")
    expect(markup).toContain("After")
    expect(markup).toContain("Apply to image")
    expect(markup).toContain("result is already saved in Media")
  })
})
