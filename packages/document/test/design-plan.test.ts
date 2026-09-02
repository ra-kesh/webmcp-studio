import { describe, expect, it } from "vitest"
import {
  DesignPlanCompilationError,
  compileStudioDesignPlan,
  type StudioDesignPlan,
} from "../src"

const basePlan = (): StudioDesignPlan => ({
  version: 1,
  documentName: "Client proposal",
  outputs: [
    {
      localId: "proposal",
      name: "Proposal",
      kind: "proposal",
      pageLocalIds: ["cover"],
      exportFormats: ["png", "pdf"],
    },
  ],
  pages: [
    {
      localId: "cover",
      outputLocalId: "proposal",
      name: "Cover",
      width: 1240,
      height: 1754,
      background: "#f7f1e7",
      nodeLocalIds: ["panel", "title", "photo"],
    },
  ],
  nodes: [
    {
      localId: "panel",
      pageLocalId: "cover",
      type: "rect",
      name: "Panel",
      x: 60,
      y: 60,
      width: 1120,
      height: 1634,
      fill: "#ebe0cf",
      paintStyleLocalId: "paper",
      radius: 20,
      strokeWidth: 0,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    },
    {
      localId: "title",
      pageLocalId: "cover",
      type: "text",
      name: "Title",
      x: 120,
      y: 140,
      width: 620,
      height: 220,
      text: "A considered celebration",
      color: "#203128",
      fontFamily: "Geist Variable",
      fontSize: 72,
      fontWeight: 600,
      italic: false,
      decoration: "none",
      lineHeight: 1.05,
      letterSpacing: -1,
      align: "left",
      sizingMode: "fixed",
      typographyStyleLocalId: "display",
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    },
    {
      localId: "photo",
      pageLocalId: "cover",
      type: "image",
      name: "Reference photograph",
      x: 790,
      y: 140,
      width: 330,
      height: 520,
      assetId: "approved-photo",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rounded_rectangle", radius: 0.08 },
      alt: "Sandstone arches at dusk",
      decorative: false,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    },
  ],
  groups: [
    {
      localId: "hero",
      pageLocalId: "cover",
      name: "Hero",
      role: "organize",
      nodeLocalIds: ["title", "photo"],
    },
  ],
  typographyStyles: [
    {
      localId: "display",
      name: "Display",
      fontFamily: "Geist Variable",
      fontSize: 72,
      fontWeight: 600,
      italic: false,
      lineHeight: 1.05,
      letterSpacing: -1,
      decoration: "none",
    },
  ],
  paintStyles: [
    {
      localId: "paper",
      name: "Warm paper",
      color: "#ebe0cf",
      opacity: 1,
    },
  ],
  variables: [
    {
      localId: "accent",
      name: "Accent",
      type: "color",
      value: "#203128",
    },
  ],
  variableBindings: [
    {
      localId: "title-color",
      variableLocalId: "accent",
      target: { kind: "node", nodeLocalId: "title", property: "color" },
    },
  ],
  fields: [
    {
      localId: "title-field",
      key: "proposal_title",
      label: "Proposal title",
      type: "text",
      required: true,
      defaultValue: "A considered celebration",
      agentDescription: "Main proposal heading",
      validation: { maxLength: 120 },
    },
  ],
  bindings: [
    {
      localId: "title-binding",
      fieldLocalId: "title-field",
      nodeLocalId: "title",
      property: "text",
    },
  ],
})

const options = () => ({
  presetId: "portrait",
  requestId: "request-fixture",
  idempotencyKey: "fixture-1",
  now: "2026-08-31T00:00:00.000Z",
  approvedAssets: new Map([
    [
      "approved-photo",
      {
        id: "approved-photo",
        src: "data:image/svg+xml,approved",
        selectable: true,
      },
    ],
  ]),
})

describe("Studio Design Plan compiler", () => {
  it("atomically compiles request-local resources into one canonical document", () => {
    const first = compileStudioDesignPlan(basePlan(), options())
    const replay = compileStudioDesignPlan(basePlan(), options())

    expect(replay).toEqual(first)
    expect(first).toMatchObject({
      schemaVersion: 6,
      name: "Client proposal",
      revision: 0,
      outputs: [{ kind: "proposal", exportFormats: ["png", "pdf"] }],
    })
    expect(first.nodes).toHaveLength(3)
    expect(first.groups).toHaveLength(1)
    expect(first.typographyStyles).toHaveLength(1)
    expect(first.paintStyles).toHaveLength(1)
    expect(first.variables).toHaveLength(1)
    expect(first.variableBindings).toHaveLength(1)
    expect(first.fields).toHaveLength(1)
    expect(first.bindings).toHaveLength(1)
    expect(first.nodes.find((node) => node.type === "image")).toMatchObject({
      assetId: "approved-photo",
      src: "data:image/svg+xml,approved",
      altProvenance: "generated",
    })
    expect(JSON.stringify(first)).not.toContain('"localId"')
  })

  it("rejects executable or renderer-private node input", () => {
    const plan = basePlan() as unknown as Record<string, unknown>
    ;(plan.nodes as Array<Record<string, unknown>>)[1]!.html = "<h1>run me</h1>"
    expect(() => compileStudioDesignPlan(plan, options())).toThrow(
      DesignPlanCompilationError
    )
    try {
      compileStudioDesignPlan(plan, options())
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_plan" })
    }
  })

  it("rejects unresolved assets, duplicate IDs, and out-of-preset geometry", () => {
    const unapproved = basePlan()
    const image = unapproved.nodes.find((node) => node.type === "image")!
    image.assetId = "https://example.com/private.jpg"
    expect(() => compileStudioDesignPlan(unapproved, options())).toThrow(
      /not approved/
    )

    const duplicate = basePlan()
    duplicate.groups[0]!.localId = "title"
    expect(() => compileStudioDesignPlan(duplicate, options())).toThrow(
      /used in both nodes and groups/
    )

    const wrongPreset = basePlan()
    wrongPreset.pages[0]!.width = 1080
    expect(() => compileStudioDesignPlan(wrongPreset, options())).toThrow(
      /must match Portrait document/
    )
  })
})
