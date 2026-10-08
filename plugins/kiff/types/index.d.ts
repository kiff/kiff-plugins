// What the plugin keeps for the current session. Nothing is kept across
// sessions.

/** What KIFF answered for one call, as the gateway reported it. */
export type KiffCallState =
  | 'allowed' // forwarded to the tool
  | 'held' // waiting for a person in KIFF Cloud
  | 'refused'
  | 'deciding'
  | 'sending' // sent to the tool, result not in yet
  | 'unknown' // KIFF cannot tell whether the tool received it
  | 'tool_error' // forwarded; the tool itself reported an error
  | 'failed'

/** How a hold ended, before the agent's retry collects it. */
export type KiffAnswer = 'approved' | 'refused' | 'expired'

export type KiffCall = {
  /** The call's kiff_operation_id, or the tool_use id when it had none. */
  key: string
  tool: string
  /** The amount argument as the agent passed it, e.g. "amount 80". */
  amount?: string
  state: KiffCallState
  reasons?: string[]
  reviewUrl?: string
  /** RFC 3339: when a held call stops waiting for an answer. */
  holdExpiresAt?: string
  /** The hold's exception id, which kiff_card is asked about. */
  exceptionId?: string
  /** The call's kiff_operation_id, if it had one. */
  operationId?: string
  /** The owner's answer to a held call, read through kiff_card. */
  answer?: KiffAnswer
  /** True once the answer was shown and the agent was told, so only once. */
  announced?: boolean
  /** Milliseconds since the epoch of the latest answer. */
  at: number
}

/** One line about the Card, from the gateway's kiff_card tool. */
export type KiffCard = {
  /** e.g. "320 of 500 amount left today", or "no Card issued". */
  summary: string
  /** True when a Card covers at least one tool. */
  issued: boolean
}

declare module 'claude-code' {
  interface PluginState {
    kiff: {
      calls: KiffCall[]
      card: KiffCard | null
      server: string | null
    }
  }
}
