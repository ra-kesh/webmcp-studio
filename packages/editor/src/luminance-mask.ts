const SRGB_LUMINANCE_RED = 0.2126
const SRGB_LUMINANCE_GREEN = 0.7152
const SRGB_LUMINANCE_BLUE = 0.0722

/**
 * Converts non-premultiplied, gamma-encoded sRGB bytes to the alpha value used
 * by Studio luminance masks. The source alpha already includes paint opacity,
 * clipping, and antialias coverage.
 */
export const srgbLuminanceMaskAlphaByte = (
  red: number,
  green: number,
  blue: number,
  alpha: number
) =>
  Math.round(
    ((SRGB_LUMINANCE_RED * red +
      SRGB_LUMINANCE_GREEN * green +
      SRGB_LUMINANCE_BLUE * blue) *
      alpha) /
      255
  )

/**
 * Rewrites RGBA pixels as a black alpha mask in place. Callers must provide
 * non-premultiplied sRGB bytes from the default or explicit
 * `{ colorSpace: "srgb", pixelFormat: "rgba-unorm8" }` Canvas 2D readback.
 */
export const convertSrgbPixelsToLuminanceMask = (pixels: Uint8ClampedArray) => {
  if (pixels.length % 4 !== 0) {
    throw new Error("Luminance mask pixels must contain complete RGBA values")
  }
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = srgbLuminanceMaskAlphaByte(
      pixels[index]!,
      pixels[index + 1]!,
      pixels[index + 2]!,
      pixels[index + 3]!
    )
    pixels[index] = 0
    pixels[index + 1] = 0
    pixels[index + 2] = 0
    pixels[index + 3] = alpha
  }
  return pixels
}
