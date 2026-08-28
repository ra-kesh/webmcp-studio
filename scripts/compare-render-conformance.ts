#!/usr/bin/env bun

import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import sharp from "sharp"

type Comparison = {
  name: string
  baseline: string
  candidate: string
  diff: string
  pixelDeltaThreshold: number
  maxDifferentPixelRatio: number
  maxRootMeanSquareError: number
}

type Manifest = {
  version: 1
  comparisons: Comparison[]
}

const manifestPath = process.argv[2]
if (!manifestPath) {
  throw new Error(
    "Usage: bun scripts/compare-render-conformance.ts <manifest.json> [--validate-only]"
  )
}

const manifestFile = Bun.file(resolve(manifestPath))
const manifest = validateManifest(await manifestFile.json())
if (process.argv.includes("--validate-only")) {
  console.log(`Validated ${manifest.comparisons.length} render comparisons`)
  process.exit(0)
}

const manifestDirectory = dirname(resolve(manifestPath))
const results = []
let failed = false

for (const comparison of manifest.comparisons) {
  const baselinePath = resolve(manifestDirectory, comparison.baseline)
  const candidatePath = resolve(manifestDirectory, comparison.candidate)
  const diffPath = resolve(manifestDirectory, comparison.diff)
  const [baseline, candidate] = await Promise.all([
    decodeRgba(baselinePath),
    decodeRgba(candidatePath),
  ])

  if (
    baseline.width !== candidate.width ||
    baseline.height !== candidate.height
  ) {
    throw new Error(
      `${comparison.name} size mismatch: ${baseline.width}x${baseline.height} versus ${candidate.width}x${candidate.height}`
    )
  }

  const pixels = baseline.width * baseline.height
  const diff = Buffer.alloc(baseline.data.length)
  let differentPixels = 0
  let squaredError = 0

  for (let offset = 0; offset < baseline.data.length; offset += 4) {
    let pixelDifferent = false
    let pixelError = 0
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(
        (baseline.data[offset + channel] ?? 0) -
          (candidate.data[offset + channel] ?? 0)
      )
      if (delta > comparison.pixelDeltaThreshold) pixelDifferent = true
      pixelError += delta * delta
    }
    squaredError += pixelError
    if (pixelDifferent) {
      differentPixels += 1
      diff[offset] = 239
      diff[offset + 1] = 68
      diff[offset + 2] = 68
      diff[offset + 3] = 255
    } else {
      const luminance = Math.round(
        ((baseline.data[offset] ?? 0) * 0.2126 +
          (baseline.data[offset + 1] ?? 0) * 0.7152 +
          (baseline.data[offset + 2] ?? 0) * 0.0722) *
          0.28 +
          184
      )
      diff[offset] = luminance
      diff[offset + 1] = luminance
      diff[offset + 2] = luminance
      diff[offset + 3] = 255
    }
  }

  const differentPixelRatio = differentPixels / pixels
  const rootMeanSquareError = Math.sqrt(squaredError / (pixels * 4))
  const passed =
    differentPixelRatio <= comparison.maxDifferentPixelRatio &&
    rootMeanSquareError <= comparison.maxRootMeanSquareError
  failed ||= !passed

  await mkdir(dirname(diffPath), { recursive: true })
  await sharp(diff, {
    raw: { width: baseline.width, height: baseline.height, channels: 4 },
  })
    .png()
    .toFile(diffPath)

  results.push({
    name: comparison.name,
    baseline: baselinePath,
    candidate: candidatePath,
    diff: diffPath,
    width: baseline.width,
    height: baseline.height,
    differentPixels,
    differentPixelRatio,
    rootMeanSquareError,
    limits: {
      pixelDeltaThreshold: comparison.pixelDeltaThreshold,
      maxDifferentPixelRatio: comparison.maxDifferentPixelRatio,
      maxRootMeanSquareError: comparison.maxRootMeanSquareError,
    },
    passed,
  })
}

const reportPath = resolve(manifestDirectory, "render-conformance-report.json")
await Bun.write(reportPath, `${JSON.stringify({ results }, null, 2)}\n`)
console.log(JSON.stringify({ reportPath, results }, null, 2))
if (failed) process.exit(1)

async function decodeRgba(path: string) {
  const image = sharp(path).ensureAlpha()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  if (info.channels !== 4) {
    throw new Error(
      `${path} decoded with ${info.channels} channels instead of RGBA`
    )
  }
  return { data, width: info.width, height: info.height }
}

function validateManifest(value: unknown): Manifest {
  if (!value || typeof value !== "object") {
    throw new Error("Render conformance manifest must be an object")
  }
  const candidate = value as Partial<Manifest>
  if (candidate.version !== 1 || !Array.isArray(candidate.comparisons)) {
    throw new Error("Render conformance manifest must use version 1")
  }
  const comparisons = candidate.comparisons.map((comparison, index) => {
    if (!comparison || typeof comparison !== "object") {
      throw new Error(`Comparison ${index} must be an object`)
    }
    const item = comparison as Partial<Comparison>
    for (const key of ["name", "baseline", "candidate", "diff"] as const) {
      if (typeof item[key] !== "string" || item[key] === "") {
        throw new Error(`Comparison ${index} requires ${key}`)
      }
    }
    for (const key of [
      "pixelDeltaThreshold",
      "maxDifferentPixelRatio",
      "maxRootMeanSquareError",
    ] as const) {
      if (typeof item[key] !== "number" || !Number.isFinite(item[key])) {
        throw new Error(`Comparison ${index} requires finite ${key}`)
      }
    }
    if (
      item.pixelDeltaThreshold! < 0 ||
      item.pixelDeltaThreshold! > 255 ||
      item.maxDifferentPixelRatio! < 0 ||
      item.maxDifferentPixelRatio! > 1 ||
      item.maxRootMeanSquareError! < 0
    ) {
      throw new Error(`Comparison ${index} has an invalid threshold`)
    }
    return item as Comparison
  })
  return { version: 1, comparisons }
}
