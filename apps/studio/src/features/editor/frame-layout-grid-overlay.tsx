import type { Document } from "@webmcp/document"
import {
  projectFrameClipBounds,
  projectFrameLayoutGridLines,
  projectFrameLayoutGridSections,
} from "@webmcp/document"

export function FrameLayoutGridOverlay({
  document,
  pageId,
  zoom,
  visible = true,
}: {
  document: Document
  pageId: string
  zoom: number
  visible?: boolean
}) {
  if (!visible) return null
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) return null
  const pageNodes = new Set(page.nodeIds)
  const frames = document.nodes.filter(
    (node): node is Extract<Document["nodes"][number], { type: "frame" }> =>
      node.type === "frame" &&
      node.visible &&
      pageNodes.has(node.id) &&
      (node.layoutGrids ?? []).some((grid) => grid.visible)
  )
  if (frames.length === 0) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 origin-top-left"
      data-editor-overlay="frame-layout-grids"
      style={{
        width: page.width,
        height: page.height,
        transform: `scale(${zoom})`,
      }}
    >
      {frames.map((frame) => {
        const ancestorClip = projectFrameClipBounds(document, frame.id)
        const clipInsets = ancestorClip
          ? {
              top: Math.max(0, ancestorClip.y - frame.y),
              right: Math.max(
                0,
                frame.x + frame.width - (ancestorClip.x + ancestorClip.width)
              ),
              bottom: Math.max(
                0,
                frame.y + frame.height - (ancestorClip.y + ancestorClip.height)
              ),
              left: Math.max(0, ancestorClip.x - frame.x),
            }
          : null
        if (
          clipInsets &&
          (clipInsets.left + clipInsets.right >= frame.width ||
            clipInsets.top + clipInsets.bottom >= frame.height)
        ) {
          return null
        }
        return (
          <div
            key={frame.id}
            data-frame-layout-grid-owner={frame.id}
            className="absolute overflow-hidden"
            style={{
              left: frame.x,
              top: frame.y,
              width: frame.width,
              height: frame.height,
              borderRadius: frame.radius,
              clipPath: clipInsets
                ? `inset(${clipInsets.top}px ${clipInsets.right}px ${clipInsets.bottom}px ${clipInsets.left}px round ${ancestorClip?.radius ?? 0}px)`
                : undefined,
            }}
          >
            {(frame.layoutGrids ?? []).flatMap((grid) => {
              if (grid.pattern !== "grid") {
                return projectFrameLayoutGridSections(frame, grid).map(
                  (section, index) => (
                    <span
                      key={`${grid.id}:section:${index}`}
                      data-layout-grid-id={grid.id}
                      className="absolute"
                      style={{
                        backgroundColor: grid.color,
                        opacity: grid.opacity,
                        ...(section.axis === "x"
                          ? {
                              left: section.start,
                              top: 0,
                              width: section.end - section.start,
                              height: frame.height,
                            }
                          : {
                              left: 0,
                              top: section.start,
                              width: frame.width,
                              height: section.end - section.start,
                            }),
                      }}
                    />
                  )
                )
              }
              return projectFrameLayoutGridLines(frame, grid).map(
                (line, index) => (
                  <span
                    key={`${grid.id}:line:${index}`}
                    data-layout-grid-id={grid.id}
                    className="absolute"
                    style={{
                      backgroundColor: grid.color,
                      opacity: grid.opacity,
                      ...(line.axis === "x"
                        ? {
                            left: line.position,
                            top: 0,
                            width: 1 / zoom,
                            height: frame.height,
                          }
                        : {
                            left: 0,
                            top: line.position,
                            width: frame.width,
                            height: 1 / zoom,
                          }),
                    }}
                  />
                )
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
