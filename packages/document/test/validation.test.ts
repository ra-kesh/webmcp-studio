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

describe("strict document validation", () => {
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
      mask: { type: "alpha", sourceNodeIds: ["cover-panel"] },
    })
    expect(errorsFor(unsupported)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group:unsupported-mask:mask:type:alpha",
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
  })
})
