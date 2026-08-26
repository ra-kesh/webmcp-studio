import type { CSSProperties } from "react"
import type { Document, SceneNode } from "@webmcp/document"

const nodeStyle = (node: SceneNode): CSSProperties => ({
  position: "absolute",
  left: node.x,
  top: node.y,
  width: node.width,
  height: node.height,
  opacity: node.opacity,
  transform: `rotate(${node.rotation}deg)`,
  transformOrigin: "top left",
  display: node.visible ? undefined : "none",
})

function RenderNode({ node }: { node: SceneNode }) {
  if (node.type === "text") {
    return (
      <div
        data-node-id={node.id}
        style={{
          ...nodeStyle(node),
          color: node.color,
          fontFamily: node.fontFamily,
          fontSize: node.fontSize,
          fontWeight: node.fontWeight,
          lineHeight: 1.18,
          textAlign: node.align,
          whiteSpace: "pre-line",
        }}
      >
        {node.text}
      </div>
    )
  }

  if (node.type === "rect") {
    return (
      <div
        data-node-id={node.id}
        style={{
          ...nodeStyle(node),
          background: node.fill,
          border: node.stroke ? `1px solid ${node.stroke}` : undefined,
          borderRadius: node.radius,
        }}
      />
    )
  }

  if (node.type === "ellipse") {
    return (
      <div
        data-node-id={node.id}
        style={{
          ...nodeStyle(node),
          background: node.fill,
          border: node.stroke
            ? `${node.strokeWidth}px solid ${node.stroke}`
            : undefined,
          borderRadius: "50%",
        }}
      />
    )
  }

  if (node.type === "line") {
    return (
      <svg
        data-node-id={node.id}
        style={{ ...nodeStyle(node), overflow: "visible" }}
        viewBox={`0 0 ${node.width} ${node.height}`}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1="0"
          x2={node.width}
          y2={node.height}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }

  if (node.type === "icon") {
    return (
      <svg
        data-node-id={node.id}
        style={nodeStyle(node)}
        viewBox={node.viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={node.path}
          fill={node.fill}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
        />
      </svg>
    )
  }

  return (
    <img
      data-node-id={node.id}
      alt={node.alt}
      src={node.src}
      style={{ ...nodeStyle(node), objectFit: node.fit }}
    />
  )
}

export function Artboard({
  document,
  pageId,
  scale = 1,
  className,
}: {
  document: Document
  pageId: string
  scale?: number
  className?: string
}) {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))

  return (
    <div
      className={className}
      style={{ width: page.width * scale, height: page.height * scale }}
    >
      <div
        data-page-id={page.id}
        style={{
          position: "relative",
          width: page.width,
          height: page.height,
          background: page.background,
          overflow: "hidden",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {page.nodeIds.map((nodeId) => {
          const node = nodesById.get(nodeId)
          return node ? <RenderNode key={node.id} node={node} /> : null
        })}
      </div>
    </div>
  )
}
