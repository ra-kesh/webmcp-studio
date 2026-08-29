import startServerEntry from "@tanstack/react-start/server-entry"

export { RenderAdmission } from "./server/render-admission"

export type StudioRequestContext = {
  workerEnv: Env
}

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      requestContext: StudioRequestContext
    }
  }
}

// TanStack Start currently resolves server-entry and server-route context from
// different public Register exports, so both declarations must stay aligned.
declare module "@tanstack/react-router" {
  interface Register {
    server: {
      requestContext: StudioRequestContext
    }
  }
}

const studioServerEntry: ExportedHandler<Env> = {
  fetch(request, workerEnv) {
    return startServerEntry.fetch(request, {
      context: { workerEnv },
    })
  },
}

export default studioServerEntry
