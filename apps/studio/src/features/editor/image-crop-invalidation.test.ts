import { describe, expect, it } from "vitest"

import { imageCropInvalidationMessage } from "./image-crop-invalidation"

describe("imageCropInvalidationMessage", () => {
  it.each([
    "document_replaced",
    "page_changed",
    "page_removed",
    "target_removed_from_page",
    "target_removed",
    "target_replaced",
    "source_changed",
    "placement_changed",
    "frame_changed",
    "frame_mask_changed",
    "target_locked",
    "target_hidden",
  ] as const)("explains %s without implying the draft was saved", (reason) => {
    const message = imageCropInvalidationMessage(reason)

    expect(message).toMatch(/^Crop was cancelled because/)
    expect(message).toMatch(/unchanged|No crop changes were applied|was kept/)
  })
})
