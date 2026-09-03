import { env } from "cloudflare:workers"
import { createMediaAssetUploadReservationHandlers } from "./media-asset-upload-reservations"
import { reserveRenderCapacityForBudget } from "./render-admission-service"
import { requireStudioPrincipal } from "./studio-principal"

export const mediaAssetUploadReservationHandlers =
  createMediaAssetUploadReservationHandlers({
    db: env.DB,
    bucket: env.ASSETS,
    requirePrincipal: (request) => requireStudioPrincipal(env, request),
    reserveUpload: (budgetKey, input) =>
      reserveRenderCapacityForBudget(
        env,
        budgetKey,
        {
          pageCount: 0,
          pixelArea: 0,
          estimatedStorageBytes: input.estimatedStorageBytes,
          currentStorageBytes: input.currentStorageBytes,
          currentAssetCount: input.currentAssetCount,
        },
        input.reservationId,
        "upload"
      ),
  })
