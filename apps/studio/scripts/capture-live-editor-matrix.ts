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
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import type { Page } from "@playwright/test"
import sharp from "sharp"

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
)
const auditRoot = join(
  repositoryRoot,
  "docs/audits/2026-08-27-editor-production-readiness"
)
const runsRoot = join(auditRoot, "artifacts/live-editor/runs")
const reportPath = join(auditRoot, "live-editor-capture-report.json")
const baseUrl = (
  process.env.STUDIO_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "")
const viewports = [
  { width: 320, height: 820 },
  { width: 390, height: 820 },
  { width: 1119, height: 820 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const

await mkdir(runsRoot, { recursive: true })
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`
const stagingRoot = await mkdtemp(join(runsRoot, ".capture-"))
const finalRoot = join(runsRoot, runId)
const temporaryReportPath = join(
  auditRoot,
  `.live-editor-capture-report-${randomUUID()}.tmp`
)
let runPromoted = false
let reportPromoted = false

try {
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: viewports[0],
  })
  const page = await context.newPage()
  const captures = []

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    await page.getByRole("heading", { name: "Studio documents" }).waitFor()
    await page.getByRole("button", { name: "Open sample", exact: true }).click()
    await page.waitForURL(/\/documents\/[^/]+$/, { timeout: 30_000 })
    await page.locator("canvas.upper-canvas").waitFor({
      state: "visible",
      timeout: 30_000,
    })

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await settlePage(page, viewport.width)
      const layout = await page.evaluate(() => {
        const box = (selector: string) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect()
          return rect
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : null
        }
        return {
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          documentPanel: box("#studio-document-panel"),
          propertiesPanel: box("#studio-properties-panel"),
          canvasViewport: box('[aria-label="Canvas viewport"]'),
          filmstrip: box('[data-page-filmstrip="gallery"]'),
          moreActions: box('button[aria-label^="More studio actions"]'),
        }
      })
      assert.ok(
        layout.scrollWidth <= layout.clientWidth,
        `${viewport.width}px editor has document-level horizontal overflow`
      )
      assert.ok(
        layout.scrollHeight <= layout.clientHeight,
        `${viewport.width}px editor has document-level vertical overflow`
      )
      assert.ok(layout.canvasViewport, `${viewport.width}px canvas is missing`)
      assert.ok(layout.filmstrip, `${viewport.width}px filmstrip is missing`)
      assert.ok(
        layout.moreActions,
        `${viewport.width}px More action is missing`
      )
      if (viewport.width >= 1280) {
        assert.ok(
          layout.documentPanel,
          `${viewport.width}px document panel is missing`
        )
        assert.ok(
          layout.propertiesPanel,
          `${viewport.width}px properties panel is missing`
        )
        assert.ok(
          layout.canvasViewport.width >= 520,
          `${viewport.width}px desktop canvas is narrower than 520px`
        )
      } else {
        assert.ok(
          !layout.documentPanel || layout.documentPanel.width === 0,
          `${viewport.width}px document panel is still visible`
        )
        assert.ok(
          !layout.propertiesPanel || layout.propertiesPanel.width === 0,
          `${viewport.width}px properties panel is still visible`
        )
      }

      const name = `${viewport.width}x${viewport.height}.png`
      const path = join(stagingRoot, name)
      await page.screenshot({
        path,
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        scale: "css",
        type: "png",
      })
      const bytes = await readFile(path)
      const metadata = await sharp(bytes).metadata()
      assert.equal(metadata.width, viewport.width)
      assert.equal(metadata.height, viewport.height)
      captures.push({
        viewport,
        screenshot: {
          path: name,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          width: metadata.width,
          height: metadata.height,
        },
        layout,
      })
    }

    const browserRuntime = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
    }))
    const report = {
      version: 1,
      runId,
      artifactRoot: `artifacts/live-editor/runs/${runId}`,
      baseUrl,
      documentUrl: page.url(),
      deviceScaleFactor: 1,
      browserRuntime: {
        browserVersion: browser.version(),
        ...browserRuntime,
        hostOperatingSystem: process.platform,
        hostArchitecture: process.arch,
      },
      captures,
    }

    await rename(stagingRoot, finalRoot)
    runPromoted = true
    await writeFile(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`)
    await rename(temporaryReportPath, reportPath)
    reportPromoted = true
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await context.close()
    await browser.close()
  }
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
  await rm(temporaryReportPath, { force: true })
  if (runPromoted && !reportPromoted) {
    await rm(finalRoot, { recursive: true, force: true })
  }
}

async function settlePage(page: Page, viewportWidth: number) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.images].map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((complete, reject) => {
            image.addEventListener("load", () => complete(), { once: true })
            image.addEventListener(
              "error",
              () => reject(new Error(`Image failed to load: ${image.src}`)),
              { once: true }
            )
          })
        }
        if (!image.naturalWidth || !image.naturalHeight) {
          throw new Error(`Image has no decoded pixels: ${image.src}`)
        }
        await image.decode()
      })
    )
    await new Promise<void>((complete) =>
      requestAnimationFrame(() => requestAnimationFrame(() => complete()))
    )
  })
  await page.waitForFunction(
    ({ desktop, expectedLeft, expectedRight }) => {
      const viewport = document
        .querySelector('[aria-label="Canvas viewport"]')
        ?.getBoundingClientRect()
      const artboard = document
        .querySelector('[aria-label="Canvas viewport"] .upper-canvas')
        ?.getBoundingClientRect()
      if (!viewport || !artboard) return false
      const centred =
        Math.abs(
          artboard.left +
            artboard.width / 2 -
            (viewport.left + viewport.width / 2)
        ) <= 1 &&
        Math.abs(
          artboard.top +
            artboard.height / 2 -
            (viewport.top + viewport.height / 2)
        ) <= 1
      if (!centred || !desktop) return centred
      const left = document
        .getElementById("studio-document-panel")
        ?.getBoundingClientRect().width
      const right = document
        .getElementById("studio-properties-panel")
        ?.getBoundingClientRect().width
      return left === expectedLeft && right === expectedRight
    },
    {
      desktop: viewportWidth >= 1280,
      expectedLeft: 264,
      expectedRight: 336,
    },
    { timeout: 10_000 }
  )
}
