import { describe, expect, it } from "vitest"
import type { Page, SceneNode } from "@webmcp/document"
import {
  createReusableImageNode,
  reusableImageReplacementCommand,
  reusableImageReplacementPatch,
} from "./media-selection-model"

const asset = {
  assetId: "media-1",
  name: "Wedding portrait",
  description: "Aditi and Kabir portrait",
  src: "asset:managed/media-1",
  width: 2400,
  height: 1600,
}

const page: Page = {
  id: "page-main",
  outputId: "output-main",
  name: "Main page",
  width: 1_200,
  height: 1_600,
  background: "#ffffff",
  nodeIds: [],
}

const imageNode: Extract<SceneNode, { type: "image" }> = {
  ...createReusableImageNode(page, asset, "image-1"),
  alt: "Authored description",
  altProvenance: "authored",
}

describe("media selection model", () => {
  it("creates one centered proportionally scaled image node", () => {
    const node = createReusableImageNode(page, asset, "image-1")

    expect(node).toMatchObject({
      id: "image-1",
      assetId: "media-1",
      src: "asset:managed/media-1",
      alt: "Aditi and Kabir portrait",
      altProvenance: "generated",
      width: 640,
      height: 427,
      x: Math.round((page.width - 640) / 2),
      y: Math.round((page.height - 427) / 2),
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
      decorative: false,
    })
  })

  it("replaces only source identity so authored alt and geometry stay intact", () => {
    expect(reusableImageReplacementPatch(imageNode, asset)).toEqual({
      assetId: "media-1",
      src: "asset:managed/media-1",
    })
  })

  it("refreshes an untouched generated alt when the source changes", () => {
    const generatedNode = createReusableImageNode(page, asset, "image-1")
    const replacement = {
      ...asset,
      assetId: "media-2",
      src: "asset:managed/media-2",
      description: "Aditi walking through marigold petals",
    }

    expect(reusableImageReplacementPatch(generatedNode, replacement)).toEqual({
      assetId: "media-2",
      src: "asset:managed/media-2",
      alt: "Aditi walking through marigold petals",
      altProvenance: "generated",
    })
  })

  it("treats legacy alt without provenance as authored during replacement", () => {
    const { altProvenance: _provenance, ...legacyNode } = imageNode

    expect(reusableImageReplacementPatch(legacyNode, asset)).toEqual({
      assetId: "media-1",
      src: "asset:managed/media-1",
    })
  })

  it("fills an empty non-decorative alt from the replacement default", () => {
    expect(
      reusableImageReplacementPatch(
        { ...imageNode, alt: "", altProvenance: "authored" },
        asset
      )
    ).toEqual({
      assetId: "media-1",
      src: "asset:managed/media-1",
      alt: "Aditi and Kabir portrait",
      altProvenance: "generated",
    })
  })

  it("keeps decorative alt empty during replacement", () => {
    expect(
      reusableImageReplacementPatch(
        {
          ...imageNode,
          alt: "",
          altProvenance: "generated",
          decorative: true,
        },
        asset
      )
    ).toEqual({
      assetId: "media-1",
      src: "asset:managed/media-1",
    })
  })

  it("routes replacement through the typed image-source command", () => {
    expect(reusableImageReplacementCommand(imageNode, asset)).toEqual({
      type: "replace_image_source",
      nodeId: "image-1",
      assetId: "media-1",
      src: "asset:managed/media-1",
    })
  })
})
