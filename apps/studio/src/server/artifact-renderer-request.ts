export function createEphemeralArtifactRendererRequest({
  path,
  body,
  signal,
}: {
  path: "/render" | "/render/pdf"
  body: unknown
  signal: AbortSignal
}) {
  return new Request(`https://renderer.internal${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Render-Persistence": "ephemeral",
    },
    body: JSON.stringify(body),
    signal,
  })
}
