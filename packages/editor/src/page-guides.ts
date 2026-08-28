import type { CanvasCamera, Point, ViewportSize } from "./viewport"

export type GuideAxis = "x" | "y"

export type PageGuide = Readonly<{
  id: string
  axis: GuideAxis
  position: number
}>

export type PageSize = Readonly<{
  width: number
  height: number
}>

export type PageGuideState = Readonly<{
  guides: readonly PageGuide[]
  selectedGuideId: string | null
  hoveredGuideId: string | null
}>

export type EditorWorkspacePreferences = Readonly<{
  rulersVisible: boolean
  guidesVisible: boolean
}>

export type EditorWorkspacePageRecord = Readonly<{
  guides: readonly PageGuide[]
}>

export type EditorWorkspaceDocumentRecord = Readonly<{
  pages: Readonly<Record<string, EditorWorkspacePageRecord>>
}>

export type EditorWorkspaceRecordV1 = Readonly<{
  version: 1
  preferences: EditorWorkspacePreferences
  documents: Readonly<Record<string, EditorWorkspaceDocumentRecord>>
}>

export type EditorWorkspaceScope = readonly Readonly<{
  id: string
  pageIds: readonly string[]
}>[]

export const EDITOR_WORKSPACE_VERSION = 1 as const
export const PAGE_GUIDE_LIMIT = 256
export const EDITOR_WORKSPACE_DOCUMENT_LIMIT = 64
export const EDITOR_WORKSPACE_PAGE_LIMIT = 512
export const EDITOR_WORKSPACE_ID_LENGTH_LIMIT = 256
export const EDITOR_WORKSPACE_SERIALIZED_SIZE_LIMIT = 2 * 1024 * 1024
export const GUIDE_HISTORY_LIMIT = 100
export const GUIDE_HIT_TOLERANCE_PX = 6
export const GUIDE_DRAG_THRESHOLD_PX = 4
export const RULER_SIZE_PX = 20
export const RULER_TARGET_SPACING_PX = 80

export const DEFAULT_EDITOR_WORKSPACE_PREFERENCES: EditorWorkspacePreferences =
  Object.freeze({
    rulersVisible: true,
    guidesVisible: true,
  })

export class EditorWorkspaceDecodeError extends Error {
  readonly code:
    "invalid_json" | "invalid_shape" | "unsupported_version" | "limit_exceeded"
  readonly path: string

  constructor(
    code: EditorWorkspaceDecodeError["code"],
    path: string,
    message: string
  ) {
    super(message)
    this.name = "EditorWorkspaceDecodeError"
    this.code = code
    this.path = path
  }
}

export type EditorWorkspaceDecodeResult =
  | { ok: true; record: EditorWorkspaceRecordV1 }
  | { ok: false; error: EditorWorkspaceDecodeError }

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key)

function fail(
  code: EditorWorkspaceDecodeError["code"],
  path: string,
  message: string
): never {
  throw new EditorWorkspaceDecodeError(code, path, message)
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_shape", path, `${path} must be an object.`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string
) {
  const keys = Object.keys(value)
  if (
    keys.length !== expected.length ||
    expected.some((key) => !hasOwn(value, key))
  ) {
    fail(
      "invalid_shape",
      path,
      `${path} must contain only ${expected.join(", ")}.`
    )
  }
}

function assertBoundedId(value: string, path: string) {
  if (
    value.length === 0 ||
    value.length > EDITOR_WORKSPACE_ID_LENGTH_LIMIT ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(
      "limit_exceeded",
      path,
      `${path} must be a non-empty identifier no longer than ${EDITOR_WORKSPACE_ID_LENGTH_LIMIT} characters.`
    )
  }
}

function assertRecordKey(value: string, path: string) {
  assertBoundedId(value, path)
  if (
    value === "__proto__" ||
    value === "constructor" ||
    value === "prototype"
  ) {
    fail("invalid_shape", path, `${path} is not a safe record key.`)
  }
}

export function assertEditorWorkspaceId(value: string, path = "workspace id") {
  assertRecordKey(value, path)
}

function assertGuideAxis(axis: string): asserts axis is GuideAxis {
  if (axis !== "x" && axis !== "y")
    throw new RangeError("Guide axis must be x or y.")
}

function decodeGuide(value: unknown, path: string): PageGuide {
  const guide = asRecord(value, path)
  assertExactKeys(guide, ["id", "axis", "position"], path)
  if (typeof guide.id !== "string")
    fail("invalid_shape", `${path}.id`, `${path}.id must be a string.`)
  assertBoundedId(guide.id, `${path}.id`)
  if (guide.axis !== "x" && guide.axis !== "y") {
    fail("invalid_shape", `${path}.axis`, `${path}.axis must be x or y.`)
  }
  if (typeof guide.position !== "number" || !Number.isFinite(guide.position)) {
    fail(
      "invalid_shape",
      `${path}.position`,
      `${path}.position must be a finite number.`
    )
  }
  return { id: guide.id, axis: guide.axis, position: guide.position }
}

function decodePage(value: unknown, path: string): EditorWorkspacePageRecord {
  const page = asRecord(value, path)
  assertExactKeys(page, ["guides"], path)
  if (!Array.isArray(page.guides)) {
    fail("invalid_shape", `${path}.guides`, `${path}.guides must be an array.`)
  }
  if (page.guides.length > PAGE_GUIDE_LIMIT) {
    fail(
      "limit_exceeded",
      `${path}.guides`,
      `${path}.guides cannot contain more than ${PAGE_GUIDE_LIMIT} guides.`
    )
  }
  const ids = new Set<string>()
  const guides = page.guides.map((guide, index) => {
    const decoded = decodeGuide(guide, `${path}.guides[${index}]`)
    if (ids.has(decoded.id)) {
      fail(
        "invalid_shape",
        `${path}.guides[${index}].id`,
        `Guide id ${decoded.id} is duplicated on the page.`
      )
    }
    ids.add(decoded.id)
    return decoded
  })
  return { guides }
}

export function createEditorWorkspaceRecord(
  preferences: EditorWorkspacePreferences = DEFAULT_EDITOR_WORKSPACE_PREFERENCES
): EditorWorkspaceRecordV1 {
  if (
    typeof preferences.rulersVisible !== "boolean" ||
    typeof preferences.guidesVisible !== "boolean"
  ) {
    throw new TypeError(
      "Editor workspace preferences must contain boolean visibility values."
    )
  }
  return {
    version: EDITOR_WORKSPACE_VERSION,
    preferences: { ...preferences },
    documents: {},
  }
}

export function decodeEditorWorkspaceRecord(
  value: unknown
): EditorWorkspaceRecordV1 {
  const root = asRecord(value, "workspace")
  assertExactKeys(root, ["version", "preferences", "documents"], "workspace")
  if (root.version !== EDITOR_WORKSPACE_VERSION) {
    fail(
      "unsupported_version",
      "workspace.version",
      `Workspace version ${String(root.version)} is not supported.`
    )
  }

  const preferences = asRecord(root.preferences, "workspace.preferences")
  assertExactKeys(
    preferences,
    ["rulersVisible", "guidesVisible"],
    "workspace.preferences"
  )
  if (
    typeof preferences.rulersVisible !== "boolean" ||
    typeof preferences.guidesVisible !== "boolean"
  ) {
    fail(
      "invalid_shape",
      "workspace.preferences",
      "Workspace preferences must contain boolean visibility values."
    )
  }

  const sourceDocuments = asRecord(root.documents, "workspace.documents")
  const documentEntries = Object.entries(sourceDocuments)
  if (documentEntries.length > EDITOR_WORKSPACE_DOCUMENT_LIMIT) {
    fail(
      "limit_exceeded",
      "workspace.documents",
      `A workspace cannot contain more than ${EDITOR_WORKSPACE_DOCUMENT_LIMIT} documents.`
    )
  }
  const documents: Record<string, EditorWorkspaceDocumentRecord> = {}
  for (const [documentId, unknownDocument] of documentEntries) {
    assertRecordKey(documentId, "workspace.documents key")
    const document = asRecord(
      unknownDocument,
      `workspace.documents[${JSON.stringify(documentId)}]`
    )
    assertExactKeys(document, ["pages"], `workspace.documents.${documentId}`)
    const sourcePages = asRecord(
      document.pages,
      `workspace.documents.${documentId}.pages`
    )
    const pageEntries = Object.entries(sourcePages)
    if (pageEntries.length > EDITOR_WORKSPACE_PAGE_LIMIT) {
      fail(
        "limit_exceeded",
        `workspace.documents.${documentId}.pages`,
        `A document cannot contain more than ${EDITOR_WORKSPACE_PAGE_LIMIT} page records.`
      )
    }
    const pages: Record<string, EditorWorkspacePageRecord> = {}
    for (const [pageId, unknownPage] of pageEntries) {
      assertRecordKey(pageId, `workspace.documents.${documentId}.pages key`)
      pages[pageId] = decodePage(
        unknownPage,
        `workspace.documents.${documentId}.pages.${pageId}`
      )
    }
    documents[documentId] = { pages }
  }

  return {
    version: EDITOR_WORKSPACE_VERSION,
    preferences: {
      rulersVisible: preferences.rulersVisible,
      guidesVisible: preferences.guidesVisible,
    },
    documents,
  }
}

export function parseEditorWorkspaceRecord(
  serialized: string
): EditorWorkspaceDecodeResult {
  if (serialized.length > EDITOR_WORKSPACE_SERIALIZED_SIZE_LIMIT) {
    return {
      ok: false,
      error: new EditorWorkspaceDecodeError(
        "limit_exceeded",
        "workspace",
        `The saved workspace exceeds ${EDITOR_WORKSPACE_SERIALIZED_SIZE_LIMIT} bytes.`
      ),
    }
  }
  let value: unknown
  try {
    value = JSON.parse(serialized) as unknown
  } catch {
    return {
      ok: false,
      error: new EditorWorkspaceDecodeError(
        "invalid_json",
        "workspace",
        "The saved workspace is not valid JSON."
      ),
    }
  }
  try {
    return { ok: true, record: decodeEditorWorkspaceRecord(value) }
  } catch (error) {
    if (error instanceof EditorWorkspaceDecodeError) {
      return { ok: false, error }
    }
    return {
      ok: false,
      error: new EditorWorkspaceDecodeError(
        "invalid_shape",
        "workspace",
        "The saved workspace could not be decoded."
      ),
    }
  }
}

export function encodeEditorWorkspaceRecord(
  record: EditorWorkspaceRecordV1
): string {
  const serialized = JSON.stringify(decodeEditorWorkspaceRecord(record))
  if (serialized.length > EDITOR_WORKSPACE_SERIALIZED_SIZE_LIMIT) {
    fail(
      "limit_exceeded",
      "workspace",
      `The saved workspace exceeds ${EDITOR_WORKSPACE_SERIALIZED_SIZE_LIMIT} bytes.`
    )
  }
  return serialized
}

export function pruneEditorWorkspaceRecord(
  record: EditorWorkspaceRecordV1,
  scope: EditorWorkspaceScope
): EditorWorkspaceRecordV1 {
  const source = decodeEditorWorkspaceRecord(record)
  if (scope.length > EDITOR_WORKSPACE_DOCUMENT_LIMIT) {
    throw new RangeError(
      `Workspace scope cannot contain more than ${EDITOR_WORKSPACE_DOCUMENT_LIMIT} documents.`
    )
  }
  const seenDocuments = new Set<string>()
  const documents: Record<string, EditorWorkspaceDocumentRecord> = {}
  for (const documentScope of scope) {
    assertRecordKey(documentScope.id, "workspace scope document id")
    if (seenDocuments.has(documentScope.id))
      throw new Error(
        `Document ${documentScope.id} is duplicated in workspace scope.`
      )
    seenDocuments.add(documentScope.id)
    if (documentScope.pageIds.length > EDITOR_WORKSPACE_PAGE_LIMIT) {
      throw new RangeError(
        `Workspace scope cannot contain more than ${EDITOR_WORKSPACE_PAGE_LIMIT} pages per document.`
      )
    }
    if (!hasOwn(source.documents, documentScope.id)) continue
    const sourceDocument = source.documents[documentScope.id]
    const seenPages = new Set<string>()
    const pages: Record<string, EditorWorkspacePageRecord> = {}
    for (const pageId of documentScope.pageIds) {
      assertRecordKey(pageId, "workspace scope page id")
      if (seenPages.has(pageId))
        throw new Error(
          `Page ${pageId} is duplicated in workspace scope for ${documentScope.id}.`
        )
      seenPages.add(pageId)
      if (hasOwn(sourceDocument.pages, pageId)) {
        pages[pageId] = {
          guides: sourceDocument.pages[pageId].guides.map((guide) => ({
            ...guide,
          })),
        }
      }
    }
    if (Object.keys(pages).length > 0) documents[documentScope.id] = { pages }
  }
  return decodeEditorWorkspaceRecord({ ...source, documents })
}

function assertPageSize(page: PageSize) {
  if (
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width < 0 ||
    page.height < 0
  ) {
    throw new RangeError("Page dimensions must be finite non-negative numbers.")
  }
}

function assertGuideList(guides: readonly PageGuide[]) {
  decodePage({ guides }, "page")
}

export function clampGuidePosition(
  axis: GuideAxis,
  position: number,
  page: PageSize
) {
  assertGuideAxis(axis)
  assertPageSize(page)
  if (!Number.isFinite(position))
    throw new RangeError("Guide position must be finite.")
  return Math.min(
    axis === "x" ? page.width : page.height,
    Math.max(0, position)
  )
}

export function addPageGuide(
  guides: readonly PageGuide[],
  guide: PageGuide,
  page: PageSize
): PageGuide[] {
  assertGuideList(guides)
  const decoded = decodeGuide(guide, "guide")
  if (guides.length >= PAGE_GUIDE_LIMIT)
    throw new RangeError(
      `A page cannot contain more than ${PAGE_GUIDE_LIMIT} guides.`
    )
  if (guides.some((candidate) => candidate.id === decoded.id))
    throw new Error(`Guide id ${decoded.id} already exists on this page.`)
  return [
    ...guides.map((candidate) => ({ ...candidate })),
    {
      ...decoded,
      position: clampGuidePosition(decoded.axis, decoded.position, page),
    },
  ]
}

export function movePageGuide(
  guides: readonly PageGuide[],
  guideId: string,
  position: number,
  page: PageSize
): PageGuide[] {
  assertGuideList(guides)
  assertBoundedId(guideId, "guideId")
  const index = guides.findIndex((guide) => guide.id === guideId)
  if (index === -1) return guides.map((guide) => ({ ...guide }))
  const nextPosition = clampGuidePosition(guides[index]!.axis, position, page)
  return guides.map((guide, guideIndex) =>
    guideIndex === index ? { ...guide, position: nextPosition } : { ...guide }
  )
}

export function removePageGuide(
  guides: readonly PageGuide[],
  guideId: string
): PageGuide[] {
  assertGuideList(guides)
  assertBoundedId(guideId, "guideId")
  return guides
    .filter((guide) => guide.id !== guideId)
    .map((guide) => ({ ...guide }))
}

export function duplicatePageGuide(
  guides: readonly PageGuide[],
  sourceGuideId: string,
  duplicateGuideId: string,
  position: number,
  page: PageSize
): PageGuide[] {
  const source = guides.find((guide) => guide.id === sourceGuideId)
  if (!source) return guides.map((guide) => ({ ...guide }))
  return addPageGuide(
    guides,
    { id: duplicateGuideId, axis: source.axis, position },
    page
  )
}

function assertCamera(camera: CanvasCamera) {
  if (
    !Number.isFinite(camera.x) ||
    !Number.isFinite(camera.y) ||
    !Number.isFinite(camera.zoom) ||
    camera.zoom <= 0
  ) {
    throw new RangeError(
      "Canvas camera must have finite coordinates and positive zoom."
    )
  }
}

function assertPoint(point: Point, name: string) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new RangeError(`${name} must contain finite coordinates.`)
}

export function pagePointToScreen(point: Point, camera: CanvasCamera): Point {
  assertPoint(point, "Page point")
  assertCamera(camera)
  return {
    x: camera.x + point.x * camera.zoom,
    y: camera.y + point.y * camera.zoom,
  }
}

export function screenPointToPage(point: Point, camera: CanvasCamera): Point {
  assertPoint(point, "Screen point")
  assertCamera(camera)
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  }
}

export function pageGuideScreenPosition(
  guide: Pick<PageGuide, "axis" | "position">,
  camera: CanvasCamera
) {
  assertGuideAxis(guide.axis)
  assertCamera(camera)
  if (!Number.isFinite(guide.position))
    throw new RangeError("Guide position must be finite.")
  return (
    guide.position * camera.zoom + (guide.axis === "x" ? camera.x : camera.y)
  )
}

export function rulerAxisAtScreenPoint(
  point: Point,
  rulerSize = RULER_SIZE_PX
): GuideAxis | null {
  assertPoint(point, "Screen point")
  if (!Number.isFinite(rulerSize) || rulerSize < 0)
    throw new RangeError("Ruler size must be a finite non-negative number.")
  if (point.x < 0 || point.y < 0) return null
  if (point.x < rulerSize && point.y < rulerSize) return null
  if (point.y < rulerSize) return "y"
  if (point.x < rulerSize) return "x"
  return null
}

export function rulerStep(
  zoom: number,
  targetSpacing = RULER_TARGET_SPACING_PX
) {
  if (!Number.isFinite(zoom) || zoom <= 0)
    throw new RangeError("Ruler zoom must be a finite positive number.")
  if (!Number.isFinite(targetSpacing) || targetSpacing <= 0)
    throw new RangeError(
      "Ruler target spacing must be a finite positive number."
    )
  const rawStep = targetSpacing / zoom
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  if (normalized <= 1) return magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

export type RulerTick = Readonly<{
  value: number
  screen: number
  major: boolean
  label: string | null
}>

export function formatRulerLabel(value: number, majorStep: number) {
  if (!Number.isFinite(value) || !Number.isFinite(majorStep) || majorStep <= 0)
    throw new RangeError(
      "Ruler labels require finite values and a positive step."
    )
  const decimals = Math.min(8, Math.max(0, Math.ceil(-Math.log10(majorStep))))
  const rounded = Number(value.toFixed(decimals))
  return Object.is(rounded, -0) ? "0" : String(rounded)
}

export function buildRulerTicks({
  axis,
  camera,
  viewportLength,
  rulerSize = RULER_SIZE_PX,
  targetSpacing = RULER_TARGET_SPACING_PX,
  minorDivisions = 5,
}: {
  axis: GuideAxis
  camera: CanvasCamera
  viewportLength: number
  rulerSize?: number
  targetSpacing?: number
  minorDivisions?: number
}): RulerTick[] {
  assertGuideAxis(axis)
  assertCamera(camera)
  if (!Number.isFinite(viewportLength) || viewportLength < 0)
    throw new RangeError(
      "Viewport length must be a finite non-negative number."
    )
  if (!Number.isFinite(rulerSize) || rulerSize < 0)
    throw new RangeError("Ruler size must be a finite non-negative number.")
  if (
    !Number.isInteger(minorDivisions) ||
    minorDivisions < 1 ||
    minorDivisions > 10
  )
    throw new RangeError(
      "Minor divisions must be an integer from 1 through 10."
    )
  if (viewportLength <= rulerSize) return []

  const offset = axis === "x" ? camera.x : camera.y
  const majorStep = rulerStep(camera.zoom, targetSpacing)
  const minorStep = majorStep / minorDivisions
  const worldStart = (rulerSize - offset) / camera.zoom
  const worldEnd = (viewportLength - offset) / camera.zoom
  const startIndex = Math.ceil(worldStart / minorStep - 1e-10)
  const endIndex = Math.floor(worldEnd / minorStep + 1e-10)
  if (endIndex - startIndex > 10_000)
    throw new RangeError("The requested ruler range contains too many ticks.")

  const ticks: RulerTick[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    const major =
      ((index % minorDivisions) + minorDivisions) % minorDivisions === 0
    const value = index * minorStep
    const normalizedValue = Math.abs(value) < minorStep * 1e-10 ? 0 : value
    ticks.push({
      value: normalizedValue,
      screen: offset + normalizedValue * camera.zoom,
      major,
      label: major ? formatRulerLabel(normalizedValue, majorStep) : null,
    })
  }
  return ticks
}

export type PageGuideHit = Readonly<{
  guide: PageGuide
  distance: number
}>

export function hitTestPageGuides(
  guides: readonly PageGuide[],
  point: Point,
  camera: CanvasCamera,
  viewport: ViewportSize,
  tolerance = GUIDE_HIT_TOLERANCE_PX
): PageGuideHit | null {
  assertGuideList(guides)
  assertPoint(point, "Screen point")
  assertCamera(camera)
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width < 0 ||
    viewport.height < 0
  ) {
    throw new RangeError(
      "Viewport dimensions must be finite non-negative numbers."
    )
  }
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new RangeError("Guide hit tolerance must be finite and non-negative.")
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x > viewport.width ||
    point.y > viewport.height
  ) {
    return null
  }

  let closest: PageGuideHit | null = null
  for (const guide of guides) {
    const position = pageGuideScreenPosition(guide, camera)
    const distance = Math.abs(
      (guide.axis === "x" ? point.x : point.y) - position
    )
    if (distance <= tolerance && (!closest || distance < closest.distance)) {
      closest = { guide: { ...guide }, distance }
    }
  }
  return closest
}

type GuideDragSource =
  | Readonly<{ kind: "ruler" }>
  | Readonly<{
      kind: "guide"
      guideId: string
      originalPosition: number
      duplicate: boolean
    }>

export type PageGuideDrag = Readonly<{
  axis: GuideAxis
  source: GuideDragSource
  startScreen: Point
  currentScreen: Point
  currentPage: Point
  position: number
  dragStarted: boolean
}>

export type PageGuideDragSettlement =
  | Readonly<{ type: "none" }>
  | Readonly<{ type: "cancel" }>
  | Readonly<{ type: "add"; axis: GuideAxis; position: number }>
  | Readonly<{ type: "move"; guideId: string; position: number }>
  | Readonly<{ type: "duplicate"; guideId: string; position: number }>
  | Readonly<{ type: "remove"; guideId: string }>

export function beginRulerGuideDrag(
  axis: GuideAxis,
  startScreen: Point,
  camera: CanvasCamera
): PageGuideDrag {
  assertGuideAxis(axis)
  const currentPage = screenPointToPage(startScreen, camera)
  return {
    axis,
    source: { kind: "ruler" },
    startScreen: { ...startScreen },
    currentScreen: { ...startScreen },
    currentPage,
    position: axis === "x" ? currentPage.x : currentPage.y,
    dragStarted: false,
  }
}

export function beginExistingGuideDrag(
  guide: PageGuide,
  startScreen: Point,
  camera: CanvasCamera,
  options: { duplicate?: boolean } = {}
): PageGuideDrag {
  const decoded = decodeGuide(guide, "guide")
  const currentPage = screenPointToPage(startScreen, camera)
  return {
    axis: decoded.axis,
    source: {
      kind: "guide",
      guideId: decoded.id,
      originalPosition: decoded.position,
      duplicate: options.duplicate ?? false,
    },
    startScreen: { ...startScreen },
    currentScreen: { ...startScreen },
    currentPage,
    position: decoded.position,
    dragStarted: false,
  }
}

export function updatePageGuideDrag(
  drag: PageGuideDrag,
  currentScreen: Point,
  camera: CanvasCamera,
  threshold = GUIDE_DRAG_THRESHOLD_PX
): PageGuideDrag {
  assertPoint(currentScreen, "Screen point")
  if (!Number.isFinite(threshold) || threshold < 0)
    throw new RangeError(
      "Guide drag threshold must be finite and non-negative."
    )
  const currentPage = screenPointToPage(currentScreen, camera)
  const dragStarted =
    drag.dragStarted ||
    Math.hypot(
      currentScreen.x - drag.startScreen.x,
      currentScreen.y - drag.startScreen.y
    ) >= threshold
  return {
    ...drag,
    currentScreen: { ...currentScreen },
    currentPage,
    position: dragStarted
      ? drag.axis === "x"
        ? currentPage.x
        : currentPage.y
      : drag.position,
    dragStarted,
  }
}

function isInSourceRuler(drag: PageGuideDrag, rulerSize: number) {
  return drag.axis === "x"
    ? drag.currentScreen.x >= 0 && drag.currentScreen.x < rulerSize
    : drag.currentScreen.y >= 0 && drag.currentScreen.y < rulerSize
}

export function settlePageGuideDrag(
  drag: PageGuideDrag,
  {
    pageSize,
    rulerSize = RULER_SIZE_PX,
  }: { pageSize: PageSize; rulerSize?: number }
): PageGuideDragSettlement {
  assertPageSize(pageSize)
  if (!Number.isFinite(rulerSize) || rulerSize < 0)
    throw new RangeError("Ruler size must be a finite non-negative number.")
  if (!drag.dragStarted) return { type: "none" }

  if (isInSourceRuler(drag, rulerSize)) {
    return drag.source.kind === "guide" && !drag.source.duplicate
      ? { type: "remove", guideId: drag.source.guideId }
      : { type: "cancel" }
  }

  if (
    drag.currentPage.x < 0 ||
    drag.currentPage.y < 0 ||
    drag.currentPage.x > pageSize.width ||
    drag.currentPage.y > pageSize.height
  ) {
    return { type: "cancel" }
  }

  const position = clampGuidePosition(drag.axis, drag.position, pageSize)
  if (drag.source.kind === "ruler") {
    return { type: "add", axis: drag.axis, position }
  }
  if (drag.source.duplicate) {
    return { type: "duplicate", guideId: drag.source.guideId, position }
  }
  if (position === drag.source.originalPosition) return { type: "none" }
  return { type: "move", guideId: drag.source.guideId, position }
}

export type GuideHistoryEntry = Readonly<{
  id: string
  documentId: string
  pageId: string
  label: string
  committedAt: number
  before: readonly PageGuide[]
  after: readonly PageGuide[]
}>

export type GuideHistory = Readonly<{
  past: readonly GuideHistoryEntry[]
  future: readonly GuideHistoryEntry[]
  limit: number
}>

export type GuideHistoryChange = Omit<GuideHistoryEntry, "id"> & {
  id?: string
}

export type GuideHistorySettlement = Readonly<{
  history: GuideHistory
  entry: GuideHistoryEntry | null
  guides: readonly PageGuide[] | null
}>

const copyGuides = (guides: readonly PageGuide[]) =>
  guides.map((guide) => ({ ...guide }))

function sameGuides(left: readonly PageGuide[], right: readonly PageGuide[]) {
  return (
    left.length === right.length &&
    left.every(
      (guide, index) =>
        guide.id === right[index]?.id &&
        guide.axis === right[index]?.axis &&
        guide.position === right[index]?.position
    )
  )
}

export function createGuideHistory(limit = GUIDE_HISTORY_LIMIT): GuideHistory {
  if (!Number.isInteger(limit) || limit < 1 || limit > GUIDE_HISTORY_LIMIT)
    throw new RangeError(
      `Guide history limit must be from 1 through ${GUIDE_HISTORY_LIMIT}.`
    )
  return { past: [], future: [], limit }
}

export function commitGuideHistory(
  history: GuideHistory,
  change: GuideHistoryChange
): GuideHistory {
  if (
    !Number.isInteger(history.limit) ||
    history.limit < 1 ||
    history.limit > GUIDE_HISTORY_LIMIT
  ) {
    throw new RangeError(
      `Guide history limit must be from 1 through ${GUIDE_HISTORY_LIMIT}.`
    )
  }
  assertGuideList(change.before)
  assertGuideList(change.after)
  assertBoundedId(change.documentId, "documentId")
  assertBoundedId(change.pageId, "pageId")
  if (
    change.label.length === 0 ||
    change.label.length > EDITOR_WORKSPACE_ID_LENGTH_LIMIT
  )
    throw new RangeError(
      "Guide history label must be from 1 through 256 characters."
    )
  if (!Number.isFinite(change.committedAt))
    throw new RangeError("Guide history timestamp must be finite.")
  if (sameGuides(change.before, change.after)) return history
  const entry: GuideHistoryEntry = {
    ...change,
    id: change.id ?? `guide-transaction-${crypto.randomUUID()}`,
    before: copyGuides(change.before),
    after: copyGuides(change.after),
  }
  assertBoundedId(entry.id, "history entry id")
  return {
    ...history,
    past: [...history.past, entry].slice(-history.limit),
    future: [],
  }
}

export function undoGuideHistory(
  history: GuideHistory
): GuideHistorySettlement {
  const entry = history.past.at(-1) ?? null
  if (!entry) return { history, entry: null, guides: null }
  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [entry, ...history.future].slice(0, history.limit),
    },
    entry,
    guides: copyGuides(entry.before),
  }
}

export function redoGuideHistory(
  history: GuideHistory
): GuideHistorySettlement {
  const entry = history.future[0] ?? null
  if (!entry) return { history, entry: null, guides: null }
  return {
    history: {
      ...history,
      past: [...history.past, entry].slice(-history.limit),
      future: history.future.slice(1),
    },
    entry,
    guides: copyGuides(entry.after),
  }
}
