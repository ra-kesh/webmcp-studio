export type ImageSourceDimensions = Readonly<{
  width: number
  height: number
}>

export type StagedLocalImageSource = Readonly<{
  src: string
  dimensions: ImageSourceDimensions
  release: () => void
}>

export class LocalImageSourceStageError extends Error {
  constructor(
    readonly code: "decode_failed" | "dimension_mismatch",
    message: string
  ) {
    super(message)
    this.name = "LocalImageSourceStageError"
  }
}

export function decodeBrowserImageSource(src: string) {
  return new Promise<ImageSourceDimensions>((resolve, reject) => {
    const image = new Image()
    const clearListeners = () => {
      image.onload = null
      image.onerror = null
    }
    image.onload = () => {
      const dimensions = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      }
      clearListeners()
      resolve(dimensions)
    }
    image.onerror = () => {
      clearListeners()
      reject(new Error("The staged image source could not be decoded"))
    }
    image.src = src
  })
}

export async function stageUsableLocalImageSource(
  blob: Blob,
  expectedDimensions: ImageSourceDimensions,
  dependencies: Readonly<{
    createObjectUrl?: (blob: Blob) => string
    revokeObjectUrl?: (src: string) => void
    decodeSource?: (src: string) => Promise<ImageSourceDimensions>
  }> = {}
): Promise<StagedLocalImageSource> {
  const createObjectUrl =
    dependencies.createObjectUrl ??
    ((value: Blob) => URL.createObjectURL(value))
  const revokeObjectUrl =
    dependencies.revokeObjectUrl ?? ((src: string) => URL.revokeObjectURL(src))
  const decodeSource = dependencies.decodeSource ?? decodeBrowserImageSource
  const src = createObjectUrl(blob)
  let released = false
  const release = () => {
    if (released) return
    released = true
    revokeObjectUrl(src)
  }

  try {
    const dimensions = await decodeSource(src)
    if (
      dimensions.width !== expectedDimensions.width ||
      dimensions.height !== expectedDimensions.height
    ) {
      throw new LocalImageSourceStageError(
        "dimension_mismatch",
        `The staged image decoded as ${dimensions.width} × ${dimensions.height}, expected ${expectedDimensions.width} × ${expectedDimensions.height}.`
      )
    }
    return Object.freeze({ src, dimensions: { ...dimensions }, release })
  } catch (error) {
    release()
    if (error instanceof LocalImageSourceStageError) throw error
    throw new LocalImageSourceStageError(
      "decode_failed",
      error instanceof Error
        ? error.message
        : "The staged image source could not be decoded."
    )
  }
}
