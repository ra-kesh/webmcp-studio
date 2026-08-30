import { describe, expect, it } from "vitest"
import {
  imageRenderParityCases,
  imageRenderParityInput,
  imageRenderParityNode,
  imageRenderParityPixelRatios,
  projectImagePaint,
  projectNodeForRender,
  renderConformanceDocument,
} from "@webmcp/document"
import {
  createImageResourceLoadState,
  decodedImageNaturalSizeForSource,
  imageResourceIdentity,
  imageResourceStateChangeForFailure,
  imageResourceStateChangeForLoad,
  reduceImageResourceLoadState,
  renderFrameStyle,
  renderImageFrameMaskStyle,
  renderImagePaintStyle,
  renderNodeDataAttributes,
  renderNodeStyle,
  renderTextLineStyle,
  renderTextSegmentStyle,
} from "../src"

describe("React render-view conformance", () => {
  it("maps every golden frame to explicit host-independent CSS", () => {
    for (const node of renderConformanceDocument.nodes) {
      const projection = projectNodeForRender(node)
      expect(renderFrameStyle(projection.frame)).toMatchObject({
        position: "absolute",
        boxSizing: "border-box",
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        opacity: node.opacity,
        transform: `rotate(${node.rotation}deg)`,
        transformOrigin: "top left",
      })
      expect(renderNodeStyle(projection).display).toBe(
        node.visible ? undefined : "none"
      )
      expect(renderNodeDataAttributes(projection)).toMatchObject({
        "data-node-id": node.id,
        "data-node-locked": node.locked ? "true" : "false",
      })
    }
  })

  it("does not collapse text whitespace or drop typography", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    expect(renderNodeStyle(projectNodeForRender(node))).toMatchObject({
      fontFamily: "Geist Variable, sans-serif",
      fontSize: 28,
      fontWeight: 650,
      lineHeight: 1.35,
      letterSpacing: 2.5,
      textRendering: "geometricPrecision",
      WebkitFontSmoothing: "antialiased",
      textAlign: "right",
      whiteSpace: "pre",
      overflowWrap: "normal",
      overflow: "hidden",
    })
  })

  it("maps mixed-run and paragraph projection to explicit React styles", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const node = {
      ...source,
      text: "Rich text",
      width: 500,
      sizingMode: "auto_width" as const,
      runs: [
        {
          start: 0,
          end: 4,
          style: {
            color: "#dc2626",
            fontSize: 36,
            fontWeight: 700,
            italic: true,
            decoration: "line_through" as const,
          },
        },
      ],
      paragraphs: [{ start: 0, end: 9, style: { align: "center" as const } }],
      links: [],
    }
    const projection = projectNodeForRender(node)
    if (projection.type !== "text") throw new Error("Expected text")
    const line = projection.content.layout.lines[0]!
    const segment = line.segments[0]!

    expect(renderTextLineStyle(line)).toMatchObject({
      display: "block",
      height: line.height,
      lineHeight: `${line.height}px`,
      textAlign: "center",
      whiteSpace: "pre",
    })
    expect(renderTextSegmentStyle(segment, line)).toMatchObject({
      color: "#dc2626",
      fontFamily: "Geist Variable, sans-serif",
      fontSize: 36,
      fontWeight: 700,
      fontStyle: "italic",
      textDecorationLine: "line-through",
      lineHeight: `${line.height}px`,
    })
  })

  it("makes fixed-box overflow observable without changing its frame", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    const projection = projectNodeForRender(node)
    if (projection.type !== "text") throw new Error("Expected text")

    expect(renderNodeDataAttributes(projection)).toMatchObject({
      "data-text-sizing-mode": "fixed",
      "data-text-measurement": projection.content.layout.measurement,
      "data-text-line-count": projection.content.layout.lineCount,
      "data-text-overflow": projection.content.layout.overflow
        ? "true"
        : "false",
      "data-text-overflow-x": projection.content.layout.overflowX
        ? "true"
        : "false",
      "data-text-overflow-y": projection.content.layout.overflowY
        ? "true"
        : "false",
    })
    expect(renderNodeStyle(projection)).toMatchObject({
      width: node.width,
      height: node.height,
      overflow: "hidden",
    })
  })

  it("uses canonical outer dimensions for bordered shapes", () => {
    const rect = renderConformanceDocument.nodes.find(
      (node) => node.id === "rect-stroke-radius"
    )!
    const ellipse = renderConformanceDocument.nodes.find(
      (node) => node.id === "ellipse-stroke"
    )!
    expect(renderNodeStyle(projectNodeForRender(rect))).toMatchObject({
      width: 220,
      height: 150,
      background: "#fef3c7",
      border: "8px solid #92400e",
      borderRadius: 24,
      boxSizing: "border-box",
    })
    expect(renderNodeStyle(projectNodeForRender(ellipse))).toMatchObject({
      width: 190,
      height: 120,
      border: "5px solid #1d4ed8",
      borderRadius: "50%",
      boxSizing: "border-box",
    })
  })

  it("projects canonical placement and clips through an overflow-safe frame", () => {
    for (const id of ["image-cover", "image-contain"] as const) {
      const node = renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === id
      )!
      const projection = projectNodeForRender(node)
      if (projection.type !== "image") throw new Error("Expected image")
      expect(renderNodeStyle(projection)).toMatchObject({
        overflow: "hidden",
      })
      expect(projection.content.placement).toEqual(node.placement)
      expect(projection.content.frameMask).toEqual(node.frameMask)
    }
  })

  it("maps every retained 1x/2x image affine and frame mask into React CSS", () => {
    for (const fixture of imageRenderParityCases) {
      for (const pixelRatio of imageRenderParityPixelRatios) {
        const input = imageRenderParityInput(fixture, pixelRatio)
        const paint = projectImagePaint(input)
        const imageStyle = renderImagePaintStyle(paint, input.naturalSize)
        const affine = paint.sourceToFrame
        expect(imageStyle).toEqual({
          position: "absolute",
          left: 0,
          top: 0,
          width: input.naturalSize.width,
          height: input.naturalSize.height,
          maxWidth: "none",
          maxHeight: "none",
          transform: `matrix(${affine.a}, ${affine.b}, ${affine.c}, ${affine.d}, ${affine.e}, ${affine.f})`,
          transformOrigin: "0 0",
        })

        const maskStyle = renderImageFrameMaskStyle(
          input.frame,
          input.frameMask
        )
        expect(maskStyle).toEqual({
          overflow: "hidden",
          borderRadius:
            paint.clip.shape === "ellipse"
              ? "50%"
              : paint.clip.shape === "rounded_rectangle"
                ? paint.clip.radius
                : undefined,
        })

        const projection = projectNodeForRender(
          imageRenderParityNode(fixture, pixelRatio)
        )
        expect(renderNodeStyle(projection)).toMatchObject(maskStyle)
      }
    }
  })

  it("invalidates decoded dimensions when a persistent image node changes source", () => {
    const decoded = {
      source: "https://cdn.example.com/old-image.jpg",
      width: 1600,
      height: 900,
    }

    expect(decodedImageNaturalSizeForSource(decoded, decoded.source)).toEqual({
      width: 1600,
      height: 900,
    })
    expect(
      decodedImageNaturalSizeForSource(
        decoded,
        "https://cdn.example.com/replacement.jpg"
      )
    ).toBeNull()
  })

  it("gives each source revision an independent React resource identity", () => {
    const oldIdentity = imageResourceIdentity(
      "image-node",
      "https://cdn.example.com/old-image.jpg"
    )
    const replacementIdentity = imageResourceIdentity(
      "image-node",
      "https://cdn.example.com/replacement.jpg"
    )

    expect(replacementIdentity).not.toBe(oldIdentity)
    expect(
      imageResourceIdentity(
        "image-node",
        "https://cdn.example.com/replacement.jpg",
        "managed-revision-2"
      )
    ).not.toBe(replacementIdentity)
  })

  it("ignores stale load and error events from replaced sources or attempts", () => {
    const identity = imageResourceIdentity(
      "image-node",
      "https://cdn.example.com/replacement.jpg",
      2
    )
    const initial = createImageResourceLoadState(
      identity,
      "https://cdn.example.com/replacement.jpg"
    )
    const retrying = reduceImageResourceLoadState(initial, { type: "retry" })

    expect(
      reduceImageResourceLoadState(retrying, {
        type: "failed",
        identity,
        attempt: 0,
      })
    ).toBe(retrying)
    expect(
      reduceImageResourceLoadState(retrying, {
        type: "loaded",
        identity: imageResourceIdentity(
          "image-node",
          "https://cdn.example.com/old.jpg",
          1
        ),
        attempt: 1,
        width: 1600,
        height: 900,
      })
    ).toBe(retrying)

    expect(
      reduceImageResourceLoadState(retrying, {
        type: "loaded",
        identity,
        attempt: 1,
        width: 1600,
        height: 900,
      })
    ).toMatchObject({
      status: "ready",
      displayed: {
        identity,
        source: "https://cdn.example.com/replacement.jpg",
        naturalSize: { width: 1600, height: 900 },
      },
      userRetried: true,
    })
  })

  it("reports exact token, source, and decoded dimensions for renderer acknowledgement", () => {
    expect(
      imageResourceStateChangeForLoad(
        "replacement-token",
        "image-node",
        "https://cdn.example.com/replacement.jpg",
        { width: 1600, height: 900 }
      )
    ).toEqual({
      token: "replacement-token",
      nodeId: "image-node",
      src: "https://cdn.example.com/replacement.jpg",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })
    expect(
      imageResourceStateChangeForFailure(
        "replacement-token",
        "image-node",
        "https://cdn.example.com/replacement.jpg"
      )
    ).toEqual({
      token: "replacement-token",
      nodeId: "image-node",
      src: "https://cdn.example.com/replacement.jpg",
      readiness: "unavailable",
      naturalSize: null,
    })
  })

  it("retains decoded pixels until a replacement candidate becomes ready", () => {
    const oldSource = "https://cdn.example.com/old.jpg"
    const replacementSource = "https://cdn.example.com/replacement.jpg"
    const oldIdentity = imageResourceIdentity("image-node", oldSource)
    const replacementIdentity = imageResourceIdentity(
      "image-node",
      replacementSource
    )
    const initial = createImageResourceLoadState(oldIdentity, oldSource)
    const oldReady = reduceImageResourceLoadState(initial, {
      type: "loaded",
      identity: oldIdentity,
      attempt: 0,
      width: 1600,
      height: 900,
    })
    const replacing = reduceImageResourceLoadState(oldReady, {
      type: "request",
      identity: replacementIdentity,
      source: replacementSource,
    })

    expect(replacing.status).toBe("loading")
    expect(replacing.displayed).toBe(oldReady.displayed)

    const failed = reduceImageResourceLoadState(replacing, {
      type: "failed",
      identity: replacementIdentity,
      attempt: 0,
    })
    expect(failed.status).toBe("error")
    expect(failed.displayed).toBe(oldReady.displayed)

    const undone = reduceImageResourceLoadState(failed, {
      type: "request",
      identity: oldIdentity,
      source: oldSource,
    })
    expect(undone.status).toBe("ready")
    expect(undone.displayed).toBe(oldReady.displayed)

    const retrying = reduceImageResourceLoadState(failed, { type: "retry" })
    expect(retrying.displayed).toBe(oldReady.displayed)
    const replacementReady = reduceImageResourceLoadState(retrying, {
      type: "loaded",
      identity: replacementIdentity,
      attempt: 1,
      width: 900,
      height: 1600,
    })
    expect(replacementReady).toMatchObject({
      status: "ready",
      displayed: {
        identity: replacementIdentity,
        source: replacementSource,
        attempt: 1,
        naturalSize: { width: 900, height: 1600 },
      },
    })
  })

  it("turns corrupt decodes into an explicit retryable error", () => {
    const identity = imageResourceIdentity("image-node", "broken://image")
    const initial = createImageResourceLoadState(identity, "broken://image")
    const failed = reduceImageResourceLoadState(initial, {
      type: "loaded",
      identity,
      attempt: 0,
      width: 0,
      height: 0,
    })

    expect(failed).toMatchObject({
      requestedIdentity: identity,
      status: "error",
      displayed: null,
      userRetried: false,
    })
    expect(
      reduceImageResourceLoadState(failed, { type: "retry" })
    ).toMatchObject({
      attempt: 1,
      status: "loading",
      displayed: null,
      userRetried: true,
    })
  })
})
