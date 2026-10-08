// Reading what the KIFF gateway (mcp.kiff.dev) answers. Pure functions, no
// engine calls, so the tests can hold them to the gateway's real wording.
//
// The gateway reports each call it ends itself at _meta["dev.kiff/call"]
// and says the same in the result text. A call it forwarded comes back as
// the tool's own result, with no KIFF metadata. Wording mirrors
// apps/gateway/internal/gateway/{result,gateway}.go in KIFF Cloud.

import type { KiffAnswer, KiffCall, KiffCallState, KiffCard } from '../types'

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
  exception_id?: string
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
): Pick<KiffCall, 'state' | 'reasons' | 'reviewUrl' | 'holdExpiresAt' | 'exceptionId'> {
  if (isError !== true) return { state: 'allowed' }
  const meta = gatewayMeta(result)
  if (meta?.state && STATES[meta.state]) {
    const reviewUrl = reviewLink(meta.review_url)
    return {
      state: STATES[meta.state]!,
      reasons: meta.reasons?.length ? meta.reasons : undefined,
      reviewUrl,
      holdExpiresAt: meta.hold_expires_at || undefined,
      exceptionId: exceptionIdOf(meta.exception_id) ?? exceptionFromLink(reviewUrl),
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
    const reviewUrl = reviewLink(/The owner can answer at (\S+?)\.(\s|$)/.exec(t)?.[1])
    return {
      state: 'held',
      reviewUrl,
      holdExpiresAt: /has not answered by (\S+?), the call is refused/.exec(t)?.[1],
      exceptionId: exceptionFromLink(reviewUrl),
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
export function describeCall(
  server: string,
  tool: string,
  input: Record<string, unknown>,
): Pick<KiffCall, 'key' | 'amount' | 'operationId' | 'hasOperationId'> {
  // The gateway trims the id, so a blank one is no id: read it the same way.
  const raw = input[OPERATION_ARG]
  const op = typeof raw === 'string' ? raw.trim() : ''
  const args: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) if (!RESERVED.has(k)) args[k] = v
  const key = op !== '' ? `${server}/${tool}#op:${op}` : `${server}/${tool}#args:${canonical(args)}`
  // A guess: the first argument named like an amount.
  const amountArg = Object.keys(args).find(k => /amount/i.test(k) && (typeof args[k] === 'number' || typeof args[k] === 'string'))
  return {
    key,
    amount: amountArg ? `${amountArg} ${String(args[amountArg])}` : undefined,
    // Only a plain id is repeated back to the agent in a prompt.
    operationId: /^[A-Za-z0-9._:-]{1,128}$/.test(op) ? op : undefined,
    hasOperationId: op !== '',
  }
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

/**
 * The status line. Claude Code puts the plugin's name ("kiff:") in front,
 * so the text does not repeat it. While a call waits for a person, that is
 * all it says, with the tool; otherwise what is left on the Card.
 */
export function statusLine(card: KiffCard | null, calls: readonly KiffCall[], now: number): string | undefined {
  const waiting = waitingCalls(calls, now)
  if (waiting.length > 0) {
    const tools = [...new Set(waiting.map(c => c.tool))].join(', ')
    return waiting.length === 1 ? `waiting for approval · ${tools}` : `${waiting.length} waiting for approval · ${tools}`
  }
  return card?.summary
}

/** Held calls the owner has not answered yet, whose wait has not ended. */
export function waitingCalls(calls: readonly KiffCall[], now: number): KiffCall[] {
  return calls.filter(c => c.state === 'held' && !c.answer && !holdEnded(c, now))
}

/**
 * Held calls whose answer is still to be read through kiff_card: not yet
 * announced, and with an exception id to ask about. A hold whose wait has
 * passed is still asked about, so its expiry is announced too.
 */
export function holdsToCheck(calls: readonly KiffCall[]): KiffCall[] {
  return calls.filter(c => c.state === 'held' && c.exceptionId && !c.announced)
}

const EXCEPTION_ID = /^exc[-_][A-Za-z0-9_-]{1,120}$/

function exceptionIdOf(id: string | undefined): string | undefined {
  return id && EXCEPTION_ID.test(id) ? id : undefined
}

/** The exception id at the end of a KIFF Cloud review link. */
export function exceptionFromLink(url: string | undefined): string | undefined {
  const link = reviewLink(url)
  if (!link) return undefined
  try {
    return exceptionIdOf(new URL(link).pathname.split('/').pop())
  } catch {
    return undefined
  }
}

/**
 * The owner's answers in a kiff_card read made with holds: by exception
 * id, only for holds that ended. From the structured result, or the JSON
 * text some connections hand over instead.
 */
export function readHolds(structured: unknown, text: string | undefined): Map<string, KiffAnswer> {
  let body = structured
  if (!body && text?.trimStart().startsWith('{')) {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }
  const out = new Map<string, KiffAnswer>()
  const holds = (body as { holds?: unknown } | undefined)?.holds
  if (!Array.isArray(holds)) return out
  for (const h of holds) {
    const id = (h as { exception_id?: unknown })?.exception_id
    const answer = answerOf((h as { status?: unknown })?.status)
    if (typeof id === 'string' && answer) out.set(id, answer)
  }
  return out
}

/** A hold's status as an answer; undefined while it still waits. */
export function answerOf(status: unknown): KiffAnswer | undefined {
  switch (status) {
    case 'approved':
    case 'changed': // the Card changed so the call fits: a retry goes through
    case 'consumed':
      return 'approved'
    case 'rejected':
      return 'refused'
    case 'expired':
    case 'invalidated':
      return 'expired'
    default:
      return undefined
  }
}

/** The toast when the owner answered a held call. */
export function answerToast(call: KiffCall): string {
  const what = call.amount ? `${call.tool} (${call.amount})` : call.tool
  return {
    approved: call.hasOperationId
      ? `KIFF: the owner approved ${what}. The agent is told to call it again to get the result.`
      : `KIFF: the owner approved ${what}. It had no kiff_operation_id, so the agent is told to check it in KIFF Cloud before calling again.`,
    refused: `KIFF: the owner refused ${what}. Nothing was sent.`,
    expired: `KIFF: ${what} was not answered in time. Nothing was sent.`,
  }[call.answer!]
}

/**
 * The one turn the plugin starts so the agent picks up the answer. Only
 * the plugin's own words, the tool's name and the agent's own operation
 * id: nothing the tool or a page wrote. It tells the agent; the agent
 * decides whether to call again.
 */
export function answerPrompt(call: KiffCall): string {
  // KIFF's own hold id names the call; it is checked to be one.
  const hold = call.exceptionId ? `KIFF hold ${call.exceptionId}` : ''
  const which = call.operationId
    ? `the held ${call.tool} call (kiff_operation_id ${call.operationId}${hold ? `, ${hold}` : ''})`
    : `the held ${call.tool} call${hold ? ` (${hold})` : ''}`
  // A retry reaches the approved call only through the same operation: an
  // identical call without an id counts as the same one for 10 minutes
  // only, so without an id the agent is not told to call again.
  const again = call.operationId
    ? `Call ${call.tool} again with the same arguments and the same kiff_operation_id to get its result; it is sent once.`
    : call.hasOperationId
      ? `Call ${call.tool} again with the same arguments and the same kiff_operation_id you used for it to get its result; it is sent once.`
      : `It was made without a kiff_operation_id, so calling ${call.tool} again now may count as a new call rather than this approved one. Check its outcome in KIFF Cloud (Needs you) before calling it again.`
  return {
    approved: `KIFF: the owner approved ${which}. ${again}`,
    refused: `KIFF: the owner refused ${which}. Nothing was sent. Do not call it again unless the user asks.`,
    expired: `KIFF: ${which} was not answered in time. Nothing was sent.`,
  }[call.answer!]
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
