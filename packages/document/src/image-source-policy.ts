export const maxInlineImageCharacters = 6_000_000

const SAFE_INLINE_RASTER =
  /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i
const SAFE_INLINE_SVG_PREFIX = /^data:image\/svg\+xml(?:;charset=utf-8)?,/i
const UNSAFE_SVG =
  /<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|url\s*\(|@import|(?:https?|file|javascript):|\/\//i

export function isRenderSafeImageSource(source: string): boolean {
  if (source.length > maxInlineImageCharacters) return false
  if (SAFE_INLINE_RASTER.test(source)) return true
  if (!SAFE_INLINE_SVG_PREFIX.test(source)) return false

  const separator = source.indexOf(",")
  if (separator < 0) return false
  try {
    const svg = decodeURIComponent(source.slice(separator + 1))
    const withoutStandardNamespace = svg.replace(
      /\sxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i,
      ""
    )
    const withoutLocalPaintReferences = withoutStandardNamespace.replaceAll(
      /url\(#[a-z_][a-z0-9_.:-]*\)/gi,
      ""
    )
    return !UNSAFE_SVG.test(withoutLocalPaintReferences)
  } catch {
    return false
  }
}
