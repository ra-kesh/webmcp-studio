import { documentSchema } from "@webmcp/document"
import type {
  Document,
  ImageFrameMask,
  ImagePlacement,
  SceneNode,
} from "@webmcp/document"

type ImageNode = Extract<SceneNode, { type: "image" }>

export const IMAGE_HEAVY_PERFORMANCE_PAGE_COUNT = 20
export const IMAGE_HEAVY_PERFORMANCE_IMAGES_PER_PAGE = 8

export type ImageHeavyPerformanceFixture = Readonly<{
  document: Document
  imageNodeIdsByPage: Readonly<Record<string, readonly string[]>>
}>

export type ImageHeavyPerformanceFixtureOptions = Readonly<{
  pageCount?: number
  imagesPerPage?: number
}>

const placementFor = (index: number): ImagePlacement => ({
  mode: index % 3 === 0 ? "manual" : "fill",
  focalX: 0.35 + (index % 4) * 0.1,
  focalY: 0.4 + (index % 3) * 0.1,
  zoom: 1 + (index % 3) * 0.08,
  rotation: index % 4 === 0 ? -4 : index % 4 === 2 ? 4 : 0,
  flipX: index % 7 === 0,
  flipY: false,
})

const frameMaskFor = (index: number): ImageFrameMask => {
  if (index % 3 === 1) {
    return { shape: "rounded_rectangle", radius: 0.08 }
  }
  if (index % 3 === 2) return { shape: "ellipse" }
  return { shape: "rectangle" }
}

/**
 * Representative ASSET-02 responsiveness fixture.
 *
 * Twenty pages exercise the accepted long-document boundary. Eight distinct
 * image sources per page are enough to catch accidental whole-document image
 * work while keeping the fixture deterministic in unit and mounted tests.
 */
export function createImageHeavyPerformanceFixture(
  options: ImageHeavyPerformanceFixtureOptions = {}
): ImageHeavyPerformanceFixture {
  const pageCount = options.pageCount ?? IMAGE_HEAVY_PERFORMANCE_PAGE_COUNT
  const imagesPerPage =
    options.imagesPerPage ?? IMAGE_HEAVY_PERFORMANCE_IMAGES_PER_PAGE
  const outputId = "performance-output"
  const createdAt = "2026-08-28T12:00:00.000Z"
  const pages: Document["pages"] = []
  const nodes: ImageNode[] = []
  const imageNodeIdsByPage: Record<string, string[]> = {}

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageNumber = pageIndex + 1
    const pageId = `performance-page-${pageNumber}`
    const nodeIds: string[] = []

    for (let imageIndex = 0; imageIndex < imagesPerPage; imageIndex += 1) {
      const imageNumber = imageIndex + 1
      const nodeId = `performance-image-${pageNumber}-${imageNumber}`
      nodeIds.push(nodeId)
      nodes.push({
        id: nodeId,
        type: "image",
        name: `Page ${pageNumber} image ${imageNumber}`,
        x: 48 + (imageIndex % 4) * 288,
        y: 48 + Math.floor(imageIndex / 4) * 360,
        width: 256,
        height: 320,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId: `performance-asset-${pageNumber}-${imageNumber}`,
        src: `https://images.example.test/performance/page-${pageNumber}/image-${imageNumber}.webp`,
        placement: placementFor(imageIndex),
        frameMask: frameMaskFor(imageIndex),
        alt: `Editorial photograph ${imageNumber} on page ${pageNumber}`,
        altProvenance: "authored",
        decorative: false,
      })
    }

    imageNodeIdsByPage[pageId] = nodeIds
    pages.push({
      id: pageId,
      outputId,
      name: `Image story ${pageNumber}`,
      width: 1240,
      height: 800,
      background: pageIndex % 2 === 0 ? "#f5f1e8" : "#10181d",
      nodeIds,
    })
  }

  const document = documentSchema.parse({
    schemaVersion: 5,
    id: `image-heavy-performance-document-${pageCount}-${imagesPerPage}`,
    name: `${pageCount}-page image-heavy performance fixture`,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    outputs: [
      {
        id: outputId,
        name: "Image-heavy proposal",
        kind: "proposal",
        pageIds: pages.map((page) => page.id),
        exportFormats: ["pdf", "png"],
      },
    ],
    pages,
    nodes,
    groups: [],
    components: [],
    componentInstances: [],
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    variableBindings: [],
    fields: [],
    fieldValues: {},
    bindings: [],
  })

  return {
    document,
    imageNodeIdsByPage,
  }
}
