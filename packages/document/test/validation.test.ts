import { describe, expect, it } from "vitest"
import {
  applyCommand,
  assertValidDocument,
  documentSchema,
  northstarSeed,
  templatePublishRequestSchema,
  validateDocument,
} from "../src"
import type { Document } from "../src"
import { initialMaskPaintAdmission } from "../src/page-paint-plan"

const clone = () => structuredClone(northstarSeed)
const errorsFor = (document: Document) =>
  validateDocument(document).filter((issue) => issue.severity === "error")

const addMaskAdmissionFixtures = (
  document: Document,
  count: number,
  size: number
) => {
  const page = document.pages.find((candidate) => candidate.id === "cover")!
  const template = document.nodes.find((node) => node.id === "cover-panel")!
  document.groups = []
  for (let index = 0; index < count; index += 1) {
    const sourceId = `admission-source-${index}`
    const contentId = `admission-content-${index}`
    document.nodes.push(
      {
        ...structuredClone(template),
        id: sourceId,
        x: 0,
        y: 0,
        width: size,
        height: size,
      },
      {
        ...structuredClone(template),
        id: contentId,
        x: 0,
        y: 0,
        width: size,
        height: size,
      }
    )
    page.nodeIds.push(sourceId, contentId)
    document.groups.push({
      id: `admission-mask-${index}`,
      pageId: page.id,
      name: `Admission mask ${index}`,
      role: "mask",
      nodeIds: [sourceId, contentId],
      mask: { type: "vector", sourceNodeIds: [sourceId] },
    })
  }
}

describe("strict document validation", () => {
  it("reports a canonical page above the active mask composite count", () => {
    const document = clone()
    addMaskAdmissionFixtures(
      document,
      initialMaskPaintAdmission.maxActiveCompositesPerPage + 1,
      1
    )
    expect(errorsFor(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "page:cover:mask-composite-admission",
          code: "render_limit_exceeded",
          message: expect.stringContaining("active mask composite count"),
        }),
      ])
    )
  })

  it("reports a canonical page above the summed 2x mask area", () => {
    const document = clone()
    addMaskAdmissionFixtures(document, 5, 2_000)
    expect(errorsFor(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "page:cover:mask-composite-admission",
          code: "render_limit_exceeded",
          message: expect.stringContaining("summed 2x mask composite area"),
        }),
      ])
    )
  })

  it("reparses public validation inputs and rejects semantic invalidity", () => {
    const document = clone()
    expect(assertValidDocument(document)).not.toBe(document)

    const invalid = clone()
    invalid.pages[0]!.nodeIds.push("missing-node")
    expect(() => assertValidDocument(invalid)).toThrow()
  })

  it("accepts the honest general output kind used by custom documents", () => {
    const document = clone()
    document.outputs[0]!.kind = "custom"
    expect(documentSchema.safeParse(document).success).toBe(true)
    expect(errorsFor(document)).toEqual([])
  })

  it("rejects unknown keys at public and nested schema boundaries", () => {
    expect(
      documentSchema.safeParse({ ...clone(), unexpected: true }).success
    ).toBe(false)

    const document = clone() as Document & {
      pages: Array<Document["pages"][number] & { unexpected?: boolean }>
    }
    document.pages[0]!.unexpected = true
    expect(documentSchema.safeParse(document).success).toBe(false)

    expect(() =>
      applyCommand(clone(), {
        id: "strict-node-patch",
        type: "update_node",
        actor: "human",
        at: "2026-08-27T10:00:00.000Z",
        nodeId: "cover-title",
        patch: { imaginaryProperty: true },
      } as never)
    ).toThrow()

    expect(() =>
      applyCommand(clone(), {
        id: "strict-command",
        type: "update_node",
        actor: "human",
        at: "2026-08-27T10:00:00.000Z",
        nodeId: "cover-title",
        patch: { x: 10 },
        unexpected: true,
      } as never)
    ).toThrow()
  })

  it("accepts only server-derivable publish request fields", () => {
    const request = {
      id: "template-version-strict",
      templateId: "northstar",
      version: 1,
      publishedAt: "2026-08-27T10:00:00.000Z",
      document: clone(),
    }
    expect(templatePublishRequestSchema.safeParse(request).success).toBe(true)
    expect(
      templatePublishRequestSchema.safeParse({
        ...request,
        sourceRevision: 999,
        manifest: { schemaVersion: 1, parameters: [], outputs: [] },
      }).success
    ).toBe(false)
  })

  it("rejects duplicate identifiers and duplicate ordered references", () => {
    const document = clone()
    document.pages.push(structuredClone(document.pages[0]!))
    document.outputs[0]!.pageIds.push(document.outputs[0]!.pageIds[0]!)

    const codes = errorsFor(document).map((issue) => issue.code)
    expect(codes).toContain("duplicate_id")
    expect(codes).toContain("invalid_output")
  })

  it("rejects noncanonical rich-text ranges and missing shared styles", () => {
    const document = clone()
    const title = document.nodes.find((node) => node.id === "cover-title")
    if (!title || title.type !== "text") throw new Error("Expected cover title")
    title.runs = [
      { start: 4, end: 8, style: { fontWeight: 700 } },
      { start: 0, end: 4, style: { fontWeight: 700 } },
    ]
    title.typographyStyleId = "missing-typography-style"
    title.paintStyleId = "missing-paint-style"

    const issues = errorsFor(document)
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_rich_text" }),
        expect.objectContaining({
          code: "invalid_style",
          nodeId: title.id,
        }),
      ])
    )
  })

  it("rejects orphaned and cross-owned pages and nodes", () => {
    const document = clone()
    const page = document.pages[0]!
    const node = document.nodes.find(
      (candidate) => candidate.id === page.nodeIds[0]
    )!
    document.pages.push({
      ...page,
      id: "orphan-page",
      outputId: "proposal",
      name: "Orphan page",
      nodeIds: [node.id],
    })
    document.nodes.push({ ...node, id: "orphan-node", name: "Orphan node" })

    const codes = errorsFor(document).map((issue) => issue.code)
    expect(codes).toContain("orphan_page")
    expect(codes).toContain("invalid_page")
    expect(codes).toContain("orphan_node")
    expect(() => assertValidDocument(document)).toThrow()
  })

  it("rejects field-value and binding relationships that cannot round-trip", () => {
    const document = clone()
    document.fields.push({
      ...document.fields[0]!,
      id: "duplicate-field-key",
    })
    document.fieldValues["missing-field"] = "orphan"
    document.bindings.push({
      ...document.bindings[0]!,
      id: "duplicate-binding-target",
    })

    const issues = errorsFor(document)
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_id" }),
        expect.objectContaining({ code: "missing_reference" }),
        expect.objectContaining({ code: "invalid_binding" }),
      ])
    )
  })

  it("rejects image protocols that must never reach the renderer", () => {
    const document = clone()
    const imagePage = document.pages[0]!
    document.nodes.push({
      id: "unsafe-image",
      type: "image",
      name: "Unsafe image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "unsafe-image-asset",
      src: "file:///etc/passwd",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      alt: "",
      decorative: false,
    })
    imagePage.nodeIds.push("unsafe-image")

    expect(errorsFor(document)).toContainEqual(
      expect.objectContaining({ code: "invalid_asset" })
    )
  })

  it("rejects managed image nodes whose public ID disagrees with the canonical source", () => {
    const document = clone()
    document.nodes.push({
      id: "mismatched-managed-image",
      type: "image",
      name: "Mismatched managed image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "asset-aaaaaaaaaa",
      src: "asset:managed/asset-bbbbbbbbbb",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      alt: "",
      decorative: false,
    })
    document.pages[0]!.nodeIds.push("mismatched-managed-image")

    expect(documentSchema.safeParse(document).success).toBe(false)
    expect(errorsFor(document)).toContainEqual(
      expect.objectContaining({
        code: "invalid_asset",
        nodeId: "mismatched-managed-image",
        message:
          "Mismatched managed image has mismatched managed asset identity",
      })
    )
    expect(() => assertValidDocument(document)).toThrow()
  })

  it("rejects group membership that cannot truthfully represent the paint stack", () => {
    const document = clone()
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    document.groups.push({
      id: "scattered-group",
      role: "organize",
      pageId: page.id,
      name: "Scattered group",
      nodeIds: [page.nodeIds[0]!, page.nodeIds[2]!],
    })

    expect(errorsFor(document)).toContainEqual(
      expect.objectContaining({
        code: "invalid_group",
        message: "Scattered group must occupy one contiguous layer stack",
      })
    )
  })

  it("rejects duplicate membership inside one group and empty leaf groups", () => {
    const document = clone()
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    document.groups.push(
      {
        id: "duplicate-membership",
        role: "organize",
        pageId: page.id,
        name: "Duplicate membership",
        nodeIds: [page.nodeIds[0]!, page.nodeIds[0]!],
      },
      {
        id: "empty-leaf",
        role: "organize",
        pageId: page.id,
        name: "Empty leaf",
        nodeIds: [],
      }
    )

    expect(errorsFor(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_group",
          message:
            "Duplicate membership contains the same layer more than once",
        }),
        expect.objectContaining({
          code: "invalid_group",
          message: "Empty leaf does not contain any layers or child groups",
        }),
      ])
    )
  })

  it("reports canonical mask relation failures as stable invalid_group issues", () => {
    const document = clone()
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    const source = document.nodes.find((node) => node.id === page.nodeIds[0])!
    document.groups.push(
      {
        id: "invalid-mask",
        role: "mask",
        pageId: page.id,
        name: "Invalid mask",
        nodeIds: [page.nodeIds[1]!],
        mask: {
          type: "vector",
          sourceNodeIds: [source.id, source.id],
        },
      },
      {
        id: "empty-mask",
        role: "mask",
        pageId: page.id,
        name: "Empty mask",
        nodeIds: [source.id],
        mask: { type: "vector", sourceNodeIds: [source.id] },
      }
    )

    expect(errorsFor(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `group:invalid-mask:mask:duplicate-source:${source.id}`,
          code: "invalid_group",
        }),
        expect.objectContaining({
          id: `group:invalid-mask:mask:source-member:${source.id}`,
          code: "invalid_group",
        }),
        expect.objectContaining({
          id: "group:empty-mask:mask:content",
          code: "invalid_group",
        }),
      ])
    )
  })

  it("reports unsupported mode, nesting, and composite admission as stable mask issues", () => {
    const unsupported = clone()
    unsupported.groups.push({
      id: "unsupported-mask",
      role: "mask",
      pageId: "cover",
      name: "Unsupported mask",
      nodeIds: ["cover-panel", "cover-eyebrow"],
      mask: { type: "luminance", sourceNodeIds: ["cover-panel"] },
    })
    expect(errorsFor(unsupported)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group:unsupported-mask:mask:type:luminance",
          code: "invalid_group",
        }),
      ])
    )

    const nested = clone()
    nested.groups.push(
      {
        id: "nested-mask",
        role: "mask",
        pageId: "cover",
        name: "Nested mask",
        nodeIds: ["cover-panel", "cover-eyebrow"],
        mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
      },
      {
        id: "nested-mask-child",
        role: "organize",
        pageId: "cover",
        parentGroupId: "nested-mask",
        name: "Nested mask child",
        nodeIds: ["cover-title"],
      }
    )
    expect(errorsFor(nested)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group:nested-mask:mask:nesting",
          code: "invalid_group",
        }),
      ])
    )

    const oversized = clone()
    const oversizedContent = oversized.nodes.find(
      (node) => node.id === "cover-eyebrow"
    )!
    oversizedContent.x = 0
    oversizedContent.y = 0
    oversizedContent.width = initialMaskPaintAdmission.maxCompositeDimension
    oversizedContent.height = initialMaskPaintAdmission.maxCompositeDimension
    oversized.groups.push({
      id: "oversized-mask",
      role: "mask",
      pageId: "cover",
      name: "Oversized mask",
      nodeIds: ["cover-panel", "cover-eyebrow"],
      mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
    })
    expect(errorsFor(oversized)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group:oversized-mask:mask:composite-limit",
          code: "invalid_group",
        }),
      ])
    )

    const twoXOnly = clone()
    const twoXContent = twoXOnly.nodes.find(
      (node) => node.id === "cover-eyebrow"
    )!
    twoXContent.x = 0
    twoXContent.y = 0
    twoXContent.width = 3_000
    twoXContent.height = 2_000
    twoXOnly.groups.push({
      id: "two-x-mask",
      role: "mask",
      pageId: "cover",
      name: "Two x mask",
      nodeIds: ["cover-panel", "cover-eyebrow"],
      mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
    })
    expect(errorsFor(twoXOnly)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group:two-x-mask:mask:composite-limit",
          code: "invalid_group",
        }),
      ])
    )
  })

  it("admits four unique sources and reports a fifth with a stable limit issue", () => {
    const document = clone()
    document.groups = []
    const source = document.nodes.find((node) => node.id === "cover-panel")!
    const copies = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(source),
      id: `multi-source-${index}`,
      name: `Multi source ${index}`,
    }))
    const content = {
      ...structuredClone(source),
      id: "multi-source-content",
      name: "Multi source content",
    }
    document.nodes = [...copies, content]
    document.pages[0]!.nodeIds = document.nodes.map((node) => node.id)
    const maskGroup: Document["groups"][number] = {
      id: "five-source-mask",
      role: "mask" as const,
      pageId: document.pages[0]!.id,
      name: "Five source mask",
      nodeIds: document.pages[0]!.nodeIds,
      mask: {
        type: "vector" as const,
        sourceNodeIds: copies.map((node) => node.id) as [
          string,
          string,
          string,
          string,
          string,
        ],
      },
    }
    document.groups.push(maskGroup)

    expect(errorsFor(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group:five-source-mask:mask:source-limit",
          code: "invalid_group",
        }),
      ])
    )
    maskGroup.mask.sourceNodeIds = maskGroup.mask.sourceNodeIds.slice(0, 4) as [
      string,
      string,
      string,
      string,
    ]
    expect(errorsFor(document)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group:five-source-mask:mask:source-limit",
        }),
      ])
    )
  })

  it.each(["ellipse", "icon"] as const)(
    "admits an unstroked rotated %s as the direct vector source",
    (type) => {
      const document = clone()
      const source = document.nodes.find((node) => node.id === "cover-panel")!
      Object.assign(
        source,
        type === "ellipse"
          ? { type, rotation: 31 }
          : {
              type,
              rotation: -19,
              path: "M0 0h24v24H0z",
              viewBox: "0 0 24 24",
            }
      )
      document.groups.push({
        id: `${type}-mask`,
        role: "mask",
        pageId: "cover",
        name: `${type} mask`,
        nodeIds: ["cover-panel", "cover-eyebrow"],
        mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
      })

      expect(errorsFor(document)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `group:${type}-mask:mask:source-admission:cover-panel`,
          }),
        ])
      )
    }
  )
})
