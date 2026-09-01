import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TooltipProvider } from "@webmcp/ui/components/tooltip"

import appCss from "@webmcp/ui/globals.css?url"

const VERCEL_BRAND_CSS_URL = "https://vercel.com/geist/vercel-brand.css"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Proposal studio",
      },
      {
        name: "description",
        content:
          "A programmable visual document studio built for the WebMCP Challenge.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: VERCEL_BRAND_CSS_URL,
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="studio-vbg-root" data-studio-density="compact">
        <TooltipProvider>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}
