import { resolveCornerRadii, roundedRectanglePath } from "./corner-geometry"
import type { CornerRadii, Document, SceneNode } from "./schema"

type FrameNode = Extract<SceneNode, { type: "frame" }>

const EPSILON = 0.000_001

const changed = (left: number, right: number) =>
  Math.abs(left - right) > EPSILON

const frameOwners = (document: Document) => {
  const owners = new Map<string, FrameNode>()
  for (const node of document.nodes) {
    if (node.type !== "frame") continue
    for (const child of node.children) owners.set(child.nodeId, node)
  }
  return owners
}

/** Stable-topologically reconciles page paint order with frame ownership. */
export function reconcileFrameChildPaintOrder(document: Document): Document {
  let didChange = false
  const pages = document.pages.map((page) => {
    const pageNodeIds = new Set(page.nodeIds)
    const originalIndex = new Map(
      page.nodeIds.map((nodeId, index) => [nodeId, index])
    )
    const outgoing = new Map<string, Set<string>>()
    const indegree = new Map(page.nodeIds.map((nodeId) => [nodeId, 0]))
    let edgeCount = 0
    const addEdge = (from: string, to: string) => {
      if (from === to || !pageNodeIds.has(from) || !pageNodeIds.has(to)) return
      const targets = outgoing.get(from) ?? new Set<string>()
      if (targets.has(to)) return
      targets.add(to)
      outgoing.set(from, targets)
      indegree.set(to, (indegree.get(to) ?? 0) + 1)
      edgeCount += 1
    }
    for (const node of document.nodes) {
      if (node.type !== "frame" || !pageNodeIds.has(node.id)) continue
      let previousChildId: string | undefined
      for (const child of node.children) {
        addEdge(node.id, child.nodeId)
        if (previousChildId) addEdge(previousChildId, child.nodeId)
        previousChildId = child.nodeId
      }
    }
    if (edgeCount === 0) return page
    const ready = page.nodeIds.filter((nodeId) => indegree.get(nodeId) === 0)
    const ordered: string[] = []
    while (ready.length > 0) {
      const nodeId = ready.shift()!
      ordered.push(nodeId)
      for (const target of outgoing.get(nodeId) ?? []) {
        const nextIndegree = (indegree.get(target) ?? 0) - 1
        indegree.set(target, nextIndegree)
        if (nextIndegree === 0) {
          const targetIndex = originalIndex.get(target) ?? 0
          const insertionIndex = ready.findIndex(
            (candidate) => (originalIndex.get(candidate) ?? 0) > targetIndex
          )
          if (insertionIndex < 0) ready.push(target)
          else ready.splice(insertionIndex, 0, target)
        }
      }
    }
    if (ordered.length !== page.nodeIds.length) return page
    if (ordered.every((nodeId, index) => nodeId === page.nodeIds[index])) {
      return page
    }
    didChange = true
    return { ...page, nodeIds: ordered }
  })
  return didChange ? { ...document, pages } : document
}

/**
 * Resolves frame auto layout into ordinary page-space geometry. Renderers only
 * paint the result; they never run a second layout engine.
 */
export function applyFrameAutoLayout(document: Document): Document {
  const nodes = [...document.nodes]
  const byId = new Map(nodes.map((node, index) => [node.id, index] as const))
  const owners = frameOwners(document)
  let didChange = false

  const read = (nodeId: string) => {
    const index = byId.get(nodeId)
    return index === undefined ? undefined : nodes[index]
  }
  const write = (node: SceneNode, patch: Partial<SceneNode>) => {
    const index = byId.get(node.id)
    if (index === undefined) return node
    const next = { ...node, ...patch } as SceneNode
    nodes[index] = next
    didChange = true
    return next
  }

  const measure = (frameId: string, stack = new Set<string>()): FrameNode => {
    const candidate = read(frameId)
    if (!candidate || candidate.type !== "frame" || stack.has(frameId)) {
      return candidate as FrameNode
    }
    const nextStack = new Set(stack).add(frameId)
    for (const child of candidate.children) {
      const node = read(child.nodeId)
      if (node?.type === "frame") measure(node.id, nextStack)
    }
    let frame = read(frameId) as FrameNode
    const layout = frame.autoLayout
    if (!layout) return frame
    const children = frame.children
      .filter((child) => child.positioning === "auto")
      .map((child) => read(child.nodeId))
      .filter((node): node is SceneNode => Boolean(node?.visible))
    const horizontal = layout.direction === "horizontal"
    const primary = children.reduce(
      (total, node) => total + (horizontal ? node.width : node.height),
      0
    )
    const counter = children.reduce(
      (maximum, node) =>
        Math.max(maximum, horizontal ? node.height : node.width),
      0
    )
    const gaps = Math.max(0, children.length - 1) * layout.gap
    const hugWidth = horizontal
      ? layout.padding.left + primary + gaps + layout.padding.right
      : layout.padding.left + counter + layout.padding.right
    const hugHeight = horizontal
      ? layout.padding.top + counter + layout.padding.bottom
      : layout.padding.top + primary + gaps + layout.padding.bottom
    const width =
      layout.horizontalSizing === "hug"
        ? Math.max(EPSILON, hugWidth)
        : frame.width
    const height =
      layout.verticalSizing === "hug"
        ? Math.max(EPSILON, hugHeight)
        : frame.height
    if (changed(width, frame.width) || changed(height, frame.height)) {
      frame = write(frame, { width, height }) as FrameNode
    }
    return frame
  }

  const arrange = (frameId: string, stack = new Set<string>()) => {
    let frame = read(frameId)
    if (!frame || frame.type !== "frame" || stack.has(frameId)) return
    const nextStack = new Set(stack).add(frameId)
    for (const childLayout of frame.children) {
      if (childLayout.positioning !== "absolute") continue
      const child = read(childLayout.nodeId)
      if (!child) continue
      const x = frame.x + childLayout.offsetX
      const y = frame.y + childLayout.offsetY
      if (changed(x, child.x) || changed(y, child.y)) {
        write(child, { x, y })
      }
    }
    const layout = frame.autoLayout
    if (layout) {
      const horizontal = layout.direction === "horizontal"
      const children = frame.children
        .filter((child) => child.positioning === "auto")
        .map((childLayout) => ({ childLayout, node: read(childLayout.nodeId) }))
        .filter(
          (
            entry
          ): entry is {
            childLayout: FrameNode["children"][number]
            node: SceneNode
          } => Boolean(entry.node?.visible)
        )
      const innerWidth =
        frame.width - layout.padding.left - layout.padding.right
      const innerHeight =
        frame.height - layout.padding.top - layout.padding.bottom
      if (children.length > 0 && (innerWidth <= 0 || innerHeight <= 0)) {
        throw new Error(`${frame.name}'s padding leaves no layout space`)
      }
      const innerPrimary = horizontal ? innerWidth : innerHeight
      const innerCounter = horizontal ? innerHeight : innerWidth
      const baseGap = Math.max(0, children.length - 1) * layout.gap
      const fillEntries = children.filter(({ childLayout }) =>
        horizontal
          ? childLayout.horizontalSizing === "fill"
          : childLayout.verticalSizing === "fill"
      )
      const fixedPrimary = children.reduce((total, { childLayout, node }) => {
        const fill = horizontal
          ? childLayout.horizontalSizing === "fill"
          : childLayout.verticalSizing === "fill"
        return total + (fill ? 0 : horizontal ? node.width : node.height)
      }, 0)
      const fillSpace = Math.max(0, innerPrimary - fixedPrimary - baseGap)
      const totalGrow = fillEntries.reduce(
        (total, { childLayout }) => total + (childLayout.grow || 1),
        0
      )
      const resolved = children.map(({ childLayout, node }) => {
        let width = node.width
        let height = node.height
        const primaryFill = horizontal
          ? childLayout.horizontalSizing === "fill"
          : childLayout.verticalSizing === "fill"
        if (primaryFill) {
          const size = fillSpace * ((childLayout.grow || 1) / totalGrow)
          if (horizontal) width = Math.max(EPSILON, size)
          else height = Math.max(EPSILON, size)
        }
        const counterFill = horizontal
          ? childLayout.verticalSizing === "fill"
          : childLayout.horizontalSizing === "fill"
        if (counterFill || layout.counterAlign === "stretch") {
          if (horizontal) height = innerCounter
          else width = innerCounter
        }
        return { childLayout, node, width, height }
      })
      const contentPrimary =
        resolved.reduce(
          (total, entry) => total + (horizontal ? entry.width : entry.height),
          0
        ) + baseGap
      const free = Math.max(0, innerPrimary - contentPrimary)
      let cursor =
        (horizontal
          ? frame.x + layout.padding.left
          : frame.y + layout.padding.top) +
        (layout.primaryAlign === "center"
          ? free / 2
          : layout.primaryAlign === "end"
            ? free
            : 0)
      const gap =
        layout.primaryAlign === "space_between" && resolved.length > 1
          ? layout.gap + free / (resolved.length - 1)
          : layout.gap
      for (const entry of resolved) {
        const counterSize = horizontal ? entry.height : entry.width
        const counterOffset =
          layout.counterAlign === "center"
            ? (innerCounter - counterSize) / 2
            : layout.counterAlign === "end"
              ? innerCounter - counterSize
              : 0
        const x = horizontal
          ? cursor
          : frame.x + layout.padding.left + counterOffset
        const y = horizontal
          ? frame.y + layout.padding.top + counterOffset
          : cursor
        if (
          changed(x, entry.node.x) ||
          changed(y, entry.node.y) ||
          changed(entry.width, entry.node.width) ||
          changed(entry.height, entry.node.height)
        ) {
          write(entry.node, { x, y, width: entry.width, height: entry.height })
        }
        cursor += (horizontal ? entry.width : entry.height) + gap
      }
    }
    frame = read(frameId)
    if (!frame || frame.type !== "frame") return
    for (const child of frame.children) {
      if (read(child.nodeId)?.type === "frame") arrange(child.nodeId, nextStack)
    }
  }

  const roots = document.nodes.filter(
    (node): node is FrameNode => node.type === "frame" && !owners.has(node.id)
  )
  for (const frame of roots) measure(frame.id)
  for (const frame of roots) arrange(frame.id)
  return didChange ? { ...document, nodes } : document
}

export type FrameClipBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
  radius: number
  cornerRadii?: CornerRadii
  cornerSmoothing?: number
  path?: string
}>

/** Returns each clipping ancestor in immediate-parent to outer-parent order. */
export function projectFrameClipStack(
  document: Document,
  nodeId: string
): FrameClipBounds[] {
  const owners = frameOwners(document)
  const clips: FrameClipBounds[] = []
  let owner = owners.get(nodeId)
  const seen = new Set<string>()
  while (owner && !seen.has(owner.id)) {
    seen.add(owner.id)
    if (owner.clipsContent) {
      const independent =
        (owner.independentCorners ?? false) && owner.cornerRadii !== undefined
      const cornerRadii = resolveCornerRadii(
        owner.radius,
        independent ? owner.cornerRadii : undefined
      )
      const advancedCorners = independent || (owner.cornerSmoothing ?? 0) > 0
      clips.push({
        x: owner.x,
        y: owner.y,
        width: owner.width,
        height: owner.height,
        radius: owner.radius,
        ...(advancedCorners
          ? {
              cornerRadii,
              cornerSmoothing: owner.cornerSmoothing ?? 0,
              path: roundedRectanglePath({
                width: owner.width,
                height: owner.height,
                cornerRadii,
                cornerSmoothing: owner.cornerSmoothing ?? 0,
              }),
            }
          : {}),
      })
    }
    owner = owners.get(owner.id)
  }
  return clips
}

/** Returns the page-space intersection owned by clipping ancestor frames. */
export function projectFrameClipBounds(
  document: Document,
  nodeId: string
): FrameClipBounds | null {
  let bounds: FrameClipBounds | null = null
  for (const clip of projectFrameClipStack(document, nodeId)) {
    const right = Math.min(
      bounds ? bounds.x + bounds.width : Infinity,
      clip.x + clip.width
    )
    const bottom = Math.min(
      bounds ? bounds.y + bounds.height : Infinity,
      clip.y + clip.height
    )
    const x = Math.max(bounds?.x ?? -Infinity, clip.x)
    const y = Math.max(bounds?.y ?? -Infinity, clip.y)
    const radius: number = bounds ? 0 : clip.radius
    const cornerRadii: CornerRadii | undefined = bounds
      ? undefined
      : clip.cornerRadii
    bounds = {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
      radius,
      ...(cornerRadii
        ? {
            cornerRadii,
            cornerSmoothing: clip.cornerSmoothing ?? 0,
            path: roundedRectanglePath({
              width: Math.max(0, right - x),
              height: Math.max(0, bottom - y),
              cornerRadii,
              cornerSmoothing: clip.cornerSmoothing ?? 0,
            }),
          }
        : {}),
    }
  }
  return bounds
}
