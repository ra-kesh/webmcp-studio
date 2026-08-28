import { describe, expect, it } from "vitest"
import {
  CanvasTransformSessionController,
  canvasTransformGeometryChanged,
  type CanvasTransformGeometry,
} from "../src/transform-session"

const first: CanvasTransformGeometry = {
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  rotation: 0,
}

const second: CanvasTransformGeometry = {
  x: 200,
  y: 120,
  width: 60,
  height: 40,
  rotation: 15,
}

const context = { documentId: "document-1", pageId: "page-1" }

describe("CanvasTransformSessionController", () => {
  it("captures an immutable single-selection baseline", () => {
    const controller = new CanvasTransformSessionController()
    const source = new Map([["node-1", first]])

    const result = controller.begin({
      ...context,
      kind: "move",
      baseline: source,
    })
    source.set("node-1", { ...first, x: 999 })

    expect(result.status).toBe("started")
    expect(controller.active).toMatchObject({
      ...context,
      kind: "move",
      nodeIds: ["node-1"],
      phase: "active",
    })
    expect(controller.active?.baseline.get("node-1")).toEqual(first)
  })

  it("preserves ordered multi-selection geometry", () => {
    const controller = new CanvasTransformSessionController()
    controller.begin({
      ...context,
      kind: "resize",
      baseline: new Map([
        ["node-2", second],
        ["node-1", first],
      ]),
    })

    expect(controller.active?.nodeIds).toEqual(["node-2", "node-1"])
    expect([...controller.active!.baseline]).toEqual([
      ["node-2", second],
      ["node-1", first],
    ])
  })

  it("rejects an empty begin and preserves the first session on duplicate begin", () => {
    const controller = new CanvasTransformSessionController()
    expect(
      controller.begin({
        ...context,
        kind: "move",
        baseline: new Map(),
      })
    ).toEqual({ status: "empty" })

    const started = controller.begin({
      ...context,
      kind: "move",
      baseline: new Map([["node-1", first]]),
    })
    const duplicate = controller.begin({
      ...context,
      kind: "rotate",
      baseline: new Map([["node-2", second]]),
    })

    expect(started.status).toBe("started")
    expect(duplicate).toEqual({
      status: "duplicate",
      session: controller.active,
    })
    expect(controller.active?.nodeIds).toEqual(["node-1"])
  })

  it("cancels once, rejects commit-after-cancel, and then releases", () => {
    const controller = new CanvasTransformSessionController()
    controller.begin({
      ...context,
      kind: "rotate",
      baseline: new Map([["node-1", first]]),
    })

    expect(controller.cancel(context).status).toBe("cancelled")
    expect(controller.active?.phase).toBe("cancelled")
    expect(controller.cancel(context).status).toBe("already_cancelled")
    expect(controller.commit(context).status).toBe("already_cancelled")
    expect(controller.active).toBeNull()
  })

  it("returns a stale outcome and clears a session for another document or page", () => {
    for (const staleContext of [
      { documentId: "document-2", pageId: "page-1" },
      { documentId: "document-1", pageId: "page-2" },
    ]) {
      const controller = new CanvasTransformSessionController()
      controller.begin({
        ...context,
        kind: "move",
        baseline: new Map([["node-1", first]]),
      })

      expect(controller.commit(staleContext)).toMatchObject({ status: "stale" })
      expect(controller.active).toBeNull()
    }
  })

  it("commits once and rejects a second settlement", () => {
    const controller = new CanvasTransformSessionController()
    controller.begin({
      ...context,
      kind: "move",
      baseline: new Map([["node-1", first]]),
    })

    expect(controller.commit(context).status).toBe("committed")
    expect(controller.commit(context)).toEqual({ status: "none" })
    expect(controller.cancel(context)).toEqual({ status: "none" })
  })
})

describe("canvasTransformGeometryChanged", () => {
  it("distinguishes a no-op completion from a real transform", () => {
    expect(canvasTransformGeometryChanged(first, { ...first })).toBe(false)
    expect(canvasTransformGeometryChanged(first, { x: first.x + 1 })).toBe(true)
  })
})
