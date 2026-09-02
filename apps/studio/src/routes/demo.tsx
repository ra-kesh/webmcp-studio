import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ArrowRight, FileStack } from "lucide-react"
import { Button } from "@webmcp/ui/components/button"

export const Route = createFileRoute("/demo")({
  component: DemoLoginRoute,
})

type DemoLoginResponse = {
  error?: { message?: string }
}

function DemoLoginRoute() {
  const [status, setStatus] = useState<"idle" | "starting" | "failed">("idle")
  const [message, setMessage] = useState("")

  const startDemo = async () => {
    if (status === "starting") return
    setStatus("starting")
    setMessage("")
    try {
      const response = await fetch("/v1/studio/session/demo", {
        method: "POST",
        headers: { Accept: "application/json" },
      })
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => ({}))) as DemoLoginResponse
        throw new Error(payload.error?.message ?? "The demo could not start")
      }
      window.location.assign("/")
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The demo could not start"
      )
      setStatus("failed")
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#fafafa] px-5 py-10 text-[#1f1f1f]">
      <section className="w-full max-w-[420px] rounded-xl border border-[#e5e5e5] bg-white p-8 shadow-[0_10px_30px_rgba(0,0,0,0.06)] sm:p-10">
        <div className="mb-8 flex size-10 items-center justify-center rounded-lg bg-[#1f1f1f] text-white">
          <FileStack aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </div>
        <h1 className="text-[28px] font-semibold tracking-[-0.035em]">
          Try WebMCP Studio
        </h1>
        <p className="mt-3 max-w-[34ch] text-[15px] leading-6 text-[#666]">
          Open a private demo workspace. No account or password required.
        </p>

        <Button
          className="mt-8 h-11 w-full justify-between px-4"
          disabled={status === "starting"}
          onClick={startDemo}
        >
          <span>
            {status === "starting" ? "Opening demo..." : "Continue as demo"}
          </span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>

        <p className="mt-4 min-h-5 text-[13px] leading-5 text-[#777]">
          {status === "failed"
            ? message
            : "Your demo data expires after 24 hours."}
        </p>
      </section>
    </main>
  )
}
