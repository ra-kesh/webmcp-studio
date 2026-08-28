import { defineConfig } from "vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [
        {
          configPath:
            command === "serve"
              ? "../renderer/wrangler.local.jsonc"
              : "../renderer/wrangler.jsonc",
        },
      ],
    }),
    tanstackStart(),
    viteReact(),
  ],
}))

export default config
