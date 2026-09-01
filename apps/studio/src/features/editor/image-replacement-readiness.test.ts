import { describe, expect, it } from "vitest"
import {
  createImageReplacementReadinessSession,
  reduceImageReplacementReadiness,
} from "./image-replacement-readiness"

const identity = {
  documentId: "document-current",
  pageId: "page-current",
} as const

describe("image replacement renderer readiness", () => {
  it("requires both Fabric and React to install the exact candidate", () => {
    const initial = createImageReplacementReadinessSession(
      "replace-1",
      identity.documentId,
      identity.pageId,
      "image-1",
      "https://assets.example.test/new.png",
      { width: 1600, height: 900 }
    )
    const fabric = reduceImageReplacementReadiness(initial, {
      ...identity,
      token: "replace-1",
      nodeId: "image-1",
      src: "https://assets.example.test/new.png",
      renderer: "fabric",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })
    const react = reduceImageReplacementReadiness(fabric.session, {
      ...identity,
      token: "replace-1",
      nodeId: "image-1",
      src: "https://assets.example.test/new.png",
      renderer: "react",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })

    expect(fabric.outcome).toBe("pending")
    expect(react.outcome).toBe("ready")
    expect(react.session.renderers).toEqual({
      fabric: "ready",
      react: "ready",
    })
  })

  it("rejects stale token, node, and source acknowledgements", () => {
    const session = createImageReplacementReadinessSession(
      "replace-current",
      identity.documentId,
      identity.pageId,
      "image-current",
      "https://assets.example.test/current.png",
      { width: 1600, height: 900 }
    )

    for (const stale of [
      {
        ...identity,
        documentId: "document-old",
        token: "replace-current",
        nodeId: "image-current",
        src: "https://assets.example.test/current.png",
      },
      {
        ...identity,
        pageId: "page-old",
        token: "replace-current",
        nodeId: "image-current",
        src: "https://assets.example.test/current.png",
      },
      {
        ...identity,
        token: "replace-old",
        nodeId: "image-current",
        src: "https://assets.example.test/current.png",
      },
      {
        ...identity,
        token: "replace-current",
        nodeId: "image-old",
        src: "https://assets.example.test/current.png",
      },
      {
        ...identity,
        token: "replace-current",
        nodeId: "image-current",
        src: "https://assets.example.test/old.png",
      },
    ]) {
      const result = reduceImageReplacementReadiness(session, {
        ...stale,
        renderer: "fabric",
        readiness: "ready",
        naturalSize: { width: 1600, height: 900 },
      })
      expect(result).toEqual({ session, outcome: "stale" })
    }
  })

  it("fails before commit when either exact renderer cannot install the source", () => {
    const session = createImageReplacementReadinessSession(
      "replace-1",
      identity.documentId,
      identity.pageId,
      "image-1",
      "https://assets.example.test/new.png",
      { width: 1600, height: 900 }
    )
    const result = reduceImageReplacementReadiness(session, {
      ...identity,
      token: "replace-1",
      nodeId: "image-1",
      src: "https://assets.example.test/new.png",
      renderer: "react",
      readiness: "unavailable",
    })

    expect(result).toEqual({ session, outcome: "failed" })
  })

  it("ignores duplicate readiness without advancing another renderer", () => {
    const initial = createImageReplacementReadinessSession(
      "replace-1",
      identity.documentId,
      identity.pageId,
      "image-1",
      "https://assets.example.test/new.png",
      { width: 1600, height: 900 }
    )
    const fabric = reduceImageReplacementReadiness(initial, {
      ...identity,
      token: "replace-1",
      nodeId: "image-1",
      src: "https://assets.example.test/new.png",
      renderer: "fabric",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })
    const duplicate = reduceImageReplacementReadiness(fabric.session, {
      ...identity,
      token: "replace-1",
      nodeId: "image-1",
      src: "https://assets.example.test/new.png",
      renderer: "fabric",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })

    expect(duplicate).toEqual({
      session: fabric.session,
      outcome: "duplicate",
    })
  })

  it("fails when either renderer decodes different natural dimensions", () => {
    const session = createImageReplacementReadinessSession(
      "replace-1",
      identity.documentId,
      identity.pageId,
      "image-1",
      "https://assets.example.test/new.png",
      { width: 1600, height: 900 }
    )

    expect(
      reduceImageReplacementReadiness(session, {
        ...identity,
        token: "replace-1",
        nodeId: "image-1",
        src: "https://assets.example.test/new.png",
        renderer: "react",
        readiness: "ready",
        naturalSize: { width: 800, height: 450 },
      }).outcome
    ).toBe("failed")
  })
})
