import { createFileRoute } from "@tanstack/react-router"
import { mediaAssetUploadReservationHandlers } from "../../../../../server/media-asset-upload-reservation-route"

export const Route = createFileRoute(
  "/v1/studio/assets/upload-reservations/$reservationId"
)({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        mediaAssetUploadReservationHandlers.upload(
          request,
          params.reservationId
        ),
    },
  },
})
