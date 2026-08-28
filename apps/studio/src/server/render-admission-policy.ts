import type { RenderResourcePlan } from "@webmcp/document"

export const renderBudgetLimits = Object.freeze({
  maxConcurrent: 2,
  maxRequestsPerDay: 100,
  maxPagesPerDay: 500,
  maxPixelAreaPerDay: 750_000_000,
  maxStorageBytesPerDay: 2_000_000_000,
  reservationTtlMs: 2 * 60_000,
})

export const thumbnailRenderBudgetLimits = Object.freeze({
  maxConcurrent: 3,
  maxRequestsPerDay: 2_000,
  maxPagesPerDay: 2_000,
  maxPixelAreaPerDay: 100_000_000,
  maxStorageBytesPerDay: 500_000_000,
  reservationTtlMs: 2 * 60_000,
})

export type RenderAdmissionWorkload = "artifact" | "thumbnail"

export const renderBudgetLimitsFor = (workload: RenderAdmissionWorkload) =>
  workload === "thumbnail" ? thumbnailRenderBudgetLimits : renderBudgetLimits

export type RenderReservationRequest = RenderResourcePlan & {
  reservationId: string
  now: number
  workload: RenderAdmissionWorkload
}

export type RenderAdmissionDecision =
  | {
      admitted: true
      reservationId: string
      expiresAt: number
    }
  | {
      admitted: false
      code:
        | "render_concurrency_exceeded"
        | "render_request_budget_exceeded"
        | "render_page_budget_exceeded"
        | "render_pixel_budget_exceeded"
        | "render_storage_budget_exceeded"
      retryAfterSeconds: number
    }
