import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const studioRoot = resolve(import.meta.dirname, "../../..")
const repositoryRoot = resolve(studioRoot, "../..")

async function editorProductionComponents() {
  const editorRoot = resolve(studioRoot, "src/features/editor")
  const entries = await readdir(editorRoot, { withFileTypes: true })
  return [
    resolve(studioRoot, "src/features/studio-shell.tsx"),
    ...entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".tsx") &&
          !entry.name.endsWith(".test.tsx")
      )
      .map((entry) => resolve(editorRoot, entry.name)),
  ]
}

describe("editor visual contracts", () => {
  it("keeps product chrome at or above the 11px metadata floor", async () => {
    const violations: string[] = []

    for (const path of await editorProductionComponents()) {
      const source = await readFile(path, "utf8")
      if (/text-\[(?:[1-9]|10)px\]/.test(source)) {
        violations.push(path.replace(`${repositoryRoot}/`, ""))
      }
    }

    expect(violations).toEqual([])
  })

  it("keeps dark artwork separated from the editor workspace", async () => {
    const styles = await readFile(
      resolve(repositoryRoot, "packages/ui/src/styles/globals.css"),
      "utf8"
    )

    expect(styles).toMatch(
      /\.dark\s*\{[\s\S]*--workspace:\s*oklch\(0\.19 0\.006 90\)/
    )
  })

  it("does not animate unbounded properties on shared pressable controls", async () => {
    for (const component of ["button.tsx", "toggle.tsx", "badge.tsx"]) {
      const source = await readFile(
        resolve(repositoryRoot, `packages/ui/src/components/${component}`),
        "utf8"
      )
      expect(source).not.toContain("transition-all")
    }
  })
})
