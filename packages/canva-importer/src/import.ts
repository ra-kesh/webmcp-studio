import type { StudioInterchangePackage } from "@webmcp/document"
import { planCanvaImport, type CanvaPlanOptions } from "./plan"
import type {
  CanvaImageSource,
  CanvaImportHost,
  CanvaImportPlan,
  CanvaImportResult,
  CanvaMediaSource,
  CanvaPlannedElement,
  CanvaRasterRequest,
  CanvaResolvedAsset,
  CanvaResolvedElement,
  CanvaResolvedImageFill,
  CanvaResolvedShapePath,
} from "./types"

const sourceKey = (source: CanvaMediaSource) =>
  source.kind === "studio_asset"
    ? `asset:${source.assetId}\u0000${source.url}`
    : `raster:${source.pageId}\u0000${source.groupId ?? ""}\u0000${source.nodeIds.join(",")}\u0000${source.scale}`

const resolveMedia = (
  source: CanvaMediaSource,
  host: CanvaImportHost<unknown>,
  cache: Map<string, Promise<CanvaResolvedAsset>>
) => {
  const key = sourceKey(source)
  const existing = cache.get(key)
  if (existing) return existing
  const pending =
    source.kind === "studio_asset"
      ? host.uploadImage(source)
      : host.renderAndUploadRaster(source)
  cache.set(key, pending)
  return pending
}

const resolveImageFill = async (
  source: CanvaImageSource | CanvaRasterRequest,
  host: CanvaImportHost<unknown>,
  cache: Map<string, Promise<CanvaResolvedAsset>>
): Promise<CanvaResolvedImageFill> => {
  const asset = await resolveMedia(source, host, cache)
  return { kind: "image", ref: asset.ref, dropTarget: false }
}

const resolveElement = async (
  element: CanvaPlannedElement,
  host: CanvaImportHost<unknown>,
  cache: Map<string, Promise<CanvaResolvedAsset>>
): Promise<CanvaResolvedElement> => {
  if (element.type === "text") return element
  if (element.type === "rect") {
    return {
      ...element,
      fill: await resolveImageFill(element.fill.source, host, cache),
    }
  }
  if (element.type === "group") {
    return {
      ...element,
      children: await Promise.all(
        element.children.map((child) => resolveElement(child, host, cache))
      ),
    }
  }

  const paths: CanvaResolvedShapePath[] = await Promise.all(
    element.paths.map(async (path): Promise<CanvaResolvedShapePath> => {
      if (!path.fill || path.fill.kind === "solid") {
        return { ...path, fill: path.fill }
      }
      return {
        ...path,
        fill: await resolveImageFill(path.fill.source, host, cache),
      }
    })
  )
  return { ...element, paths }
}

/**
 * Executes a plan through the Canva app's installed SDK adapter. Image uploads
 * and selective raster renders run in parallel and are de-duplicated. Page
 * insertion remains ordered so the Studio page sequence and z-order survive.
 */
export async function importCanvaPlan<PageHandle>(
  plan: CanvaImportPlan,
  host: CanvaImportHost<PageHandle>
): Promise<CanvaImportResult> {
  try {
    await host.beginImport(plan)
    const assetCache = new Map<string, Promise<CanvaResolvedAsset>>()
    const resolvedPages = await Promise.all(
      plan.pages.map(async (page) => ({
        page,
        elements: await Promise.all(
          page.elements.map((element) =>
            resolveElement(element, host, assetCache)
          )
        ),
      }))
    )

    for (const [index, resolved] of resolvedPages.entries()) {
      const page = await host.ensureAbsolutePage(resolved.page, index)
      await host.insertElements(page, resolved.elements)
    }
    await host.completeImport(plan)
    return {
      pageCount: plan.pages.length,
      nativeEditableNodeCount: plan.compatibility.nativeEditableNodeIds.length,
      rasterizedSelectionCount: plan.compatibility.rasterizations.length,
      compatibility: plan.compatibility,
    }
  } catch (error) {
    await host.failImport?.(plan, error)
    throw error
  }
}

/** Converts a Studio interchange package and executes it through a Canva app. */
export const importStudioInterchangeToCanva = <PageHandle>(
  input: StudioInterchangePackage | unknown,
  host: CanvaImportHost<PageHandle>,
  options: CanvaPlanOptions = {}
) => importCanvaPlan(planCanvaImport(input, options), host)
