import {
  mediaAssetUploadReservationRequestSchema,
  mediaAssetUploadReservationResponseSchema,
} from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { apiErrorResponse, apiIssuesFrom } from "./api-boundary"
import { readStudioJsonBody } from "./json-request-policy"
import { MediaAssetRepository } from "./media-asset-repository"
import {
  MAX_MEDIA_ASSET_BYTES,
  MediaAssetError,
  sha256Hex,
  validateMediaUpload,
} from "./media-assets"
import {
  completeRenderLeaseWithRetry,
  failRenderLeaseWithRetry,
  RenderAdmissionError,
  renderAdmissionErrorResponse,
} from "./render-admission-service"
import type { RenderAdmissionLease } from "./render-admission-service"
import type { StudioPrincipal } from "./studio-principal"

const RESERVATION_TTL_MS = 10 * 60_000
const CLAIM_TTL_MS = 2 * 60_000
const reservationIdPattern = /^upload-[A-Za-z0-9_-]{13,89}$/
const bearerTokenPattern = /^[A-Za-z0-9_-]{43}$/

type ReservationRow = {
  id: string
  token_hash: string
  workspace_id: string
  budget_key: string
  name: string
  media_type: "image/png" | "image/jpeg" | "image/webp"
  expected_bytes: number
  idempotency_key: string
  created_at: string
  expires_at: string
  claim_expires_at: string | null
  consumed_at: string | null
  asset_id: string | null
}

const opaqueToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

const authorizationToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? ""
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/)
  return match?.[1] ?? null
}

const reservationError = (
  request: Request,
  code: string,
  status: number,
  message: string,
  retryable = false
) =>
  apiErrorResponse(
    request,
    { code, message, retryable },
    { status, headers: { "Cache-Control": "no-store" } }
  )

const mediaErrorResponse = (request: Request, error: MediaAssetError) =>
  reservationError(
    request,
    error.code,
    error.status,
    error.message,
    false
  )

export type MediaAssetUploadReservationDependencies = {
  db: D1Database
  bucket: R2Bucket
  requirePrincipal: (request: Request) => Promise<StudioPrincipal | Response>
  reserveUpload: (
    budgetKey: string,
    input: {
      reservationId: string
      estimatedStorageBytes: number
      currentStorageBytes: number
      currentAssetCount: number
    }
  ) => Promise<RenderAdmissionLease>
  now?: () => Date
}

export function createMediaAssetUploadReservationHandlers(
  dependencies: MediaAssetUploadReservationDependencies
) {
  const now = () => dependencies.now?.() ?? new Date()
  const repository = new MediaAssetRepository(
    dependencies.db,
    dependencies.bucket
  )

  const releaseClaim = async (
    reservationId: string,
    claimExpiresAt: string
  ) => {
    await dependencies.db
      .prepare(
        `UPDATE media_asset_upload_reservations
         SET claim_expires_at = NULL
         WHERE id = ?1 AND consumed_at IS NULL AND claim_expires_at = ?2`
      )
      .bind(reservationId, claimExpiresAt)
      .run()
  }

  return {
    create: async (request: Request) => {
      const principal = await dependencies.requirePrincipal(request)
      if (principal instanceof Response) return principal

      let input: unknown
      try {
        input = await readStudioJsonBody(
          request,
          "/v1/studio/assets/upload-reservations"
        )
      } catch (error) {
        if (error instanceof JsonBodyError) {
          return principal.respond(jsonBodyErrorResponse(error, true))
        }
        throw error
      }

      const parsed = mediaAssetUploadReservationRequestSchema.safeParse(input)
      if (!parsed.success) {
        return principal.respond(
          apiErrorResponse(
            request,
            {
              code: "invalid_asset_upload_reservation",
              message: "The upload reservation request is invalid.",
              retryable: false,
              issues: apiIssuesFrom(parsed.error.issues),
            },
            { status: 400 }
          )
        )
      }

      const createdAt = now()
      const expiresAt = new Date(createdAt.getTime() + RESERVATION_TTL_MS)
      const reservationId = `upload-${crypto.randomUUID().replaceAll("-", "")}`
      const token = opaqueToken()
      const tokenHash = await sha256Hex(new TextEncoder().encode(token))

      await dependencies.db.batch([
        dependencies.db
          .prepare(
            `DELETE FROM media_asset_upload_reservations
             WHERE expires_at <= ?1`
          )
          .bind(createdAt.toISOString()),
        dependencies.db
          .prepare(
            `INSERT INTO media_asset_upload_reservations
             (id, token_hash, workspace_id, budget_key, name, media_type,
              expected_bytes, idempotency_key, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
          )
          .bind(
            reservationId,
            tokenHash,
            principal.workspaceId,
            principal.budgetKey,
            parsed.data.name,
            parsed.data.mediaType,
            parsed.data.bytes,
            parsed.data.idempotencyKey,
            createdAt.toISOString(),
            expiresAt.toISOString()
          ),
      ])

      const uploadUrl = new URL(
        `/v1/studio/assets/upload-reservations/${reservationId}`,
        request.url
      ).toString()
      return principal.respond(
        Response.json(
          mediaAssetUploadReservationResponseSchema.parse({
            reservation: {
              id: reservationId,
              uploadUrl,
              method: "PUT",
              headers: {
                authorization: `Bearer ${token}`,
                contentType: parsed.data.mediaType,
                contentLength: parsed.data.bytes,
              },
              expiresAt: expiresAt.toISOString(),
            },
          }),
          { status: 201, headers: { "Cache-Control": "private, no-store" } }
        )
      )
    },

    upload: async (request: Request, reservationId: string) => {
      if (!reservationIdPattern.test(reservationId)) {
        return reservationError(
          request,
          "asset_upload_reservation_not_found",
          404,
          "The upload reservation was not found."
        )
      }
      const token = authorizationToken(request)
      if (!token || !bearerTokenPattern.test(token)) {
        return reservationError(
          request,
          "asset_upload_reservation_invalid",
          401,
          "A valid upload reservation token is required."
        )
      }
      const tokenHash = await sha256Hex(new TextEncoder().encode(token))
      const reservation = await dependencies.db
        .prepare(
          `SELECT id, token_hash, workspace_id, budget_key, name, media_type,
                  expected_bytes, idempotency_key, created_at, expires_at,
                  claim_expires_at, consumed_at, asset_id
           FROM media_asset_upload_reservations
           WHERE id = ?1 AND token_hash = ?2`
        )
        .bind(reservationId, tokenHash)
        .first<ReservationRow>()
      if (!reservation) {
        return reservationError(
          request,
          "asset_upload_reservation_not_found",
          404,
          "The upload reservation was not found."
        )
      }

      const currentTime = now()
      if (reservation.consumed_at && reservation.asset_id) {
        const asset = await repository.lookup(
          reservation.workspace_id,
          reservation.asset_id
        )
        return Response.json(
          { asset },
          { status: 200, headers: { "Cache-Control": "no-store" } }
        )
      }
      if (reservation.expires_at <= currentTime.toISOString()) {
        return reservationError(
          request,
          "asset_upload_reservation_expired",
          410,
          "The upload reservation expired. Create a new reservation."
        )
      }

      const suppliedType = (request.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        ?.trim()
        .toLowerCase()
      if (suppliedType !== reservation.media_type) {
        return reservationError(
          request,
          "asset_upload_media_type_mismatch",
          415,
          `Content-Type must be ${reservation.media_type}.`
        )
      }
      const suppliedLength = Number(request.headers.get("content-length"))
      if (
        !Number.isSafeInteger(suppliedLength) ||
        suppliedLength < 1 ||
        suppliedLength > MAX_MEDIA_ASSET_BYTES ||
        suppliedLength !== reservation.expected_bytes
      ) {
        return reservationError(
          request,
          "asset_upload_length_mismatch",
          400,
          `Content-Length must equal the reserved ${reservation.expected_bytes} bytes.`
        )
      }

      const claimExpiresAt = new Date(
        currentTime.getTime() + CLAIM_TTL_MS
      ).toISOString()
      const claim = await dependencies.db
        .prepare(
          `UPDATE media_asset_upload_reservations
           SET claim_expires_at = ?3
           WHERE id = ?1 AND token_hash = ?2
             AND consumed_at IS NULL
             AND expires_at > ?4
             AND (claim_expires_at IS NULL OR claim_expires_at <= ?4)`
        )
        .bind(
          reservationId,
          tokenHash,
          claimExpiresAt,
          currentTime.toISOString()
        )
        .run()
      if (Number(claim.meta.changes) !== 1) {
        return reservationError(
          request,
          "asset_upload_reservation_busy",
          409,
          "This upload reservation is already being used.",
          true
        )
      }

      let lease: RenderAdmissionLease | null = null
      try {
        const storage = await repository.storageUsage(reservation.workspace_id)
        lease = await dependencies.reserveUpload(reservation.budget_key, {
          reservationId: `media-upload-${reservation.id}`,
          estimatedStorageBytes: reservation.expected_bytes,
          currentStorageBytes: storage.bytes,
          currentAssetCount: storage.count,
        })
        const blob = await request.blob()
        const validated = await validateMediaUpload(blob, reservation.name)
        if (validated.byteLength !== reservation.expected_bytes) {
          throw new MediaAssetError(
            "invalid_image",
            422,
            "The uploaded image bytes do not match the reservation."
          )
        }
        const result = await repository.upload(
          reservation.workspace_id,
          validated,
          reservation.idempotency_key
        )
        await completeRenderLeaseWithRetry(
          lease,
          result.created ? validated.byteLength : 0
        )
        lease = null
        await dependencies.db
          .prepare(
            `UPDATE media_asset_upload_reservations
             SET consumed_at = ?3, asset_id = ?4, claim_expires_at = NULL
             WHERE id = ?1 AND token_hash = ?2 AND consumed_at IS NULL`
          )
          .bind(reservationId, tokenHash, now().toISOString(), result.asset.id)
          .run()
        return Response.json(
          { asset: result.asset },
          {
            status: result.created ? 201 : 200,
            headers: { "Cache-Control": "no-store" },
          }
        )
      } catch (error) {
        if (lease) await failRenderLeaseWithRetry(lease)
        await releaseClaim(reservationId, claimExpiresAt)
        if (error instanceof MediaAssetError) {
          return mediaErrorResponse(request, error)
        }
        if (error instanceof RenderAdmissionError) {
          return renderAdmissionErrorResponse(error)
        }
        throw error
      }
    },
  }
}
