import { describe, expect, it } from "vitest"
import { imageCropKeyboardScreenDelta } from "./image-crop-keyboard"

describe("image crop keyboard nudge", () => {
  it.each([
    ["ArrowLeft", false, { x: -1, y: 0 }],
    ["ArrowRight", false, { x: 1, y: 0 }],
    ["ArrowUp", false, { x: 0, y: -1 }],
    ["ArrowDown", false, { x: 0, y: 1 }],
    ["ArrowLeft", true, { x: -10, y: 0 }],
    ["ArrowRight", true, { x: 10, y: 0 }],
    ["ArrowUp", true, { x: 0, y: -10 }],
    ["ArrowDown", true, { x: 0, y: 10 }],
  ] as const)("maps %s coarse=%s to screen pixels", (key, coarse, expected) => {
    expect(imageCropKeyboardScreenDelta(key, coarse)).toEqual(expected)
  })
})
