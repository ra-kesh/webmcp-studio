import { describe, expect, it } from "vitest"
import {
  DocumentGenerationError,
  compileDocumentGenerationRequest,
  type DocumentGenerationRequest,
} from "../src"

const skill = {
  kind: "repository" as const,
  title: "Proposal design skill",
  canonicalUrl: "https://github.com/example/proposal-skill/blob/main/SKILL.md",
  contentHash: "a".repeat(64),
}

const minimalBlankRequest = (): DocumentGenerationRequest => ({
  requestId: "blank-proposal-1",
  idempotencyKey: "blank-proposal-1",
  prompt: "Create a one-page client proposal.",
  skill,
  start: {
    kind: "blank",
    presetId: "portrait",
    plan: {
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
          background: "#ffffff",
          nodeLocalIds: ["title"],
        },
      ],
      nodes: [
        {
          localId: "title",
          pageLocalId: "cover",
          type: "text",
          name: "Title",
          x: 100,
          y: 100,
          width: 1040,
          height: 160,
          text: "Client proposal",
          color: "#111111",
          fontFamily: "Geist Variable",
          fontSize: 64,
          fontWeight: 600,
          italic: false,
          decoration: "none",
          lineHeight: 1.1,
          letterSpacing: 0,
          align: "left",
          sizingMode: "fixed",
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
        },
      ],
      groups: [],
      typographyStyles: [],
      paintStyles: [],
      variables: [],
      variableBindings: [],
      fields: [],
      bindings: [],
    },
  },
  designGuides: [
    {
      kind: "repository",
      title: "Editorial direction",
      canonicalUrl:
        "https://github.com/example/proposal-skill/blob/main/design.md",
      contentHash: "b".repeat(64),
      decisions: {
        colors: { background: "#ffffff", foreground: "#111111" },
        typography: { display: "Geist Variable 600" },
        spacingBase: 8,
        principles: ["Use a restrained editorial hierarchy."],
      },
    },
  ],
  references: [
    {
      kind: "analysis",
      label: "Editorial proposal reference",
      canonicalUrl: "https://example.com/reference.jpg",
      contentHash: "c".repeat(64),
    },
  ],
})

const options = {
  now: "2026-08-31T00:00:00.000Z",
  approvedAssets: new Map(),
}

describe("document generation request", () => {
  it("creates one isolated blank candidate with skill and design provenance", () => {
    const request = minimalBlankRequest()
    const first = compileDocumentGenerationRequest(request, options)
    const replay = compileDocumentGenerationRequest(request, options)

    expect(replay).toEqual(first)
    expect(first).toMatchObject({
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      start: {
        kind: "blank",
        presetId: "portrait",
        designPlanVersion: 1,
      },
      summary: {
        nodesByType: { text: 1 },
        structuralChanges: [
          "Created 1 pages from portrait",
          "Created 1 editable layers",
          "Created 0 groups",
        ],
      },
      provenance: { skill, designGuides: request.designGuides },
      validation: [],
      warnings: [],
    })
    expect(first.candidate.schemaVersion).toBe(5)
  })

  it("clones and adapts one exact template through bounded canonical changes", () => {
    const request: DocumentGenerationRequest = {
      requestId: "template-proposal-1",
      idempotencyKey: "template-proposal-1",
      prompt: "Adapt the editorial one-pager.",
      skill,
      requestedName: "Aster proposal",
      start: {
        kind: "template",
        template: { id: "editorial-one-pager", version: 1 },
        fieldValues: {
          document_title: "Aster launch proposal",
          document_subtitle: "A two-day working session in Bengaluru.",
        },
        commands: [
          {
            type: "set_visibility",
            nodeId: "editorial-footer",
            visible: false,
          },
          {
            type: "insert_image",
            pageId: "editorial-one-pager-page",
            localId: "approved-photo",
            name: "Approved campaign photo",
            assetId: "campaign-photo",
            x: 760,
            y: 980,
            width: 320,
            height: 420,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
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
            alt: "Team collaborating in a workshop",
            decorative: false,
          },
        ],
      },
      designGuides: [],
      references: [],
    }
    const result = compileDocumentGenerationRequest(request, {
      ...options,
      approvedAssets: new Map([
        [
          "campaign-photo",
          {
            id: "campaign-photo",
            src: "https://example.com/campaign-photo.jpg",
            selectable: true,
          },
        ],
      ]),
    })
    expect(result.start).toMatchObject({
      kind: "template",
      template: { id: "editorial-one-pager", version: 1 },
    })
    expect(result.candidate.name).toBe("Aster proposal")
    expect(
      result.candidate.nodes.find((node) => node.name === "Document title")
    ).toMatchObject({ text: "Aster launch proposal" })
    expect(
      result.candidate.nodes.find((node) => node.name === "Footer")
    ).toMatchObject({ visible: false })
    expect(
      result.candidate.nodes.find(
        (node) => node.name === "Approved campaign photo"
      )
    ).toMatchObject({
      type: "image",
      assetId: "campaign-photo",
      alt: "Team collaborating in a workshop",
      altProvenance: "generated",
    })
    expect(result.candidate.revision).toBe(0)
  })

  it("rejects unapproved references and source-dependent templates", () => {
    const unapproved = minimalBlankRequest()
    unapproved.references = [{ kind: "asset", assetId: "remote-photo" }]
    expect(() => compileDocumentGenerationRequest(unapproved, options)).toThrow(
      /not approved/
    )

    const quotation: DocumentGenerationRequest = {
      ...minimalBlankRequest(),
      start: {
        kind: "template",
        template: { id: "quotation-editorial-olive", version: 4 },
      },
    }
    expect(() => compileDocumentGenerationRequest(quotation, options)).toThrow(
      DocumentGenerationError
    )
    try {
      compileDocumentGenerationRequest(quotation, options)
    } catch (error) {
      expect(error).toMatchObject({ code: "template_requires_source" })
    }
  })
})
