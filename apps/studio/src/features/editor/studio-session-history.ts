export type SessionHistoryAction = Readonly<{
  kind: "document" | "guide"
  id: string
}>

export type SessionHistoryLedger = Readonly<{
  past: readonly SessionHistoryAction[]
  future: readonly SessionHistoryAction[]
}>

const SESSION_HISTORY_LIMIT = 200

export const createSessionHistory = (): SessionHistoryLedger => ({
  past: [],
  future: [],
})

export function recordSessionHistoryAction(
  ledger: SessionHistoryLedger,
  action: SessionHistoryAction
): SessionHistoryLedger {
  const previous = ledger.past.at(-1)
  if (previous?.kind === action.kind && previous.id === action.id) return ledger
  return {
    past: [...ledger.past, action].slice(-SESSION_HISTORY_LIMIT),
    future: [],
  }
}

export function resetSessionHistoryForDocument(
  documentUndoEntryId: string | null
): SessionHistoryLedger {
  return {
    past: documentUndoEntryId
      ? [{ kind: "document", id: documentUndoEntryId }]
      : [],
    future: [],
  }
}

export function takeSessionUndo(ledger: SessionHistoryLedger): Readonly<{
  action: SessionHistoryAction | null
  ledger: SessionHistoryLedger
}> {
  const action = ledger.past.at(-1) ?? null
  if (!action) return { action: null, ledger }
  return {
    action,
    ledger: {
      past: ledger.past.slice(0, -1),
      future: [action, ...ledger.future].slice(0, SESSION_HISTORY_LIMIT),
    },
  }
}

export function takeSessionRedo(ledger: SessionHistoryLedger): Readonly<{
  action: SessionHistoryAction | null
  ledger: SessionHistoryLedger
}> {
  const action = ledger.future.at(0) ?? null
  if (!action) return { action: null, ledger }
  return {
    action,
    ledger: {
      past: [...ledger.past, action].slice(-SESSION_HISTORY_LIMIT),
      future: ledger.future.slice(1),
    },
  }
}
