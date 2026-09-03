import type { StudioDesignIntent } from "@webmcp/document"
import type { GeneratedCandidatePixelAnalysis } from "@webmcp/webmcp"

const round = (value: number, places = 4) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const rgbHex = (red: number, green: number, blue: number) =>
  `#${[red, green, blue]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`.toUpperCase()

const compositeChannel = (channel: number, alpha: number) =>
  channel * alpha + 255 * (1 - alpha)

type ReleaseZone = NonNullable<
  StudioDesignIntent["pages"][number]
>["releaseZones"][number]

export async function analyzeGenerationRasterPixels(
  blob: Blob,
  expected: Readonly<{
    width: number
    height: number
    backgroundColor?: string
  }>,
  releaseZones: readonly ReleaseZone[] = [],
  signal?: AbortSignal
): Promise<GeneratedCandidatePixelAnalysis> {
  signal?.throwIfAborted()
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
      throw new Error("The decoded inspection raster dimensions changed.")
    }
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) throw new Error("Pixel inspection canvas is unavailable.")
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
    signal?.throwIfAborted()

    const cornerSize = Math.max(
      2,
      Math.floor(Math.min(bitmap.width, bitmap.height) * 0.035)
    )
    let cornerRed = 0
    let cornerGreen = 0
    let cornerBlue = 0
    let cornerCount = 0
    const isCorner = (x: number, y: number) =>
      (x < cornerSize || x >= bitmap.width - cornerSize) &&
      (y < cornerSize || y >= bitmap.height - cornerSize)
    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        if (!isCorner(x, y)) continue
        const offset = (y * bitmap.width + x) * 4
        const alpha = pixels[offset + 3]! / 255
        cornerRed += compositeChannel(pixels[offset]!, alpha)
        cornerGreen += compositeChannel(pixels[offset + 1]!, alpha)
        cornerBlue += compositeChannel(pixels[offset + 2]!, alpha)
        cornerCount += 1
      }
    }
    const declaredBackground = (() => {
      if (!expected.backgroundColor) return null
      const sampleCanvas = document.createElement("canvas")
      sampleCanvas.width = 1
      sampleCanvas.height = 1
      const sampleContext = sampleCanvas.getContext("2d")
      if (!sampleContext) return null
      sampleContext.fillStyle = expected.backgroundColor
      sampleContext.fillRect(0, 0, 1, 1)
      const sample = sampleContext.getImageData(0, 0, 1, 1).data
      return { red: sample[0]!, green: sample[1]!, blue: sample[2]! }
    })()
    const background = declaredBackground ?? {
      red: cornerRed / cornerCount,
      green: cornerGreen / cornerCount,
      blue: cornerBlue / cornerCount,
    }
    const totalPixels = bitmap.width * bitmap.height
    const edgeSize = Math.max(
      1,
      Math.floor(Math.min(bitmap.width, bitmap.height) * 0.025)
    )
    const edges = {
      top: { ink: 0, total: 0 },
      right: { ink: 0, total: 0 },
      bottom: { ink: 0, total: 0 },
      left: { ink: 0, total: 0 },
    }
    const zones = releaseZones.map((zone) => ({ zone, ink: 0, total: 0 }))
    const colorCounts = new Map<string, number>()
    let foregroundPixels = 0
    let highKeyPixels = 0
    let darkPixels = 0
    let luminanceTotal = 0
    let luminanceSquaredTotal = 0
    let foregroundX = 0
    let foregroundY = 0

    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        const offset = (y * bitmap.width + x) * 4
        const alpha = pixels[offset + 3]! / 255
        const red = compositeChannel(pixels[offset]!, alpha)
        const green = compositeChannel(pixels[offset + 1]!, alpha)
        const blue = compositeChannel(pixels[offset + 2]!, alpha)
        const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
        const colorDistance = Math.sqrt(
          (red - background.red) ** 2 +
            (green - background.green) ** 2 +
            (blue - background.blue) ** 2
        )
        const ink = colorDistance >= 30
        luminanceTotal += luminance
        luminanceSquaredTotal += luminance * luminance
        if (luminance >= 0.86) highKeyPixels += 1
        if (luminance <= 0.28) darkPixels += 1
        if (ink) {
          foregroundPixels += 1
          foregroundX += (x + 0.5) / bitmap.width
          foregroundY += (y + 0.5) / bitmap.height
          const quantized = rgbHex(
            Math.round(red / 32) * 32,
            Math.round(green / 32) * 32,
            Math.round(blue / 32) * 32
          )
          colorCounts.set(quantized, (colorCounts.get(quantized) ?? 0) + 1)
        }
        const updateEdge = (edge: keyof typeof edges) => {
          edges[edge].total += 1
          if (ink) edges[edge].ink += 1
        }
        if (y < edgeSize) updateEdge("top")
        if (x >= bitmap.width - edgeSize) updateEdge("right")
        if (y >= bitmap.height - edgeSize) updateEdge("bottom")
        if (x < edgeSize) updateEdge("left")
        const normalizedX = (x + 0.5) / bitmap.width
        const normalizedY = (y + 0.5) / bitmap.height
        for (const item of zones) {
          const { bounds } = item.zone
          if (
            normalizedX >= bounds.x &&
            normalizedX <= bounds.x + bounds.width &&
            normalizedY >= bounds.y &&
            normalizedY <= bounds.y + bounds.height
          ) {
            item.total += 1
            if (ink) item.ink += 1
          }
        }
      }
    }
    const meanLuminance = luminanceTotal / totalPixels
    const luminanceVariance = Math.max(
      0,
      luminanceSquaredTotal / totalPixels - meanLuminance ** 2
    )
    return {
      source: "canonical-thumbnail-pixels",
      width: bitmap.width,
      height: bitmap.height,
      backgroundEstimate: rgbHex(
        background.red,
        background.green,
        background.blue
      ),
      foregroundPixelRatio: round(foregroundPixels / totalPixels),
      highKeyPixelRatio: round(highKeyPixels / totalPixels),
      darkPixelRatio: round(darkPixels / totalPixels),
      meanLuminance: round(meanLuminance),
      luminanceDeviation: round(Math.sqrt(luminanceVariance)),
      foregroundCentroid:
        foregroundPixels > 0
          ? {
              x: round(foregroundX / foregroundPixels),
              y: round(foregroundY / foregroundPixels),
            }
          : null,
      edgeInkRatios: {
        top: round(edges.top.ink / edges.top.total),
        right: round(edges.right.ink / edges.right.total),
        bottom: round(edges.bottom.ink / edges.bottom.total),
        left: round(edges.left.ink / edges.left.total),
      },
      dominantInkColors: [...colorCounts]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([color, count]) => ({
          color,
          ratio: round(count / Math.max(1, foregroundPixels)),
        })),
      releaseZones: zones.map(({ zone, ink, total }) => {
        const inkRatio = total > 0 ? ink / total : 0
        return {
          id: zone.id,
          name: zone.name,
          inkRatio: round(inkRatio),
          maxInkRatio: zone.maxInkRatio,
          passes: inkRatio <= zone.maxInkRatio,
        }
      }),
    }
  } finally {
    bitmap.close()
  }
}
