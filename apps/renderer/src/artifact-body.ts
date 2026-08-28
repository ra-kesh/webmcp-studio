export const MAX_RENDER_ARTIFACT_BYTES = 16 * 1024 * 1024

export class ArtifactSizeError extends Error {
  readonly code = "artifact_too_large"

  constructor(
    readonly receivedBytes: number,
    readonly maxBytes: number
  ) {
    super(`Rendered artifact exceeds the ${maxBytes}-byte limit`)
    this.name = "ArtifactSizeError"
  }
}

export function assertArtifactSize(
  receivedBytes: number,
  maxBytes = MAX_RENDER_ARTIFACT_BYTES
) {
  if (
    !Number.isSafeInteger(receivedBytes) ||
    receivedBytes < 0 ||
    receivedBytes > maxBytes
  ) {
    throw new ArtifactSizeError(receivedBytes, maxBytes)
  }
}
