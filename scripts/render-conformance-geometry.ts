export type RgbaImage = Readonly<{
  data: Uint8Array
  width: number
  height: number
}>

export type RgbColor = readonly [number, number, number]

export type InkRegion = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export type InkBand = Readonly<{
  top: number
  bottom: number
  left: number
  right: number
  inkPixels: number
  upperContrastFraction: number
  lowerDirectionCosine: number
}>

export type InkGeometryOptions = Readonly<{
  background: RgbColor
  foreground: RgbColor
  minimumContrastFraction: number
  minimumInkPixelsPerRow: number
}>

export type InkGeometryComparison = Readonly<{
  passed: boolean
  maximumEdgeDelta: number | null
  maximumInkPixelRatioDelta: number | null
  maximumContrastFractionDelta: number | null
  maximumDirectionCosineDelta: number | null
  minimumCandidateDirectionCosine: number | null
  baselineBands: readonly InkBand[]
  candidateBands: readonly InkBand[]
  bands: readonly Readonly<{
    index: number
    baseline: InkBand
    candidate: InkBand
    edgeDeltas: Readonly<{
      top: number
      bottom: number
      left: number
      right: number
    }>
    maximumEdgeDelta: number
    inkPixelRatioDelta: number
    contrastFractionDelta: number
    directionCosineDelta: number
  }>[]
  reason: string | null
}>

export type InkGeometryComparisonLimits = Readonly<{
  maximumEdgeDelta: number
  maximumInkPixelRatioDelta: number
  maximumContrastFractionDelta: number
  minimumDirectionCosine: number
  maximumDirectionCosineDelta?: number
}>

export function extractHorizontalInkBands(
  image: RgbaImage,
  region: InkRegion,
  options: InkGeometryOptions
): readonly InkBand[] {
  if (image.data.length !== image.width * image.height * 4) {
    throw new Error("Ink geometry requires an exact RGBA pixel buffer")
  }
  if (
    !Number.isFinite(options.minimumContrastFraction) ||
    options.minimumContrastFraction <= 0 ||
    options.minimumContrastFraction > 1
  ) {
    throw new Error(
      "Ink contrast fraction must be greater than 0 and at most 1"
    )
  }
  if (
    !Number.isInteger(options.minimumInkPixelsPerRow) ||
    options.minimumInkPixelsPerRow <= 0
  ) {
    throw new Error("Minimum ink pixels per row must be a positive integer")
  }

  const left = clamp(Math.floor(region.left), 0, image.width)
  const top = clamp(Math.floor(region.top), 0, image.height)
  const right = clamp(Math.ceil(region.right), left, image.width)
  const bottom = clamp(Math.ceil(region.bottom), top, image.height)
  const referenceContrast = colorDistance(
    options.background,
    options.foreground
  )
  if (referenceContrast === 0) {
    throw new Error("Ink foreground must differ from its background")
  }

  const rows: Array<{
    y: number
    left: number
    right: number
    inkPixels: number
    contrastFractions: number[]
    directionCosines: number[]
  }> = []
  for (let y = top; y < bottom; y += 1) {
    let rowLeft = right
    let rowRight = left - 1
    let inkPixels = 0
    const contrastFractions: number[] = []
    const directionCosines: number[] = []
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4
      const alpha = (image.data[offset + 3] ?? 0) / 255
      const pixel: RgbColor = [
        compositeChannel(image.data[offset] ?? 0, options.background[0], alpha),
        compositeChannel(
          image.data[offset + 1] ?? 0,
          options.background[1],
          alpha
        ),
        compositeChannel(
          image.data[offset + 2] ?? 0,
          options.background[2],
          alpha
        ),
      ]
      const contrastFraction =
        colorDistance(options.background, pixel) / referenceContrast
      if (contrastFraction < options.minimumContrastFraction) {
        continue
      }
      inkPixels += 1
      rowLeft = Math.min(rowLeft, x)
      rowRight = Math.max(rowRight, x)
      contrastFractions.push(contrastFraction)
      directionCosines.push(
        colorDirectionCosine(options.background, options.foreground, pixel)
      )
    }
    if (inkPixels >= options.minimumInkPixelsPerRow) {
      rows.push({
        y,
        left: rowLeft,
        right: rowRight,
        inkPixels,
        contrastFractions,
        directionCosines,
      })
    }
  }

  const bands: Array<{
    top: number
    bottom: number
    left: number
    right: number
    inkPixels: number
    contrastFractions: number[]
    directionCosines: number[]
  }> = []
  for (const row of rows) {
    const previous = bands.at(-1)
    if (!previous || row.y > previous.bottom + 1) {
      bands.push({
        top: row.y,
        bottom: row.y,
        left: row.left,
        right: row.right,
        inkPixels: row.inkPixels,
        contrastFractions: row.contrastFractions,
        directionCosines: row.directionCosines,
      })
      continue
    }
    bands[bands.length - 1] = {
      top: previous.top,
      bottom: row.y,
      left: Math.min(previous.left, row.left),
      right: Math.max(previous.right, row.right),
      inkPixels: previous.inkPixels + row.inkPixels,
      contrastFractions: previous.contrastFractions.concat(
        row.contrastFractions
      ),
      directionCosines: previous.directionCosines.concat(row.directionCosines),
    }
  }
  return bands.map((band) => ({
    top: band.top,
    bottom: band.bottom,
    left: band.left,
    right: band.right,
    inkPixels: band.inkPixels,
    upperContrastFraction: percentile(band.contrastFractions, 0.75),
    lowerDirectionCosine: percentile(band.directionCosines, 0.1),
  }))
}

export function compareHorizontalInkBands(
  baselineBands: readonly InkBand[],
  candidateBands: readonly InkBand[],
  limits: InkGeometryComparisonLimits
): InkGeometryComparison {
  if (
    !Number.isInteger(limits.maximumEdgeDelta) ||
    limits.maximumEdgeDelta < 0 ||
    !isUnitInterval(limits.maximumInkPixelRatioDelta) ||
    !isUnitInterval(limits.maximumContrastFractionDelta) ||
    !isUnitInterval(limits.minimumDirectionCosine) ||
    (limits.maximumDirectionCosineDelta !== undefined &&
      !isUnitInterval(limits.maximumDirectionCosineDelta))
  ) {
    throw new Error("Ink geometry comparison limits are invalid")
  }
  if (baselineBands.length === 0 || candidateBands.length === 0) {
    return {
      passed: false,
      maximumEdgeDelta: null,
      maximumInkPixelRatioDelta: null,
      maximumContrastFractionDelta: null,
      maximumDirectionCosineDelta: null,
      minimumCandidateDirectionCosine: null,
      baselineBands,
      candidateBands,
      bands: [],
      reason: "Text ink was not detected in both captures.",
    }
  }
  if (baselineBands.length !== candidateBands.length) {
    return {
      passed: false,
      maximumEdgeDelta: null,
      maximumInkPixelRatioDelta: null,
      maximumContrastFractionDelta: null,
      maximumDirectionCosineDelta: null,
      minimumCandidateDirectionCosine: null,
      baselineBands,
      candidateBands,
      bands: [],
      reason: `Text line-band count changed from ${baselineBands.length} to ${candidateBands.length}.`,
    }
  }

  const bands = baselineBands.map((baseline, index) => {
    const candidate = candidateBands[index]!
    const edgeDeltas = {
      top: Math.abs(baseline.top - candidate.top),
      bottom: Math.abs(baseline.bottom - candidate.bottom),
      left: Math.abs(baseline.left - candidate.left),
      right: Math.abs(baseline.right - candidate.right),
    }
    return {
      index,
      baseline,
      candidate,
      edgeDeltas,
      maximumEdgeDelta: Math.max(...Object.values(edgeDeltas)),
      inkPixelRatioDelta:
        Math.abs(baseline.inkPixels - candidate.inkPixels) / baseline.inkPixels,
      contrastFractionDelta: Math.abs(
        baseline.upperContrastFraction - candidate.upperContrastFraction
      ),
      directionCosineDelta: Math.abs(
        baseline.lowerDirectionCosine - candidate.lowerDirectionCosine
      ),
    }
  })
  const maximumEdgeDelta = Math.max(
    ...bands.map((band) => band.maximumEdgeDelta)
  )
  const maximumInkPixelRatioDelta = Math.max(
    ...bands.map((band) => band.inkPixelRatioDelta)
  )
  const maximumContrastFractionDelta = Math.max(
    ...bands.map((band) => band.contrastFractionDelta)
  )
  const minimumCandidateDirectionCosine = Math.min(
    ...bands.map((band) => band.candidate.lowerDirectionCosine)
  )
  const maximumDirectionCosineDelta = Math.max(
    ...bands.map((band) => band.directionCosineDelta)
  )
  const edgePassed = maximumEdgeDelta <= limits.maximumEdgeDelta
  const coveragePassed =
    maximumInkPixelRatioDelta <= limits.maximumInkPixelRatioDelta
  const contrastPassed =
    maximumContrastFractionDelta <= limits.maximumContrastFractionDelta
  const directionPassed =
    minimumCandidateDirectionCosine >= limits.minimumDirectionCosine &&
    (limits.maximumDirectionCosineDelta === undefined ||
      maximumDirectionCosineDelta <= limits.maximumDirectionCosineDelta)
  const passed =
    edgePassed && coveragePassed && contrastPassed && directionPassed
  return {
    passed,
    maximumEdgeDelta,
    maximumInkPixelRatioDelta,
    maximumContrastFractionDelta,
    maximumDirectionCosineDelta,
    minimumCandidateDirectionCosine,
    baselineBands,
    candidateBands,
    bands,
    reason: !edgePassed
      ? `Text ink moved by ${maximumEdgeDelta}px; the limit is ${limits.maximumEdgeDelta}px.`
      : !coveragePassed
        ? `Text ink coverage changed by ${(maximumInkPixelRatioDelta * 100).toFixed(2)}%; the limit is ${(limits.maximumInkPixelRatioDelta * 100).toFixed(2)}%.`
        : !contrastPassed
          ? `Text ink contrast changed by ${maximumContrastFractionDelta.toFixed(4)}; the limit is ${limits.maximumContrastFractionDelta.toFixed(4)}.`
          : !directionPassed
            ? limits.maximumDirectionCosineDelta !== undefined &&
              maximumDirectionCosineDelta > limits.maximumDirectionCosineDelta
              ? `Text ink foreground direction cosine changed by ${maximumDirectionCosineDelta.toFixed(4)}; the limit is ${limits.maximumDirectionCosineDelta.toFixed(4)}.`
              : `Text ink foreground direction cosine fell to ${minimumCandidateDirectionCosine.toFixed(4)}; the minimum is ${limits.minimumDirectionCosine.toFixed(4)}.`
            : null,
  }
}

function compositeChannel(channel: number, background: number, alpha: number) {
  return channel * alpha + background * (1 - alpha)
}

function colorDistance(left: RgbColor, right: RgbColor) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

function colorDirectionCosine(
  background: RgbColor,
  foreground: RgbColor,
  pixel: RgbColor
) {
  const expected = foreground.map(
    (channel, index) => channel - background[index]!
  )
  const actual = pixel.map((channel, index) => channel - background[index]!)
  const denominator = vectorLength(expected) * vectorLength(actual)
  if (denominator === 0) return -1
  return dotProduct(expected, actual) / denominator
}

function vectorLength(vector: readonly number[]) {
  return Math.hypot(...vector)
}

function dotProduct(left: readonly number[], right: readonly number[]) {
  return left.reduce((total, value, index) => total + value * right[index]!, 0)
}

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) throw new Error("Cannot measure empty ink samples")
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) * fraction)]!
}

function isUnitInterval(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}
