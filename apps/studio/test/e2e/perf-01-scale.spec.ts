import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  createAdverseRichTextConformanceNode,
  documentSchema,
} from "@webmcp/document"
import { expect, test } from "@playwright/test"
import type { Locator, Page, Request } from "@playwright/test"
import { createImageHeavyPerformanceFixture } from "../../src/features/editor/image-heavy-performance-fixture.test-contract"

const documentStorageKey = "webmcp-studio:northstar-document:v2"
const filmstripIntersectionRootMarginPx = 240
const evidencePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/audits/2026-08-27-editor-production-readiness/artifacts/perf-01-scale-profile.json"
)

type BrowserProbe = {
  activeObjectUrls: Set<string>
  createdObjectUrls: number
  revokedObjectUrls: number
  longTaskSupported: boolean
  longTasks: Array<{ duration: number; startTime: number }>
  fontLoads: Array<{
    descriptor: string
    sampleLength: number
    startedAt: number
    endedAt: number
  }>
}

declare global {
  interface Window {
    __perf01Probe?: BrowserProbe
    __perf01PageSwitch?: {
      startedAt: number
      readyAt: number | null
      paintEndedAt: number | null
      usedJSHeapBytesAtPaint: number | null
    }
  }
}

function createScaleDocument() {
  const fixture = createImageHeavyPerformanceFixture({ pageCount: 100 })
  const adverseTextNodeId = "perf-01-adverse-rich-text"
  const adverseText = createAdverseRichTextConformanceNode({
    id: adverseTextNodeId,
    name: "Adverse 1,000-run rich text",
    x: 24,
    y: 24,
  })
  return documentSchema.parse({
    ...fixture.document,
    id: "perf-01-browser-scale-document",
    name: "PERF-01 browser scale document",
    pages: fixture.document.pages.map((page, index) =>
      index === fixture.document.pages.length - 1
        ? { ...page, nodeIds: [...page.nodeIds, adverseTextNodeId] }
        : page
    ),
    nodes: [
      ...fixture.document.nodes.map((node, index) => ({
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
      adverseText,
    ],
  })
}

async function installBrowserProbe(page: Page) {
  await page.addInitScript(() => {
    const activeObjectUrls = new Set<string>()
    const probe: BrowserProbe = {
      activeObjectUrls,
      createdObjectUrls: 0,
      revokedObjectUrls: 0,
      longTaskSupported:
        PerformanceObserver.supportedEntryTypes.includes("longtask"),
      longTasks: [],
      fontLoads: [],
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
    const loadFont = document.fonts.load.bind(document.fonts)
    document.fonts.load = async (descriptor, sample) => {
      const startedAt = performance.now()
      try {
        return await loadFont(descriptor, sample)
      } finally {
        probe.fontLoads.push({
          descriptor,
          sampleLength: sample?.length ?? 0,
          startedAt,
          endedAt: performance.now(),
        })
      }
    }
    if (probe.longTaskSupported) {
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
  const startedPageIds: string[] = []
  const invalidPageIdRequests: string[] = []
  const isThumbnail = (request: Request) =>
    new URL(request.url()).pathname === "/v1/studio/page-thumbnail"
  page.on("request", (request) => {
    if (!isThumbnail(request)) return
    started += 1
    try {
      const input = request.postDataJSON() as { pageId?: unknown }
      if (typeof input.pageId !== "string" || !input.pageId) {
        invalidPageIdRequests.push("missing pageId")
      } else {
        startedPageIds.push(input.pageId)
      }
    } catch (error) {
      invalidPageIdRequests.push(
        error instanceof Error ? error.message : "invalid JSON body"
      )
    }
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
  return () => {
    if (invalidPageIdRequests.length) {
      throw new Error(
        `Thumbnail requests without a valid pageId: ${invalidPageIdRequests.join(", ")}`
      )
    }
    return {
      started,
      startedPageIds: [...startedPageIds],
      completed,
      failed,
      active: active.size,
      maximumConcurrency,
    }
  }
}

async function expandedFilmstripPageIds(viewport: Locator) {
  return viewport.evaluate((viewport, rootMarginPx) => {
    const root = viewport.getBoundingClientRect()
    const left = root.left - rootMarginPx
    const right = root.right + rootMarginPx
    return [
      ...viewport.querySelectorAll<HTMLElement>("[data-page-selector-id]"),
    ]
      .filter((control) => {
        const rect = control.getBoundingClientRect()
        return rect.right >= left && rect.left <= right
      })
      .map((control) => control.dataset.pageSelectorId)
      .filter((pageId): pageId is string => Boolean(pageId))
  }, filmstripIntersectionRootMarginPx)
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
  const initialExpandedPageIds =
    await expandedFilmstripPageIds(filmstripViewport)

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
  const finalExpandedPageIds = await expandedFilmstripPageIds(filmstripViewport)
  const expandedPageIdUnion = [
    ...new Set([...initialExpandedPageIds, ...finalExpandedPageIds]),
  ]

  const interactionBaseline = await page.evaluate(() => ({
    now: performance.now(),
    usedJSHeapBytes: (
      performance as Performance & {
        memory?: { usedJSHeapSize: number }
      }
    ).memory?.usedJSHeapSize,
  }))
  const cpuProfileSession =
    process.env.PERF01_CPU_PROFILE === "true"
      ? await page.context().newCDPSession(page)
      : null
  if (cpuProfileSession) {
    await cpuProfileSession.send("Profiler.enable")
    await cpuProfileSession.send("Profiler.start")
  }
  const readyPageSelector = `[data-canvas-page-id="${scaleDocument.pages[99]!.id}"][data-canvas-ready-page-id="${scaleDocument.pages[99]!.id}"][data-canvas-runtime-state="ready"]`
  await pageButtons.nth(99).evaluate((button, selector) => {
    button.addEventListener(
      "click",
      () => {
        window.__perf01PageSwitch = {
          startedAt: performance.now(),
          readyAt: null,
          paintEndedAt: null,
          usedJSHeapBytesAtPaint: null,
        }
        const observer = new MutationObserver(() => {
          if (!document.querySelector(selector)) return
          observer.disconnect()
          const timing = window.__perf01PageSwitch
          if (!timing) return
          timing.readyAt = performance.now()
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (window.__perf01PageSwitch === timing) {
                timing.usedJSHeapBytesAtPaint =
                  (
                    performance as Performance & {
                      memory?: { usedJSHeapSize: number }
                    }
                  ).memory?.usedJSHeapSize ?? null
                timing.paintEndedAt = performance.now()
              }
            })
          })
        })
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: [
            "data-canvas-page-id",
            "data-canvas-ready-page-id",
            "data-canvas-runtime-state",
          ],
          childList: true,
          subtree: true,
        })
      },
      { capture: true, once: true }
    )
  }, readyPageSelector)
  await pageButtons.nth(99).click()
  const pageSwitchTiming = await page.evaluate(
    () =>
      new Promise<NonNullable<Window["__perf01PageSwitch"]>>(
        (resolve, reject) => {
          const deadline = performance.now() + 15_000
          const readPaintBoundary = () => {
            const timing = window.__perf01PageSwitch
            if (timing?.readyAt && timing.paintEndedAt) {
              resolve(timing)
              return
            }
            if (performance.now() >= deadline) {
              reject(new Error("Missing exact page-switch paint timing"))
              return
            }
            requestAnimationFrame(readPaintBoundary)
          }
          readPaintBoundary()
        }
      )
  )
  if (cpuProfileSession) {
    const { profile } = await cpuProfileSession.send("Profiler.stop")
    await test.info().attach("perf-01-cpu-profile", {
      body: Buffer.from(JSON.stringify(profile)),
      contentType: "application/json",
    })
    await cpuProfileSession.detach()
  }
  await expect(
    page.getByText("Image story 100", { exact: true }).first()
  ).toBeVisible()
  await expect(page.locator(readyPageSelector)).toBeVisible({ timeout: 15_000 })
  const pageSwitchWallTime =
    pageSwitchTiming.readyAt! - pageSwitchTiming.startedAt
  const pageReadyToPaintTime =
    pageSwitchTiming.paintEndedAt! - pageSwitchTiming.readyAt!
  const pageSwitchPaintTime =
    pageSwitchTiming.paintEndedAt! - pageSwitchTiming.startedAt
  await page.waitForTimeout(450)

  const browser = await page.evaluate(
    ({ startedAt, paintEndedAt }) => {
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
        longTaskSupported: probe?.longTaskSupported ?? false,
        longTaskCount: probe?.longTasks.length ?? null,
        maximumLongTaskMs: probe?.longTasks.length
          ? Math.max(...probe.longTasks.map((entry) => entry.duration))
          : 0,
        longTaskTotalMs:
          probe?.longTasks.reduce(
            (total, entry) => total + entry.duration,
            0
          ) ?? null,
        interactionLongTasks:
          probe?.longTasks.filter(
            (entry) =>
              entry.startTime < paintEndedAt &&
              entry.startTime + entry.duration > startedAt
          ) ?? [],
        fontLoads: probe?.fontLoads ?? [],
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
    },
    {
      startedAt: pageSwitchTiming.startedAt,
      paintEndedAt: pageSwitchTiming.paintEndedAt!,
    }
  )
  const requests = readRequests()
  const interactionMaximumLongTaskMs = browser.interactionLongTasks.length
    ? Math.max(...browser.interactionLongTasks.map((entry) => entry.duration))
    : 0
  const interactionHeapGrowthBytes =
    pageSwitchTiming.usedJSHeapBytesAtPaint === null ||
    interactionBaseline.usedJSHeapBytes === undefined
      ? null
      : Math.max(
          0,
          pageSwitchTiming.usedJSHeapBytesAtPaint -
            interactionBaseline.usedJSHeapBytes
        )
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
      adverseRichTextRuns: 1_000,
    },
    readyWallTime,
    pageSwitchWallTime,
    pageReadyToPaintTime,
    pageSwitchPaintTime,
    frameProfile,
    thumbnailMode:
      requests.started > 0 ? "renderer-backed" : "development-live-fallback",
    requests,
    thumbnailAdmission: {
      rootMarginPx: filmstripIntersectionRootMarginPx,
      initialExpandedPageIds,
      finalExpandedPageIds,
      expandedPageIdUnion,
      startedPageIds: requests.startedPageIds,
    },
    browser,
    interaction: {
      maximumLongTaskMs: interactionMaximumLongTaskMs,
      usedJSHeapBytesAtPaint: pageSwitchTiming.usedJSHeapBytesAtPaint,
      heapGrowthBytes: interactionHeapGrowthBytes,
      clickToReadyMs: pageSwitchWallTime,
      readyToPaintMs: pageReadyToPaintTime,
      clickToPaintMs: pageSwitchPaintTime,
    },
    budgets: {
      maximumThumbnailConcurrency: 3,
      maximumTotalThumbnailStarts: expandedPageIdUnion.length,
      maximumRetainedObjectUrls: 64,
      maximumDevelopmentLiveArtboards: 8,
      maximumP95FrameMs: 32,
      maximumPageSwitchWallTime: 500,
      maximumClickToPaintWallTime: 750,
      maximumRichTextSwitchLongTaskMs: 500,
      maximumRichTextSwitchHeapGrowthBytes: 64 * 1024 * 1024,
    },
  }

  await test.info().attach("perf-01-evidence", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  })

  await page.goto("about:blank")

  expect(evidence.thumbnailMode).toBe("renderer-backed")
  expect(requests.started).toBeGreaterThan(0)
  expect(requests.startedPageIds).toHaveLength(requests.started)
  expect(new Set(requests.startedPageIds).size).toBe(requests.started)
  expect(
    requests.startedPageIds.every((pageId) =>
      expandedPageIdUnion.includes(pageId)
    )
  ).toBe(true)
  expect(requests.started).toBeLessThanOrEqual(
    evidence.budgets.maximumTotalThumbnailStarts
  )
  expect(browser.thumbnailElements).toBe(100)
  expect(browser.liveArtboards).toBe(0)
  expect(requests.maximumConcurrency).toBeLessThanOrEqual(3)
  expect(browser.activeObjectUrls ?? 0).toBeLessThanOrEqual(64)
  expect(frameProfile.p95FrameMs).toBeLessThanOrEqual(32)
  expect(pageSwitchWallTime).toBeLessThanOrEqual(500)
  expect(pageSwitchPaintTime).toBeLessThanOrEqual(
    evidence.budgets.maximumClickToPaintWallTime
  )
  expect(browser.longTaskSupported).toBe(true)
  expect(interactionMaximumLongTaskMs).toBeLessThanOrEqual(
    evidence.budgets.maximumRichTextSwitchLongTaskMs
  )
  expect(interactionBaseline.usedJSHeapBytes).toEqual(expect.any(Number))
  expect(pageSwitchTiming.usedJSHeapBytesAtPaint).toEqual(expect.any(Number))
  expect(interactionHeapGrowthBytes).not.toBeNull()
  expect(interactionHeapGrowthBytes!).toBeLessThanOrEqual(
    evidence.budgets.maximumRichTextSwitchHeapGrowthBytes
  )

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
