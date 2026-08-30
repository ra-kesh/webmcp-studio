#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import {
  buildComponentPublicationJourney,
  componentRenderConformanceDocument,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
} from "@webmcp/document"
import sharp from "sharp"
import {
  compareHorizontalInkBands,
  extractHorizontalInkBands,
  type RgbColor,
} from "./render-conformance-geometry"

type GeometryGate = {
  pageId: string
  textNodeIds: string[]
  minimumContrastFraction: number
  minimumInkPixelsPerRow: number
  maximumEdgeDelta: number
  maximumInkPixelRatioDelta: number
  maximumContrastFractionDelta: number
  minimumDirectionCosine: number
  maximumDirectionCosineDelta?: number
  acceptWhenRawFails: boolean
  acceptWhenRawRatioPasses?: boolean
}

type Comparison = {
  name: string
  baseline: string
  candidate: string
  diff: string
  pixelDeltaThreshold: number
  maxDifferentPixelRatio: number
  maxRootMeanSquareError: number
  geometry?: GeometryGate
}

type Manifest = {
  version: 1 | 2
  captureReport: string
  report?: string
  comparisons: Comparison[]
}

type CaptureArtifact = {
  path: string
  bytes: number
  sha256: string
}

type CaptureReport = {
  version: 1 | 2
  corpus?: "golden" | "resources" | "components" | "component-journey"
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
const comparisonDocument =
  captureReport.corpus === "resources"
    ? textDesignSystemConformanceDocument
    : captureReport.corpus === "components"
      ? componentRenderConformanceDocument
      : captureReport.corpus === "component-journey"
        ? buildComponentPublicationJourney().published.document
        : renderConformanceDocument
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
  const rawPassed =
    differentPixelRatio <= comparison.maxDifferentPixelRatio &&
    rootMeanSquareError <= comparison.maxRootMeanSquareError
  const geometry = comparison.geometry
    ? compareTextInkGeometry(
        baseline,
        candidate,
        comparison.geometry,
        comparison.name
      )
    : null
  const geometryAccepted = Boolean(
    geometry?.passed === true &&
    (comparison.geometry?.acceptWhenRawFails ||
      (comparison.geometry?.acceptWhenRawRatioPasses &&
        differentPixelRatio <= comparison.maxDifferentPixelRatio))
  )
  const passed = rawPassed || geometryAccepted
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
    rawPassed,
    geometry,
    acceptance: rawPassed
      ? "raw"
      : geometryAccepted && comparison.geometry?.acceptWhenRawRatioPasses
        ? "geometry_with_raw_ratio"
        : passed
          ? "geometry"
          : "failed",
    passed,
  })
}

const reportPath = manifest.report
  ? resolveSafeRelative(manifestDirectory, manifest.report, "comparison report")
  : resolve(manifestDirectory, "render-conformance-report.json")
await Bun.write(reportPath, `${JSON.stringify({ results }, null, 2)}\n`)
console.log(JSON.stringify({ reportPath, results }, null, 2))
if (failed) process.exit(1)

function compareTextInkGeometry(
  baseline: Awaited<ReturnType<typeof decodeRgba>>,
  candidate: Awaited<ReturnType<typeof decodeRgba>>,
  gate: GeometryGate,
  comparisonName: string
) {
  const page = comparisonDocument.pages.find(
    (candidatePage) => candidatePage.id === gate.pageId
  )
  if (!page) {
    throw new Error(`${comparisonName} geometry page ${gate.pageId} is missing`)
  }
  if (baseline.width !== page.width || baseline.height !== page.height) {
    throw new Error(
      `${comparisonName} geometry page is ${baseline.width}x${baseline.height}; canonical ${page.id} is ${page.width}x${page.height}`
    )
  }
  if (
    gate.acceptWhenRawFails &&
    (gate.textNodeIds.length !== 1 ||
      page.nodeIds.length !== gate.textNodeIds.length ||
      page.nodeIds.some((nodeId, index) => nodeId !== gate.textNodeIds[index]))
  ) {
    throw new Error(
      `${comparisonName} cannot substitute geometry for raw pixels unless one text node is the complete canonical page content`
    )
  }

  const background = parseHexColor(page.background, `${page.id} background`)
  const nodes = gate.textNodeIds.map((nodeId) => {
    const node = comparisonDocument.nodes.find(
      (candidateNode) => candidateNode.id === nodeId
    )
    if (!node || node.type !== "text" || !node.visible) {
      throw new Error(
        `${comparisonName} geometry node ${nodeId} must be a visible canonical text node`
      )
    }
    if (node.rotation !== 0) {
      throw new Error(
        `${comparisonName} geometry node ${nodeId} must be unrotated for horizontal line-band comparison`
      )
    }
    if (!page.nodeIds.includes(node.id)) {
      throw new Error(
        `${comparisonName} geometry node ${nodeId} does not belong to ${page.id}`
      )
    }
    const textColor = parseHexColor(node.color, `${node.id} text color`)
    const foreground = blendColor(background, textColor, node.opacity)
    const region = gate.acceptWhenRawFails
      ? { left: 0, top: 0, right: page.width, bottom: page.height }
      : {
          left: node.x,
          top: node.y,
          right: node.x + node.width,
          bottom: node.y + node.height,
        }
    const options = {
      background,
      foreground,
      minimumContrastFraction: gate.minimumContrastFraction,
      minimumInkPixelsPerRow: gate.minimumInkPixelsPerRow,
    }
    const baselineBands = extractHorizontalInkBands(baseline, region, options)
    const candidateBands = extractHorizontalInkBands(candidate, region, options)
    return {
      nodeId,
      region,
      ...compareHorizontalInkBands(baselineBands, candidateBands, {
        maximumEdgeDelta: gate.maximumEdgeDelta,
        maximumInkMassRatioDelta: gate.maximumInkPixelRatioDelta,
        maximumContrastFractionDelta: gate.maximumContrastFractionDelta,
        minimumDirectionCosine: gate.minimumDirectionCosine,
        maximumDirectionCosineDelta: gate.maximumDirectionCosineDelta,
      }),
    }
  })
  return {
    pageId: page.id,
    minimumContrastFraction: gate.minimumContrastFraction,
    minimumInkPixelsPerRow: gate.minimumInkPixelsPerRow,
    maximumAllowedEdgeDelta: gate.maximumEdgeDelta,
    maximumAllowedInkMassRatioDelta: gate.maximumInkPixelRatioDelta,
    maximumAllowedContrastFractionDelta: gate.maximumContrastFractionDelta,
    minimumAllowedDirectionCosine: gate.minimumDirectionCosine,
    maximumAllowedDirectionCosineDelta:
      gate.maximumDirectionCosineDelta ?? null,
    completePageSubstitute: gate.acceptWhenRawFails,
    rawRatioRequired: gate.acceptWhenRawRatioPasses === true,
    maximumEdgeDelta:
      nodes.length > 0 && nodes.every((node) => node.maximumEdgeDelta !== null)
        ? Math.max(...nodes.map((node) => node.maximumEdgeDelta!))
        : null,
    passed: nodes.length > 0 && nodes.every((node) => node.passed),
    nodes,
  }
}

function parseHexColor(value: string, label: string): RgbColor {
  const normalized = value.trim()
  const short = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(normalized)
  if (short) {
    return [
      Number.parseInt(`${short[1]}${short[1]}`, 16),
      Number.parseInt(`${short[2]}${short[2]}`, 16),
      Number.parseInt(`${short[3]}${short[3]}`, 16),
    ]
  }
  const full = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized)
  if (!full) throw new Error(`${label} must be an opaque hex color`)
  return [
    Number.parseInt(full[1], 16),
    Number.parseInt(full[2], 16),
    Number.parseInt(full[3], 16),
  ]
}

function blendColor(
  background: RgbColor,
  foreground: RgbColor,
  opacity: number
): RgbColor {
  return [
    blendChannel(background[0], foreground[0], opacity),
    blendChannel(background[1], foreground[1], opacity),
    blendChannel(background[2], foreground[2], opacity),
  ]
}

function blendChannel(background: number, foreground: number, opacity: number) {
  return Math.round(background + (foreground - background) * opacity)
}

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
    (candidate.version !== 1 && candidate.version !== 2) ||
    typeof candidate.captureReport !== "string" ||
    candidate.captureReport === "" ||
    !Array.isArray(candidate.comparisons)
  ) {
    throw new Error("Render conformance manifest must use version 1 or 2")
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
    const geometry =
      item.geometry === undefined
        ? undefined
        : validateGeometryGate(item.geometry, index, candidate.version!)
    return { ...item, geometry } as Comparison
  })
  if (
    candidate.report !== undefined &&
    (typeof candidate.report !== "string" || candidate.report === "")
  ) {
    throw new Error("Render conformance manifest report must be a path")
  }
  return {
    version: candidate.version,
    captureReport: candidate.captureReport,
    report: candidate.report,
    comparisons,
  }
}

function validateGeometryGate(
  value: unknown,
  comparisonIndex: number,
  manifestVersion: 1 | 2
): GeometryGate {
  if (manifestVersion !== 2 || !value || typeof value !== "object") {
    throw new Error(
      `Comparison ${comparisonIndex} geometry requires manifest version 2`
    )
  }
  const gate = value as Partial<GeometryGate>
  if (
    typeof gate.pageId !== "string" ||
    gate.pageId === "" ||
    !Array.isArray(gate.textNodeIds) ||
    gate.textNodeIds.length === 0 ||
    gate.textNodeIds.some(
      (nodeId) => typeof nodeId !== "string" || nodeId === ""
    ) ||
    new Set(gate.textNodeIds).size !== gate.textNodeIds.length ||
    typeof gate.minimumContrastFraction !== "number" ||
    !Number.isFinite(gate.minimumContrastFraction) ||
    gate.minimumContrastFraction <= 0 ||
    gate.minimumContrastFraction > 1 ||
    typeof gate.minimumInkPixelsPerRow !== "number" ||
    !Number.isInteger(gate.minimumInkPixelsPerRow) ||
    gate.minimumInkPixelsPerRow <= 0 ||
    typeof gate.maximumEdgeDelta !== "number" ||
    !Number.isInteger(gate.maximumEdgeDelta) ||
    gate.maximumEdgeDelta < 0 ||
    typeof gate.maximumInkPixelRatioDelta !== "number" ||
    !Number.isFinite(gate.maximumInkPixelRatioDelta) ||
    gate.maximumInkPixelRatioDelta < 0 ||
    gate.maximumInkPixelRatioDelta > 1 ||
    typeof gate.maximumContrastFractionDelta !== "number" ||
    !Number.isFinite(gate.maximumContrastFractionDelta) ||
    gate.maximumContrastFractionDelta < 0 ||
    gate.maximumContrastFractionDelta > 1 ||
    typeof gate.minimumDirectionCosine !== "number" ||
    !Number.isFinite(gate.minimumDirectionCosine) ||
    gate.minimumDirectionCosine < 0 ||
    gate.minimumDirectionCosine > 1 ||
    (gate.maximumDirectionCosineDelta !== undefined &&
      (typeof gate.maximumDirectionCosineDelta !== "number" ||
        !Number.isFinite(gate.maximumDirectionCosineDelta) ||
        gate.maximumDirectionCosineDelta < 0 ||
        gate.maximumDirectionCosineDelta > 1)) ||
    typeof gate.acceptWhenRawFails !== "boolean" ||
    (gate.acceptWhenRawRatioPasses !== undefined &&
      typeof gate.acceptWhenRawRatioPasses !== "boolean") ||
    (gate.acceptWhenRawFails && gate.acceptWhenRawRatioPasses)
  ) {
    throw new Error(`Comparison ${comparisonIndex} has invalid ink geometry`)
  }
  return gate as GeometryGate
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
