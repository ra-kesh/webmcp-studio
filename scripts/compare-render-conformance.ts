#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
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
  captureReport: string
  comparisons: Comparison[]
}

type CaptureArtifact = {
  path: string
  bytes: number
  sha256: string
}

type CaptureReport = {
  version: 1 | 2
  runId?: string
  artifactRoot?: string
  baseUrl: string
  deviceScaleFactor: number
  browserCaptureRuntime?: {
    browserVersion: string
    userAgent: string
    platform: string
    hostOperatingSystem: string
    hostArchitecture: string
  } | null
  artifacts: CaptureArtifact[]
}

const manifestPath = process.argv[2]
if (!manifestPath) {
  throw new Error(
    "Usage: bun scripts/compare-render-conformance.ts <manifest.json> [--validate-only]"
  )
}

const manifestFile = Bun.file(resolve(manifestPath))
const manifest = validateManifest(await manifestFile.json())
const manifestDirectory = dirname(resolve(manifestPath))
const captureReportPath = resolveSafeRelative(
  manifestDirectory,
  manifest.captureReport,
  "capture report"
)
const captureReport = validateCaptureReport(
  await Bun.file(captureReportPath).json()
)
const captureArtifactRoot =
  captureReport.version === 2
    ? resolveSafeRelative(
        dirname(captureReportPath),
        captureReport.artifactRoot!,
        "capture artifact root"
      )
    : resolve(dirname(captureReportPath), "artifacts")
const reportedArtifacts = await verifyCaptureArtifacts(
  captureReport,
  captureArtifactRoot
)

if (process.argv.includes("--validate-only")) {
  console.log(
    `Validated ${reportedArtifacts.size} captured artifacts and ${manifest.comparisons.length} render comparisons from capture report v${captureReport.version}`
  )
  process.exit(0)
}

const results = []
let failed = false

for (const comparison of manifest.comparisons) {
  const baselinePath = resolveReportedCapture(
    comparison.baseline,
    captureArtifactRoot,
    reportedArtifacts
  )
  const candidatePath = resolveReportedCapture(
    comparison.candidate,
    captureArtifactRoot,
    reportedArtifacts
  )
  const diffPath = resolveSafeRelative(
    manifestDirectory,
    comparison.diff,
    `${comparison.name} diff`
  )
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
  if (
    candidate.version !== 1 ||
    typeof candidate.captureReport !== "string" ||
    candidate.captureReport === "" ||
    !Array.isArray(candidate.comparisons)
  ) {
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
  return {
    version: 1,
    captureReport: candidate.captureReport,
    comparisons,
  }
}

function validateCaptureReport(value: unknown): CaptureReport {
  if (!value || typeof value !== "object") {
    throw new Error("Render conformance capture report must be an object")
  }
  const candidate = value as Partial<CaptureReport>
  if (candidate.version !== 1 && candidate.version !== 2) {
    throw new Error("Render conformance capture report must use version 1 or 2")
  }
  if (
    typeof candidate.baseUrl !== "string" ||
    candidate.baseUrl === "" ||
    typeof candidate.deviceScaleFactor !== "number" ||
    !Number.isFinite(candidate.deviceScaleFactor) ||
    candidate.deviceScaleFactor <= 0 ||
    !Array.isArray(candidate.artifacts)
  ) {
    throw new Error("Render conformance capture report lacks runtime metadata")
  }
  if (candidate.version === 2) {
    if (
      typeof candidate.runId !== "string" ||
      candidate.runId === "" ||
      typeof candidate.artifactRoot !== "string" ||
      candidate.artifactRoot === ""
    ) {
      throw new Error("Capture report v2 requires runId and artifactRoot")
    }
    if (candidate.artifactRoot !== `artifacts/runs/${candidate.runId}`) {
      throw new Error(
        "Capture report v2 artifactRoot must match its immutable runId"
      )
    }
    const runtime = candidate.browserCaptureRuntime
    if (
      !runtime ||
      typeof runtime.browserVersion !== "string" ||
      typeof runtime.userAgent !== "string" ||
      typeof runtime.platform !== "string" ||
      typeof runtime.hostOperatingSystem !== "string" ||
      typeof runtime.hostArchitecture !== "string"
    ) {
      throw new Error("Capture report v2 requires browser runtime metadata")
    }
  }
  const artifacts = candidate.artifacts.map((artifact, index) => {
    if (!artifact || typeof artifact !== "object") {
      throw new Error(`Capture artifact ${index} must be an object`)
    }
    const item = artifact as Partial<CaptureArtifact>
    if (
      typeof item.path !== "string" ||
      item.path === "" ||
      typeof item.bytes !== "number" ||
      !Number.isInteger(item.bytes) ||
      item.bytes < 0 ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    ) {
      throw new Error(
        `Capture artifact ${index} has invalid integrity metadata`
      )
    }
    return item as CaptureArtifact
  })
  return { ...candidate, artifacts } as CaptureReport
}

async function verifyCaptureArtifacts(
  report: CaptureReport,
  artifactRoot: string
) {
  const artifacts = new Map<string, CaptureArtifact>()
  for (const artifact of report.artifacts) {
    if (artifacts.has(artifact.path)) {
      throw new Error(`Capture report repeats artifact ${artifact.path}`)
    }
    const path = resolveSafeRelative(
      artifactRoot,
      artifact.path,
      `capture artifact ${artifact.path}`
    )
    const bytes = await readFile(path)
    if (bytes.byteLength !== artifact.bytes) {
      throw new Error(
        `Capture artifact ${artifact.path} has ${bytes.byteLength} bytes; report requires ${artifact.bytes}`
      )
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    if (sha256 !== artifact.sha256) {
      throw new Error(
        `Capture artifact ${artifact.path} hash ${sha256} differs from report ${artifact.sha256}`
      )
    }
    artifacts.set(artifact.path, artifact)
  }
  return artifacts
}

function resolveReportedCapture(
  manifestPath: string,
  artifactRoot: string,
  reportedArtifacts: Map<string, CaptureArtifact>
) {
  const artifactPath = manifestPath.startsWith("artifacts/")
    ? manifestPath.slice("artifacts/".length)
    : manifestPath
  if (!reportedArtifacts.has(artifactPath)) {
    throw new Error(
      `Comparison input ${manifestPath} is not bound to the capture report`
    )
  }
  return resolveSafeRelative(
    artifactRoot,
    artifactPath,
    `comparison input ${manifestPath}`
  )
}

function resolveSafeRelative(root: string, path: string, label: string) {
  if (isAbsolute(path)) throw new Error(`${label} must be a relative path`)
  const target = resolve(root, path)
  const fromRoot = relative(root, target)
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`${label} escapes its allowed directory`)
  }
  return target
}
