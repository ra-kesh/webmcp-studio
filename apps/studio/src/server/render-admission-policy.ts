import type { RenderResourcePlan } from "@webmcp/document"

export const renderBudgetLimits = Object.freeze({
  maxConcurrent: 2,
  maxRequestsPerDay: 100,
  maxPagesPerDay: 500,
  maxPixelAreaPerDay: 750_000_000,
  maxStorageBytesPerDay: 2_000_000_000,
  // A durable render has a ten-minute execution deadline. Keep its admission
  // lease slightly longer so a valid long-running attempt cannot lose its
  // concurrency/storage reservation before the workflow settles it.
  reservationTtlMs: 12 * 60_000,
})

export const thumbnailRenderBudgetLimits = Object.freeze({
  maxConcurrent: 3,
  maxRequestsPerDay: 2_000,
  maxPagesPerDay: 2_000,
  maxPixelAreaPerDay: 100_000_000,
  maxStorageBytesPerDay: 500_000_000,
  reservationTtlMs: 2 * 60_000,
})

export const uploadBudgetLimits = Object.freeze({
  maxConcurrent: 3,
  maxRequestsPerDay: 500,
  maxPagesPerDay: Number.MAX_SAFE_INTEGER,
  maxPixelAreaPerDay: Number.MAX_SAFE_INTEGER,
  maxStorageBytesPerDay: 2_000_000_000,
  maxWorkspaceStorageBytes: 1_000_000_000,
  maxWorkspaceAssets: 5_000,
  reservationTtlMs: 5 * 60_000,
})

export type RenderAdmissionWorkload = "artifact" | "thumbnail" | "upload"

export const renderBudgetLimitsFor = (workload: RenderAdmissionWorkload) =>
  workload === "thumbnail"
    ? thumbnailRenderBudgetLimits
    : workload === "upload"
      ? uploadBudgetLimits
      : renderBudgetLimits

export type RenderReservationRequest = Pick<
  RenderResourcePlan,
  "pageCount" | "pixelArea" | "estimatedStorageBytes"
> & {
  reservationId: string
  now: number
  workload: RenderAdmissionWorkload
  currentStorageBytes?: number
  currentAssetCount?: number
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
        | "upload_request_budget_exceeded"
        | "upload_concurrency_exceeded"
        | "upload_daily_storage_budget_exceeded"
        | "upload_workspace_storage_exceeded"
        | "upload_workspace_asset_count_exceeded"
      retryAfterSeconds: number
    }
