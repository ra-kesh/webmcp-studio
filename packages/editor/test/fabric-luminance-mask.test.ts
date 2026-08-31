import { Rect, setEnv } from "fabric"
import { getEnv as getNodeFabricEnv, StaticCanvas } from "fabric/node"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { createFabricLuminanceMaskUnion } from "../src/fabric-luminance-mask"

beforeAll(() => setEnv(getNodeFabricEnv()))

const source = (left: number, fill: string, opacity = 1, width = 20) =>
  new Rect({
    left,
    top: 0,
    width,
    height: 20,
    originX: "left",
    originY: "top",
    fill,
    strokeWidth: 0,
    opacity,
  })

const alphaAt = (
  mask: ReturnType<typeof createFabricLuminanceMaskUnion>,
  x: number
) => {
  const canvas = mask.maskObject.getElement() as HTMLCanvasElement
  return canvas.getContext("2d")!.getImageData(x, 10, 1, 1).data[3]!
}

describe("Fabric luminance mask source union", () => {
  it("converts coefficient-sensitive sRGB source paint and alpha", () => {
    const red = source(0, "#ff0000")
    const green = source(20, "#00ff00", 0.5)
    const transparentBlue = source(40, "#0000ff", 0)
    const result = createFabricLuminanceMaskUnion(
      "luminance-colors",
      [
        ["red", red],
        ["green", green],
        ["transparent-blue", transparentBlue],
      ],
      { x: 0, y: 0, width: 60, height: 20 },
      1
    )

    expect([...result.sourceObjects.keys()]).toEqual([
      "red",
      "green",
      "transparent-blue",
    ])
    expect(alphaAt(result, 10)).toBe(54)
    expect(alphaAt(result, 30)).toBe(92)
    expect(alphaAt(result, 50)).toBe(0)
    expect(result.maskObject).toMatchObject({
      globalCompositeOperation: "destination-in",
      opacity: 1,
    })
  })

  it("unions converted sources with source-over alpha", () => {
    const result = createFabricLuminanceMaskUnion(
      "luminance-union",
      [
        ["red", source(0, "#ff0000")],
        ["green", source(0, "#00ff00")],
      ],
      { x: 0, y: 0, width: 20, height: 20 },
      1
    )

    expect(alphaAt(result, 10)).toBe(197)
  })

  it("attributes source rasterization failures before union", () => {
    const broken = source(0, "#ffffff")
    vi.spyOn(broken, "toCanvasElement").mockImplementation(() => {
      throw new Error("raster failed")
    })

    expect(() =>
      createFabricLuminanceMaskUnion(
        "luminance-failure",
        [["broken-source", broken]],
        { x: 0, y: 0, width: 20, height: 20 },
        1
      )
    ).toThrow("Fabric luminance mask source broken-source conversion failed")
  })

  it("clamps the retained backing store to the admitted 2x ratio", () => {
    const result = createFabricLuminanceMaskUnion(
      "luminance-ratio",
      [
        ["red", source(0, "#ff0000", 1, 10)],
        ["green", source(10, "#00ff00", 1, 10)],
      ],
      { x: 0, y: 0, width: 20, height: 20 },
      3
    )

    const canvas = result.maskObject.getElement() as HTMLCanvasElement
    expect([canvas.width, canvas.height]).toEqual([40, 40])
    const rendered = new StaticCanvas(undefined, {
      width: 20,
      height: 20,
      enableRetinaScaling: false,
      renderOnAddRemove: false,
    })
    rendered.add(source(0, "#ffffff"), result.maskObject)
    rendered.renderAll()
    const renderedAlpha = (x: number) =>
      rendered.contextContainer.getImageData(x, 10, 1, 1).data[3]!
    expect(renderedAlpha(5)).toBe(54)
    expect(renderedAlpha(15)).toBe(182)
    rendered.dispose()
  })
})
