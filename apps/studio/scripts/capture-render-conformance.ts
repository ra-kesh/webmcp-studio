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
import { chromium } from "@playwright/test"
import { DOMMatrix, ImageData, Path2D, createCanvas } from "@napi-rs/canvas"
import { documentSchema, renderConformanceDocument } from "@webmcp/document"
import sharp from "sharp"

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
const baseUrl = (
  process.env.CONFORMANCE_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "")
const pageIds = renderConformanceDocument.pages.map((page) => page.id)
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
] as const
let browserCaptureRuntime: {
  browserVersion: string
  userAgent: string
  platform: string
  hostOperatingSystem: NodeJS.Platform
  hostArchitecture: string
} | null = null

await mkdir(artifactRunsRoot, { recursive: true })
const captureRunId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`
const stagingRoot = await mkdtemp(join(artifactRunsRoot, ".capture-"))
const finalRunRoot = join(artifactRunsRoot, captureRunId)
const reportPath = join(auditRoot, "render-conformance-capture-report.json")
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

function verifyDocumentRoundTrip() {
  const serialized = JSON.stringify(renderConformanceDocument)
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
    [
      {
        id: "mixed-document",
        pageIds: ["properties-page", "long-text-page"],
      },
      { id: "square-image", pageIds: ["square-page"] },
    ]
  )
}

async function captureBrowserSurfaces() {
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width: 2_000, height: 1_200 },
  })
  const browserPage = await context.newPage()
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
    for (const pageId of pageIds) {
      await browserPage.goto(
        `${baseUrl}/render-conformance?page=${encodeURIComponent(pageId)}`,
        { waitUntil: "networkidle" }
      )
      const embeddedDocument = await browserPage
        .locator('script[data-conformance-document="v3"]')
        .textContent()
      assert.ok(embeddedDocument, "Conformance route omitted its document")
      assert.equal(
        JSON.stringify(documentSchema.parse(JSON.parse(embeddedDocument))),
        JSON.stringify(renderConformanceDocument),
        `${pageId} browser fixture differs from the imported document`
      )

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

      for (const surface of ["render-view", "fabric"] as const) {
        const locator = browserPage.locator(
          `[data-conformance-capture="${surface}:${pageId}"]`
        )
        assert.equal(
          await locator.getAttribute("data-conformance-state"),
          "ready",
          `${surface}:${pageId} did not reach capture readiness`
        )
        const bytes = await locator.screenshot({
          animations: "disabled",
          caret: "hide",
          scale: "css",
          type: "png",
        })
        await writeFile(join(stagingRoot, surface, `${pageId}.png`), bytes)
      }
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

async function captureRendererArtifacts() {
  for (const page of renderConformanceDocument.pages) {
    const { response, body } = await fetchRendererArtifact(
      `${baseUrl}/v1/studio/export-png`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: renderConformanceDocument,
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

  const output = renderConformanceDocument.outputs.find(
    (candidate) => candidate.id === "mixed-document"
  )!
  const { response, body: pdf } = await fetchRendererArtifact(
    `${baseUrl}/v1/studio/export-pdf`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document: renderConformanceDocument,
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

async function rasterizePdf(pdfBytes: Uint8Array, outputPageIds: string[]) {
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
  const task = getDocument({ data: pdfBytes })
  const pdf = await task.promise
  try {
    assert.equal(pdf.numPages, outputPageIds.length, "Renderer PDF page count")
    for (let index = 0; index < outputPageIds.length; index += 1) {
      const pageId = outputPageIds[index]
      const canonicalPage = renderConformanceDocument.pages.find(
        (candidate) => candidate.id === pageId
      )!
      const pdfPage = await pdf.getPage(index + 1)
      const viewport = pdfPage.getViewport({ scale: 96 / 72 })
      assert.equal(Math.round(viewport.width), canonicalPage.width)
      assert.equal(Math.round(viewport.height), canonicalPage.height)
      const canvas = createCanvas(canonicalPage.width, canonicalPage.height)
      const canvasContext = canvas.getContext("2d")
      await pdfPage.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext:
          canvasContext as unknown as globalThis.CanvasRenderingContext2D,
        viewport,
      }).promise
      await writeFile(
        join(stagingRoot, "renderer-pdf", `${pageId}.png`),
        canvas.toBuffer("image/png")
      )
    }
  } finally {
    await task.destroy()
  }
}

async function buildCaptureReport() {
  const artifacts = []
  for (const directory of retainedDirectories) {
    const names =
      directory === "renderer-pdf"
        ? ["mixed-document.pdf", "properties-page.png", "long-text-page.png"]
        : pageIds.map((pageId) => `${pageId}.png`)
    for (const name of names) {
      const path = join(stagingRoot, directory, name)
      const bytes = await readFile(path)
      const entry: Record<string, unknown> = {
        path: `${directory}/${name}`,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }
      if (name.endsWith(".png")) {
        const metadata = await sharp(bytes).metadata()
        const pageId = basename(name, ".png")
        const page = renderConformanceDocument.pages.find(
          (candidate) => candidate.id === pageId
        )!
        assert.equal(metadata.width, page.width, `${directory}/${name} width`)
        assert.equal(
          metadata.height,
          page.height,
          `${directory}/${name} height`
        )
        entry.width = metadata.width
        entry.height = metadata.height
      }
      artifacts.push(entry)
    }
  }
  return {
    version: 2,
    runId: captureRunId,
    artifactRoot: `artifacts/runs/${captureRunId}`,
    documentId: renderConformanceDocument.id,
    revision: renderConformanceDocument.revision,
    baseUrl,
    deviceScaleFactor: 1,
    browserCaptureRuntime,
    pageOrder: renderConformanceDocument.pages.map((page) => page.id),
    outputs: renderConformanceDocument.outputs.map(({ id, pageIds: ids }) => ({
      id,
      pageIds: ids,
    })),
    artifacts,
  }
}

function decodeErrorBody(body: Uint8Array) {
  return new TextDecoder().decode(body).slice(0, 1_000)
}
