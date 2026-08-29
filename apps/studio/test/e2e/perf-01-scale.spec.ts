import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { documentSchema } from "@webmcp/document"
import { expect, test } from "@playwright/test"
import type { Page, Request } from "@playwright/test"
import { createImageHeavyPerformanceFixture } from "../../src/features/editor/image-heavy-performance-fixture.test-contract"

const documentStorageKey = "webmcp-studio:northstar-document:v2"
const evidencePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/audits/2026-08-27-editor-production-readiness/artifacts/perf-01-scale-profile.json"
)

type BrowserProbe = {
  activeObjectUrls: Set<string>
  createdObjectUrls: number
  revokedObjectUrls: number
  longTasks: Array<{ duration: number; startTime: number }>
}

declare global {
  interface Window {
    __perf01Probe?: BrowserProbe
  }
}

function createScaleDocument() {
  const fixture = createImageHeavyPerformanceFixture({ pageCount: 100 })
  return documentSchema.parse({
    ...fixture.document,
    id: "perf-01-browser-scale-document",
    name: "PERF-01 browser scale document",
    nodes: fixture.document.nodes.map((node, index) => ({
      id: node.id,
      type: "rect" as const,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      opacity: node.opacity,
      visible: node.visible,
      locked: node.locked,
      fill:
        index % 3 === 0 ? "#2f5d50" : index % 3 === 1 ? "#d79a6b" : "#172126",
      radius: index % 3 === 1 ? 24 : 0,
    })),
  })
}

async function installBrowserProbe(page: Page) {
  await page.addInitScript(() => {
    const activeObjectUrls = new Set<string>()
    const probe: BrowserProbe = {
      activeObjectUrls,
      createdObjectUrls: 0,
      revokedObjectUrls: 0,
      longTasks: [],
    }
    const createObjectUrl = URL.createObjectURL.bind(URL)
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = createObjectUrl(blob)
      activeObjectUrls.add(url)
      probe.createdObjectUrls += 1
      return url
    }
    URL.revokeObjectURL = (url) => {
      if (activeObjectUrls.delete(url)) probe.revokedObjectUrls += 1
      revokeObjectUrl(url)
    }
    window.__perf01Probe = probe
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
          })
        }
      }).observe({ type: "longtask", buffered: true })
    }
  })
}

function trackThumbnailRequests(page: Page) {
  const active = new Set<Request>()
  let maximumConcurrency = 0
  let started = 0
  let completed = 0
  let failed = 0
  const isThumbnail = (request: Request) =>
    new URL(request.url()).pathname === "/v1/studio/page-thumbnail"
  page.on("request", (request) => {
    if (!isThumbnail(request)) return
    started += 1
    active.add(request)
    maximumConcurrency = Math.max(maximumConcurrency, active.size)
  })
  page.on("requestfinished", (request) => {
    if (!isThumbnail(request)) return
    completed += 1
    active.delete(request)
  })
  page.on("requestfailed", (request) => {
    if (!isThumbnail(request)) return
    failed += 1
    active.delete(request)
  })
  return () => ({
    started,
    completed,
    failed,
    active: active.size,
    maximumConcurrency,
  })
}

test("profiles the real 100-page filmstrip and page-switch workload", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await installBrowserProbe(page)
  const readRequests = trackThumbnailRequests(page)
  const scaleDocument = createScaleDocument()
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: documentStorageKey,
      value: JSON.stringify(scaleDocument),
    }
  )

  const reloadStartedAt = Date.now()
  await page.goto("/")
  await page
    .getByRole("button", { name: "Open PERF-01 browser scale document" })
    .click()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 15_000,
  })
  const filmstrip = page.getByRole("region", {
    name: "Image-heavy proposal pages",
  })
  const filmstripViewport = filmstrip.locator(
    '[data-slot="scroll-area-viewport"]'
  )
  const pageButtons = filmstrip.getByRole("button", { name: /^Open page/ })
  await expect(pageButtons).toHaveCount(100)
  const readyWallTime = Date.now() - reloadStartedAt

  const frameProfile = await filmstripViewport.evaluate(async (element) => {
    const samples: number[] = []
    const maximumScroll = element.scrollWidth - element.clientWidth
    let previous = performance.now()
    for (let frame = 0; frame < 90; frame += 1) {
      await new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => resolveFrame())
      )
      const now = performance.now()
      samples.push(now - previous)
      previous = now
      const progress = frame % 2 === 0 ? frame / 89 : 1 - frame / 89
      element.scrollLeft = Math.round(maximumScroll * progress)
    }
    element.scrollLeft = maximumScroll
    await new Promise<void>((resolveFrame) =>
      requestAnimationFrame(() => resolveFrame())
    )
    const ordered = [...samples].sort((left, right) => left - right)
    const percentile = (fraction: number) =>
      ordered[Math.floor((ordered.length - 1) * fraction)] ?? 0
    return {
      frames: samples.length,
      p50FrameMs: percentile(0.5),
      p95FrameMs: percentile(0.95),
      p99FrameMs: percentile(0.99),
      maximumFrameMs: Math.max(...samples),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }
  })

  const switchStartedAt = Date.now()
  await pageButtons.nth(99).click()
  await expect(
    page.getByText("Image story 100", { exact: true }).first()
  ).toBeVisible()
  const pageSwitchWallTime = Date.now() - switchStartedAt
  await page.waitForTimeout(450)

  const browser = await page.evaluate(() => {
    const probe = window.__perf01Probe
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
      }
    ).memory
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined
    return {
      activeObjectUrls: probe?.activeObjectUrls.size ?? null,
      createdObjectUrls: probe?.createdObjectUrls ?? null,
      revokedObjectUrls: probe?.revokedObjectUrls ?? null,
      longTaskCount: probe?.longTasks.length ?? null,
      maximumLongTaskMs: probe?.longTasks.length
        ? Math.max(...probe.longTasks.map((entry) => entry.duration))
        : 0,
      longTaskTotalMs:
        probe?.longTasks.reduce((total, entry) => total + entry.duration, 0) ??
        null,
      usedJSHeapBytes: memory?.usedJSHeapSize ?? null,
      totalJSHeapBytes: memory?.totalJSHeapSize ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      thumbnailElements: document.querySelectorAll("[data-page-thumbnail-id]")
        .length,
      liveArtboards: document.querySelectorAll(
        "[data-page-filmstrip-item] [data-page-id]"
      ).length,
      deferredThumbnails: document.querySelectorAll(
        '[data-thumbnail-state="deferred"]'
      ).length,
      readyRasterThumbnails: document.querySelectorAll(
        'img[data-thumbnail-state="ready"]'
      ).length,
      canvases: document.querySelectorAll("canvas").length,
    }
  })
  const requests = readRequests()
  const evidence = {
    version: 1,
    capturedAt: new Date().toISOString(),
    runtime: {
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: page.viewportSize(),
    },
    document: {
      pages: scaleDocument.pages.length,
      nodes: scaleDocument.nodes.length,
    },
    readyWallTime,
    pageSwitchWallTime,
    frameProfile,
    thumbnailMode:
      requests.started > 0 ? "renderer-backed" : "development-live-fallback",
    requests,
    browser,
    budgets: {
      maximumThumbnailConcurrency: 3,
      maximumTotalThumbnailStarts: 3,
      maximumRetainedObjectUrls: 64,
      maximumDevelopmentLiveArtboards: 8,
      maximumP95FrameMs: 32,
      maximumPageSwitchWallTime: 500,
    },
  }

  await page.goto("about:blank")

  expect(evidence.thumbnailMode).toBe("renderer-backed")
  expect(requests.started).toBeGreaterThan(0)
  expect(requests.started).toBeLessThanOrEqual(
    evidence.budgets.maximumTotalThumbnailStarts
  )
  expect(browser.thumbnailElements).toBe(100)
  expect(browser.liveArtboards).toBeGreaterThan(0)
  expect(browser.liveArtboards).toBeLessThanOrEqual(8)
  expect(requests.maximumConcurrency).toBeLessThanOrEqual(3)
  expect(browser.activeObjectUrls ?? 0).toBeLessThanOrEqual(64)
  expect(frameProfile.p95FrameMs).toBeLessThanOrEqual(32)
  expect(pageSwitchWallTime).toBeLessThanOrEqual(500)

  await mkdir(dirname(evidencePath), { recursive: true })
  const pendingEvidencePath = `${evidencePath}.pending-${process.pid}-${Date.now()}`
  try {
    await writeFile(
      pendingEvidencePath,
      `${JSON.stringify(evidence, null, 2)}\n`
    )
    await rename(pendingEvidencePath, evidencePath)
  } finally {
    await rm(pendingEvidencePath, { force: true })
  }
})
