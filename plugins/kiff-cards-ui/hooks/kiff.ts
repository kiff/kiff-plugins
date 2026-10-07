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

/** Where a person answers a hold. A link anywhere else is not shown. */
export const REVIEW_ORIGIN = 'https://app.kiff.dev'

/**
 * The gateway's _meta["dev.kiff/call"], read only at the top level of the
 * result. A forwarded tool's result passes through the gateway unchanged,
 * so a nested copy could have been written by the tool.
 */
export function gatewayMeta(result: unknown): GatewayCall | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  const meta = (result as Record<string, unknown>)._meta
  if (!meta || typeof meta !== 'object') return undefined
  const call = (meta as Record<string, unknown>)[META_KEY]
  return call && typeof call === 'object' ? (call as GatewayCall) : undefined
}

/** The review link, only when it points at KIFF Cloud. */
export function reviewLink(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin === REVIEW_ORIGIN ? url : undefined
  } catch {
    return undefined
  }
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

// The results the gateway writes itself, by how their text starts
// (apps/gateway/internal/gateway/gateway.go). Each is an error result.
const TEXTS: { prefix: string; state: KiffCallState; reasons?: string[] }[] = [
  { prefix: "Waiting for the owner's approval", state: 'held' },
  { prefix: "KIFF could not be asked for the owner's answer just now", state: 'held', reasons: ['decide_unavailable'] },
  { prefix: 'Refused: kiff_operation_id ', state: 'refused', reasons: ['operation_id_reused'] },
  { prefix: 'This call is still being decided', state: 'deciding' },
  { prefix: 'This call has been sent to the tool and its result is not in yet', state: 'sending' },
  { prefix: 'This call was sent to the tool at', state: 'allowed' },
  { prefix: 'Sent to the tool, but its response was lost', state: 'unknown', reasons: ['response_lost'] },
  { prefix: 'KIFF could not record this call', state: 'failed', reasons: ['call_not_recorded'] },
  { prefix: 'KIFF could not be asked for a decision', state: 'failed', reasons: ['decide_unavailable'] },
  { prefix: "The tool's stored credential could not be read", state: 'failed', reasons: ['credential_unreadable'] },
  { prefix: 'The tool could not be reached', state: 'failed', reasons: ['tool_unreachable'] },
]

/**
 * What KIFF answered. Only an error result can be one the gateway wrote
 * (kiffResult always marks it so); anything else is the tool's own result
 * after KIFF let the call through.
 */
export function readAnswer(
  result: unknown,
  text: string | undefined,
  isError: boolean | undefined,
): Pick<KiffCall, 'state' | 'reasons' | 'reviewUrl' | 'holdExpiresAt'> {
  if (isError !== true) return { state: 'allowed' }
  const meta = gatewayMeta(result)
  if (meta?.state && STATES[meta.state]) {
    return {
      state: STATES[meta.state]!,
      reasons: meta.reasons?.length ? meta.reasons : undefined,
      reviewUrl: reviewLink(meta.review_url),
      holdExpiresAt: meta.hold_expires_at || undefined,
    }
  }
  // Claude Code may lead an error result's text with "Error: ".
  const t = (text ?? '').replace(/^Error: /, '')
  const refused = /^Refused by KIFF \(([^):]*)(?::\s*([^)]*))?\)/.exec(t)
  if (refused) {
    const reasons = refused[2]?.split(',').map(r => r.trim()).filter(Boolean)
    return { state: 'refused', reasons: reasons?.length ? reasons : undefined }
  }
  const known = TEXTS.find(k => t.startsWith(k.prefix))
  if (known?.state === 'held' && !known.reasons) {
    return {
      state: 'held',
      reviewUrl: reviewLink(/The owner can answer at (\S+?)\.(\s|$)/.exec(t)?.[1]),
      holdExpiresAt: /has not answered by (\S+?), the call is refused/.exec(t)?.[1],
    }
  }
  if (known) return { state: known.state, reasons: known.reasons }
  // Not KIFF's wording: the call was forwarded and the tool reported an error.
  return { state: 'tool_error' }
}

// Keys of tool.call's input that are the engine's, not the tool's.
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'consent', OPERATION_ARG])

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/**
 * The call's key and its amount argument. The gateway scopes an operation
 * id per tool, and without one treats an identical call as a retry, so the
 * key is the server and tool plus the operation id, or else the arguments.
 * The gateway counts an identical call as a retry only within 10 minutes;
 * here a later identical call without an id replaces the earlier entry.
 */
export function describeCall(server: string, tool: string, input: Record<string, unknown>): Pick<KiffCall, 'key' | 'amount'> {
  const op = input[OPERATION_ARG]
  const args: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) if (!RESERVED.has(k)) args[k] = v
  const key = typeof op === 'string' && op !== '' ? `${server}/${tool}#op:${op}` : `${server}/${tool}#args:${canonical(args)}`
  // A guess: the first argument named like an amount.
  const amountArg = Object.keys(args).find(k => /amount/i.test(k) && (typeof args[k] === 'number' || typeof args[k] === 'string'))
  return { key, amount: amountArg ? `${amountArg} ${String(args[amountArg])}` : undefined }
}

/** Adds an answer, or replaces the earlier answer for the same call. */
export function upsert(calls: readonly KiffCall[], call: KiffCall, max = 50): KiffCall[] {
  return [...calls.filter(c => c.key !== call.key), call].slice(-max)
}

type CardLimit = {
  quantity?: string
  limit?: number
  window?: string
  used?: number
  remaining?: number
  status?: string
  // What a summed amount means, when the domain declares it (kiff-cloud #1053):
  // unit EUR with scale 2 makes 8000 read as 80.00 EUR.
  unit?: string
  scale?: number
}
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
  const window = WINDOWS[tightest.window ?? ''] ?? 'in this window'
  if (arg && tightest.unit) {
    const scale = tightest.scale ?? 0
    const amount = (n: number) => formatScaled(n, scale)
    return { summary: `${amount(tightest.remaining!)} of ${amount(tightest.limit!)} ${tightest.unit} left ${window}`, issued: true }
  }
  const unit = arg ?? 'calls'
  return { summary: `${tightest.remaining} of ${tightest.limit} ${unit} left ${window}`, issued: true }
}

/** Writes n with scale decimal places: 8000, 2 -> "80.00". */
export function formatScaled(n: number, scale: number): string {
  if (!Number.isInteger(scale) || scale <= 0) return String(n)
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.abs(n)).padStart(scale + 1, '0')
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

/**
 * The same line from kiff_card's text, for when the structured result does
 * not reach the plugin (the tool declares no output schema).
 */
export function summarizeCardText(text: string | undefined): KiffCard | undefined {
  if (!text) return undefined
  // Some connections (the claude.ai connector) hand the Card over as its
  // JSON, in the text, with no structuredContent.
  if (text.trimStart().startsWith('{')) {
    try {
      return summarizeCard(JSON.parse(text))
    } catch {
      return undefined
    }
  }
  if (!text.startsWith('You act as agent ')) return undefined
  if (text.includes('No Card of yours applies here')) return { summary: 'no Card issued', issued: false }
  let best: { remaining: number; limit: number; line: string } | undefined
  // Totals may be decimals once the Card has a unit: "38.00 of 50.00 EUR left today".
  for (const m of text.matchAll(/(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) (\S+) left (today|in the last hour|in the last 24 hours|in this window)/g)) {
    const remaining = Number(m[1]), limit = Number(m[2])
    if (limit > 0 && (!best || remaining / limit < best.remaining / best.limit)) best = { remaining, limit, line: m[0] }
  }
  return { summary: best ? best.line : 'Card active', issued: true }
}

/**
 * True when a failed kiff_card read should stop background reads: any error
 * except KIFF's own "could not read your Card", which is transient and
 * retried. That covers Claude Code's refusals (its permission prompt, a deny
 * rule, the auto mode classifier, each worded differently), but also the
 * gateway failing to read the account's tools (card.go) and connector
 * errors. So the explanation shown never claims the cause.
 */
export function permissionRefused(text: string): boolean {
  return !text.replace(/^Error: /, '').startsWith('KIFF could not read your Card')
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
