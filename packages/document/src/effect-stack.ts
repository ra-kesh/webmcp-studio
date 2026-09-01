import type { LayerEffect } from "./schema"

export const visibleLayerEffects = (
  effects: readonly LayerEffect[] | undefined
) => effects?.filter((effect) => effect.visible) ?? []

export const layerEffectFilter = (
  effects: readonly LayerEffect[] | undefined
) =>
  visibleLayerEffects(effects)
    .map((effect) =>
      effect.type === "drop_shadow"
        ? `drop-shadow(${effect.offsetX}px ${effect.offsetY}px ${effect.blur}px ${effect.color})`
        : `blur(${effect.radius}px)`
    )
    .join(" ")

export const layerEffectBounds = (
  frame: { x: number; y: number; width: number; height: number },
  effects: readonly LayerEffect[] | undefined
) =>
  visibleLayerEffects(effects).reduce((bounds, effect) => {
    const expansion =
      (effect.type === "drop_shadow" ? effect.blur : effect.radius) * 2
    if (effect.type === "layer_blur") {
      return {
        x: bounds.x - expansion,
        y: bounds.y - expansion,
        width: bounds.width + expansion * 2,
        height: bounds.height + expansion * 2,
      }
    }
    const left = Math.min(bounds.x, bounds.x + effect.offsetX - expansion)
    const top = Math.min(bounds.y, bounds.y + effect.offsetY - expansion)
    const right = Math.max(
      bounds.x + bounds.width,
      bounds.x + bounds.width + effect.offsetX + expansion
    )
    const bottom = Math.max(
      bounds.y + bounds.height,
      bounds.y + bounds.height + effect.offsetY + expansion
    )
    return { x: left, y: top, width: right - left, height: bottom - top }
  }, frame)

export const scaleLayerEffects = (
  effects: readonly LayerEffect[] | undefined,
  scale: number
): readonly LayerEffect[] | undefined =>
  effects?.map((effect) =>
    effect.type === "drop_shadow"
      ? {
          ...effect,
          offsetX: effect.offsetX * scale,
          offsetY: effect.offsetY * scale,
          blur: effect.blur * scale,
        }
      : { ...effect, radius: effect.radius * scale }
  )
