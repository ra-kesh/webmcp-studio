import { describe, expect, it } from "vitest"
import {
  EDITOR_WORKSPACE_ID_LENGTH_LIMIT,
  EDITOR_WORKSPACE_SERIALIZED_SIZE_LIMIT,
  GUIDE_DRAG_THRESHOLD_PX,
  PAGE_GUIDE_LIMIT,
  addPageGuide,
  beginExistingGuideDrag,
  beginRulerGuideDrag,
  buildRulerTicks,
  commitGuideHistory,
  createEditorWorkspaceRecord,
  createGuideHistory,
  decodeEditorWorkspaceRecord,
  duplicatePageGuide,
  encodeEditorWorkspaceRecord,
  formatRulerLabel,
  hitTestPageGuides,
  movePageGuide,
  pageGuideScreenPosition,
  pagePointToScreen,
  parseEditorWorkspaceRecord,
  pruneEditorWorkspaceRecord,
  redoGuideHistory,
  removePageGuide,
  rulerAxisAtScreenPoint,
  rulerStep,
  screenPointToPage,
  settlePageGuideDrag,
  undoGuideHistory,
  updatePageGuideDrag,
  type EditorWorkspaceRecordV1,
  type PageGuide,
} from "../src/page-guides"

const page = { width: 1240, height: 1754 }
const camera = { x: 120, y: -40, zoom: 0.5 }

const guide = (id: string, axis: "x" | "y", position: number): PageGuide => ({
  id,
  axis,
  position,
})

describe("editor workspace codec", () => {
  it("round-trips only stable preferences and page-local guide records", () => {
    const source: EditorWorkspaceRecordV1 = {
      version: 1,
      preferences: { rulersVisible: false, guidesVisible: true },
      documents: {
        quotation: {
          pages: {
            cover: {
              guides: [
                guide("guide-left", "x", 92),
                guide("guide-title", "y", 310),
              ],
            },
          },
        },
      },
    }

    expect(
      parseEditorWorkspaceRecord(encodeEditorWorkspaceRecord(source))
    ).toEqual({
      ok: true,
      record: source,
    })
    expect(encodeEditorWorkspaceRecord(source)).not.toContain("hover")
    expect(encodeEditorWorkspaceRecord(source)).not.toContain("camera")
    expect(createEditorWorkspaceRecord()).toEqual({
      version: 1,
      preferences: { rulersVisible: true, guidesVisible: true },
      documents: {},
    })
  })

  it("rejects unknown fields, unsupported versions, unsafe keys, and malformed JSON", () => {
    expect(() =>
      decodeEditorWorkspaceRecord({
        ...createEditorWorkspaceRecord(),
        selectedGuideId: "transient-state",
      })
    ).toThrow(/must contain only/)
    expect(() =>
      decodeEditorWorkspaceRecord({
        ...createEditorWorkspaceRecord(),
        version: 2,
      })
    ).toThrow(/not supported/)
    expect(() =>
      decodeEditorWorkspaceRecord({
        ...createEditorWorkspaceRecord(),
        documents: JSON.parse('{"__proto__":{"pages":{}}}') as unknown,
      })
    ).toThrow(/safe record key/)
    expect(parseEditorWorkspaceRecord('{"version":')).toMatchObject({
      ok: false,
      error: { code: "invalid_json" },
    })
  })

  it("rejects duplicate guide ids, invalid axes, non-finite positions, and oversized data", () => {
    const workspace = (guides: unknown[]) => ({
      version: 1,
      preferences: { rulersVisible: true, guidesVisible: true },
      documents: { document: { pages: { page: { guides } } } },
    })
    expect(() =>
      decodeEditorWorkspaceRecord(
        workspace([guide("same", "x", 1), guide("same", "y", 2)])
      )
    ).toThrow(/duplicated/)
    expect(() =>
      decodeEditorWorkspaceRecord(
        workspace([{ id: "g", axis: "z", position: 1 }])
      )
    ).toThrow(/must be x or y/)
    expect(() =>
      decodeEditorWorkspaceRecord(
        workspace([{ id: "g", axis: "x", position: NaN }])
      )
    ).toThrow(/finite/)
    expect(() =>
      decodeEditorWorkspaceRecord(
        workspace(
          Array.from({ length: PAGE_GUIDE_LIMIT + 1 }, (_, index) =>
            guide(`g-${index}`, "x", index)
          )
        )
      )
    ).toThrow(/cannot contain more/)
    expect(() =>
      decodeEditorWorkspaceRecord(
        workspace([
          guide("g".repeat(EDITOR_WORKSPACE_ID_LENGTH_LIMIT + 1), "x", 1),
        ])
      )
    ).toThrow(/no longer than/)
    expect(
      parseEditorWorkspaceRecord(
        " ".repeat(EDITOR_WORKSPACE_SERIALIZED_SIZE_LIMIT + 1)
      )
    ).toMatchObject({ ok: false, error: { code: "limit_exceeded" } })
  })

  it("prunes absent documents and pages with a strict bounded scope", () => {
    const source: EditorWorkspaceRecordV1 = {
      version: 1,
      preferences: { rulersVisible: true, guidesVisible: true },
      documents: {
        current: {
          pages: {
            keep: { guides: [guide("keep", "x", 10)] },
            deleted: { guides: [guide("deleted", "y", 20)] },
          },
        },
        replaced: { pages: { old: { guides: [guide("old", "x", 30)] } } },
      },
    }
    const pruned = pruneEditorWorkspaceRecord(source, [
      { id: "current", pageIds: ["keep"] },
    ])
    expect(Object.keys(pruned.documents)).toEqual(["current"])
    expect(Object.keys(pruned.documents.current.pages)).toEqual(["keep"])
    expect(() =>
      pruneEditorWorkspaceRecord(source, [
        { id: "current", pageIds: ["keep", "keep"] },
      ])
    ).toThrow(/duplicated/)
  })

  it("refuses to encode a record that cannot be read back within the byte bound", () => {
    const documents = Object.fromEntries(
      Array.from({ length: 32 }, (_, documentIndex) => [
        `document-${documentIndex}`,
        {
          pages: {
            page: {
              guides: Array.from(
                { length: PAGE_GUIDE_LIMIT },
                (_, guideIndex) => ({
                  id: `${documentIndex}-${guideIndex}`.padEnd(
                    EDITOR_WORKSPACE_ID_LENGTH_LIMIT,
                    "x"
                  ),
                  axis: "x" as const,
                  position: guideIndex,
                })
              ),
            },
          },
        },
      ])
    )
    expect(() =>
      encodeEditorWorkspaceRecord({
        version: 1,
        preferences: { rulersVisible: true, guidesVisible: true },
        documents,
      })
    ).toThrow(/exceeds/)
  })
})

describe("page guide operations", () => {
  it("adds, moves, duplicates, and removes guides without mutating an input array", () => {
    const source = [guide("source", "x", 100)]
    const added = addPageGuide(source, guide("edge", "y", 2_000), page)
    const moved = movePageGuide(added, "source", -20, page)
    const duplicated = duplicatePageGuide(moved, "source", "copy", 500, page)
    const removed = removePageGuide(duplicated, "edge")

    expect(source).toEqual([guide("source", "x", 100)])
    expect(added[1]).toEqual(guide("edge", "y", page.height))
    expect(moved[0]).toEqual(guide("source", "x", 0))
    expect(duplicated.at(-1)).toEqual(guide("copy", "x", 500))
    expect(removed.map(({ id }) => id)).toEqual(["source", "copy"])
  })

  it("rejects duplicate ids and refuses to exceed the per-page bound", () => {
    expect(() =>
      addPageGuide([guide("same", "x", 1)], guide("same", "y", 2), page)
    ).toThrow(/already exists/)
    const full = Array.from({ length: PAGE_GUIDE_LIMIT }, (_, index) =>
      guide(`g-${index}`, "x", index)
    )
    expect(() => addPageGuide(full, guide("overflow", "x", 1), page)).toThrow(
      /cannot contain more/
    )
    expect(() =>
      addPageGuide(
        [],
        { id: "bad-axis", axis: "z", position: 1 } as never,
        page
      )
    ).toThrow(/must be x or y/)
  })
})

describe("guide coordinates, rulers, and hit testing", () => {
  it.each([0.1, 0.25, 0.4375, 1, 4])(
    "round-trips page and screen coordinates at zoom %s",
    (zoom) => {
      const activeCamera = { x: -247.25, y: 83.5, zoom }
      const point = { x: 713.75, y: -91.125 }
      const screen = pagePointToScreen(point, activeCamera)
      const restored = screenPointToPage(screen, activeCamera)
      expect(restored.x).toBeCloseTo(point.x, 10)
      expect(restored.y).toBeCloseTo(point.y, 10)
    }
  )

  it("maps the top and left ruler strips without claiming their corner", () => {
    expect(rulerAxisAtScreenPoint({ x: 100, y: 5 })).toBe("y")
    expect(rulerAxisAtScreenPoint({ x: 5, y: 100 })).toBe("x")
    expect(rulerAxisAtScreenPoint({ x: 5, y: 5 })).toBeNull()
    expect(rulerAxisAtScreenPoint({ x: 20, y: 20 })).toBeNull()
  })

  it("uses the 1/2/5 sequence and emits stable negative, zero, major, and minor ticks", () => {
    expect([0.1, 0.25, 0.4375, 1, 4].map((zoom) => rulerStep(zoom))).toEqual([
      1_000, 500, 200, 100, 20,
    ])
    const ticks = buildRulerTicks({
      axis: "x",
      camera: { x: 120, y: 0, zoom: 1 },
      viewportLength: 420,
    })
    expect(ticks.some((tick) => tick.value < 0 && tick.major)).toBe(true)
    expect(ticks.find((tick) => tick.value === 0)).toMatchObject({
      screen: 120,
      major: true,
      label: "0",
    })
    expect(ticks.some((tick) => !tick.major && tick.label === null)).toBe(true)
    expect(formatRulerLabel(-0, 0.5)).toBe("0")
    expect(formatRulerLabel(1.5, 0.5)).toBe("1.5")
  })

  it.each([0.1, 1, 4])("keeps a six-pixel hit target at zoom %s", (zoom) => {
    const activeCamera = { x: 40, y: 30, zoom }
    const guides = [guide("vertical", "x", 100)]
    const screen = pageGuideScreenPosition(guides[0]!, activeCamera)
    expect(
      hitTestPageGuides(guides, { x: screen + 5.999, y: 200 }, activeCamera, {
        width: 800,
        height: 600,
      })?.guide.id
    ).toBe("vertical")
    expect(
      hitTestPageGuides(guides, { x: screen + 6.001, y: 200 }, activeCamera, {
        width: 800,
        height: 600,
      })
    ).toBeNull()
  })
})

describe("page guide drag state", () => {
  it("does nothing for a ruler click that never crosses the drag threshold", () => {
    const drag = beginRulerGuideDrag("y", { x: 100, y: 5 }, camera)
    const moved = updatePageGuideDrag(
      drag,
      { x: 100, y: 5 + GUIDE_DRAG_THRESHOLD_PX - 0.01 },
      camera
    )
    expect(moved.dragStarted).toBe(false)
    expect(settlePageGuideDrag(moved, { pageSize: page })).toEqual({
      type: "none",
    })
  })

  it("publishes an add settlement only after crossing the drag threshold", () => {
    const drag = updatePageGuideDrag(
      beginRulerGuideDrag("y", { x: 200, y: 5 }, { x: 0, y: 0, zoom: 1 }),
      { x: 200, y: 300 },
      { x: 0, y: 0, zoom: 1 }
    )
    expect(drag.dragStarted).toBe(true)
    expect(settlePageGuideDrag(drag, { pageSize: page })).toEqual({
      type: "add",
      axis: "y",
      position: 300,
    })
  })

  it("moves, duplicates, removes, and cancels existing guide drags truthfully", () => {
    const source = guide("source", "x", 100)
    const move = updatePageGuideDrag(
      beginExistingGuideDrag(source, { x: 170, y: 200 }, camera),
      { x: 220, y: 200 },
      camera
    )
    expect(settlePageGuideDrag(move, { pageSize: page })).toEqual({
      type: "move",
      guideId: "source",
      position: 200,
    })

    const duplicate = updatePageGuideDrag(
      beginExistingGuideDrag(source, { x: 170, y: 200 }, camera, {
        duplicate: true,
      }),
      { x: 245, y: 200 },
      camera
    )
    expect(settlePageGuideDrag(duplicate, { pageSize: page })).toEqual({
      type: "duplicate",
      guideId: "source",
      position: 250,
    })

    const inRuler = updatePageGuideDrag(move, { x: 5, y: 200 }, camera)
    expect(settlePageGuideDrag(inRuler, { pageSize: page })).toEqual({
      type: "remove",
      guideId: "source",
    })
    const duplicateInRuler = updatePageGuideDrag(
      duplicate,
      { x: 5, y: 200 },
      camera
    )
    expect(settlePageGuideDrag(duplicateInRuler, { pageSize: page })).toEqual({
      type: "cancel",
    })

    const outsidePage = updatePageGuideDrag(move, { x: 900, y: -100 }, camera)
    expect(settlePageGuideDrag(outsidePage, { pageSize: page })).toEqual({
      type: "cancel",
    })
  })
})

describe("bounded guide history", () => {
  it("undoes and redoes exact page-local arrays without document copies", () => {
    const before = [guide("a", "x", 10)]
    const after = [guide("a", "x", 40)]
    const committed = commitGuideHistory(createGuideHistory(2), {
      id: "move-a",
      documentId: "document",
      pageId: "cover",
      label: "Move guide",
      committedAt: 10,
      before,
      after,
    })
    before[0] = guide("mutated", "y", 0)
    after[0] = guide("mutated", "y", 0)

    const undone = undoGuideHistory(committed)
    expect(undone.guides).toEqual([guide("a", "x", 10)])
    expect(undone.entry).toMatchObject({
      documentId: "document",
      pageId: "cover",
    })
    expect(redoGuideHistory(undone.history).guides).toEqual([
      guide("a", "x", 40),
    ])
  })

  it("bounds past and future entries and clears redo on a new commit", () => {
    let history = createGuideHistory(2)
    for (let index = 0; index < 3; index += 1) {
      history = commitGuideHistory(history, {
        id: `entry-${index}`,
        documentId: "document",
        pageId: "cover",
        label: "Move guide",
        committedAt: index,
        before: [guide("a", "x", index)],
        after: [guide("a", "x", index + 1)],
      })
    }
    expect(history.past.map(({ id }) => id)).toEqual(["entry-1", "entry-2"])
    const undone = undoGuideHistory(history)
    const replaced = commitGuideHistory(undone.history, {
      id: "replacement",
      documentId: "document",
      pageId: "cover",
      label: "Move guide",
      committedAt: 10,
      before: [guide("a", "x", 2)],
      after: [guide("a", "x", 20)],
    })
    expect(replaced.future).toEqual([])
  })
})
