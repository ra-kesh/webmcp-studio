import type { ManagedMediaAsset } from "./managed-media-repository"
import {
  managedMediaContentUrl,
  managedMediaSource,
} from "./managed-media-repository"
import { validateMediaDimensions } from "./media-file-policy"

type ManagedImageMetadata = Pick<
  ManagedMediaAsset,
  "id" | "mediaType" | "bytes" | "width" | "height"
>

export type VerifiedManagedBrowserImageResource = {
  assetId: string
  src: string
  width: number
  height: number
  contentHash: string
}

export class ManagedImageResourceError extends Error {
  constructor(
    readonly code:
      | "managed_image_content_unavailable"
      | "managed_image_content_hash_missing"
      | "managed_image_media_type_mismatch"
      | "managed_image_byte_length_mismatch"
      | "managed_image_dimension_mismatch",
    message: string
  ) {
    super(message)
    this.name = "ManagedImageResourceError"
  }
}

const contentHashFromResponse = (response: Response) => {
  const match = response.headers.get("etag")?.match(/^"sha256-([a-f0-9]{64})"$/)
  if (!match) {
    throw new ManagedImageResourceError(
      "managed_image_content_hash_missing",
      "The workspace image response did not include its verified content identity."
    )
  }
  return match[1]
}

export async function verifyManagedBrowserImageResource(
  metadata: ManagedImageMetadata,
  decodeDimensions: (blob: Blob) => Promise<{
    width: number
    height: number
  }>,
  fetchContent: typeof fetch = fetch
): Promise<VerifiedManagedBrowserImageResource> {
  const response = await fetchContent(managedMediaContentUrl(metadata.id))
  if (!response.ok) {
    throw new ManagedImageResourceError(
      "managed_image_content_unavailable",
      `Image content returned ${response.status}.`
    )
  }
  const contentHash = contentHashFromResponse(response)
  const blob = await response.blob()
  if (blob.type !== metadata.mediaType) {
    throw new ManagedImageResourceError(
      "managed_image_media_type_mismatch",
      "The workspace image type no longer matches its managed metadata."
    )
  }
  if (blob.size !== metadata.bytes) {
    throw new ManagedImageResourceError(
      "managed_image_byte_length_mismatch",
      "The workspace image size no longer matches its managed metadata."
    )
  }
  const dimensions = await decodeDimensions(blob)
  const dimensionError = validateMediaDimensions(dimensions)
  if (dimensionError) throw new Error(dimensionError)
  if (
    dimensions.width !== metadata.width ||
    dimensions.height !== metadata.height
  ) {
    throw new ManagedImageResourceError(
      "managed_image_dimension_mismatch",
      `The workspace image decoded as ${dimensions.width} × ${dimensions.height}, but its managed metadata is ${metadata.width} × ${metadata.height}. The design was not changed.`
    )
  }
  return {
    assetId: metadata.id,
    src: managedMediaSource(metadata.id),
    width: dimensions.width,
    height: dimensions.height,
    contentHash,
  }
}
