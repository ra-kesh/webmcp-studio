import type { SceneNode } from "@webmcp/document"

export type CanvasTransformKind = "move" | "resize" | "rotate"

export type CanvasTransformGeometry = Readonly<
  Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation">
>

export type CanvasTransformContext = Readonly<{
  documentId: string
  pageId: string
}>

export type CanvasTransformSession = CanvasTransformContext &
  Readonly<{
    kind: CanvasTransformKind
    nodeIds: readonly string[]
    baseline: ReadonlyMap<string, CanvasTransformGeometry>
    phase: "active" | "cancelled"
  }>

export type CanvasTransformBeginResult =
  | Readonly<{ status: "started"; session: CanvasTransformSession }>
  | Readonly<{ status: "duplicate"; session: CanvasTransformSession }>
  | Readonly<{ status: "empty" }>

export type CanvasTransformSettlementResult =
  | Readonly<{
      status: "committed" | "cancelled" | "already_cancelled"
      session: CanvasTransformSession
    }>
  | Readonly<{ status: "none" }>
  | Readonly<{ status: "stale"; session: CanvasTransformSession }>

function sameContext(
  session: CanvasTransformContext,
  context: CanvasTransformContext
) {
  return (
    session.documentId === context.documentId &&
    session.pageId === context.pageId
  )
}

function immutableGeometry(
  geometry: CanvasTransformGeometry
): CanvasTransformGeometry {
  return Object.freeze({
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: geometry.rotation,
  })
}

function createSession(input: {
  documentId: string
  pageId: string
  kind: CanvasTransformKind
  baseline: ReadonlyMap<string, CanvasTransformGeometry>
}): CanvasTransformSession | null {
  const baseline = new Map<string, CanvasTransformGeometry>()
  for (const [nodeId, geometry] of input.baseline) {
    if (!nodeId || baseline.has(nodeId)) continue
    baseline.set(nodeId, immutableGeometry(geometry))
  }
  if (!baseline.size) return null
  return Object.freeze({
    documentId: input.documentId,
    pageId: input.pageId,
    kind: input.kind,
    nodeIds: Object.freeze([...baseline.keys()]),
    baseline,
    phase: "active" as const,
  })
}

/**
 * Owns the short-lived boundary between Fabric's visual preview and the
 * canonical document commit. The controller intentionally knows nothing about
 * Fabric so stale-context and duplicate-event behavior can be proved without a
 * canvas runtime.
 */
export class CanvasTransformSessionController {
  private current: CanvasTransformSession | null = null

  get active() {
    return this.current
  }

  begin(input: {
    documentId: string
    pageId: string
    kind: CanvasTransformKind
    baseline: ReadonlyMap<string, CanvasTransformGeometry>
  }): CanvasTransformBeginResult {
    if (this.current) return { status: "duplicate", session: this.current }
    const session = createSession(input)
    if (!session) return { status: "empty" }
    this.current = session
    return { status: "started", session }
  }

  commit(context: CanvasTransformContext): CanvasTransformSettlementResult {
    const session = this.current
    if (!session) return { status: "none" }
    this.current = null
    if (!sameContext(session, context)) return { status: "stale", session }
    if (session.phase === "cancelled") {
      return { status: "already_cancelled", session }
    }
    return { status: "committed", session }
  }

  cancel(context: CanvasTransformContext): CanvasTransformSettlementResult {
    const session = this.current
    if (!session) return { status: "none" }
    if (!sameContext(session, context)) {
      this.current = null
      return { status: "stale", session }
    }
    if (session.phase === "cancelled") {
      return { status: "already_cancelled", session }
    }
    const cancelled = Object.freeze({ ...session, phase: "cancelled" as const })
    this.current = cancelled
    return { status: "cancelled", session: cancelled }
  }

  /**
   * Releases a cancelled session after Fabric's trailing object:modified event,
   * or when a sync/unmount boundary makes that event impossible or irrelevant.
   */
  release(): CanvasTransformSession | null {
    const session = this.current
    this.current = null
    return session
  }
}

export function canvasTransformGeometryChanged(
  baseline: CanvasTransformGeometry,
  patch: Partial<CanvasTransformGeometry>
) {
  return (Object.keys(patch) as (keyof CanvasTransformGeometry)[]).some(
    (key) => patch[key] !== baseline[key]
  )
}
