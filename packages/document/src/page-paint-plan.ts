import type { Document, Page, SceneNode } from "./schema"

export type MaskPaintType = "vector" | "alpha" | "luminance"
export type MaskSourceCombination = "source_over_union"

export type MaskPaintSource =
  | Readonly<{ nodeId: string; kind: "vector" }>
  | Readonly<{ nodeId: string; kind: "image"; assetId: string }>
  | Readonly<{
      nodeId: string
      kind: "text"
      fontFaces: readonly Readonly<{
        family: string
        style: "normal" | "italic"
        weight: number
      }>[]
    }>

export type MaskPaintRelation = Readonly<{
  groupId: string
  pageId: string
  maskType: MaskPaintType
  nodeIds: readonly string[]
  sourceNodeIds: readonly string[]
}>

export type PagePaintBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type PagePaintPlanEntry =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{
      kind: "mask_group"
      groupId: string
      maskType: MaskPaintType
      sourceNodeIds: readonly string[]
      visibleSourceNodeIds: readonly string[]
      sources: readonly MaskPaintSource[]
      sourceCombination: MaskSourceCombination
      content: readonly PagePaintPlanEntry[]
      bounds: PagePaintBounds
      outputBounds: PagePaintBounds
      maskEnabled: boolean
      compositeRequired: boolean
    }>

export type PagePaintPlan = Readonly<{
  pageId: string
  entries: readonly PagePaintPlanEntry[]
}>

export const initialMaskPaintAdmission = Object.freeze({
  maxPixelRatio: 2,
  maxSources: 4,
  maxMaskedDescendants: 512,
  maxNestingDepth: 2,
  maxCompositeDimension: 8192,
  maxCompositePixelArea: 16_777_216,
  // Gate M2 admits at most four full-area composites per page. The separate
  // count cap also prevents many tiny masks from creating unbounded surfaces.
  maxActiveCompositesPerPage: 32,
  maxPageCompositePixelArea: 67_108_864,
})

/**
 * Normalizes host display ratios to the only range Gate M2 admits. Consumers
 * must use this value for both paint-plan projection and backing-store sizing.
 */
export const supportedMaskPaintPixelRatio = (requested: number) =>
  Number.isFinite(requested) && requested > 0
    ? Math.min(requested, initialMaskPaintAdmission.maxPixelRatio)
    : 1

export type PagePaintPlanErrorCode =
  | "MASK_GROUP_PAGE_MISMATCH"
  | "MASK_GROUP_DUPLICATE_ID"
  | "MASK_GROUP_UNSUPPORTED_TYPE"
  | "MASK_GROUP_UNSUPPORTED_SOURCE"
  | "MASK_GROUP_EMPTY_SOURCES"
  | "MASK_GROUP_DUPLICATE_SOURCE"
  | "MASK_GROUP_SOURCE_LIMIT"
  | "MASK_GROUP_NODE_MISSING"
  | "MASK_GROUP_SOURCE_NOT_MEMBER"
  | "MASK_GROUP_NO_CONTENT"
  | "MASK_GROUP_NONCONTIGUOUS"
  | "MASK_GROUP_OVERLAP"
  | "MASK_GROUP_NESTING_UNSUPPORTED"
  | "MASK_GROUP_CONTENT_LIMIT"
  | "MASK_GROUP_COMPOSITE_LIMIT"
  | "MASK_PAGE_COMPOSITE_COUNT_LIMIT"
  | "MASK_PAGE_COMPOSITE_AREA_LIMIT"
  | "MASK_GROUP_INVALID_PIXEL_RATIO"
  | "MASK_GROUP_PIXEL_RATIO_LIMIT"

export class PagePaintPlanError extends Error {
  readonly code: PagePaintPlanErrorCode
  readonly groupId?: string
  readonly nodeId?: string

  constructor(
    code: PagePaintPlanErrorCode,
    message: string,
    context: { groupId?: string; nodeId?: string } = {}
  ) {
    super(message)
    this.name = "PagePaintPlanError"
    this.code = code
    this.groupId = context.groupId
    this.nodeId = context.nodeId
  }
}

const rotatedFrameBounds = (node: SceneNode): PagePaintBounds => {
  const radians = (node.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const corners = [
    { x: 0, y: 0 },
    { x: node.width * cosine, y: node.width * sine },
    { x: -node.height * sine, y: node.height * cosine },
    {
      x: node.width * cosine - node.height * sine,
      y: node.width * sine + node.height * cosine,
    },
  ]
  const left = node.x + Math.min(...corners.map((corner) => corner.x))
  const top = node.y + Math.min(...corners.map((corner) => corner.y))
  const right = node.x + Math.max(...corners.map((corner) => corner.x))
  const bottom = node.y + Math.max(...corners.map((corner) => corner.y))
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

const unionBounds = (bounds: readonly PagePaintBounds[]): PagePaintBounds => {
  if (bounds.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const left = Math.min(...bounds.map((bound) => bound.x))
  const top = Math.min(...bounds.map((bound) => bound.y))
  const right = Math.max(...bounds.map((bound) => bound.x + bound.width))
  const bottom = Math.max(...bounds.map((bound) => bound.y + bound.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const projectMaskCompositeGeometry = (
  nodes: readonly SceneNode[],
  sourceNodeIds: readonly string[]
) => {
  const sourceIds = new Set(sourceNodeIds)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const visibleSourceNodeIds = sourceNodeIds.filter(
    (nodeId) => nodesById.get(nodeId)?.visible
  )
  const visibleContentNodeIds = nodes
    .filter((node) => !sourceIds.has(node.id) && node.visible)
    .map((node) => node.id)
  const maskEnabled = visibleSourceNodeIds.length > 0
  const compositeRequired = maskEnabled && visibleContentNodeIds.length > 0
  const contributingNodeIds = compositeRequired
    ? [...visibleSourceNodeIds, ...visibleContentNodeIds]
    : visibleContentNodeIds
  const bounds = unionBounds(
    contributingNodeIds.map((nodeId) =>
      rotatedFrameBounds(nodesById.get(nodeId)!)
    )
  )
  const outputBounds = unionBounds(
    visibleContentNodeIds.map((nodeId) =>
      rotatedFrameBounds(nodesById.get(nodeId)!)
    )
  )
  return {
    visibleSourceNodeIds,
    visibleContentNodeIds,
    maskEnabled,
    compositeRequired,
    bounds,
    outputBounds,
  } as const
}

export const assertCompositeAdmission = (
  groupId: string,
  bounds: PagePaintBounds,
  pixelRatio: number
) => {
  const deviceWidth = Math.ceil(bounds.width * pixelRatio)
  const deviceHeight = Math.ceil(bounds.height * pixelRatio)
  if (
    deviceWidth > initialMaskPaintAdmission.maxCompositeDimension ||
    deviceHeight > initialMaskPaintAdmission.maxCompositeDimension ||
    deviceWidth * deviceHeight > initialMaskPaintAdmission.maxCompositePixelArea
  ) {
    throw new PagePaintPlanError(
      "MASK_GROUP_COMPOSITE_LIMIT",
      `Mask group ${groupId} exceeds the initial composite admission limit`,
      { groupId }
    )
  }
}

export const isAdmittedVectorMaskSource = (
  node: SceneNode | undefined
): node is Extract<SceneNode, { type: "rect" | "ellipse" | "icon" }> =>
  Boolean(
    node &&
    (node.type === "rect" || node.type === "ellipse" || node.type === "icon") &&
    node.strokeWidth === 0
  )

export const isAdmittedAlphaMaskSource = (
  node: SceneNode | undefined
): node is Extract<
  SceneNode,
  { type: "rect" | "ellipse" | "icon" | "image" | "text" }
> =>
  Boolean(
    node &&
    (node.type === "rect" ||
      node.type === "ellipse" ||
      node.type === "icon" ||
      node.type === "image" ||
      node.type === "text")
  )

const maskPaintSource = (node: SceneNode): MaskPaintSource => {
  if (node.type === "image") {
    return { nodeId: node.id, kind: "image", assetId: node.assetId }
  }
  if (node.type === "text") {
    const fontFaces = new Map<
      string,
      { family: string; style: "normal" | "italic"; weight: number }
    >()
    const addFace = (family: string, weight: number, italic: boolean) => {
      const style = italic ? "italic" : "normal"
      fontFaces.set(`${family}\u0000${style}\u0000${weight}`, {
        family,
        style,
        weight,
      })
    }
    addFace(node.fontFamily, node.fontWeight, node.italic)
    for (const run of node.runs) {
      addFace(
        run.style.fontFamily ?? node.fontFamily,
        run.style.fontWeight ?? node.fontWeight,
        run.style.italic ?? node.italic
      )
    }
    return {
      nodeId: node.id,
      kind: "text",
      fontFaces: [...fontFaces.values()].sort(
        (left, right) =>
          left.family.localeCompare(right.family) ||
          left.style.localeCompare(right.style) ||
          left.weight - right.weight
      ),
    }
  }
  return { nodeId: node.id, kind: "vector" }
}

export const isAdmittedMaskSource = (
  maskType: MaskPaintType,
  node: SceneNode | undefined
) =>
  maskType === "vector"
    ? isAdmittedVectorMaskSource(node)
    : isAdmittedAlphaMaskSource(node)

const canonicalMaskRelationsForPage = (
  document: Document,
  page: Page
): MaskPaintRelation[] => {
  const relations: MaskPaintRelation[] = []
  for (const group of document.groups) {
    if (group.role !== "mask" || group.pageId !== page.id) continue
    if (
      group.parentGroupId ||
      document.groups.some((candidate) => candidate.parentGroupId === group.id)
    ) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NESTING_UNSUPPORTED",
        `Mask group ${group.id} exceeds the initial nesting admission`,
        { groupId: group.id }
      )
    }
    relations.push({
      groupId: group.id,
      pageId: group.pageId,
      maskType: group.mask.type,
      // The canonical contract requires mask sources and content to be direct
      // members. Do not expand descendants here: projection must reject an
      // invalid nested relation even when a caller bypasses validation.
      nodeIds: [...group.nodeIds],
      sourceNodeIds: [...group.mask.sourceNodeIds],
    })
  }
  return relations
}

type NestedProjection = Readonly<{
  entry: Extract<PagePaintPlanEntry, { kind: "mask_group" }>
  subtreeNodeIds: readonly string[]
  firstIndex: number
  leafContentCount: number
  hasVisibleOutput: boolean
}>

const projectNestedCanonicalPagePaintPlan = (
  document: Document,
  page: Page,
  pixelRatio: number
): PagePaintPlan => {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new PagePaintPlanError(
      "MASK_GROUP_INVALID_PIXEL_RATIO",
      "Mask paint pixel ratio must be finite and greater than zero"
    )
  }
  if (pixelRatio > initialMaskPaintAdmission.maxPixelRatio) {
    throw new PagePaintPlanError(
      "MASK_GROUP_PIXEL_RATIO_LIMIT",
      `Mask paint pixel ratio ${pixelRatio} exceeds the maximum of ${initialMaskPaintAdmission.maxPixelRatio}`
    )
  }
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const pageIndex = new Map(
    page.nodeIds.map((nodeId, index) => [nodeId, index])
  )
  const allGroupsById = new Map(
    document.groups.map((group) => [group.id, group])
  )
  const maskGroups = document.groups.filter(
    (group): group is Extract<Document["groups"][number], { role: "mask" }> =>
      group.role === "mask" && group.pageId === page.id
  )
  const maskGroupsById = new Map(maskGroups.map((group) => [group.id, group]))
  const childrenByParent = new Map<string, typeof maskGroups>()
  const directOwnerByNodeId = new Map<
    string,
    { groupId: string; role: Document["groups"][number]["role"] }
  >()

  for (const group of document.groups) {
    if (group.pageId !== page.id) continue
    for (const nodeId of group.nodeIds) {
      const existingOwner = directOwnerByNodeId.get(nodeId)
      if (
        existingOwner &&
        existingOwner.groupId !== group.id &&
        (existingOwner.role === "mask" || group.role === "mask")
      ) {
        throw new PagePaintPlanError(
          "MASK_GROUP_OVERLAP",
          `Node ${nodeId} has ambiguous direct ownership between groups ${existingOwner.groupId} and ${group.id}`,
          {
            groupId: group.role === "mask" ? group.id : existingOwner.groupId,
            nodeId,
          }
        )
      }
      directOwnerByNodeId.set(nodeId, { groupId: group.id, role: group.role })
    }
  }

  for (const group of maskGroups) {
    if (group.parentGroupId) {
      const parent = allGroupsById.get(group.parentGroupId)
      if (!parent || parent.pageId !== page.id) {
        throw new PagePaintPlanError(
          "MASK_GROUP_NESTING_UNSUPPORTED",
          `Mask group ${group.id} must belong to a group on its page`,
          { groupId: group.id }
        )
      }
      if (parent.role === "mask") {
        const children = childrenByParent.get(parent.id)
        if (children) children.push(group)
        else childrenByParent.set(parent.id, [group])
      }
    }
  }
  for (const group of document.groups) {
    if (
      group.role === "organize" &&
      group.parentGroupId &&
      maskGroupsById.has(group.parentGroupId)
    ) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NESTING_UNSUPPORTED",
        `Mask group ${group.parentGroupId} cannot contain organize group ${group.id}`,
        { groupId: group.parentGroupId }
      )
    }
  }

  const resolving = new Set<string>()
  const resolved = new Map<string, NestedProjection>()
  const projectGroup = (groupId: string, depth: number): NestedProjection => {
    const cached = resolved.get(groupId)
    if (cached) return cached
    const group = maskGroupsById.get(groupId)
    if (!group) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NESTING_UNSUPPORTED",
        `Mask group ${groupId} is missing from its page`,
        { groupId }
      )
    }
    if (
      resolving.has(groupId) ||
      depth > initialMaskPaintAdmission.maxNestingDepth
    ) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NESTING_UNSUPPORTED",
        `Mask group ${groupId} exceeds the bounded nesting depth`,
        { groupId }
      )
    }
    resolving.add(groupId)

    if (group.mask.sourceNodeIds.length === 0) {
      throw new PagePaintPlanError(
        "MASK_GROUP_EMPTY_SOURCES",
        `Mask group ${group.id} has no source`,
        { groupId: group.id }
      )
    }
    if (
      new Set(group.mask.sourceNodeIds).size !== group.mask.sourceNodeIds.length
    ) {
      throw new PagePaintPlanError(
        "MASK_GROUP_DUPLICATE_SOURCE",
        `Mask group ${group.id} contains a duplicate source`,
        {
          groupId: group.id,
          nodeId: group.mask.sourceNodeIds.find(
            (sourceNodeId, index) =>
              group.mask.sourceNodeIds.indexOf(sourceNodeId) !== index
          ),
        }
      )
    }
    if (
      group.mask.sourceNodeIds.length > initialMaskPaintAdmission.maxSources
    ) {
      throw new PagePaintPlanError(
        "MASK_GROUP_SOURCE_LIMIT",
        `Mask group ${group.id} exceeds the source limit`,
        { groupId: group.id }
      )
    }
    const sourceIds = new Set(group.mask.sourceNodeIds)
    const directNodes = group.nodeIds.map((nodeId) => {
      const node = nodesById.get(nodeId)
      if (!node || !pageIndex.has(nodeId)) {
        throw new PagePaintPlanError(
          "MASK_GROUP_NODE_MISSING",
          `Mask group ${group.id} references missing page node ${nodeId}`,
          { groupId: group.id, nodeId }
        )
      }
      return node
    })
    for (const sourceNodeId of group.mask.sourceNodeIds) {
      if (!group.nodeIds.includes(sourceNodeId)) {
        throw new PagePaintPlanError(
          "MASK_GROUP_SOURCE_NOT_MEMBER",
          `Mask source ${sourceNodeId} is not a direct group member`,
          { groupId: group.id, nodeId: sourceNodeId }
        )
      }
      if (!isAdmittedMaskSource(group.mask.type, nodesById.get(sourceNodeId))) {
        throw new PagePaintPlanError(
          "MASK_GROUP_UNSUPPORTED_SOURCE",
          `Mask source ${sourceNodeId} is not admitted for ${group.mask.type}`,
          { groupId: group.id, nodeId: sourceNodeId }
        )
      }
    }

    const children = (childrenByParent.get(group.id) ?? []).map((child) =>
      projectGroup(child.id, depth + 1)
    )
    const directContentNodes = directNodes.filter(
      (node) => !sourceIds.has(node.id)
    )
    if (directContentNodes.length === 0 && children.length === 0) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NO_CONTENT",
        `Mask group ${group.id} has no content`,
        { groupId: group.id }
      )
    }
    const leafContentCount =
      directContentNodes.length +
      children.reduce((count, child) => count + child.leafContentCount, 0)
    if (leafContentCount > initialMaskPaintAdmission.maxMaskedDescendants) {
      throw new PagePaintPlanError(
        "MASK_GROUP_CONTENT_LIMIT",
        `Mask group ${group.id} exceeds the masked-content limit`,
        { groupId: group.id }
      )
    }

    const subtreeNodeIds = [
      ...group.nodeIds,
      ...children.flatMap((child) => child.subtreeNodeIds),
    ].sort((left, right) => pageIndex.get(left)! - pageIndex.get(right)!)
    const indexes = subtreeNodeIds.map((nodeId) => pageIndex.get(nodeId)!)
    const firstIndex = Math.min(...indexes)
    const lastIndex = Math.max(...indexes)
    if (lastIndex - firstIndex + 1 !== indexes.length) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NONCONTIGUOUS",
        `Mask group ${group.id} is not contiguous in page paint order`,
        { groupId: group.id }
      )
    }

    const content = [
      ...directContentNodes.map((node) => ({
        index: pageIndex.get(node.id)!,
        entry: { kind: "node", nodeId: node.id } as const,
      })),
      ...children.map((child) => ({
        index: child.firstIndex,
        entry: child.entry,
      })),
    ]
      .sort((left, right) => left.index - right.index)
      .map((item) => item.entry)
    const visibleDirectContent = directContentNodes.filter(
      (node) => node.visible
    )
    const outputBounds = unionBounds([
      ...visibleDirectContent.map(rotatedFrameBounds),
      ...children
        .filter((child) => child.hasVisibleOutput)
        .map((child) => child.entry.outputBounds),
    ])
    const hasVisibleOutput =
      visibleDirectContent.length > 0 ||
      children.some((child) => child.hasVisibleOutput)
    const visibleSourceNodeIds = group.mask.sourceNodeIds.filter(
      (nodeId) => nodesById.get(nodeId)?.visible
    )
    const maskEnabled = visibleSourceNodeIds.length > 0
    const compositeRequired = maskEnabled && hasVisibleOutput
    const bounds = compositeRequired
      ? unionBounds([
          ...visibleSourceNodeIds.map((nodeId) =>
            rotatedFrameBounds(nodesById.get(nodeId)!)
          ),
          outputBounds,
        ])
      : outputBounds
    const result: NestedProjection = {
      entry: {
        kind: "mask_group",
        groupId: group.id,
        maskType: group.mask.type,
        sourceNodeIds: [...group.mask.sourceNodeIds],
        visibleSourceNodeIds,
        sources: group.mask.sourceNodeIds.map((sourceNodeId) =>
          maskPaintSource(nodesById.get(sourceNodeId)!)
        ),
        sourceCombination: "source_over_union",
        content,
        bounds,
        outputBounds,
        maskEnabled,
        compositeRequired,
      },
      subtreeNodeIds,
      firstIndex,
      leafContentCount,
      hasVisibleOutput,
    }
    resolving.delete(groupId)
    resolved.set(groupId, result)
    return result
  }

  const roots = maskGroups
    .filter(
      (group) =>
        !group.parentGroupId ||
        allGroupsById.get(group.parentGroupId)?.role !== "mask"
    )
    .map((group) => projectGroup(group.id, 1))
  if (resolved.size !== maskGroups.length) {
    const unresolved = maskGroups.find((group) => !resolved.has(group.id))!
    projectGroup(unresolved.id, 1)
  }

  let activeCompositeCount = 0
  let admittedDevicePixelArea = 0
  const admit = (entry: PagePaintPlanEntry) => {
    if (entry.kind !== "mask_group") return
    for (const child of entry.content) admit(child)
    if (!entry.compositeRequired) return
    assertCompositeAdmission(entry.groupId, entry.bounds, pixelRatio)
    activeCompositeCount += 1
    admittedDevicePixelArea +=
      Math.ceil(entry.bounds.width * pixelRatio) *
      Math.ceil(entry.bounds.height * pixelRatio)
    if (
      activeCompositeCount >
      initialMaskPaintAdmission.maxActiveCompositesPerPage
    ) {
      throw new PagePaintPlanError(
        "MASK_PAGE_COMPOSITE_COUNT_LIMIT",
        `Page ${page.id} exceeds the active composite count limit`
      )
    }
    if (
      admittedDevicePixelArea >
      initialMaskPaintAdmission.maxPageCompositePixelArea
    ) {
      throw new PagePaintPlanError(
        "MASK_PAGE_COMPOSITE_AREA_LIMIT",
        `Page ${page.id} exceeds the admitted composite area limit`
      )
    }
  }
  for (const root of roots) admit(root.entry)

  const rootByNodeId = new Map<string, NestedProjection>()
  for (const root of roots) {
    for (const nodeId of root.subtreeNodeIds) {
      const existing = rootByNodeId.get(nodeId)
      if (existing) {
        throw new PagePaintPlanError(
          "MASK_GROUP_OVERLAP",
          `Node ${nodeId} belongs to multiple top-level mask subtrees`,
          { groupId: root.entry.groupId, nodeId }
        )
      }
      rootByNodeId.set(nodeId, root)
    }
  }
  const entries: PagePaintPlanEntry[] = []
  for (const nodeId of page.nodeIds) {
    const root = rootByNodeId.get(nodeId)
    if (!root) entries.push({ kind: "node", nodeId })
    else if (root.firstIndex === pageIndex.get(nodeId)) entries.push(root.entry)
  }
  return { pageId: page.id, entries }
}

/**
 * Projects a canonical document page. Organize groups intentionally contribute
 * no relation, preserving the legacy flat paint traversal. The relation overload
 * below remains internal M0 fixture support until those fixtures are retired.
 */
export function projectPagePaintPlan(
  document: Document,
  pageId: string,
  options?: { pixelRatio?: number }
): PagePaintPlan
/** @internal Gate M0 relation-fixture compatibility only. */
export function projectPagePaintPlan(
  page: Page,
  nodes: readonly SceneNode[],
  maskRelations: readonly MaskPaintRelation[],
  options?: { pixelRatio?: number }
): PagePaintPlan
export function projectPagePaintPlan(
  documentOrPage: Document | Page,
  pageIdOrNodes: string | readonly SceneNode[],
  relationsOrOptions:
    readonly MaskPaintRelation[] | { pixelRatio?: number } = [],
  options: { pixelRatio?: number } = {}
): PagePaintPlan {
  if ("pages" in documentOrPage) {
    if (typeof pageIdOrNodes !== "string") {
      throw new Error("Canonical paint-plan projection requires a page id")
    }
    const page = documentOrPage.pages.find(
      (candidate) => candidate.id === pageIdOrNodes
    )
    if (!page) throw new Error(`Unknown page: ${pageIdOrNodes}`)
    const projectionOptions = (
      Array.isArray(relationsOrOptions) ? {} : relationsOrOptions
    ) as { pixelRatio?: number }
    const hasNestedMask = documentOrPage.groups.some(
      (group) =>
        group.role === "mask" &&
        group.pageId === page.id &&
        (Boolean(group.parentGroupId) ||
          documentOrPage.groups.some(
            (candidate) => candidate.parentGroupId === group.id
          ))
    )
    return hasNestedMask
      ? projectNestedCanonicalPagePaintPlan(
          documentOrPage,
          page,
          projectionOptions.pixelRatio ?? 1
        )
      : projectPagePaintPlanFromRelations(
          page,
          documentOrPage.nodes,
          canonicalMaskRelationsForPage(documentOrPage, page),
          projectionOptions
        )
  }
  if (typeof pageIdOrNodes === "string") {
    throw new Error("Relation paint-plan projection requires page nodes")
  }
  return projectPagePaintPlanFromRelations(
    documentOrPage,
    pageIdOrNodes,
    relationsOrOptions as readonly MaskPaintRelation[],
    options
  )
}

/**
 * Builds the shared structural paint plan without depending on Fabric, DOM,
 * decoded resources, or provider URLs. Geometry follows the top-left rotation
 * origin shared by Fabric, React, and renderer HTML. Gate M0 passes relations explicitly;
 * schema v6 will derive the same input from canonical document groups.
 */
export function projectPagePaintPlanFromRelations(
  page: Page,
  nodes: readonly SceneNode[],
  maskRelations: readonly MaskPaintRelation[],
  options: { pixelRatio?: number } = {}
): PagePaintPlan {
  const pixelRatio = options.pixelRatio ?? 1
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new PagePaintPlanError(
      "MASK_GROUP_INVALID_PIXEL_RATIO",
      "Mask paint pixel ratio must be finite and greater than zero"
    )
  }
  if (pixelRatio > initialMaskPaintAdmission.maxPixelRatio) {
    throw new PagePaintPlanError(
      "MASK_GROUP_PIXEL_RATIO_LIMIT",
      `Mask paint pixel ratio ${pixelRatio} exceeds the Gate M2 maximum of ${initialMaskPaintAdmission.maxPixelRatio}`
    )
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const pageIndex = new Map(
    page.nodeIds.map((nodeId, index) => [nodeId, index])
  )
  const relationByNodeId = new Map<string, MaskPaintRelation>()
  const firstNodeByGroupId = new Map<string, string>()
  const groupIds = new Set<string>()

  for (const relation of maskRelations) {
    if (groupIds.has(relation.groupId)) {
      throw new PagePaintPlanError(
        "MASK_GROUP_DUPLICATE_ID",
        `Mask group ${relation.groupId} is duplicated`,
        { groupId: relation.groupId }
      )
    }
    groupIds.add(relation.groupId)
    if (relation.pageId !== page.id) {
      throw new PagePaintPlanError(
        "MASK_GROUP_PAGE_MISMATCH",
        `Mask group ${relation.groupId} does not belong to page ${page.id}`,
        { groupId: relation.groupId }
      )
    }
    if (relation.sourceNodeIds.length === 0) {
      throw new PagePaintPlanError(
        "MASK_GROUP_EMPTY_SOURCES",
        `Mask group ${relation.groupId} has no source`,
        { groupId: relation.groupId }
      )
    }
    if (
      relation.maskType !== "vector" &&
      relation.maskType !== "alpha" &&
      relation.maskType !== "luminance"
    ) {
      throw new PagePaintPlanError(
        "MASK_GROUP_UNSUPPORTED_TYPE",
        `Mask group ${relation.groupId} uses an unsupported mask type`,
        { groupId: relation.groupId }
      )
    }
    if (relation.sourceNodeIds.length > initialMaskPaintAdmission.maxSources) {
      throw new PagePaintPlanError(
        "MASK_GROUP_SOURCE_LIMIT",
        `Mask group ${relation.groupId} exceeds the initial source limit`,
        { groupId: relation.groupId }
      )
    }
    if (
      relation.nodeIds.length - relation.sourceNodeIds.length >
      initialMaskPaintAdmission.maxMaskedDescendants
    ) {
      throw new PagePaintPlanError(
        "MASK_GROUP_CONTENT_LIMIT",
        `Mask group ${relation.groupId} exceeds the initial content limit`,
        { groupId: relation.groupId }
      )
    }

    const sourceIds = new Set(relation.sourceNodeIds)
    const contentNodeIds = relation.nodeIds.filter(
      (nodeId) => !sourceIds.has(nodeId)
    )
    if (contentNodeIds.length === 0) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NO_CONTENT",
        `Mask group ${relation.groupId} has no content`,
        { groupId: relation.groupId }
      )
    }

    const indices = relation.nodeIds.map((nodeId) => {
      const node = nodesById.get(nodeId)
      const index = pageIndex.get(nodeId)
      if (!node || index === undefined) {
        throw new PagePaintPlanError(
          "MASK_GROUP_NODE_MISSING",
          `Mask group ${relation.groupId} references missing page node ${nodeId}`,
          { groupId: relation.groupId, nodeId }
        )
      }
      const existing = relationByNodeId.get(nodeId)
      if (existing) {
        throw new PagePaintPlanError(
          "MASK_GROUP_OVERLAP",
          `Node ${nodeId} belongs to multiple mask groups`,
          { groupId: relation.groupId, nodeId }
        )
      }
      relationByNodeId.set(nodeId, relation)
      return index
    })

    for (const sourceNodeId of sourceIds) {
      if (!relation.nodeIds.includes(sourceNodeId)) {
        throw new PagePaintPlanError(
          "MASK_GROUP_SOURCE_NOT_MEMBER",
          `Mask source ${sourceNodeId} is not a direct group member`,
          { groupId: relation.groupId, nodeId: sourceNodeId }
        )
      }
      const sourceNode = nodesById.get(sourceNodeId)
      if (!isAdmittedMaskSource(relation.maskType, sourceNode)) {
        throw new PagePaintPlanError(
          "MASK_GROUP_UNSUPPORTED_SOURCE",
          `Mask source ${sourceNodeId} is not admitted for a ${relation.maskType} mask`,
          { groupId: relation.groupId, nodeId: sourceNodeId }
        )
      }
    }

    const firstIndex = Math.min(...indices)
    const lastIndex = Math.max(...indices)
    if (lastIndex - firstIndex + 1 !== indices.length) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NONCONTIGUOUS",
        `Mask group ${relation.groupId} is not contiguous in page paint order`,
        { groupId: relation.groupId }
      )
    }
    const firstNodeId = page.nodeIds[firstIndex]
    if (!firstNodeId) {
      throw new PagePaintPlanError(
        "MASK_GROUP_NODE_MISSING",
        `Mask group ${relation.groupId} has no first page node`,
        { groupId: relation.groupId }
      )
    }
    firstNodeByGroupId.set(relation.groupId, firstNodeId)
  }

  const entries: PagePaintPlanEntry[] = []
  let activeCompositeCount = 0
  let admittedDevicePixelArea = 0
  for (const nodeId of page.nodeIds) {
    const relation = relationByNodeId.get(nodeId)
    if (!relation) {
      entries.push({ kind: "node", nodeId })
      continue
    }
    if (firstNodeByGroupId.get(relation.groupId) !== nodeId) continue

    const sourceIds = new Set(relation.sourceNodeIds)
    const contentNodeIds = page.nodeIds.filter(
      (candidateId) =>
        relationByNodeId.get(candidateId)?.groupId === relation.groupId &&
        !sourceIds.has(candidateId)
    )
    const geometry = projectMaskCompositeGeometry(
      relation.nodeIds.map((nodeId) => nodesById.get(nodeId)!),
      relation.sourceNodeIds
    )
    if (geometry.compositeRequired) {
      assertCompositeAdmission(relation.groupId, geometry.bounds, pixelRatio)
      activeCompositeCount += 1
      admittedDevicePixelArea +=
        Math.ceil(geometry.bounds.width * pixelRatio) *
        Math.ceil(geometry.bounds.height * pixelRatio)
      if (
        activeCompositeCount >
        initialMaskPaintAdmission.maxActiveCompositesPerPage
      ) {
        throw new PagePaintPlanError(
          "MASK_PAGE_COMPOSITE_COUNT_LIMIT",
          `Page ${page.id} exceeds the Gate M2 active composite count limit`
        )
      }
      if (
        admittedDevicePixelArea >
        initialMaskPaintAdmission.maxPageCompositePixelArea
      ) {
        throw new PagePaintPlanError(
          "MASK_PAGE_COMPOSITE_AREA_LIMIT",
          `Page ${page.id} exceeds the Gate M2 admitted composite area limit`
        )
      }
    }
    entries.push({
      kind: "mask_group",
      groupId: relation.groupId,
      maskType: relation.maskType,
      sourceNodeIds: [...relation.sourceNodeIds],
      visibleSourceNodeIds: geometry.visibleSourceNodeIds,
      sources: relation.sourceNodeIds.map((sourceNodeId) =>
        maskPaintSource(nodesById.get(sourceNodeId)!)
      ),
      sourceCombination: "source_over_union",
      content: contentNodeIds.map((contentNodeId) => ({
        kind: "node",
        nodeId: contentNodeId,
      })),
      bounds: geometry.bounds,
      outputBounds: geometry.outputBounds,
      maskEnabled: geometry.maskEnabled,
      compositeRequired: geometry.compositeRequired,
    })
  }

  return { pageId: page.id, entries }
}
