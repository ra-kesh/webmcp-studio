import {
  managedRendererFonts,
  rendererFontFaces,
  renderPolicyLimits,
} from "./render-policy"

export const STUDIO_DESIGN_PLAN_VERSION = 1 as const

export const studioGenerationLimits = Object.freeze({
  maxRequestBytes: 512 * 1024,
  maxPromptCharacters: 16_000,
  maxPages: 20,
  maxOutputs: 20,
  maxNodes: 1_000,
  maxGroups: 250,
  maxGroupDepth: 16,
  maxTypographyStyles: 100,
  maxPaintStyles: 100,
  maxVariables: 100,
  maxFields: 100,
  maxBindings: 2_000,
  maxReferences: 4,
  maxDesignGuides: 4,
  maxNormalizedDesignGuideBytes: 64 * 1024,
  maxTemplateCommands: 24,
  maxLocalIdCharacters: 64,
  maxNameCharacters: 120,
  maxTextCharacters: 10_000,
  maxIconPathCharacters: 16_384,
  maxCanonicalUrlCharacters: 2_048,
  maxPrinciplesPerGuide: 24,
  maxPrincipleCharacters: 500,
  maxIdempotencyKeyCharacters: 128,
  // Three complete candidates are enough for propose, inspect, and two focused
  // repair passes without allowing an unbounded renderer or Review loop.
  maxCandidateReplacements: 2,
  maxPageDimension: renderPolicyLimits.maxPageDimension,
  maxPagePixelArea: renderPolicyLimits.maxPagePixelArea,
})

export const studioBlankDocumentPresets = [
  {
    id: "portrait",
    name: "Portrait document",
    width: 1_240,
    height: 1_754,
    outputKind: "proposal",
    exportFormats: ["png", "pdf"],
  },
  {
    id: "square",
    name: "Square social",
    width: 1_080,
    height: 1_080,
    outputKind: "social",
    exportFormats: ["png", "pdf"],
  },
  {
    id: "story",
    name: "Social story",
    width: 1_080,
    height: 1_920,
    outputKind: "social",
    exportFormats: ["png", "pdf"],
  },
] as const

export const studioDesignPlanVocabulary = Object.freeze({
  version: STUDIO_DESIGN_PLAN_VERSION,
  localIds: {
    pattern: "^[a-z][a-z0-9_-]{0,63}$",
    scope: "request",
    canonicalIdsAccepted: false,
  },
  output: {
    properties: ["localId", "name", "kind", "pageLocalIds", "exportFormats"],
    kinds: ["proposal", "social", "custom"],
    exportFormats: ["png", "pdf"],
  },
  page: {
    properties: [
      "localId",
      "outputLocalId",
      "name",
      "width",
      "height",
      "background",
      "nodeLocalIds",
    ],
  },
  node: {
    sharedProperties: [
      "localId",
      "pageLocalId",
      "name",
      "x",
      "y",
      "width",
      "height",
      "rotation",
      "opacity",
      "visible",
      "locked",
    ],
    types: {
      text: [
        "text",
        "color",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "italic",
        "decoration",
        "lineHeight",
        "letterSpacing",
        "align",
        "sizingMode",
        "typographyStyleLocalId",
        "paintStyleLocalId",
      ],
      rect: ["fill", "radius", "stroke", "strokeWidth", "paintStyleLocalId"],
      ellipse: ["fill", "stroke", "strokeWidth", "paintStyleLocalId"],
      line: ["stroke", "strokeWidth", "paintStyleLocalId"],
      icon: [
        "path",
        "viewBox",
        "fill",
        "stroke",
        "strokeWidth",
        "paintStyleLocalId",
      ],
      image: ["assetId", "placement", "frameMask", "alt", "decorative"],
    },
  },
  resources: {
    groups: true,
    typographyStyles: true,
    paintStyles: true,
    variables: true,
    variableBindings: true,
    fields: true,
    fieldBindings: true,
    components: false,
  },
})

export const studioGenerationCapabilities = Object.freeze({
  designPlanVersion: STUDIO_DESIGN_PLAN_VERSION,
  startModes: ["blank", "template"],
  availableFonts: [...managedRendererFonts],
  availableFontFaces: rendererFontFaces.map((face) => ({
    faceId: face.assetId,
    family: face.family,
    style: face.style,
    weight: face.weight,
    source: face.source,
    unicodeRange: face.unicodeRange,
    contentSha256: face.sha256,
  })),
  fontDiscovery: {
    operation: "read_document_generation_capabilities",
    sources: ["bundled", "google_fonts_cache"],
    renderTimeRemoteFetch: false,
    googleFontRule:
      "A Google Fonts face becomes renderable only after Studio caches its exact bytes and content hash.",
  },
  approvedAssetRule:
    "Image layers and asset fields accept only asset IDs returned by Studio. URLs are provenance only.",
  templateChanges: {
    targetDiscovery: "read_template.editableNodes",
    fieldValues: "Use field keys returned by read_template.fields.",
    nodeOperations: ["set_text", "set_visibility", "asset_substitution"],
    pageOperations: ["insert_image"],
    privateTemplateBodyRequired: false,
  },
  executableInput: {
    jsx: false,
    html: false,
    css: false,
    scripts: false,
  },
  review: {
    isolatedCandidate: true,
    currentDocumentMutationBeforeApproval: false,
    approvalAction: "Create editable document",
    rejectionCreatesDocument: false,
    candidateReplacementLimit: studioGenerationLimits.maxCandidateReplacements,
  },
  idempotency: {
    required: true,
    keyPattern: "^[A-Za-z0-9._:-]+$",
    sameKeyDifferentPayload: "rejected",
    replayCreatesDuplicate: false,
  },
  limits: studioGenerationLimits,
})

export type StudioBlankDocumentPreset =
  (typeof studioBlankDocumentPresets)[number]
