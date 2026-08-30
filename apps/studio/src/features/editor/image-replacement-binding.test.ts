import { describe, expect, it } from "vitest"
import type { Document, SceneNode } from "@webmcp/document"
import {
  imageReplacementBindingImpact,
  imageReplacementConstraintsByNodeId,
} from "./image-replacement-binding"
import { reusableImageReplacementPatch } from "./media-selection-model"

const originalImage: Extract<SceneNode, { type: "image" }> = {
  id: "image-primary",
  type: "image",
  name: "Primary portrait",
  assetId: "asset-original01",
  src: "asset:managed/asset-original01",
  alt: "Carefully authored alternative text",
  placement: {
    mode: "manual",
    focalX: 0.2,
    focalY: 0.8,
    zoom: 1.4,
    rotation: -7,
    flipX: true,
    flipY: false,
  },
  frameMask: { shape: "rounded_rectangle", radius: 0.18 },
  x: 120,
  y: 240,
  width: 360,
  height: 480,
  rotation: 12,
  opacity: 0.75,
  visible: true,
  locked: false,
  decorative: false,
}

function fixture(bound: boolean): Document {
  return {
    schemaVersion: 4,
    id: "binding-replacement-document",
    name: "Binding replacement fixture",
    revision: 0,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    outputs: [
      {
        id: "output-main",
        name: "Main output",
        kind: "proposal",
        pageIds: ["page-main"],
        exportFormats: ["png"],
      },
    ],
    pages: [
      {
        id: "page-main",
        outputId: "output-main",
        name: "Main page",
        width: 1_200,
        height: 1_600,
        background: "#ffffff",
        nodeIds: [originalImage.id, "image-secondary"],
      },
    ],
    nodes: [
      originalImage,
      { ...originalImage, id: "image-secondary", name: "Secondary portrait" },
    ],
    groups: [],
    components: [],
    componentInstances: [],
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    variableBindings: [],
    fields: [
      {
        id: "field-portrait",
        key: "portrait",
        label: "Client portrait",
        type: "asset",
        required: true,
        defaultValue: "asset:managed/asset-original01",
        agentDescription: "The portrait shared by proposal pages.",
        validation: {},
      },
    ],
    fieldValues: { "field-portrait": "asset:managed/asset-original01" },
    bindings: bound
      ? [
          {
            id: "binding-primary",
            fieldId: "field-portrait",
            nodeId: originalImage.id,
            property: "src",
          },
          {
            id: "binding-secondary",
            fieldId: "field-portrait",
            nodeId: "image-secondary",
            property: "src",
          },
        ]
      : [],
  }
}

describe("binding-aware image replacement", () => {
  it("allows an unbound image to use the direct replacement path", () => {
    const document = fixture(false)
    expect(imageReplacementBindingImpact(document, originalImage.id)).toBeNull()

    const replaced = {
      ...originalImage,
      ...reusableImageReplacementPatch(originalImage, {
        assetId: "asset-replacement01",
        name: "Replacement",
        description: "A generated default that must not overwrite authored alt",
        src: "asset:managed/asset-replacement01",
        width: 1_200,
        height: 800,
      }),
    }
    expect(replaced).toEqual({
      ...originalImage,
      assetId: "asset-replacement01",
      src: "asset:managed/asset-replacement01",
    })
  })

  it("blocks a bound source and describes the shared fan-out", () => {
    expect(
      imageReplacementBindingImpact(fixture(true), originalImage.id)
    ).toEqual({
      bindingId: "binding-primary",
      fieldId: "field-portrait",
      fieldLabel: "Client portrait",
      nodeId: originalImage.id,
      nodeName: originalImage.name,
      affectedNodeIds: [originalImage.id, "image-secondary"],
      message:
        "“Primary portrait” gets its image from the “Client portrait” shared asset field (2 linked layers). Change the field value in Fields to update every linked layer, or unbind Source to replace only this layer.",
    })
  })

  it("projects only bound selections into inspector replacement constraints", () => {
    const document = fixture(true)
    expect(
      imageReplacementConstraintsByNodeId(document, [
        originalImage.id,
        "image-secondary",
        "missing-node",
      ])
    ).toEqual({
      [originalImage.id]: {
        reason:
          "“Primary portrait” gets its image from the “Client portrait” shared asset field (2 linked layers). Change the field value in Fields to update every linked layer, or unbind Source to replace only this layer.",
      },
      "image-secondary": {
        reason:
          "“Secondary portrait” gets its image from the “Client portrait” shared asset field (2 linked layers). Change the field value in Fields to update every linked layer, or unbind Source to replace only this layer.",
      },
    })
  })
})
