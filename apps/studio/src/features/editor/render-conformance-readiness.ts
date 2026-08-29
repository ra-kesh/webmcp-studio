import type { Document } from "@webmcp/document"
import type { CanvasFontFaceSet } from "./fabric-artboard"
import { waitForCanvasDocumentFonts } from "./fabric-artboard"

export async function waitForRenderViewDocumentFonts(
  document: Document,
  pageId: string,
  fontFaceSet: CanvasFontFaceSet | undefined
) {
  await waitForCanvasDocumentFonts(document, pageId, fontFaceSet)
}
