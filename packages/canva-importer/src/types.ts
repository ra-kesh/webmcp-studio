export type CanvaRasterizationReason =
  | "blend_mode"
  | "effects"
  | "fill_stack"
  | "stroke_stack"
  | "image_placement"
  | "frame_clipping"
  | "mask_group"
  | "flip_transform"

export type CanvaImportWarningCode =
  | "component_semantics_not_imported"
  | "constraints_not_imported"
  | "field_bindings_not_imported"
  | "font_may_substitute"
  | "group_flattened"
  | "page_background_may_differ"
  | "text_links_not_imported"
  | "text_overflow_may_differ"
  | "variable_bindings_not_imported"

export type StudioElementMetadata = Readonly<{
  documentId: string
  pageId: string
  nodeIds: readonly string[]
  groupId?: string
}>

export type CanvaElementBox = Readonly<{
  top: number
  left: number
  width: number
  height: number
  rotation: number
}>

export type CanvaElementBase = CanvaElementBox &
  Readonly<{
    name: string
    locked: boolean
    /** Canva uses zero for opaque and one for fully transparent. */
    transparency: number
    metadata: StudioElementMetadata
  }>

export type CanvaSolidFill = Readonly<{
  kind: "solid"
  color: string
}>

export type CanvaImageSource = Readonly<{
  kind: "studio_asset"
  assetId: string
  url: string
  altText: string
  decorative: boolean
}>

export type CanvaRasterRequest = Readonly<{
  kind: "studio_raster"
  pageId: string
  nodeIds: readonly string[]
  groupId?: string
  bounds: CanvaElementBox
  format: "png"
  scale: number
  reasons: readonly CanvaRasterizationReason[]
}>

export type CanvaMediaSource = CanvaImageSource | CanvaRasterRequest

export type CanvaImageFill = Readonly<{
  kind: "image"
  source: CanvaMediaSource
  dropTarget: false
}>

export type CanvaShapePath = Readonly<{
  d: string
  fill: CanvaSolidFill | CanvaImageFill | null
  stroke?: Readonly<{
    color: string
    weight: number
  }>
}>

export type CanvaShapeElement = CanvaElementBase &
  Readonly<{
    type: "shape"
    viewBox: Readonly<{
      top: number
      left: number
      width: number
      height: number
    }>
    paths: readonly CanvaShapePath[]
  }>

export type CanvaTextStyle = Readonly<{
  color: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  decoration: "none" | "underline" | "strikethrough"
  lineHeight: number
  letterSpacing: number
}>

export type CanvaTextRange = Readonly<{
  start: number
  end: number
  style: Partial<CanvaTextStyle>
}>

export type CanvaParagraphRange = Readonly<{
  start: number
  end: number
  align: "start" | "center" | "end" | "justify"
  list?: Readonly<{
    kind: "bulleted" | "numbered"
    level: number
    start?: number
  }>
}>

export type CanvaTextElement = CanvaElementBase &
  Readonly<{
    type: "text"
    text: string
    style: CanvaTextStyle
    ranges: readonly CanvaTextRange[]
    paragraphs: readonly CanvaParagraphRange[]
    horizontalAlignment: "start" | "center" | "end" | "justify"
    verticalAlignment: "start" | "center" | "end"
  }>

export type CanvaRasterElement = CanvaElementBase &
  Readonly<{
    type: "rect"
    fill: CanvaImageFill & Readonly<{ source: CanvaRasterRequest }>
  }>

export type CanvaGroupElement = CanvaElementBase &
  Readonly<{
    type: "group"
    children: readonly CanvaPlannedElement[]
  }>

/**
 * These variants correspond to Canva absolute-page concepts. The host adapter
 * converts them to the installed Canva SDK version at the application edge.
 */
export type CanvaPlannedElement =
  CanvaShapeElement | CanvaTextElement | CanvaRasterElement | CanvaGroupElement

export type CanvaImportWarning = Readonly<{
  code: CanvaImportWarningCode
  message: string
  pageId?: string
  nodeIds?: readonly string[]
  groupId?: string
}>

export type CanvaCompatibilityReport = Readonly<{
  nativeEditableNodeIds: readonly string[]
  rasterizations: readonly CanvaRasterRequest[]
  warnings: readonly CanvaImportWarning[]
}>

export type CanvaAbsolutePagePlan = Readonly<{
  sourcePageId: string
  name: string
  width: number
  height: number
  background: string
  /** Back to front, matching Canva's element collection order. */
  elements: readonly CanvaPlannedElement[]
}>

export type CanvaImportPlan = Readonly<{
  format: "webmcp-studio-canva-import"
  version: 1
  source: Readonly<{
    documentId: string
    documentName: string
    revision: number
    interchangeVersion: number
  }>
  pages: readonly CanvaAbsolutePagePlan[]
  compatibility: CanvaCompatibilityReport
}>

export type CanvaResolvedAsset = Readonly<{
  /** Opaque Canva asset reference returned by `@canva/asset`. */
  ref: string
}>

export type CanvaResolvedImageFill = Readonly<{
  kind: "image"
  ref: string
  dropTarget: false
}>

export type CanvaResolvedShapePath = Omit<CanvaShapePath, "fill"> &
  Readonly<{
    fill: CanvaSolidFill | CanvaResolvedImageFill | null
  }>

export type CanvaResolvedElement =
  | (Omit<CanvaShapeElement, "paths"> &
      Readonly<{ paths: readonly CanvaResolvedShapePath[] }>)
  | CanvaTextElement
  | (Omit<CanvaRasterElement, "fill"> &
      Readonly<{ fill: CanvaResolvedImageFill }>)
  | (Omit<CanvaGroupElement, "children"> &
      Readonly<{ children: readonly CanvaResolvedElement[] }>)

/**
 * The small boundary a Canva app must implement with its installed Apps SDK.
 * It deliberately does not depend on `@canva/design`, which is not installed
 * in this repository and changes independently from Studio's document model.
 */
export interface CanvaImportHost<PageHandle = unknown> {
  beginImport(plan: CanvaImportPlan): Promise<void>
  ensureAbsolutePage(
    page: CanvaAbsolutePagePlan,
    index: number
  ): Promise<PageHandle>
  uploadImage(source: CanvaImageSource): Promise<CanvaResolvedAsset>
  renderAndUploadRaster(
    request: CanvaRasterRequest
  ): Promise<CanvaResolvedAsset>
  insertElements(
    page: PageHandle,
    elements: readonly CanvaResolvedElement[]
  ): Promise<void>
  completeImport(plan: CanvaImportPlan): Promise<void>
  failImport?(plan: CanvaImportPlan, error: unknown): Promise<void>
}

export type CanvaImportResult = Readonly<{
  pageCount: number
  nativeEditableNodeCount: number
  rasterizedSelectionCount: number
  compatibility: CanvaCompatibilityReport
}>
