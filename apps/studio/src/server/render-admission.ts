import { DurableObject } from "cloudflare:workers"
import {
  renderBudgetLimitsFor,
  uploadBudgetLimits,
} from "./render-admission-policy"
import type {
  RenderAdmissionDecision,
  RenderReservationRequest,
} from "./render-admission-policy"

export {
  renderBudgetLimits,
  renderBudgetLimitsFor,
  thumbnailRenderBudgetLimits,
  uploadBudgetLimits,
} from "./render-admission-policy"
export type {
  RenderAdmissionDecision,
  RenderAdmissionWorkload,
  RenderReservationRequest,
} from "./render-admission-policy"

type UsageRow = {
  day: string
  request_count: number
  page_count: number
  pixel_area: number
  storage_bytes: number
}

const utcDay = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10)
const secondsUntilNextUtcDay = (timestamp: number) => {
  const date = new Date(timestamp)
  const next = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  )
  return Math.max(1, Math.ceil((next - timestamp) / 1_000))
}

export class RenderAdmission extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS usage (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          day TEXT NOT NULL,
          request_count INTEGER NOT NULL,
          page_count INTEGER NOT NULL,
          pixel_area INTEGER NOT NULL,
          storage_bytes INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reservations (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed', 'expired')),
          estimated_bytes INTEGER NOT NULL,
          actual_bytes INTEGER,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS reservations_status_expiry
          ON reservations(status, expires_at);
        CREATE TABLE IF NOT EXISTS api_rate_window (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          window_start INTEGER NOT NULL,
          request_count INTEGER NOT NULL
        );
      `)
    })
  }

  async admitApiRequest(input: {
    now: number
    limit: number
    windowMs: number
  }): Promise<
    | { admitted: true; remaining: number }
    | { admitted: false; retryAfterSeconds: number }
  > {
    const limit = Math.max(1, Math.floor(input.limit))
    const windowMs = Math.max(1_000, Math.floor(input.windowMs))
    const windowStart = Math.floor(input.now / windowMs) * windowMs
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{ window_start: number; request_count: number }>(
          `SELECT window_start, request_count
           FROM api_rate_window WHERE singleton = 1`
        )
        .toArray()
        .at(0)
      const requestCount =
        !row || row.window_start !== windowStart ? 0 : row.request_count
      if (requestCount >= limit) {
        return {
          admitted: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowStart + windowMs - input.now) / 1_000)
          ),
        }
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO api_rate_window (singleton, window_start, request_count)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           window_start = excluded.window_start,
           request_count = excluded.request_count`,
        windowStart,
        requestCount + 1
      )
      return { admitted: true, remaining: limit - requestCount - 1 }
    })
  }

  async reserve(
    request: RenderReservationRequest
  ): Promise<RenderAdmissionDecision> {
    const limits = renderBudgetLimitsFor(request.workload)
    const day = utcDay(request.now)
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql
      const current = sql
        .exec<UsageRow>(
          `SELECT day, request_count, page_count, pixel_area, storage_bytes
           FROM usage WHERE singleton = 1`
        )
        .toArray()
        .at(0)
      if (!current || current.day !== day) {
        sql.exec("DELETE FROM reservations")
        sql.exec(
          `INSERT OR REPLACE INTO usage
           (singleton, day, request_count, page_count, pixel_area, storage_bytes)
           VALUES (1, ?, 0, 0, 0, 0)`,
          day
        )
      } else {
        const expired =
          sql
            .exec<{ reserved_bytes: number }>(
              `SELECT COALESCE(SUM(estimated_bytes), 0) AS reserved_bytes
             FROM reservations WHERE status = 'active' AND expires_at <= ?`,
              request.now
            )
            .toArray()[0]?.reserved_bytes ?? 0
        if (expired > 0) {
          sql.exec(
            `UPDATE usage SET storage_bytes = MAX(0, storage_bytes - ?)
             WHERE singleton = 1`,
            expired
          )
          sql.exec(
            `UPDATE reservations SET status = 'expired', completed_at = ?
             WHERE status = 'active' AND expires_at <= ?`,
            request.now,
            request.now
          )
        }
      }

      const existing = sql
        .exec<{
          status: string
          estimated_bytes: number
          actual_bytes: number | null
        }>(
          `SELECT status, estimated_bytes, actual_bytes
           FROM reservations WHERE id = ?`,
          request.reservationId
        )
        .toArray()
        .at(0)
      if (existing?.status === "active") {
        const expiresAt = request.now + limits.reservationTtlMs
        sql.exec(
          `UPDATE reservations SET expires_at = ?
           WHERE id = ? AND status = 'active'`,
          expiresAt,
          request.reservationId
        )
        return {
          admitted: true,
          reservationId: request.reservationId,
          expiresAt,
        }
      }
      const usage = sql
        .exec<UsageRow>(
          `SELECT day, request_count, page_count, pixel_area, storage_bytes
           FROM usage WHERE singleton = 1`
        )
        .one()
      const active = sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM reservations WHERE status = 'active'"
        )
        .one().count
      if (request.workload === "upload") {
        const activeUploads = sql
          .exec<{ count: number; bytes: number }>(
            `SELECT COUNT(*) AS count, COALESCE(SUM(estimated_bytes), 0) AS bytes
             FROM reservations WHERE status = 'active'`
          )
          .one()
        const currentStorageBytes = Math.max(
          0,
          Math.floor(request.currentStorageBytes ?? 0)
        )
        const currentAssetCount = Math.max(
          0,
          Math.floor(request.currentAssetCount ?? 0)
        )
        if (
          currentStorageBytes +
            activeUploads.bytes +
            request.estimatedStorageBytes >
          uploadBudgetLimits.maxWorkspaceStorageBytes
        ) {
          return {
            admitted: false,
            code: "upload_workspace_storage_exceeded",
            retryAfterSeconds: 0,
          }
        }
        if (
          currentAssetCount + activeUploads.count + 1 >
          uploadBudgetLimits.maxWorkspaceAssets
        ) {
          return {
            admitted: false,
            code: "upload_workspace_asset_count_exceeded",
            retryAfterSeconds: 0,
          }
        }
      }
      const dayRetry = secondsUntilNextUtcDay(request.now)
      if (active >= limits.maxConcurrent) {
        return {
          admitted: false,
          code:
            request.workload === "upload"
              ? "upload_concurrency_exceeded"
              : "render_concurrency_exceeded",
          retryAfterSeconds: 30,
        }
      }
      if (existing?.status === "completed") {
        const previousBytes = existing.actual_bytes ?? 0
        const reactivationBytes = request.estimatedStorageBytes
        const projectedStorage =
          usage.storage_bytes - previousBytes + reactivationBytes
        if (projectedStorage > limits.maxStorageBytesPerDay) {
          return {
            admitted: false,
            code:
              request.workload === "upload"
                ? "upload_daily_storage_budget_exceeded"
                : "render_storage_budget_exceeded",
            retryAfterSeconds: dayRetry,
          }
        }
        const expiresAt = request.now + limits.reservationTtlMs
        sql.exec(
          `UPDATE reservations
           SET status = 'active', estimated_bytes = ?, actual_bytes = NULL,
               created_at = ?, expires_at = ?, completed_at = NULL
           WHERE id = ? AND status = 'completed'`,
          reactivationBytes,
          request.now,
          expiresAt,
          request.reservationId
        )
        sql.exec(
          `UPDATE usage SET storage_bytes = MAX(0, storage_bytes - ?) + ?
           WHERE singleton = 1`,
          previousBytes,
          reactivationBytes
        )
        return {
          admitted: true,
          reservationId: request.reservationId,
          expiresAt,
        }
      }
      if (
        existing &&
        (existing.status === "failed" || existing.status === "expired")
      ) {
        if (
          usage.storage_bytes + request.estimatedStorageBytes >
          limits.maxStorageBytesPerDay
        ) {
          return {
            admitted: false,
            code:
              request.workload === "upload"
                ? "upload_daily_storage_budget_exceeded"
                : "render_storage_budget_exceeded",
            retryAfterSeconds: dayRetry,
          }
        }
        const expiresAt = request.now + limits.reservationTtlMs
        sql.exec(
          `UPDATE reservations
           SET status = 'active', estimated_bytes = ?, actual_bytes = NULL,
               created_at = ?, expires_at = ?, completed_at = NULL
           WHERE id = ?`,
          request.estimatedStorageBytes,
          request.now,
          expiresAt,
          request.reservationId
        )
        sql.exec(
          `UPDATE usage SET storage_bytes = storage_bytes + ?
           WHERE singleton = 1`,
          request.estimatedStorageBytes
        )
        return {
          admitted: true,
          reservationId: request.reservationId,
          expiresAt,
        }
      }
      if (usage.request_count + 1 > limits.maxRequestsPerDay) {
        return {
          admitted: false,
          code:
            request.workload === "upload"
              ? "upload_request_budget_exceeded"
              : "render_request_budget_exceeded",
          retryAfterSeconds: dayRetry,
        }
      }
      if (usage.page_count + request.pageCount > limits.maxPagesPerDay) {
        return {
          admitted: false,
          code: "render_page_budget_exceeded",
          retryAfterSeconds: dayRetry,
        }
      }
      if (usage.pixel_area + request.pixelArea > limits.maxPixelAreaPerDay) {
        return {
          admitted: false,
          code: "render_pixel_budget_exceeded",
          retryAfterSeconds: dayRetry,
        }
      }
      if (
        usage.storage_bytes + request.estimatedStorageBytes >
        limits.maxStorageBytesPerDay
      ) {
        return {
          admitted: false,
          code:
            request.workload === "upload"
              ? "upload_daily_storage_budget_exceeded"
              : "render_storage_budget_exceeded",
          retryAfterSeconds: dayRetry,
        }
      }

      const expiresAt = request.now + limits.reservationTtlMs
      sql.exec(
        `INSERT INTO reservations
         (id, status, estimated_bytes, created_at, expires_at)
         VALUES (?, 'active', ?, ?, ?)`,
        request.reservationId,
        request.estimatedStorageBytes,
        request.now,
        expiresAt
      )
      sql.exec(
        `UPDATE usage
         SET request_count = request_count + 1,
             page_count = page_count + ?,
             pixel_area = pixel_area + ?,
             storage_bytes = storage_bytes + ?
         WHERE singleton = 1`,
        request.pageCount,
        request.pixelArea,
        request.estimatedStorageBytes
      )
      return {
        admitted: true,
        reservationId: request.reservationId,
        expiresAt,
      }
    })
  }

  async complete(
    reservationId: string,
    actualBytes: number,
    now: number
  ): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const reservation = this.ctx.storage.sql
        .exec<{ status: string; estimated_bytes: number }>(
          "SELECT status, estimated_bytes FROM reservations WHERE id = ?",
          reservationId
        )
        .toArray()
        .at(0)
      if (!reservation || reservation.status !== "active") return
      const safeActualBytes = Math.max(0, Math.floor(actualBytes))
      this.ctx.storage.sql.exec(
        `UPDATE usage SET storage_bytes = MAX(0, storage_bytes - ? + ?)
         WHERE singleton = 1`,
        reservation.estimated_bytes,
        safeActualBytes
      )
      this.ctx.storage.sql.exec(
        `UPDATE reservations
         SET status = 'completed', actual_bytes = ?, completed_at = ?
         WHERE id = ?`,
        safeActualBytes,
        now,
        reservationId
      )
    })
  }

  async fail(reservationId: string, now: number): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const reservation = this.ctx.storage.sql
        .exec<{
          status: string
          estimated_bytes: number
          actual_bytes: number | null
        }>(
          `SELECT status, estimated_bytes, actual_bytes
           FROM reservations WHERE id = ?`,
          reservationId
        )
        .toArray()
        .at(0)
      if (
        !reservation ||
        (reservation.status !== "active" && reservation.status !== "completed")
      )
        return
      const accountedBytes =
        reservation.status === "completed"
          ? (reservation.actual_bytes ?? 0)
          : reservation.estimated_bytes
      this.ctx.storage.sql.exec(
        `UPDATE usage SET storage_bytes = MAX(0, storage_bytes - ?)
         WHERE singleton = 1`,
        accountedBytes
      )
      this.ctx.storage.sql.exec(
        `UPDATE reservations SET status = 'failed', completed_at = ? WHERE id = ?`,
        now,
        reservationId
      )
    })
  }
}
