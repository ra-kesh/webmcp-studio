import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { documentSchema, northstarSeed } from "@webmcp/document"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"
const evidencePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/audits/2026-08-27-editor-production-readiness/artifacts/perf-01-layer-scale-profile.json"
)

type TestWebMcpResult = {
  structuredContent?: unknown
  isError?: boolean
}

type TestWebMcpTool = {
  name: string
  execute: (input: unknown) => TestWebMcpResult | Promise<TestWebMcpResult>
}

declare global {
  interface Window {
    __perf01LayerProbe?: {
      longTasks: Array<{ duration: number; startTime: number }>
    }
    __studioTestTools?: Map<string, TestWebMcpTool>
  }
}

function createLayerScaleDocument() {
  const base = structuredClone(northstarSeed)
  const page = base.pages[0]
  const output = base.outputs[0]
  const rect = base.nodes.find((node) => node.type === "rect")
  if (!page || !output || !rect || rect.type !== "rect") {
    throw new Error(
      "The canonical seed is missing a page, output, or rectangle"
    )
  }
  const nodes = Array.from({ length: 1_000 }, (_, index) => ({
    ...rect,
    id: `perf-layer-${String(index + 1).padStart(4, "0")}`,
    name: `Scale layer ${String(index + 1).padStart(4, "0")}`,
    x: 20 + (index % 32) * 36,
    y: 20 + Math.floor(index / 32) * 36,
    width: 24,
    height: 24,
    fill: index % 2 === 0 ? "#2f5d50" : "#d79a6b",
    radius: index % 3 === 0 ? 6 : 0,
    visible: true,
    locked: false,
  }))
  return documentSchema.parse({
    ...base,
    id: "perf-01-layer-scale-document",
    name: "PERF-01 1,000-layer document",
    pages: [{ ...page, nodeIds: nodes.map((node) => node.id) }],
    outputs: [{ ...output, pageIds: [page.id] }],
    nodes,
    groups: [
      {
        id: "perf-layer-group",
        role: "organize",
        pageId: page.id,
        name: "Scale layers",
        nodeIds: nodes.map((node) => node.id),
      },
    ],
    fields: [],
    fieldValues: {},
    bindings: [],
  })
}

async function installBrowserProbe(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, TestWebMcpTool>()
    window.__studioTestTools = tools
    const documentWithModelContext = document as Document & {
      modelContext?: {
        registerTool: (tool: TestWebMcpTool) => Promise<undefined>
      }
    }
    documentWithModelContext.modelContext = {
      registerTool: async (tool) => {
        tools.set(tool.name, tool)
        return undefined
      },
    }

    const longTasks: Array<{ duration: number; startTime: number }> = []
    window.__perf01LayerProbe = { longTasks }
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
          })
        }
      }).observe({ type: "longtask", buffered: true })
    }
  })
}

async function selectedNodeIds(page: Page) {
  return page.evaluate(async () => {
    const result = await window.__studioTestTools
      ?.get("inspect_design")
      ?.execute({})
    const content = result?.structuredContent as
      { selection?: { nodeIds?: string[] } | null } | undefined
    return content?.selection?.nodeIds ?? []
  })
}

test("profiles a visible 1,000-layer active page and virtualized tree", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await installBrowserProbe(page)
  const scaleDocument = createLayerScaleDocument()
  const targetNode = scaleDocument.nodes.at(-1)
  if (!targetNode) throw new Error("The scale document has no target node")
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: documentStorageKey,
      value: JSON.stringify(scaleDocument),
    }
  )

  const openStartedAt = Date.now()
  await page.goto("/")
  await page
    .getByRole("button", {
      name: "Open PERF-01 1,000-layer document",
    })
    .click()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible({
    timeout: 20_000,
  })
  await expect
    .poll(() =>
      page.evaluate(() => window.__studioTestTools?.has("inspect_design"))
    )
    .toBe(true)
  const activeNodeCount = await page.evaluate(async () => {
    const result = await window.__studioTestTools
      ?.get("inspect_design")
      ?.execute({})
    const content = result?.structuredContent as
      { activePageNodes?: unknown[] } | undefined
    return content?.activePageNodes?.length ?? 0
  })
  const openWallTime = Date.now() - openStartedAt

  await page.getByRole("tab", { name: "Layers" }).click()
  const tree = page.getByRole("tree", { name: "Document layers" })
  const treeScroll = page.getByTestId("layer-tree-scroll")
  await expect(tree).toBeVisible()
  const scaleGroup = tree.getByRole("treeitem", {
    name: "Scale layers",
    exact: true,
  })
  await scaleGroup.getByRole("button", { name: "Expand Scale layers" }).click()
  await expect(scaleGroup).toHaveAttribute("aria-expanded", "true")
  const expandedMountedRows = await tree.getByRole("treeitem").count()
  const expandedTreeGeometry = await treeScroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))

  const search = page.getByRole("searchbox", { name: "Search layers" })
  const searchStartedAt = Date.now()
  await search.fill(targetNode.name)
  const targetRow = tree.getByRole("treeitem", {
    name: targetNode.name,
    exact: true,
  })
  await expect(targetRow).toBeVisible()
  const searchWallTime = Date.now() - searchStartedAt

  const selectionStartedAt = Date.now()
  await targetRow.click()
  await expect.poll(() => selectedNodeIds(page)).toEqual([targetNode.id])
  const selectionWallTime = Date.now() - selectionStartedAt

  const xInput = page.getByLabel("X", { exact: true })
  const nextX = targetNode.x + 1
  const editStartedAt = Date.now()
  await xInput.fill(String(nextX))
  await xInput.press("Enter")
  await expect(xInput).toHaveValue(String(nextX))
  const editWallTime = Date.now() - editStartedAt

  await page.getByRole("button", { name: "Fit canvas" }).click()
  const viewport = page.getByLabel("Canvas viewport")
  const transform = viewport.locator(":scope > .will-change-transform")
  const transformBefore = await transform.evaluate(
    (element) => getComputedStyle(element).transform
  )
  const cameraFrameProfile = await viewport.evaluate(async (element) => {
    const samples: number[] = []
    let previous = performance.now()
    for (let frame = 0; frame < 90; frame += 1) {
      await new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => resolveFrame())
      )
      const now = performance.now()
      samples.push(now - previous)
      previous = now
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: frame % 2 === 0 ? 8 : -8,
          deltaY: frame % 3 === 0 ? 10 : -4,
        })
      )
    }
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
    }
  })
  const transformAfter = await transform.evaluate(
    (element) => getComputedStyle(element).transform
  )
  await page.waitForTimeout(180)
  const zoomDisplay = page.getByRole("button", { name: /Reset zoom to 100%/ })
  const zoomBefore = await zoomDisplay.textContent()
  const zoomFrameProfile = await viewport.evaluate(async (element) => {
    const samples: number[] = []
    let previous = performance.now()
    for (let frame = 0; frame < 60; frame += 1) {
      await new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => resolveFrame())
      )
      const now = performance.now()
      samples.push(now - previous)
      previous = now
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: element.getBoundingClientRect().left + 320,
          clientY: element.getBoundingClientRect().top + 240,
          ctrlKey: true,
          deltaY: -0.2,
        })
      )
    }
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
    }
  })
  await expect(zoomDisplay).not.toHaveText(zoomBefore ?? "")

  const browser = await page.evaluate(() => {
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
      }
    ).memory
    const probe = window.__perf01LayerProbe
    return {
      longTaskCount: probe?.longTasks.length ?? null,
      maximumLongTaskMs: probe?.longTasks.length
        ? Math.max(...probe.longTasks.map((entry) => entry.duration))
        : 0,
      longTaskTotalMs:
        probe?.longTasks.reduce((total, entry) => total + entry.duration, 0) ??
        null,
      usedJSHeapBytes: memory?.usedJSHeapSize ?? null,
      totalJSHeapBytes: memory?.totalJSHeapSize ?? null,
      canvases: document.querySelectorAll("canvas").length,
      mountedTreeRows: document.querySelectorAll(
        '[role="tree"][aria-label="Document layers"] [role="treeitem"]'
      ).length,
    }
  })
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
      visibleNodes: scaleDocument.nodes.filter((node) => node.visible).length,
    },
    openWallTime,
    activeNodeCount,
    expandedMountedRows,
    searchWallTime,
    selectionWallTime,
    editWallTime,
    cameraFrameProfile,
    zoomFrameProfile,
    cameraTransformChanged: transformAfter !== transformBefore,
    expandedTreeGeometry,
    browser,
    budgets: {
      maximumOpenWallTime: 10_000,
      maximumMountedTreeRows: 80,
      maximumSearchWallTime: 1_000,
      maximumSelectionWallTime: 750,
      maximumEditWallTime: 750,
      maximumP95CameraFrameMs: 32,
      maximumP95ZoomFrameMs: 32,
    },
  }

  await page.goto("about:blank")
  expect(activeNodeCount).toBe(1_000)
  expect(openWallTime).toBeLessThanOrEqual(evidence.budgets.maximumOpenWallTime)
  expect(expandedMountedRows).toBeLessThan(
    evidence.budgets.maximumMountedTreeRows
  )
  expect(expandedTreeGeometry.scrollHeight).toBeGreaterThan(
    expandedTreeGeometry.clientHeight
  )
  expect(browser.mountedTreeRows).toBeLessThan(
    evidence.budgets.maximumMountedTreeRows
  )
  expect(searchWallTime).toBeLessThanOrEqual(
    evidence.budgets.maximumSearchWallTime
  )
  expect(selectionWallTime).toBeLessThanOrEqual(
    evidence.budgets.maximumSelectionWallTime
  )
  expect(editWallTime).toBeLessThanOrEqual(evidence.budgets.maximumEditWallTime)
  expect(cameraFrameProfile.p95FrameMs).toBeLessThanOrEqual(
    evidence.budgets.maximumP95CameraFrameMs
  )
  expect(zoomFrameProfile.p95FrameMs).toBeLessThanOrEqual(
    evidence.budgets.maximumP95ZoomFrameMs
  )
  expect(evidence.cameraTransformChanged).toBe(true)

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
