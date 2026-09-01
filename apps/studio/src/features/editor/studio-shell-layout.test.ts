import { describe, expect, test } from "vitest"
import {
  STUDIO_SHELL_LAYOUT_LIMITS,
  STUDIO_SHELL_LAYOUT_STORAGE_KEY,
  StudioShellLayoutRepository,
  applyStudioShellResizeKey,
  bootstrapStudioShellLayout,
  createDefaultStudioShellLayout,
  getStudioShellPanelResizeBounds,
  parseStudioShellLayout,
  parseStudioShellLayoutQuarantineRecord,
  resolveStudioShellLayout,
  resizeStudioShellPanelAtWidth,
  setStudioShellFilmstripDensity,
  setStudioShellPanelCollapsed,
  setStudioShellPanelWidth,
  toggleStudioShellPanel,
  toggleStudioShellCleanMode,
} from "./studio-shell-layout"
import type { StudioShellLayoutV1 } from "./studio-shell-layout"

class MemoryStorage implements Storage {
  #items = new Map<string, string>()
  failGet = false
  failSet = false

  get length() {
    return this.#items.size
  }

  clear() {
    this.#items.clear()
  }

  getItem(key: string) {
    if (this.failGet) throw new Error("read unavailable")
    return this.#items.get(key) ?? null
  }

  key(index: number) {
    return [...this.#items.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.#items.delete(key)
  }

  setItem(key: string, value: string) {
    if (this.failSet) throw new Error("write unavailable")
    this.#items.set(key, value)
  }
}

function layoutWithWidths(left: number, right: number): StudioShellLayoutV1 {
  return setStudioShellPanelWidth(
    setStudioShellPanelWidth(createDefaultStudioShellLayout(), "left", left),
    "right",
    right
  )
}

describe("studio shell layout preferences", () => {
  test("encodes the audited panel and canvas metrics in its defaults", () => {
    expect(STUDIO_SHELL_LAYOUT_LIMITS).toEqual({
      leftPanel: { minimum: 208, default: 264, maximum: 360 },
      rightPanel: { minimum: 256, default: 288, maximum: 400 },
      canvas: { minimum: 520 },
      splitter: { width: 12 },
      filmstrip: { compact: 96, comfortable: 120 },
    })
    expect(createDefaultStudioShellLayout()).toEqual({
      version: 1,
      leftPanel: { width: 264, collapsed: false },
      rightPanel: { width: 288, collapsed: false },
      filmstripDensity: "compact",
    })
  })

  test("strictly validates its shape while clamping finite stored widths", () => {
    expect(
      parseStudioShellLayout(
        JSON.stringify({
          version: 1,
          leftPanel: { width: -50.4, collapsed: false },
          rightPanel: { width: 900.6, collapsed: true },
          filmstripDensity: "comfortable",
        })
      )
    ).toEqual({
      ok: true,
      layout: {
        version: 1,
        leftPanel: { width: 208, collapsed: false },
        rightPanel: { width: 400, collapsed: true },
        filmstripDensity: "comfortable",
      },
    })

    expect(
      parseStudioShellLayout(
        JSON.stringify({
          ...createDefaultStudioShellLayout(),
          unexpected: true,
        })
      )
    ).toMatchObject({ ok: false, error: { code: "invalid_shape" } })
    expect(
      parseStudioShellLayout(
        JSON.stringify({
          ...createDefaultStudioShellLayout(),
          leftPanel: { width: null, collapsed: false },
        })
      )
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_shape", path: "$.leftPanel" },
    })
    expect(parseStudioShellLayout("not json")).toMatchObject({
      ok: false,
      error: { code: "invalid_json" },
    })
    expect(
      parseStudioShellLayout(
        JSON.stringify({ ...createDefaultStudioShellLayout(), version: 2 })
      )
    ).toMatchObject({
      ok: false,
      error: { code: "unsupported_version", path: "$.version" },
    })
  })

  test("keeps last expanded widths across collapse and restore", () => {
    const resized = setStudioShellPanelWidth(
      createDefaultStudioShellLayout(),
      "left",
      344
    )
    const collapsed = toggleStudioShellPanel(resized, "left")
    expect(collapsed.leftPanel).toEqual({ width: 344, collapsed: true })
    expect(toggleStudioShellPanel(collapsed, "left").leftPanel).toEqual({
      width: 344,
      collapsed: false,
    })
    expect(
      setStudioShellPanelCollapsed(collapsed, "left", true).leftPanel
    ).toEqual({ width: 344, collapsed: true })
  })

  test("toggles both panels as one clean mode without changing their widths", () => {
    const layout = {
      ...createDefaultStudioShellLayout(),
      leftPanel: { width: 344, collapsed: false },
      rightPanel: { width: 312, collapsed: true },
    }
    const clean = toggleStudioShellCleanMode(layout)
    expect(clean.leftPanel).toEqual({ width: 344, collapsed: true })
    expect(clean.rightPanel).toEqual({ width: 312, collapsed: true })
    expect(toggleStudioShellCleanMode(clean)).toMatchObject({
      leftPanel: { width: 344, collapsed: false },
      rightPanel: { width: 312, collapsed: false },
    })
  })

  test("clamps direct panel updates and ignores non-finite input", () => {
    const original = createDefaultStudioShellLayout()
    expect(setStudioShellPanelWidth(original, "left", -Infinity)).toBe(original)
    expect(setStudioShellPanelWidth(original, "left", 999).leftPanel).toEqual({
      width: 360,
      collapsed: false,
    })
    expect(setStudioShellPanelWidth(original, "right", 10).rightPanel).toEqual({
      width: 256,
      collapsed: false,
    })
  })

  test("updates filmstrip density without permitting an invalid record", () => {
    const original = createDefaultStudioShellLayout()
    expect(
      setStudioShellFilmstripDensity(original, "comfortable").filmstripDensity
    ).toBe("comfortable")
    expect(setStudioShellFilmstripDensity(original, "roomy")).toBe(original)
  })
})

describe("studio shell desktop reconciliation", () => {
  test("uses defaults at 1280px without stealing the canvas minimum", () => {
    expect(
      resolveStudioShellLayout(createDefaultStudioShellLayout(), 1280)
    ).toEqual({
      leftPanelWidth: 264,
      rightPanelWidth: 288,
      canvasWidth: 704,
      minimumRequiredWidth: 1008,
      canUseDesktopLayout: true,
    })
  })

  test("shrinks both requested panels proportionally before the canvas", () => {
    expect(resolveStudioShellLayout(layoutWithWidths(360, 440), 1280)).toEqual({
      leftPanelWidth: 347,
      rightPanelWidth: 389,
      canvasWidth: 520,
      minimumRequiredWidth: 1008,
      canUseDesktopLayout: true,
    })
  })

  test("gives collapsed panel space to the canvas without losing its saved width", () => {
    const layout = setStudioShellPanelCollapsed(
      layoutWithWidths(352, 432),
      "left",
      true
    )
    expect(resolveStudioShellLayout(layout, 1280)).toEqual({
      leftPanelWidth: 0,
      rightPanelWidth: 400,
      canvasWidth: 868,
      minimumRequiredWidth: 788,
      canUseDesktopLayout: true,
    })
    expect(layout.leftPanel).toEqual({ width: 352, collapsed: true })
  })

  test("signals compact composition when panel and canvas minimums cannot fit", () => {
    expect(
      resolveStudioShellLayout(createDefaultStudioShellLayout(), 1000)
    ).toEqual({
      leftPanelWidth: 208,
      rightPanelWidth: 256,
      canvasWidth: 512,
      minimumRequiredWidth: 1008,
      canUseDesktopLayout: false,
    })
    expect(
      resolveStudioShellLayout(createDefaultStudioShellLayout(), Infinity)
        .canUseDesktopLayout
    ).toBe(false)
  })

  test("exposes effective splitter bounds that preserve the opposite panel and canvas", () => {
    const wide = layoutWithWidths(360, 440)

    expect(getStudioShellPanelResizeBounds(wide, "left", 1600)).toEqual({
      value: 360,
      minimum: 208,
      maximum: 360,
      disabled: false,
    })
    expect(getStudioShellPanelResizeBounds(wide, "right", 1600)).toEqual({
      value: 400,
      minimum: 256,
      maximum: 400,
      disabled: false,
    })
    expect(getStudioShellPanelResizeBounds(wide, "left", 1280)).toEqual({
      value: 347,
      minimum: 208,
      maximum: 347,
      disabled: false,
    })
    expect(getStudioShellPanelResizeBounds(wide, "right", 1280)).toEqual({
      value: 389,
      minimum: 256,
      maximum: 389,
      disabled: false,
    })
  })

  test("moves the left splitter exactly while the right panel remains fixed", () => {
    const wide = layoutWithWidths(360, 440)
    const constrained = resolveStudioShellLayout(wide, 1280)
    expect(constrained).toMatchObject({
      leftPanelWidth: 347,
      rightPanelWidth: 389,
      canvasWidth: 520,
    })

    const movedInward = resizeStudioShellPanelAtWidth(
      wide,
      "left",
      constrained.leftPanelWidth - 8,
      1280
    )
    expect(movedInward.leftPanel.width).toBe(339)
    expect(movedInward.rightPanel.width).toBe(389)
    expect(resolveStudioShellLayout(movedInward, 1280)).toMatchObject({
      leftPanelWidth: 339,
      rightPanelWidth: 389,
      canvasWidth: 528,
    })
    expect(
      getStudioShellPanelResizeBounds(movedInward, "right", 1280).maximum
    ).toBe(397)

    const movedOutward = resizeStudioShellPanelAtWidth(
      movedInward,
      "left",
      347,
      1280
    )
    expect(movedOutward.leftPanel.width).toBe(347)
    expect(movedOutward.rightPanel.width).toBe(389)
    expect(resolveStudioShellLayout(movedOutward, 1280)).toMatchObject({
      leftPanelWidth: 347,
      rightPanelWidth: 389,
      canvasWidth: 520,
    })

    const clampedOutward = resizeStudioShellPanelAtWidth(
      wide,
      "left",
      constrained.leftPanelWidth + 8,
      1280
    )
    expect(clampedOutward.leftPanel.width).toBe(347)
    expect(clampedOutward.rightPanel.width).toBe(389)
    expect(resolveStudioShellLayout(clampedOutward, 1280).canvasWidth).toBe(520)
  })

  test("moves the right splitter exactly while the left panel remains fixed", () => {
    const wide = layoutWithWidths(360, 440)
    const constrained = resolveStudioShellLayout(wide, 1280)

    const movedInward = resizeStudioShellPanelAtWidth(
      wide,
      "right",
      constrained.rightPanelWidth - 8,
      1280
    )
    expect(movedInward.leftPanel.width).toBe(347)
    expect(movedInward.rightPanel.width).toBe(381)
    expect(resolveStudioShellLayout(movedInward, 1280)).toMatchObject({
      leftPanelWidth: 347,
      rightPanelWidth: 381,
      canvasWidth: 528,
    })
    expect(
      getStudioShellPanelResizeBounds(movedInward, "left", 1280).maximum
    ).toBe(355)

    const movedOutward = resizeStudioShellPanelAtWidth(
      movedInward,
      "right",
      389,
      1280
    )
    expect(movedOutward.leftPanel.width).toBe(347)
    expect(movedOutward.rightPanel.width).toBe(389)
    expect(resolveStudioShellLayout(movedOutward, 1280)).toMatchObject({
      leftPanelWidth: 347,
      rightPanelWidth: 389,
      canvasWidth: 520,
    })

    const clampedOutward = resizeStudioShellPanelAtWidth(
      wide,
      "right",
      constrained.rightPanelWidth + 8,
      1280
    )
    expect(clampedOutward.leftPanel.width).toBe(347)
    expect(clampedOutward.rightPanel.width).toBe(389)
    expect(resolveStudioShellLayout(clampedOutward, 1280).canvasWidth).toBe(520)
  })
})

describe("studio shell splitter keyboard math", () => {
  test("moves splitters physically by 8px and by 32px with Shift", () => {
    const initial = createDefaultStudioShellLayout()
    expect(
      applyStudioShellResizeKey(initial, "left", { key: "ArrowRight" }).layout
        .leftPanel.width
    ).toBe(272)
    expect(
      applyStudioShellResizeKey(initial, "left", {
        key: "ArrowLeft",
        shiftKey: true,
      }).layout.leftPanel.width
    ).toBe(232)

    expect(
      applyStudioShellResizeKey(initial, "right", { key: "ArrowLeft" }).layout
        .rightPanel.width
    ).toBe(296)
    expect(
      applyStudioShellResizeKey(initial, "right", {
        key: "ArrowRight",
        shiftKey: true,
      }).layout.rightPanel.width
    ).toBe(256)
  })

  test("supports Home, End, Enter, bounds, and unrelated keys", () => {
    const initial = createDefaultStudioShellLayout()
    expect(
      applyStudioShellResizeKey(initial, "left", { key: "Home" }).layout
        .leftPanel.width
    ).toBe(208)
    expect(
      applyStudioShellResizeKey(initial, "right", { key: "End" }).layout
        .rightPanel.width
    ).toBe(400)

    const collapsed = applyStudioShellResizeKey(initial, "right", {
      key: "Enter",
    })
    expect(collapsed).toMatchObject({
      handled: true,
      layout: { rightPanel: { width: 288, collapsed: true } },
    })
    expect(
      applyStudioShellResizeKey(collapsed.layout, "right", { key: "Enter" })
        .layout.rightPanel
    ).toEqual({ width: 288, collapsed: false })

    const ignored = applyStudioShellResizeKey(initial, "left", { key: "Tab" })
    expect(ignored).toEqual({ handled: false, layout: initial })
  })
})

describe("studio shell layout repository", () => {
  test("boots with safe defaults when the storage property getter throws", () => {
    const failure = new DOMException("Storage is blocked", "SecurityError")
    const boot = bootstrapStudioShellLayout(() => {
      throw failure
    })

    expect(boot.repository).toBeNull()
    expect(boot.result).toEqual({
      status: "unavailable",
      layout: createDefaultStudioShellLayout(),
      error: failure,
    })
  })

  test("persists user-global preferences and restores clamped finite widths", () => {
    const storage = new MemoryStorage()
    const repository = new StudioShellLayoutRepository(storage)
    expect(repository.load()).toEqual({
      status: "empty",
      layout: createDefaultStudioShellLayout(),
    })

    const layout = setStudioShellPanelCollapsed(
      layoutWithWidths(320, 408),
      "right",
      true
    )
    expect(repository.save(layout)).toEqual({ ok: true })
    expect(repository.load()).toEqual({ status: "restored", layout })

    storage.setItem(
      STUDIO_SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        ...layout,
        leftPanel: { width: 9_000, collapsed: false },
      })
    )
    expect(repository.load()).toMatchObject({
      status: "restored",
      layout: { leftPanel: { width: 360, collapsed: false } },
    })
  })

  test("quarantines corrupt and old-version records before using defaults", () => {
    const storage = new MemoryStorage()
    const raw = JSON.stringify({
      ...createDefaultStudioShellLayout(),
      version: 0,
    })
    storage.setItem(STUDIO_SHELL_LAYOUT_STORAGE_KEY, raw)
    const repository = new StudioShellLayoutRepository(storage, {
      now: () => "2026-08-28T15:45:30.000Z",
    })

    const result = repository.load()
    expect(result).toMatchObject({
      status: "recovered",
      layout: createDefaultStudioShellLayout(),
      failure: { code: "unsupported_version" },
      rawPreservedAt: "quarantine",
    })
    if (result.status !== "recovered" || !result.quarantineKey)
      throw new Error("Expected a quarantined shell layout")
    expect(storage.getItem(STUDIO_SHELL_LAYOUT_STORAGE_KEY)).toBeNull()
    expect(
      parseStudioShellLayoutQuarantineRecord(
        storage.getItem(result.quarantineKey)
      )
    ).toMatchObject({ raw, failure: { code: "unsupported_version" } })
  })

  test("keeps source bytes when quarantine or storage is unavailable", () => {
    const storage = new MemoryStorage()
    storage.setItem(STUDIO_SHELL_LAYOUT_STORAGE_KEY, "not json")
    storage.failSet = true
    expect(new StudioShellLayoutRepository(storage).load()).toMatchObject({
      status: "recovered",
      rawPreservedAt: "source",
      quarantineKey: null,
    })
    expect(storage.getItem(STUDIO_SHELL_LAYOUT_STORAGE_KEY)).toBe("not json")

    storage.failSet = false
    storage.failGet = true
    expect(new StudioShellLayoutRepository(storage).load()).toMatchObject({
      status: "unavailable",
      layout: createDefaultStudioShellLayout(),
      error: { message: "read unavailable" },
    })
  })

  test("contains invalid runtime writes", () => {
    const storage = new MemoryStorage()
    const invalid = {
      ...createDefaultStudioShellLayout(),
      rightPanel: { width: Number.NaN, collapsed: false },
    } as StudioShellLayoutV1
    expect(
      new StudioShellLayoutRepository(storage).save(invalid)
    ).toMatchObject({ ok: false })
    expect(storage.getItem(STUDIO_SHELL_LAYOUT_STORAGE_KEY)).toBeNull()
  })
})
