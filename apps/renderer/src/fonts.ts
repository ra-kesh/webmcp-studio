import { rendererFontFaces } from "@webmcp/document"
import { GEIST_LATIN_WOFF2_BASE64 } from "./geist-font"
import { GEIST_LATIN_ITALIC_WOFF2_BASE64 } from "./geist-font-italic"
import {
  INTER_LATIN_ITALIC_WOFF2_BASE64,
  INTER_LATIN_WOFF2_BASE64,
} from "./inter-font"

const fontBytesByAssetId = new Map<string, string>([
  ["geist-variable-latin-normal-5.3.0", GEIST_LATIN_WOFF2_BASE64],
  ["geist-variable-latin-italic-5.3.0", GEIST_LATIN_ITALIC_WOFF2_BASE64],
  ["inter-variable-latin-normal-5.3.0", INTER_LATIN_WOFF2_BASE64],
  ["inter-variable-latin-italic-5.3.0", INTER_LATIN_ITALIC_WOFF2_BASE64],
])

export const embeddedRendererFontFaces = rendererFontFaces.map((face) => {
  const base64 = fontBytesByAssetId.get(face.assetId)
  if (!base64) {
    throw new Error(`Renderer font bytes are missing for ${face.assetId}`)
  }
  return { ...face, base64 }
})

const fontDataUrl = (base64: string) => `data:font/woff2;base64,${base64}`

export const rendererFontFaceCss = embeddedRendererFontFaces
  .map(
    (face) =>
      `@font-face{font-family:"${face.family}";font-style:${face.style};font-display:block;font-weight:${face.weight.min} ${face.weight.max};src:url("${fontDataUrl(face.base64)}") format("woff2");unicode-range:${face.unicodeRange}}`
  )
  .join("")

export const rendererFontFaceManifest = embeddedRendererFontFaces.map(
  ({ base64: _base64, ...face }) => face
)
