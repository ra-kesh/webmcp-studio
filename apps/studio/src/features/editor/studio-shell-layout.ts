export const STUDIO_SHELL_LAYOUT_VERSION = 1 as const
export const STUDIO_SHELL_LAYOUT_STORAGE_KEY = "webmcp-studio:shell-layout:v1"
export const STUDIO_SHELL_LAYOUT_QUARANTINE_KEY_PREFIX =
  "webmcp-studio:shell-layout-quarantine:v1"

export const STUDIO_SHELL_LAYOUT_LIMITS = Object.freeze({
  leftPanel: Object.freeze({ minimum: 208, default: 264, maximum: 360 }),
  rightPanel: Object.freeze({ minimum: 320, default: 336, maximum: 480 }),
  canvas: Object.freeze({ minimum: 520 }),
  splitter: Object.freeze({ width: 12 }),
  filmstrip: Object.freeze({ compact: 96, comfortable: 120 }),
})

export const STUDIO_SHELL_RESIZE_STEP = 8
export const STUDIO_SHELL_RESIZE_LARGE_STEP = 32

export type StudioShellPanel = "left" | "right"
export type StudioShellFilmstripDensity = "compact" | "comfortable"

export type StudioShellPanelPreference = Readonly<{
  /** The last expanded width. Collapsing a panel never replaces this value. */
  width: number
  collapsed: boolean
}>

export type StudioShellLayoutV1 = Readonly<{
  version: typeof STUDIO_SHELL_LAYOUT_VERSION
  leftPanel: StudioShellPanelPreference
  rightPanel: StudioShellPanelPreference
  filmstripDensity: StudioShellFilmstripDensity
}>

export type ResolvedStudioShellLayout = Readonly<{
  leftPanelWidth: number
  rightPanelWidth: number
  canvasWidth: number
  minimumRequiredWidth: number
  canUseDesktopLayout: boolean
}>

export type StudioShellPanelResizeBounds = Readonly<{
  value: number
  minimum: number
  maximum: number
  disabled: boolean
}>

export type StudioShellLayoutDecodeError = Readonly<{
  code: "invalid_json" | "invalid_shape" | "unsupported_version"
  path: string
  message: string
}>

export type StudioShellLayoutDecodeResult =
  | Readonly<{ ok: true; layout: StudioShellLayoutV1 }>
  | Readonly<{ ok: false; error: StudioShellLayoutDecodeError }>

export type StudioShellLayoutStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>

export type StudioShellLayoutQuarantineRecordV1 = Readonly<{
  version: 1
  sourceStorageKey: string
  capturedAt: string
  failure: StudioShellLayoutDecodeError
  raw: string
}>

export type StudioShellLayoutLoadResult =
  | Readonly<{ status: "empty" | "restored"; layout: StudioShellLayoutV1 }>
  | Readonly<{
      status: "recovered"
      layout: StudioShellLayoutV1
      failure: StudioShellLayoutDecodeError
      rawPreservedAt: "quarantine" | "source"
      quarantineKey: string | null
    }>
  | Readonly<{
      status: "unavailable"
      layout: StudioShellLayoutV1
      error: Error
    }>

export type StudioShellLayoutSaveResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: Error }>

export type StudioShellLayoutBootstrapResult = Readonly<{
  repository: StudioShellLayoutRepository | null
  result: StudioShellLayoutLoadResult
}>

export type StudioShellResizeKey =
  "ArrowLeft" | "ArrowRight" | "Home" | "End" | "Enter"

export type StudioShellResizeKeyInput = Readonly<{
  key: string
  shiftKey?: boolean
}>

export type StudioShellResizeKeyResult = Readonly<{
  handled: boolean
  layout: StudioShellLayoutV1
}>

const TOP_LEVEL_KEYS = [
  "version",
  "leftPanel",
  "rightPanel",
  "filmstripDensity",
] as const
const PANEL_KEYS = ["width", "collapsed"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
) {
  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  )
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizePanel(
  value: unknown,
  panel: StudioShellPanel
): StudioShellPanelPreference | null {
  if (!isRecord(value) || !hasExactKeys(value, PANEL_KEYS)) return null
  if (!Number.isFinite(value.width) || typeof value.collapsed !== "boolean")
    return null
  const limits =
    panel === "left"
      ? STUDIO_SHELL_LAYOUT_LIMITS.leftPanel
      : STUDIO_SHELL_LAYOUT_LIMITS.rightPanel
  return {
    width: Math.round(
      clamp(value.width as number, limits.minimum, limits.maximum)
    ),
    collapsed: value.collapsed,
  }
}

function decodeStudioShellLayoutValue(
  value: unknown
): StudioShellLayoutDecodeResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: {
        code: "invalid_shape",
        path: "$",
        message: "Shell layout must be an object.",
      },
    }
  }
  if (value.version !== STUDIO_SHELL_LAYOUT_VERSION) {
    return {
      ok: false,
      error: {
        code: "unsupported_version",
        path: "$.version",
        message: "Shell layout version is not supported.",
      },
    }
  }
  if (!hasExactKeys(value, TOP_LEVEL_KEYS)) {
    return {
      ok: false,
      error: {
        code: "invalid_shape",
        path: "$",
        message: "Shell layout has an invalid set of properties.",
      },
    }
  }

  const leftPanel = normalizePanel(value.leftPanel, "left")
  if (!leftPanel) {
    return {
      ok: false,
      error: {
        code: "invalid_shape",
        path: "$.leftPanel",
        message: "Left panel preference is invalid.",
      },
    }
  }
  const rightPanel = normalizePanel(value.rightPanel, "right")
  if (!rightPanel) {
    return {
      ok: false,
      error: {
        code: "invalid_shape",
        path: "$.rightPanel",
        message: "Right panel preference is invalid.",
      },
    }
  }
  if (
    value.filmstripDensity !== "compact" &&
    value.filmstripDensity !== "comfortable"
  ) {
    return {
      ok: false,
      error: {
        code: "invalid_shape",
        path: "$.filmstripDensity",
        message: "Filmstrip density is invalid.",
      },
    }
  }

  return {
    ok: true,
    layout: {
      version: STUDIO_SHELL_LAYOUT_VERSION,
      leftPanel,
      rightPanel,
      filmstripDensity: value.filmstripDensity,
    },
  }
}

function asError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback)
}

function panelLimits(panel: StudioShellPanel) {
  return panel === "left"
    ? STUDIO_SHELL_LAYOUT_LIMITS.leftPanel
    : STUDIO_SHELL_LAYOUT_LIMITS.rightPanel
}

function panelKey(panel: StudioShellPanel) {
  return panel === "left" ? "leftPanel" : "rightPanel"
}

function quarantineKey(capturedAt: string) {
  return `${STUDIO_SHELL_LAYOUT_QUARANTINE_KEY_PREFIX}:${capturedAt.replaceAll(":", "-")}`
}

function availableQuarantineKey(
  storage: StudioShellLayoutStorage,
  capturedAt: string
) {
  const base = quarantineKey(capturedAt)
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}:${suffix}`
    if (storage.getItem(candidate) === null) return candidate
  }
  throw new Error("Shell layout quarantine is full for this timestamp.")
}

export function createDefaultStudioShellLayout(): StudioShellLayoutV1 {
  return {
    version: STUDIO_SHELL_LAYOUT_VERSION,
    leftPanel: {
      width: STUDIO_SHELL_LAYOUT_LIMITS.leftPanel.default,
      collapsed: false,
    },
    rightPanel: {
      width: STUDIO_SHELL_LAYOUT_LIMITS.rightPanel.default,
      collapsed: false,
    },
    filmstripDensity: "compact",
  }
}

export function parseStudioShellLayout(
  serialized: string
): StudioShellLayoutDecodeResult {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        path: "$",
        message: "Shell layout is not valid JSON.",
      },
    }
  }
  return decodeStudioShellLayoutValue(value)
}

export function encodeStudioShellLayout(layout: StudioShellLayoutV1) {
  const decoded = decodeStudioShellLayoutValue(layout)
  if (!decoded.ok) throw new Error(decoded.error.message)
  return JSON.stringify(decoded.layout)
}

export function setStudioShellPanelWidth(
  layout: StudioShellLayoutV1,
  panel: StudioShellPanel,
  width: number
): StudioShellLayoutV1 {
  if (!Number.isFinite(width)) return layout
  const limits = panelLimits(panel)
  const key = panelKey(panel)
  return {
    ...layout,
    [key]: {
      width: Math.round(clamp(width, limits.minimum, limits.maximum)),
      collapsed: false,
    },
  }
}

export function setStudioShellPanelCollapsed(
  layout: StudioShellLayoutV1,
  panel: StudioShellPanel,
  collapsed: boolean
): StudioShellLayoutV1 {
  const key = panelKey(panel)
  return {
    ...layout,
    [key]: { ...layout[key], collapsed },
  }
}

export function toggleStudioShellPanel(
  layout: StudioShellLayoutV1,
  panel: StudioShellPanel
) {
  const key = panelKey(panel)
  return setStudioShellPanelCollapsed(layout, panel, !layout[key].collapsed)
}

export function toggleStudioShellCleanMode(
  layout: StudioShellLayoutV1
): StudioShellLayoutV1 {
  const cleanModeActive =
    layout.leftPanel.collapsed && layout.rightPanel.collapsed
  return {
    ...layout,
    leftPanel: { ...layout.leftPanel, collapsed: !cleanModeActive },
    rightPanel: { ...layout.rightPanel, collapsed: !cleanModeActive },
  }
}

export function setStudioShellFilmstripDensity(
  layout: StudioShellLayoutV1,
  density: unknown
): StudioShellLayoutV1 {
  if (density !== "compact" && density !== "comfortable") return layout
  return { ...layout, filmstripDensity: density }
}

export function applyStudioShellResizeKey(
  layout: StudioShellLayoutV1,
  panel: StudioShellPanel,
  input: StudioShellResizeKeyInput
): StudioShellResizeKeyResult {
  if (
    input.key !== "ArrowLeft" &&
    input.key !== "ArrowRight" &&
    input.key !== "Home" &&
    input.key !== "End" &&
    input.key !== "Enter"
  ) {
    return { handled: false, layout }
  }

  const key = panelKey(panel)
  if (input.key === "Enter") {
    return { handled: true, layout: toggleStudioShellPanel(layout, panel) }
  }

  const limits = panelLimits(panel)
  if (input.key === "Home") {
    return {
      handled: true,
      layout: setStudioShellPanelWidth(layout, panel, limits.minimum),
    }
  }
  if (input.key === "End") {
    return {
      handled: true,
      layout: setStudioShellPanelWidth(layout, panel, limits.maximum),
    }
  }

  const step = input.shiftKey
    ? STUDIO_SHELL_RESIZE_LARGE_STEP
    : STUDIO_SHELL_RESIZE_STEP
  const dividerDirection = input.key === "ArrowLeft" ? -1 : 1
  const panelDirection = panel === "left" ? dividerDirection : -dividerDirection
  return {
    handled: true,
    layout: setStudioShellPanelWidth(
      layout,
      panel,
      layout[key].width + panelDirection * step
    ),
  }
}

/**
 * Resolves persisted preferences against the live desktop width. If even the
 * panel minimums cannot leave the canvas minimum, `canUseDesktopLayout` is
 * false so the caller can keep the compact shell instead of violating either
 * contract.
 */
export function resolveStudioShellLayout(
  layout: StudioShellLayoutV1,
  availableDesktopWidth: number
): ResolvedStudioShellLayout {
  const availableWidth = Number.isFinite(availableDesktopWidth)
    ? Math.max(0, Math.floor(availableDesktopWidth))
    : 0
  const leftMinimum = layout.leftPanel.collapsed
    ? 0
    : STUDIO_SHELL_LAYOUT_LIMITS.leftPanel.minimum
  const rightMinimum = layout.rightPanel.collapsed
    ? 0
    : STUDIO_SHELL_LAYOUT_LIMITS.rightPanel.minimum
  const splitterWidth =
    Number(!layout.leftPanel.collapsed) *
      STUDIO_SHELL_LAYOUT_LIMITS.splitter.width +
    Number(!layout.rightPanel.collapsed) *
      STUDIO_SHELL_LAYOUT_LIMITS.splitter.width
  const minimumRequiredWidth =
    leftMinimum +
    rightMinimum +
    splitterWidth +
    STUDIO_SHELL_LAYOUT_LIMITS.canvas.minimum

  if (availableWidth < minimumRequiredWidth) {
    return {
      leftPanelWidth: leftMinimum,
      rightPanelWidth: rightMinimum,
      canvasWidth: Math.max(
        0,
        availableWidth - leftMinimum - rightMinimum - splitterWidth
      ),
      minimumRequiredWidth,
      canUseDesktopLayout: false,
    }
  }

  const requestedLeft = layout.leftPanel.collapsed
    ? 0
    : clamp(
        layout.leftPanel.width,
        STUDIO_SHELL_LAYOUT_LIMITS.leftPanel.minimum,
        STUDIO_SHELL_LAYOUT_LIMITS.leftPanel.maximum
      )
  const requestedRight = layout.rightPanel.collapsed
    ? 0
    : clamp(
        layout.rightPanel.width,
        STUDIO_SHELL_LAYOUT_LIMITS.rightPanel.minimum,
        STUDIO_SHELL_LAYOUT_LIMITS.rightPanel.maximum
      )
  const panelBudget =
    availableWidth - STUDIO_SHELL_LAYOUT_LIMITS.canvas.minimum - splitterWidth
  const requestedTotal = requestedLeft + requestedRight

  if (requestedTotal <= panelBudget) {
    return {
      leftPanelWidth: requestedLeft,
      rightPanelWidth: requestedRight,
      canvasWidth: availableWidth - requestedTotal - splitterWidth,
      minimumRequiredWidth,
      canUseDesktopLayout: true,
    }
  }

  const leftExtra = requestedLeft - leftMinimum
  const rightExtra = requestedRight - rightMinimum
  const availableExtra = panelBudget - leftMinimum - rightMinimum
  const requestedExtra = leftExtra + rightExtra
  const allocatedLeftExtra =
    requestedExtra === 0
      ? 0
      : Math.floor((availableExtra * leftExtra) / requestedExtra)
  const allocatedRightExtra = availableExtra - allocatedLeftExtra
  const leftPanelWidth = leftMinimum + allocatedLeftExtra
  const rightPanelWidth = rightMinimum + allocatedRightExtra

  return {
    leftPanelWidth,
    rightPanelWidth,
    canvasWidth:
      availableWidth - leftPanelWidth - rightPanelWidth - splitterWidth,
    minimumRequiredWidth,
    canUseDesktopLayout: true,
  }
}

/**
 * Returns the live bounds for one visible desktop splitter. The effective
 * maximum keeps the other visible panel fixed and reserves both splitter
 * handles plus the canvas minimum.
 */
export function getStudioShellPanelResizeBounds(
  layout: StudioShellLayoutV1,
  panel: StudioShellPanel,
  availableDesktopWidth: number
): StudioShellPanelResizeBounds {
  const key = panelKey(panel)
  const limits = panelLimits(panel)
  const resolved = resolveStudioShellLayout(layout, availableDesktopWidth)

  if (layout[key].collapsed || !resolved.canUseDesktopLayout) {
    return {
      value: layout[key].collapsed ? 0 : resolved[`${panel}PanelWidth`],
      minimum: limits.minimum,
      maximum: limits.minimum,
      disabled: true,
    }
  }

  const availableWidth = Math.max(0, Math.floor(availableDesktopWidth))
  const oppositePanelWidth =
    panel === "left" ? resolved.rightPanelWidth : resolved.leftPanelWidth
  const splitterWidth =
    Number(!layout.leftPanel.collapsed) *
      STUDIO_SHELL_LAYOUT_LIMITS.splitter.width +
    Number(!layout.rightPanel.collapsed) *
      STUDIO_SHELL_LAYOUT_LIMITS.splitter.width
  const effectiveMaximum = clamp(
    availableWidth -
      oppositePanelWidth -
      splitterWidth -
      STUDIO_SHELL_LAYOUT_LIMITS.canvas.minimum,
    limits.minimum,
    limits.maximum
  )

  return {
    value:
      panel === "left" ? resolved.leftPanelWidth : resolved.rightPanelWidth,
    minimum: limits.minimum,
    maximum: Math.floor(effectiveMaximum),
    disabled: false,
  }
}

/**
 * Applies a pointer or keyboard resize in visible desktop coordinates. At a
 * constrained viewport it replaces stale saved preferences with the settled
 * visible widths, so later movements remain one-to-one with the splitter.
 */
export function resizeStudioShellPanelAtWidth(
  layout: StudioShellLayoutV1,
  panel: StudioShellPanel,
  width: number,
  availableDesktopWidth: number
): StudioShellLayoutV1 {
  if (!Number.isFinite(width)) return layout

  const bounds = getStudioShellPanelResizeBounds(
    layout,
    panel,
    availableDesktopWidth
  )
  if (bounds.disabled) return layout

  const resolved = resolveStudioShellLayout(layout, availableDesktopWidth)
  const nextVisibleWidth = Math.round(
    clamp(width, bounds.minimum, bounds.maximum)
  )
  const nextLeftWidth =
    panel === "left" ? nextVisibleWidth : resolved.leftPanelWidth
  const nextRightWidth =
    panel === "right" ? nextVisibleWidth : resolved.rightPanelWidth
  const nextLeftPanel = layout.leftPanel.collapsed
    ? layout.leftPanel
    : { ...layout.leftPanel, width: nextLeftWidth }
  const nextRightPanel = layout.rightPanel.collapsed
    ? layout.rightPanel
    : { ...layout.rightPanel, width: nextRightWidth }

  if (
    nextLeftPanel.width === layout.leftPanel.width &&
    nextRightPanel.width === layout.rightPanel.width
  ) {
    return layout
  }

  return {
    ...layout,
    leftPanel: nextLeftPanel,
    rightPanel: nextRightPanel,
  }
}

export function createStudioShellLayoutQuarantineRecord(
  raw: string,
  failure: StudioShellLayoutDecodeError,
  capturedAt = new Date().toISOString()
): StudioShellLayoutQuarantineRecordV1 {
  return {
    version: 1,
    sourceStorageKey: STUDIO_SHELL_LAYOUT_STORAGE_KEY,
    capturedAt,
    failure: { ...failure },
    raw,
  }
}

export function parseStudioShellLayoutQuarantineRecord(
  serialized: string | null
): StudioShellLayoutQuarantineRecordV1 | null {
  if (!serialized) return null
  try {
    const value = JSON.parse(
      serialized
    ) as Partial<StudioShellLayoutQuarantineRecordV1>
    const failure = value.failure as
      Partial<StudioShellLayoutDecodeError> | undefined
    if (
      value.version !== 1 ||
      value.sourceStorageKey !== STUDIO_SHELL_LAYOUT_STORAGE_KEY ||
      typeof value.capturedAt !== "string" ||
      typeof value.raw !== "string" ||
      !failure ||
      !["invalid_json", "invalid_shape", "unsupported_version"].includes(
        failure.code ?? ""
      ) ||
      typeof failure.path !== "string" ||
      typeof failure.message !== "string"
    ) {
      return null
    }
    return value as StudioShellLayoutQuarantineRecordV1
  } catch {
    return null
  }
}

export class StudioShellLayoutRepository {
  readonly #storage: StudioShellLayoutStorage
  readonly #now: () => string

  constructor(
    storage: StudioShellLayoutStorage,
    options: { now?: () => string } = {}
  ) {
    this.#storage = storage
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  load(): StudioShellLayoutLoadResult {
    let raw: string | null
    try {
      raw = this.#storage.getItem(STUDIO_SHELL_LAYOUT_STORAGE_KEY)
    } catch (error) {
      return {
        status: "unavailable",
        layout: createDefaultStudioShellLayout(),
        error: asError(error, "Shell layout storage could not be read."),
      }
    }
    if (raw === null) {
      return { status: "empty", layout: createDefaultStudioShellLayout() }
    }

    const decoded = parseStudioShellLayout(raw)
    if (decoded.ok) return { status: "restored", layout: decoded.layout }

    const capturedAt = this.#now()
    const quarantine = createStudioShellLayoutQuarantineRecord(
      raw,
      decoded.error,
      capturedAt
    )
    let key: string
    try {
      key = availableQuarantineKey(this.#storage, capturedAt)
      this.#storage.setItem(key, JSON.stringify(quarantine))
    } catch {
      return {
        status: "recovered",
        layout: createDefaultStudioShellLayout(),
        failure: decoded.error,
        rawPreservedAt: "source",
        quarantineKey: null,
      }
    }
    try {
      this.#storage.removeItem(STUDIO_SHELL_LAYOUT_STORAGE_KEY)
    } catch {
      // The quarantine contains an exact copy, so retaining the source is safe.
    }
    return {
      status: "recovered",
      layout: createDefaultStudioShellLayout(),
      failure: decoded.error,
      rawPreservedAt: "quarantine",
      quarantineKey: key,
    }
  }

  save(layout: StudioShellLayoutV1): StudioShellLayoutSaveResult {
    try {
      this.#storage.setItem(
        STUDIO_SHELL_LAYOUT_STORAGE_KEY,
        encodeStudioShellLayout(layout)
      )
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: asError(error, "Shell layout storage could not be written."),
      }
    }
  }
}

export function bootstrapStudioShellLayout(
  acquireStorage: () => StudioShellLayoutStorage
): StudioShellLayoutBootstrapResult {
  try {
    const repository = new StudioShellLayoutRepository(acquireStorage())
    return { repository, result: repository.load() }
  } catch (error) {
    return {
      repository: null,
      result: {
        status: "unavailable",
        layout: createDefaultStudioShellLayout(),
        error: asError(error, "Shell layout storage is unavailable."),
      },
    }
  }
}
