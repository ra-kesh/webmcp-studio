#!/usr/bin/env bun

import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page as PlaywrightPage } from "@playwright/test"
import { DOMMatrix, ImageData, Path2D, createCanvas } from "@napi-rs/canvas"
import {
  buildComponentPublicationJourney,
  componentRenderConformanceDocument,
  createTemplateVersion,
  documentSchema,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
  type Document,
} from "@webmcp/document"
import {
  alphaImageMaskRenderConformanceDocument,
  alphaImageMaskRenderConformanceHiddenSourceDocument,
  alphaTextMaskRenderConformanceDocument,
  maskRenderConformanceHiddenSourceNodes,
  maskRenderConformanceDocument,
  maskRenderConformancePage,
  multiAlphaMaskRenderConformanceDocument,
  multiVectorMaskRenderConformanceAllHiddenDocument,
  multiVectorMaskRenderConformanceDocument,
  multiVectorMaskRenderConformanceOneHiddenDocument,
} from "@webmcp/document/internal/mask-render-conformance"
import { projectPagePaintPlan } from "@webmcp/document/internal/page-paint-plan"
import sharp from "sharp"
import { renderDocumentToHtml } from "../../renderer/src/html"

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
)
const auditRoot = join(
  repositoryRoot,
  "docs/audits/2026-08-27-editor-production-readiness"
)
const artifactRoot = join(auditRoot, "artifacts")
const artifactRunsRoot = join(artifactRoot, "runs")
const conformanceCorpus =
  process.env.CONFORMANCE_CORPUS === "resources" ||
  process.env.CONFORMANCE_CORPUS === "components" ||
  process.env.CONFORMANCE_CORPUS === "component-journey" ||
  process.env.CONFORMANCE_CORPUS === "mask"
    ? process.env.CONFORMANCE_CORPUS
    : "golden"
const captureDocument =
  conformanceCorpus === "mask"
    ? maskRenderConformanceDocument
    : conformanceCorpus === "resources"
      ? createTemplateVersion(textDesignSystemConformanceDocument, {
          id: "text-design-system-conformance-v1",
          templateId: "text-design-system-conformance",
          version: 1,
          sourceSnapshotId: `sha256-${"b".repeat(64)}`,
          publishedAt: "2026-08-30T16:00:00.000Z",
        }).document
      : conformanceCorpus === "components"
        ? createTemplateVersion(componentRenderConformanceDocument, {
            id: "component-render-conformance-v1",
            templateId: "component-render-conformance",
            version: 1,
            sourceSnapshotId: `sha256-${"c".repeat(64)}`,
            publishedAt: "2026-08-30T16:05:00.000Z",
          }).document
        : conformanceCorpus === "component-journey"
          ? buildComponentPublicationJourney().published.document
          : renderConformanceDocument
const baseUrl = (
  process.env.CONFORMANCE_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "")
const pageIds = captureDocument.pages.map((page) => page.id)
const pdfOutput = requirePdfOutput(captureDocument)
const rendererRetryDelayMs = Number(
  process.env.CONFORMANCE_RENDER_RETRY_DELAY_MS ?? 5_000
)
const rendererRequestAttempts = Number(
  process.env.CONFORMANCE_RENDER_REQUEST_ATTEMPTS ?? 3
)
const rendererRequestTimeoutMs = Number(
  process.env.CONFORMANCE_RENDER_REQUEST_TIMEOUT_MS ?? 30_000
)
const retainedDirectories = [
  "render-view",
  "fabric",
  "renderer-png",
  "renderer-pdf",
  "renderer-endpoint-smoke",
] as const
const hiddenSourceMaskConformanceDocument: Document = {
  ...maskRenderConformanceDocument,
  nodes: maskRenderConformanceHiddenSourceNodes,
}
const maskCaptureStates = [
  {
    name: "visible",
    document: maskRenderConformanceDocument,
  },
  {
    name: "hidden-source",
    document: hiddenSourceMaskConformanceDocument,
  },
  {
    name: "alpha-image",
    document: alphaImageMaskRenderConformanceDocument,
  },
  {
    name: "alpha-image-hidden",
    document: alphaImageMaskRenderConformanceHiddenSourceDocument,
  },
  {
    name: "alpha-text",
    document: alphaTextMaskRenderConformanceDocument,
  },
  {
    name: "multi-vector",
    document: multiVectorMaskRenderConformanceDocument,
  },
  {
    name: "multi-vector-one-hidden",
    document: multiVectorMaskRenderConformanceOneHiddenDocument,
  },
  {
    name: "multi-vector-all-hidden",
    document: multiVectorMaskRenderConformanceAllHiddenDocument,
  },
  {
    name: "multi-alpha",
    document: multiAlphaMaskRenderConformanceDocument,
  },
] as const
const visibleMaskBrowserSurfaceThreshold = Object.freeze({
  channelDifference: 8,
  maxPixelsAboveChannelDifference: 51,
  maxMeanChannelDifference: 0.046,
  maxChannelDifference: 23,
})
const hiddenMaskBrowserSurfaceThreshold = Object.freeze({
  channelDifference: 8,
  maxPixelsAboveChannelDifference: 765,
  maxMeanChannelDifference: 0.171,
  maxChannelDifference: 48,
})
const directMaskPdfRasterThreshold = Object.freeze({
  channelDifference: 8,
  maxPixelsAboveChannelDifference: 250,
  maxMeanChannelDifference: 0.16,
  maxChannelDifference: 32,
})
const directMaskTwoXThreshold = Object.freeze({
  channelDifference: 8,
  maxPixelsAboveChannelDifference: 1_100,
  maxMeanChannelDifference: 0.08,
  maxChannelDifference: 32,
})
const browserCaptureSurfaces = ["render-view", "fabric"] as const
type BrowserCaptureSurface = (typeof browserCaptureSurfaces)[number]
type BrowserCaptureScope = Readonly<{
  pageId: string
  phase: "navigation" | "readiness" | "capture"
  surface: BrowserCaptureSurface | null
}>
type BrowserPageErrorEvidence = BrowserCaptureScope &
  Readonly<{
    name: string
    message: string
    stack: string | null
  }>
let browserCaptureRuntime: {
  browserVersion: string
  userAgent: string
  platform: string
  hostOperatingSystem: NodeJS.Platform
  hostArchitecture: string
} | null = null
const browserPageErrors: BrowserPageErrorEvidence[] = []
const browserSurfaceCaptures: Array<
  Readonly<{
    pageId: string
    surface: BrowserCaptureSurface
    state: "ready"
    maskState: (typeof maskCaptureStates)[number]["name"] | null
  }>
> = []

await mkdir(artifactRunsRoot, { recursive: true })
const captureRunId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`
const stagingRoot = await mkdtemp(join(artifactRunsRoot, ".capture-"))
const finalRunRoot = join(artifactRunsRoot, captureRunId)
const reportPath = join(
  auditRoot,
  conformanceCorpus === "resources"
    ? "text-design-system-conformance-capture-report.json"
    : conformanceCorpus === "components"
      ? "component-conformance-capture-report.json"
      : conformanceCorpus === "component-journey"
        ? "component-journey-conformance-capture-report.json"
        : conformanceCorpus === "mask"
          ? "mask-conformance-capture-report.json"
          : "render-conformance-capture-report.json"
)
const temporaryReportPath = join(
  auditRoot,
  `.render-conformance-capture-report-${randomUUID()}.tmp`
)
let runPromoted = false
let reportPromoted = false
for (const directory of retainedDirectories) {
  await mkdir(join(stagingRoot, directory), { recursive: true })
}

try {
  verifyDocumentRoundTrip()
  await captureBrowserSurfaces()
  await captureRendererArtifacts()
  const report = await buildCaptureReport()
  await rename(stagingRoot, finalRunRoot)
  runPromoted = true
  await writeFile(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`)
  await rename(temporaryReportPath, reportPath)
  reportPromoted = true
  console.log(JSON.stringify(report, null, 2))
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
  await rm(temporaryReportPath, { force: true })
  if (runPromoted && !reportPromoted) {
    await rm(finalRunRoot, { recursive: true, force: true })
  }
}

function requirePdfOutput(document: Document) {
  const output = document.outputs.find((candidate) =>
    candidate.exportFormats.includes("pdf")
  )
  if (!output) throw new Error("Conformance corpus requires a PDF output")
  return output
}

function verifyDocumentRoundTrip() {
  const serialized = JSON.stringify(captureDocument)
  const roundTripped = documentSchema.parse(JSON.parse(serialized) as unknown)
  assert.equal(
    JSON.stringify(roundTripped),
    serialized,
    "Conformance document JSON round trip changed canonical bytes"
  )
  assert.deepEqual(
    roundTripped.outputs.map(({ id, pageIds: outputPageIds }) => ({
      id,
      pageIds: outputPageIds,
    })),
    conformanceCorpus === "components"
      ? [
          {
            id: "component-render-output",
            pageIds: ["component-render-page"],
          },
        ]
      : conformanceCorpus === "component-journey"
        ? [
            {
              id: "proposal",
              pageIds: ["cover", "story", "package", "timeline", "terms"],
            },
            { id: "whatsapp", pageIds: ["whatsapp-card"] },
            { id: "follow-up", pageIds: ["square-card"] },
          ]
        : conformanceCorpus === "mask"
          ? [
              {
                id: "mask-conformance-output",
                pageIds: ["mask-conformance-page"],
              },
            ]
          : [
              {
                id: "mixed-document",
                pageIds: ["properties-page", "long-text-page"],
              },
              { id: "square-image", pageIds: ["square-page"] },
            ]
  )
}

async function captureBrowserSurfaces() {
  console.info("Launching retained browser-surface capture")
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width: 2_000, height: 1_200 },
  })
  const browserPage = await context.newPage()
  browserPage.setDefaultTimeout(30_000)
  browserPage.setDefaultNavigationTimeout(30_000)
  let captureScope: BrowserCaptureScope | null = null
  const onPageError = (error: Error) => {
    browserPageErrors.push({
      pageId: captureScope?.pageId ?? "unscoped",
      phase: captureScope?.phase ?? "navigation",
      surface: captureScope?.surface ?? null,
      name: error.name || "Error",
      message: error.message || String(error),
      stack: error.stack?.slice(0, 8_000) ?? null,
    })
  }
  browserPage.on("pageerror", onPageError)
  try {
    const browserRuntime = await browserPage.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
    }))
    browserCaptureRuntime = {
      browserVersion: browser.version(),
      ...browserRuntime,
      hostOperatingSystem: process.platform,
      hostArchitecture: process.arch,
    }
    const browserStates =
      conformanceCorpus === "mask"
        ? maskCaptureStates.map(({ name }) => name)
        : [null]
    for (const pageId of pageIds) {
      for (const maskState of browserStates) {
        const stateLabel = maskState ? ` (${maskState})` : ""
        console.info(`Starting browser surfaces for ${pageId}${stateLabel}`)
        captureScope = { pageId, phase: "navigation", surface: null }
        const maskStateQuery = maskState
          ? `&maskState=${encodeURIComponent(maskState)}`
          : ""
        await browserPage.goto(
          `${baseUrl}/render-conformance?corpus=${conformanceCorpus}&page=${encodeURIComponent(pageId)}${maskStateQuery}`,
          { waitUntil: "networkidle" }
        )
        console.info(`Loaded browser surfaces for ${pageId}${stateLabel}`)
        assertNoBrowserPageErrors(`${pageId} navigation`)
        const embeddedDocument = await browserPage
          .locator('script[data-conformance-document="v3"]')
          .textContent()
        assert.ok(embeddedDocument, "Conformance route omitted its document")
        const expectedDocument = maskState
          ? maskCaptureStates.find((state) => state.name === maskState)!
              .document
          : captureDocument
        assert.deepEqual(
          documentSchema.parse(JSON.parse(embeddedDocument)),
          documentSchema.parse(expectedDocument),
          `${pageId} browser fixture differs from the imported document`
        )

        captureScope = { pageId, phase: "readiness", surface: null }
        await browserPage.waitForFunction(
          (targetPageId) =>
            ["render-view", "fabric"].every((surface) => {
              const element = document.querySelector(
                `[data-conformance-capture="${surface}:${targetPageId}"]`
              )
              return (
                element?.getAttribute("data-conformance-state") === "ready" ||
                element?.getAttribute("data-conformance-state") === "error"
              )
            }),
          pageId,
          { timeout: 30_000 }
        )
        assertNoBrowserPageErrors(`${pageId} surface readiness`)

        for (const surface of browserCaptureSurfaces) {
          captureScope = { pageId, phase: "capture", surface }
          const locator = browserPage.locator(
            `[data-conformance-capture="${surface}:${pageId}"]`
          )
          assertNoBrowserPageErrors(`${surface}:${pageId} ready claim`)
          assert.equal(
            await locator.getAttribute("data-conformance-state"),
            "ready",
            `${surface}:${pageId} did not reach capture readiness`
          )
          const bytes = await locator.screenshot({
            animations: "disabled",
            caret: "hide",
            scale: "css",
            timeout: 30_000,
            type: "png",
          })
          assertNoBrowserPageErrors(`${surface}:${pageId} screenshot`)
          const artifactName = maskState
            ? `${pageId}-${maskState}.png`
            : `${pageId}.png`
          await writeFile(join(stagingRoot, surface, artifactName), bytes)
          browserSurfaceCaptures.push({
            pageId,
            surface,
            state: "ready",
            maskState,
          })
          console.info(
            `Captured ${surface} browser surface for ${pageId}${stateLabel}`
          )
        }
        captureScope = null
      }
    }
  } finally {
    browserPage.off("pageerror", onPageError)
    await browserPage.close()
    console.info("Closed retained browser capture page")
    await context.close()
    console.info("Closed retained browser capture context")
    await browser.close()
    console.info("Closed retained browser capture browser")
  }
}

async function captureRendererArtifacts() {
  if (conformanceCorpus === "mask") {
    await captureMaskRendererArtifacts()
    return
  }
  for (const page of captureDocument.pages) {
    const { response, body } = await fetchRendererArtifact(
      `${baseUrl}/v1/studio/export-png`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: captureDocument,
          pageId: page.id,
        }),
      },
      `${page.id} Renderer PNG`
    )
    assert.equal(
      response.status,
      200,
      `${page.id} Renderer PNG failed: ${decodeErrorBody(body)}`
    )
    assert.equal(response.headers.get("Content-Type"), "image/png")
    assert.deepEqual(
      [...body.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    )
    assert.equal(response.headers.get("X-Page-Id"), page.id)
    assert.equal(response.headers.get("X-Output-Id"), page.outputId)
    assert.equal(response.headers.get("X-Width"), String(page.width))
    assert.equal(response.headers.get("X-Height"), String(page.height))
    await writeFile(join(stagingRoot, "renderer-png", `${page.id}.png`), body)
  }

  const output = pdfOutput
  const { response, body: pdf } = await fetchRendererArtifact(
    `${baseUrl}/v1/studio/export-pdf`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document: captureDocument,
        outputId: output.id,
      }),
    },
    "Renderer PDF"
  )
  assert.equal(
    response.status,
    200,
    `Renderer PDF failed: ${decodeErrorBody(pdf)}`
  )
  assert.equal(response.headers.get("Content-Type"), "application/pdf")
  assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), "%PDF-")
  assert.equal(response.headers.get("X-Output-Id"), output.id)
  assert.equal(
    response.headers.get("X-Page-Count"),
    String(output.pageIds.length)
  )
  await writeFile(join(stagingRoot, "renderer-pdf", `${output.id}.pdf`), pdf)
  await rasterizePdf(pdf, output.pageIds)
}

async function captureMaskRendererArtifacts() {
  const pdfsToRasterize: Array<
    Readonly<{
      state: (typeof maskCaptureStates)[number]["name"]
      bytes: Uint8Array
    }>
  > = []
  console.info("Launching direct mask PNG capture")
  const pngBrowser = await chromium.launch({
    channel: "chrome",
    headless: true,
  })
  try {
    for (const state of maskCaptureStates) {
      for (const deviceScaleFactor of [1, 2] as const) {
        projectPagePaintPlan(state.document, maskRenderConformancePage.id, {
          pixelRatio: deviceScaleFactor,
        })
        const html = renderDocumentToHtml(
          state.document,
          maskRenderConformancePage.id
        )
        const context = await pngBrowser.newContext({
          deviceScaleFactor,
          viewport: {
            width: maskRenderConformancePage.width,
            height: maskRenderConformancePage.height,
          },
        })
        const browserPage = await context.newPage()
        browserPage.setDefaultTimeout(30_000)
        try {
          console.info(
            `Starting direct mask ${state.name} PNG at ${deviceScaleFactor}x`
          )
          await browserPage.setContent(html, { waitUntil: "load" })
          await waitForDirectMaskPaint(browserPage)
          const png = await browserPage.screenshot({
            animations: "disabled",
            caret: "hide",
            scale: "device",
            timeout: 30_000,
            type: "png",
          })
          await writeFile(
            join(
              stagingRoot,
              "renderer-png",
              `mask-${state.name}-${deviceScaleFactor}x.png`
            ),
            png
          )
          console.info(
            `Captured direct mask ${state.name} PNG at ${deviceScaleFactor}x`
          )
        } finally {
          await browserPage.close()
          await context.close()
          console.info(
            `Closed direct mask ${state.name} ${deviceScaleFactor}x context`
          )
        }
      }
    }
  } finally {
    await pngBrowser.close()
  }

  // Chrome can stall while creating a new high-DPI context after page.pdf().
  // Keep PDF generation in a fresh browser lifecycle so raster screenshots and
  // print capture cannot interfere with one another.
  console.info("Launching direct mask PDF capture")
  const pdfBrowser = await chromium.launch({
    channel: "chrome",
    headless: true,
  })
  try {
    for (const state of maskCaptureStates) {
      projectPagePaintPlan(state.document, maskRenderConformancePage.id, {
        pixelRatio: 1,
      })
      const html = renderDocumentToHtml(
        state.document,
        maskRenderConformancePage.id
      )
      const context = await pdfBrowser.newContext({
        deviceScaleFactor: 1,
        viewport: {
          width: maskRenderConformancePage.width,
          height: maskRenderConformancePage.height,
        },
      })
      const browserPage = await context.newPage()
      browserPage.setDefaultTimeout(30_000)
      try {
        console.info(`Starting direct mask ${state.name} PDF`)
        await browserPage.setContent(html, { waitUntil: "load" })
        await waitForDirectMaskPaint(browserPage)
        const pdf = await browserPage.pdf({
          width: `${maskRenderConformancePage.width}px`,
          height: `${maskRenderConformancePage.height}px`,
          printBackground: true,
          preferCSSPageSize: true,
        })
        await writeFile(
          join(stagingRoot, "renderer-pdf", `mask-${state.name}.pdf`),
          pdf
        )
        pdfsToRasterize.push({
          state: state.name,
          bytes: Uint8Array.from(pdf),
        })
        console.info(`Captured direct mask ${state.name} PDF`)
      } finally {
        await browserPage.close()
        await context.close()
        console.info(`Closed direct mask ${state.name} PDF context`)
      }
    }
  } finally {
    await pdfBrowser.close()
  }
  for (const pdf of pdfsToRasterize) {
    await rasterizePdf(
      pdf.bytes,
      [maskRenderConformancePage.id],
      "renderer-pdf",
      [`mask-${pdf.state}`]
    )
    console.info(`Rasterized direct mask ${pdf.state} PDF`)
  }
  await captureMaskEndpointSmoke()
}

async function waitForDirectMaskPaint(browserPage: PlaywrightPage) {
  await browserPage.waitForFunction(
    () =>
      document.documentElement.hasAttribute("data-render-ready") ||
      document.documentElement.hasAttribute("data-render-error"),
    undefined,
    { timeout: 30_000 }
  )
  const error = await browserPage
    .locator("html")
    .getAttribute("data-render-error")
  assert.equal(error, null, `Direct mask resource readiness failed: ${error}`)
  await browserPage.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}

async function captureMaskEndpointSmoke() {
  const page = maskRenderConformancePage
  for (const state of maskCaptureStates) {
    const prefix = `canonical-mask-v5-${state.name}`
    const { response: pngResponse, body: png } = await fetchRendererArtifact(
      `${baseUrl}/v1/studio/export-png`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: state.document, pageId: page.id }),
      },
      `${state.name} canonical mask endpoint PNG`
    )
    assert.equal(pngResponse.status, 200, decodeErrorBody(png))
    assert.equal(pngResponse.headers.get("Content-Type"), "image/png")
    await writeFile(
      join(stagingRoot, "renderer-endpoint-smoke", `${prefix}.png`),
      png
    )

    const { response: thumbnailResponse, body: thumbnail } =
      await fetchRendererArtifact(
        `${baseUrl}/v1/studio/page-thumbnail`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            document: state.document,
            pageId: page.id,
            size: { width: 240, height: 180 },
          }),
        },
        `${state.name} canonical mask thumbnail`
      )
    assert.equal(thumbnailResponse.status, 200, decodeErrorBody(thumbnail))
    assert.equal(thumbnailResponse.headers.get("Content-Type"), "image/png")
    await writeFile(
      join(stagingRoot, "renderer-endpoint-smoke", `${prefix}-thumbnail.png`),
      thumbnail
    )

    const { response: pdfResponse, body: pdf } = await fetchRendererArtifact(
      `${baseUrl}/v1/studio/export-pdf`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: state.document,
          outputId: pdfOutput.id,
        }),
      },
      `${state.name} canonical mask endpoint PDF`
    )
    assert.equal(pdfResponse.status, 200, decodeErrorBody(pdf))
    assert.equal(pdfResponse.headers.get("Content-Type"), "application/pdf")
    await writeFile(
      join(stagingRoot, "renderer-endpoint-smoke", `${prefix}.pdf`),
      pdf
    )
    await rasterizePdf(pdf, [page.id], "renderer-endpoint-smoke", [
      `${prefix}-raster`,
    ])
  }
}

async function fetchRendererArtifact(
  url: string,
  init: RequestInit,
  label: string
) {
  for (let attempt = 1; attempt <= rendererRequestAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(rendererRequestTimeoutMs),
      })
      const body = new Uint8Array(await response.arrayBuffer())
      if (response.ok || !isRetryableRendererStatus(response.status)) {
        return { response, body }
      }
      if (attempt === rendererRequestAttempts) return { response, body }
      console.warn(
        `${label} received retryable HTTP ${response.status}; waiting ${rendererRetryDelayMs}ms before attempt ${attempt + 1}/${rendererRequestAttempts}`
      )
    } catch (error) {
      if (attempt === rendererRequestAttempts) throw error
      console.warn(
        `${label} did not complete within ${rendererRequestTimeoutMs}ms; waiting ${rendererRetryDelayMs}ms before attempt ${attempt + 1}/${rendererRequestAttempts}`
      )
    }
    await wait(rendererRetryDelayMs)
  }
  throw new Error(`${label} exhausted its renderer attempts`)
}

function isRetryableRendererStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503
}

function wait(milliseconds: number) {
  return new Promise<void>((complete) => setTimeout(complete, milliseconds))
}

async function rasterizePdf(
  pdfBytes: Uint8Array,
  outputPageIds: readonly string[],
  directory: (typeof retainedDirectories)[number] = "renderer-pdf",
  rasterNames: readonly string[] = outputPageIds
) {
  assert.equal(
    rasterNames.length,
    outputPageIds.length,
    "PDF raster names must match the PDF page count"
  )
  const require = createRequire(import.meta.url)
  const nodeProcess = process as NodeJS.Process & {
    getBuiltinModule?: (name: string) => unknown
  }
  if (!Reflect.has(nodeProcess, "getBuiltinModule")) {
    Reflect.set(nodeProcess, "getBuiltinModule", (name: string) =>
      require(name)
    )
  }
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = getDocument({ data: Uint8Array.from(pdfBytes) })
  const pdf = await task.promise
  try {
    assert.equal(pdf.numPages, outputPageIds.length, "Renderer PDF page count")
    for (let index = 0; index < outputPageIds.length; index += 1) {
      const pageId = outputPageIds[index]
      const canonicalPage = captureDocument.pages.find(
        (candidate) => candidate.id === pageId
      )!
      const pdfPage = await pdf.getPage(index + 1)
      const viewport = pdfPage.getViewport({ scale: 96 / 72 })
      assert.ok(
        Math.abs(viewport.width - canonicalPage.width) < 1,
        `${pageId} PDF width ${viewport.width} differs from ${canonicalPage.width}px`
      )
      assert.ok(
        Math.abs(viewport.height - canonicalPage.height) < 1,
        `${pageId} PDF height ${viewport.height} differs from ${canonicalPage.height}px`
      )
      const canvas = createCanvas(canonicalPage.width, canonicalPage.height)
      const canvasContext = canvas.getContext("2d")
      await pdfPage.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext:
          canvasContext as unknown as globalThis.CanvasRenderingContext2D,
        viewport,
      }).promise
      await writeFile(
        join(stagingRoot, directory, `${rasterNames[index]}.png`),
        canvas.toBuffer("image/png")
      )
    }
  } finally {
    // pdfjs' loading-task teardown blocks synchronously under Bun after a
    // successful raster. This one-shot evidence process releases it on exit.
  }
}

async function buildCaptureReport() {
  const artifacts = []
  for (const artifact of retainedArtifactSpecs()) {
    const path = join(stagingRoot, artifact.directory, artifact.name)
    const bytes = await readFile(path)
    const entry: Record<string, unknown> = {
      path: `${artifact.directory}/${artifact.name}`,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
    if (artifact.name.endsWith(".png")) {
      const metadata = await sharp(bytes).metadata()
      const page = captureDocument.pages.find(
        (candidate) => candidate.id === artifact.pageId
      )
      assert.ok(page, `Unknown artifact page ${artifact.pageId}`)
      const scale = artifact.scale ?? 1
      assert.equal(
        metadata.width,
        artifact.expectedWidth ?? page.width * scale,
        `${artifact.directory}/${artifact.name} width`
      )
      assert.equal(
        metadata.height,
        artifact.expectedHeight ?? page.height * scale,
        `${artifact.directory}/${artifact.name} height`
      )
      entry.width = metadata.width
      entry.height = metadata.height
    }
    artifacts.push(entry)
  }
  return {
    version: 2,
    runId: captureRunId,
    artifactRoot: `artifacts/runs/${captureRunId}`,
    corpus: conformanceCorpus,
    documentId: captureDocument.id,
    revision: captureDocument.revision,
    baseUrl,
    deviceScaleFactor: 1,
    browserCaptureRuntime,
    browserCaptureEvidence: {
      pageErrorPolicy: "fail_before_surface_ready",
      pageErrors: browserPageErrors,
      surfaces: browserSurfaceCaptures,
    },
    pageOrder: captureDocument.pages.map((page) => page.id),
    outputs: captureDocument.outputs.map(({ id, pageIds: ids }) => ({
      id,
      pageIds: ids,
    })),
    artifacts,
    ...(conformanceCorpus === "mask"
      ? {
          maskEvidence: {
            directHtml: {
              states: maskCaptureStates.map(({ name }) => name),
              deviceScaleFactors: [1, 2],
              pngPathPattern: "renderer-png/mask-{state}-{scale}x.png",
              pdfPathPattern: "renderer-pdf/mask-{state}.pdf",
              pdfRasterPathPattern: "renderer-pdf/mask-{state}.png",
            },
            pngPdfRasterComparisons: await Promise.all(
              maskCaptureStates.map(({ name }) =>
                comparePngArtifacts(
                  `renderer-png/mask-${name}-1x.png`,
                  `renderer-pdf/mask-${name}.png`,
                  directMaskPdfRasterThreshold
                )
              )
            ),
            browserSurfaceComparisons: await Promise.all(
              maskCaptureStates.map(({ name }) =>
                comparePngArtifacts(
                  `render-view/${maskRenderConformancePage.id}-${name}.png`,
                  `fabric/${maskRenderConformancePage.id}-${name}.png`,
                  name.includes("hidden")
                    ? hiddenMaskBrowserSurfaceThreshold
                    : visibleMaskBrowserSurfaceThreshold
                )
              )
            ),
            directHtmlBrowserRenderViewComparisons: await Promise.all(
              maskCaptureStates.map(({ name }) =>
                comparePngArtifacts(
                  `renderer-png/mask-${name}-1x.png`,
                  `render-view/${maskRenderConformancePage.id}-${name}.png`,
                  visibleMaskBrowserSurfaceThreshold
                )
              )
            ),
            oneToTwoXComparisons: await Promise.all(
              maskCaptureStates.map(({ name }) =>
                comparePngArtifactsAtCssScale(
                  `renderer-png/mask-${name}-1x.png`,
                  `renderer-png/mask-${name}-2x.png`,
                  directMaskTwoXThreshold
                )
              )
            ),
            productionEndpointSmoke: {
              exercised: true,
              states: maskCaptureStates.map(({ name }) => ({
                name,
                png: `renderer-endpoint-smoke/canonical-mask-v5-${name}.png`,
                thumbnail: `renderer-endpoint-smoke/canonical-mask-v5-${name}-thumbnail.png`,
                pdf: `renderer-endpoint-smoke/canonical-mask-v5-${name}.pdf`,
                pdfRaster: `renderer-endpoint-smoke/canonical-mask-v5-${name}-raster.png`,
              })),
              scope:
                "Canonical schema-v5 single- and multi-source vector and alpha mask documents rendered through the public Studio PNG and PDF endpoints.",
            },
          },
        }
      : {}),
  }
}

type RetainedArtifactSpec = Readonly<{
  directory: (typeof retainedDirectories)[number]
  name: string
  pageId?: string
  scale?: number
  expectedWidth?: number
  expectedHeight?: number
}>

function retainedArtifactSpecs(): RetainedArtifactSpec[] {
  if (conformanceCorpus === "mask") {
    const pageId = maskRenderConformancePage.id
    return [
      ...browserCaptureSurfaces.flatMap((surface) =>
        maskCaptureStates.map(({ name }) => ({
          directory: surface,
          name: `${pageId}-${name}.png`,
          pageId,
        }))
      ),
      ...maskCaptureStates.flatMap(({ name }) =>
        [1, 2].map((scale) => ({
          directory: "renderer-png" as const,
          name: `mask-${name}-${scale}x.png`,
          pageId,
          scale,
        }))
      ),
      ...maskCaptureStates.flatMap(({ name }) => [
        {
          directory: "renderer-pdf" as const,
          name: `mask-${name}.pdf`,
        },
        {
          directory: "renderer-pdf" as const,
          name: `mask-${name}.png`,
          pageId,
        },
      ]),
      ...maskCaptureStates.flatMap(({ name }) => [
        {
          directory: "renderer-endpoint-smoke" as const,
          name: `canonical-mask-v5-${name}.png`,
          pageId,
        },
        {
          directory: "renderer-endpoint-smoke" as const,
          name: `canonical-mask-v5-${name}.pdf`,
        },
        {
          directory: "renderer-endpoint-smoke" as const,
          name: `canonical-mask-v5-${name}-thumbnail.png`,
          pageId,
          expectedWidth: 240,
          expectedHeight: 180,
        },
        {
          directory: "renderer-endpoint-smoke" as const,
          name: `canonical-mask-v5-${name}-raster.png`,
          pageId,
        },
      ]),
    ]
  }
  return retainedDirectories.flatMap((directory) => {
    if (directory === "renderer-endpoint-smoke") return []
    const names =
      directory === "renderer-pdf"
        ? [
            `${pdfOutput.id}.pdf`,
            ...pdfOutput.pageIds.map((pageId) => `${pageId}.png`),
          ]
        : pageIds.map((pageId) => `${pageId}.png`)
    return names.map((name) => ({
      directory,
      name,
      ...(name.endsWith(".png") ? { pageId: basename(name, ".png") } : {}),
    }))
  })
}

type PngComparisonThreshold = Readonly<{
  channelDifference: number
  maxPixelsAboveChannelDifference: number
  maxMeanChannelDifference: number
  maxChannelDifference: number
}>

async function comparePngArtifacts(
  leftPath: string,
  rightPath: string,
  threshold: PngComparisonThreshold
) {
  const [left, right] = await Promise.all([
    sharp(join(stagingRoot, leftPath)).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    }),
    sharp(join(stagingRoot, rightPath)).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    }),
  ])
  return compareDecodedPngs(leftPath, rightPath, left, right, threshold)
}

async function comparePngArtifactsAtCssScale(
  oneXPath: string,
  twoXPath: string,
  threshold: PngComparisonThreshold
) {
  const oneX = await sharp(join(stagingRoot, oneXPath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const twoX = await sharp(join(stagingRoot, twoXPath))
    .resize(oneX.info.width, oneX.info.height, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return compareDecodedPngs(
    oneXPath,
    `${twoXPath} downsampled to CSS pixels`,
    oneX,
    twoX,
    threshold
  )
}

function compareDecodedPngs(
  leftPath: string,
  rightPath: string,
  left: Readonly<{
    data: Uint8Array
    info: Readonly<{ width: number; height: number }>
  }>,
  right: Readonly<{
    data: Uint8Array
    info: Readonly<{ width: number; height: number }>
  }>,
  threshold: PngComparisonThreshold
) {
  assert.equal(
    left.info.width,
    right.info.width,
    `${leftPath} and ${rightPath} widths differ`
  )
  assert.equal(
    left.info.height,
    right.info.height,
    `${leftPath} and ${rightPath} heights differ`
  )
  let changedChannels = 0
  let pixelsAboveChannelDifference = 0
  let totalAbsoluteDifference = 0
  let maxChannelDifference = 0
  for (let index = 0; index < left.data.length; index += 4) {
    let pixelMaxDifference = 0
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(
        left.data[index + channel]! - right.data[index + channel]!
      )
      if (difference > 0) changedChannels += 1
      totalAbsoluteDifference += difference
      pixelMaxDifference = Math.max(pixelMaxDifference, difference)
      maxChannelDifference = Math.max(maxChannelDifference, difference)
    }
    if (pixelMaxDifference > threshold.channelDifference) {
      pixelsAboveChannelDifference += 1
    }
  }
  const comparison = {
    baseline: leftPath,
    candidate: rightPath,
    comparedChannels: left.data.length,
    comparedPixels: left.data.length / 4,
    changedChannels,
    pixelsAboveChannelDifference,
    maxChannelDifference,
    meanAbsoluteDifference: totalAbsoluteDifference / left.data.length,
    threshold,
  }
  assert.ok(
    comparison.pixelsAboveChannelDifference <=
      threshold.maxPixelsAboveChannelDifference,
    `${leftPath} vs ${rightPath} has ${comparison.pixelsAboveChannelDifference} pixels above channel delta ${threshold.channelDifference}; limit is ${threshold.maxPixelsAboveChannelDifference}`
  )
  assert.ok(
    comparison.meanAbsoluteDifference <= threshold.maxMeanChannelDifference,
    `${leftPath} vs ${rightPath} has mean channel delta ${comparison.meanAbsoluteDifference}; limit is ${threshold.maxMeanChannelDifference}`
  )
  assert.ok(
    comparison.maxChannelDifference <= threshold.maxChannelDifference,
    `${leftPath} vs ${rightPath} has maximum channel delta ${comparison.maxChannelDifference}; limit is ${threshold.maxChannelDifference}`
  )
  return comparison
}

function assertNoBrowserPageErrors(stage: string) {
  assert.equal(
    browserPageErrors.length,
    0,
    `${stage} emitted browser page errors:\n${browserPageErrors
      .map(
        (error) =>
          `${error.name}: ${error.message} [page=${error.pageId}, phase=${error.phase}, surface=${error.surface ?? "none"}]${error.stack ? `\n${error.stack}` : ""}`
      )
      .join("\n\n")}`
  )
}

function decodeErrorBody(body: Uint8Array) {
  return new TextDecoder().decode(body).slice(0, 1_000)
}
