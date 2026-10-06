// Reading what the KIFF gateway (mcp.kiff.dev) answers. Pure functions, no
// engine calls, so the tests can hold them to the gateway's real wording.
//
// The gateway reports each call it ends itself at _meta["dev.kiff/call"]
// and says the same in the result text. A call it forwarded comes back as
// the tool's own result, with no KIFF metadata. Wording mirrors
// apps/gateway/internal/gateway/{result,gateway}.go in KIFF Cloud.

import type { KiffCall, KiffCallState, KiffCard } from '../types'

export const META_KEY = 'dev.kiff/call'
export const CARD_TOOL = 'kiff_card'
export const OPERATION_ARG = 'kiff_operation_id'

/**
 * The server and tool of an MCP tool name when the server is a KIFF
 * gateway: `mcp__kiff__…` (a connect link), `mcp__plugin_kiff-cards_kiff__…`
 * (the kiff-cards plugin) or `mcp__claude_ai_KIFF__…` (a claude.ai connector).
 */
export function kiffTool(name: string): { server: string; tool: string } | undefined {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!m || !/(^|_)kiff$/i.test(m[1]!)) return undefined
  return { server: m[1]!, tool: m[2]! }
}

type GatewayCall = {
  state?: string
  operation_id?: string
  reasons?: string[]
  review_url?: string
  hold_expires_at?: string
}

/** Finds _meta["dev.kiff/call"] wherever the engine kept the result's _meta. */
export function gatewayMeta(result: unknown): GatewayCall | undefined {
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number): GatewayCall | undefined => {
    if (!v || typeof v !== 'object' || depth > 4 || seen.has(v)) return undefined
    seen.add(v)
    const meta = (v as Record<string, unknown>)._meta
    if (meta && typeof meta === 'object') {
      const call = (meta as Record<string, unknown>)[META_KEY]
      if (call && typeof call === 'object') return call as GatewayCall
    }
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      const found = walk(child, depth + 1)
      if (found) return found
    }
    return undefined
  }
  return walk(result, 0)
}

const STATES: Record<string, KiffCallState> = {
  held: 'held',
  refused: 'refused',
  deciding: 'deciding',
  forwarding: 'sending',
  forwarded: 'allowed',
  unknown: 'unknown',
  failed: 'failed',
}

/** What KIFF answered, from the metadata when present, else from the text. */
export function readAnswer(
  result: unknown,
  text: string | undefined,
  isError: boolean | undefined,
): Pick<KiffCall, 'state' | 'reasons' | 'reviewUrl' | 'holdExpiresAt'> {
  const meta = gatewayMeta(result)
  if (meta?.state && STATES[meta.state]) {
    return {
      state: STATES[meta.state]!,
      reasons: meta.reasons?.length ? meta.reasons : undefined,
      reviewUrl: meta.review_url || undefined,
      holdExpiresAt: meta.hold_expires_at || undefined,
    }
  }
  const t = text ?? ''
  if (t.startsWith("Waiting for the owner's approval")) {
    return {
      state: 'held',
      reviewUrl: /The owner can answer at (\S+?)\.(\s|$)/.exec(t)?.[1],
      holdExpiresAt: /has not answered by (\S+?), the call is refused/.exec(t)?.[1],
    }
  }
  const refused = /^Refused by KIFF \(([^):]*)(?::\s*([^)]*))?\)/.exec(t)
  if (refused) {
    const reasons = refused[2]?.split(',').map(r => r.trim()).filter(Boolean)
    return { state: 'refused', reasons: reasons?.length ? reasons : undefined }
  }
  if (t.startsWith('This call is still being decided')) return { state: 'deciding' }
  if (t.startsWith('This call has been sent to the tool and its result is not in yet')) return { state: 'sending' }
  if (t.startsWith('This call was sent to the tool at')) return { state: 'allowed' }
  // No KIFF wording: the gateway forwarded the call and this is the tool's
  // own result.
  return { state: isError ? 'tool_error' : 'allowed' }
}

/** The call's key and its amount argument, from the tool call's input. */
export function describeCall(input: Record<string, unknown>, fallbackKey: string): Pick<KiffCall, 'key' | 'amount'> {
  const op = input[OPERATION_ARG]
  const key = typeof op === 'string' && op !== '' ? op : fallbackKey
  const amountArg = Object.keys(input).find(k => /amount/i.test(k) && (typeof input[k] === 'number' || typeof input[k] === 'string'))
  return { key, amount: amountArg ? `${amountArg} ${String(input[amountArg])}` : undefined }
}

/** Adds an answer, or replaces the earlier answer for the same call. */
export function upsert(calls: readonly KiffCall[], call: KiffCall, max = 50): KiffCall[] {
  return [...calls.filter(c => c.key !== call.key), call].slice(-max)
}

type CardLimit = { quantity?: string; limit?: number; window?: string; used?: number; remaining?: number; status?: string }
type AgentCard = { agent_id?: string; cards?: { id?: string; limits?: CardLimit[]; grants?: unknown[] }[] }

const WINDOWS: Record<string, string> = {
  calendar_day: 'today',
  rolling_1h: 'in the last hour',
  rolling_24h: 'in the last 24 hours',
}

/**
 * One line about the Card from kiff_card's structured result: the total with
 * the least left, or that no Card applies. Undefined when it is not a Card.
 */
export function summarizeCard(structured: unknown): KiffCard | undefined {
  if (!structured || typeof structured !== 'object') return undefined
  const card = structured as AgentCard
  if (!Array.isArray(card.cards)) return undefined
  if (card.cards.length === 0) return { summary: 'no Card issued', issued: false }
  let tightest: CardLimit | undefined
  for (const c of card.cards) {
    for (const l of c.limits ?? []) {
      if (l.status !== 'ok' || typeof l.limit !== 'number' || typeof l.remaining !== 'number' || l.limit <= 0) continue
      if (!tightest || l.remaining / l.limit < tightest.remaining! / tightest.limit!) tightest = l
    }
  }
  if (!tightest) return { summary: 'Card active', issued: true }
  const arg = /^sum\((.+)\)$/.exec(tightest.quantity ?? '')?.[1]
  const unit = arg ?? 'calls'
  const window = WINDOWS[tightest.window ?? ''] ?? 'in this window'
  return { summary: `${tightest.remaining} of ${tightest.limit} ${unit} left ${window}`, issued: true }
}

/** The status line: the Card, then how many calls wait for a person. */
export function statusLine(card: KiffCard | null, calls: readonly KiffCall[], now: number): string | undefined {
  const waiting = calls.filter(c => c.state === 'held' && !holdEnded(c, now)).length
  if (!card && waiting === 0) return undefined
  const parts = ['KIFF']
  if (card) parts.push(card.summary)
  if (waiting > 0) parts.push(`${waiting} waiting for approval`)
  return parts.join(' · ')
}

/** True once a held call's waiting time has passed. */
export function holdEnded(call: KiffCall, now: number): boolean {
  if (call.state !== 'held' || !call.holdExpiresAt) return false
  const t = Date.parse(call.holdExpiresAt)
  return !Number.isNaN(t) && t <= now
}

/** The toast for a call KIFF just held. */
export function heldToast(call: KiffCall): string {
  const what = call.amount ? `${call.tool} (${call.amount})` : call.tool
  const where = call.reviewUrl ? ` Answer in KIFF Cloud: ${call.reviewUrl}` : ' Answer in KIFF Cloud.'
  return `KIFF is holding ${what} for approval. Nothing was sent.${where}`
}
