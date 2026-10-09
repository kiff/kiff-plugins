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
/** The gateway's read-only list of the agent's held, sending and unknown calls (kiff-cloud#959). */
export const PENDING_TOOL = 'kiff_pending'
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
    const rooms = waiting.filter(c => c.roomStatus === 'approved_no_room')
    if (rooms.length === waiting.length) return rooms.length === 1 ? `approved, waiting for Card room · ${tools}` : `${rooms.length} approved, waiting for Card room · ${tools}`
    if (rooms.length > 0) return `${rooms.length} waiting for Card room · ${waiting.length - rooms.length} waiting for approval · ${tools}`
    return waiting.length === 1 ? `waiting for approval · ${tools}` : `${waiting.length} waiting for approval · ${tools}`
  }
  return card?.summary
}

/** Held calls the owner has not answered yet, whose wait has not ended. */
export function waitingCalls(calls: readonly KiffCall[], now: number): KiffCall[] {
  return calls.filter(c => c.state === 'held' && !c.answer && (c.roomStatus === 'approved_no_room' || !holdEnded(c, now)))
}

/** How long past its expiry a hold is still asked about, for the answer to land. */
export const HOLD_GRACE_MS = 2 * 60 * 1000
/** The longest a hold can wait (a Card's hold expiry is at most 7 days). */
export const MAX_HOLD_MS = 7 * 24 * 60 * 60 * 1000

/**
 * True once a held call is no longer asked about, answer or not: its expiry
 * plus a grace has passed, or, with no expiry known, the longest hold since
 * it was seen. Bounds the reads when KIFF never reports the hold (a gateway
 * without holds, another agent's id, a purged hold). It ends with no
 * answer: shown as a wait that ended, and the agent gets no turn.
 */
export function checkEnded(call: KiffCall, now: number): boolean {
  if (call.state !== 'held' || call.answer) return false
  const expires = call.holdExpiresAt ? Date.parse(call.holdExpiresAt) : NaN
  return Number.isNaN(expires) ? now >= call.at + MAX_HOLD_MS : now >= expires + HOLD_GRACE_MS
}

/** Held calls whose answer is not known yet: not announced, with KIFF's hold id. */
export function unanswered(calls: readonly KiffCall[]): KiffCall[] {
  return calls.filter(c => c.state === 'held' && c.exceptionId && !c.announced)
}

/**
 * Held calls to ask kiff_pending about now. Within its bound (checkEnded)
 * a hold is asked about on every tick. Past it, once more (finalChecked),
 * so an answer given in time is still learned after the plugin could not
 * read for a while (a refusal, an outage, a machine asleep); after that
 * only when the person asks (/kiff). The bound only stops the asking: an
 * answer kiff_pending reports is always applied (review on #12).
 */
export function holdsToCheck(calls: readonly KiffCall[], now: number, asked = false): KiffCall[] {
  return unanswered(calls).filter(c => asked || !checkEnded(c, now) || !c.finalChecked)
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

/** One held call as kiff_pending lists it, by exception id. */
export type PendingHold = {
  /** The owner's answer; undefined while it still waits or KIFF could not say. */
  answer?: KiffAnswer
  roomStatus?: KiffCall['roomStatus']
  /**
   * True when KIFF could not read the owner's answer (unavailable, or a word
   * it does not know): the hold was listed, but its answer was not read.
   */
  unread?: boolean
  /** KIFF's key for a call made without an id, when kiff_pending gives one. */
  collectId?: string
}

/** KIFF's own key for a call, as kiff_pending lists one made without an id. */
const KIFF_KEY = /^tc-[0-9a-f]{40}$/

/** A cursor kiff_pending handed out: passed back only to kiff_pending. */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/

/** One kiff_pending read: its held calls, and where the next page starts. */
export type PendingRead = { holds: Map<string, PendingHold>; next?: string }

/**
 * The held calls in a kiff_pending read, by exception id, and its
 * next_cursor. From the structured result, or the JSON text some
 * connections hand over instead. Only KIFF's own words are taken: the
 * answer, the hold id, a key of KIFF's form and the cursor; never the
 * tool's arguments or the agent's own id.
 */
export function readPending(structured: unknown, text: string | undefined): PendingRead {
  let body = structured
  if (!body && text?.trimStart().startsWith('{')) {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }
  const out = new Map<string, PendingHold>()
  const page = body as { calls?: unknown; next_cursor?: unknown } | undefined
  const next = typeof page?.next_cursor === 'string' && CURSOR.test(page.next_cursor) ? page.next_cursor : undefined
  const calls = page?.calls
  if (!Array.isArray(calls)) return { holds: out, next }
  for (const c of calls) {
    const e = c as { state?: unknown; exception_id?: unknown; answer?: unknown; kiff_operation_id?: unknown }
    if (e?.state !== 'held' || typeof e.exception_id !== 'string') continue
    const op = typeof e.kiff_operation_id === 'string' && KIFF_KEY.test(e.kiff_operation_id) ? e.kiff_operation_id : undefined
    const answer = answerOf(e.answer)
    const roomStatus = e.answer === 'approved_no_room' ? e.answer : undefined
    out.set(e.exception_id, { answer, ...(roomStatus ? { roomStatus } : {}), unread: !answer && e.answer !== 'waiting' && e.answer !== 'approved_no_room', collectId: op })
  }
  return { holds: out, next }
}

/** kiff_pending's answer for a held call; undefined while it still waits. */
export function answerOf(answer: unknown): KiffAnswer | undefined {
  switch (answer) {
    case 'approved':
      return 'approved'
    case 'refused':
      return 'refused'
    case 'ended': // ran out, or the Card changed or was withdrawn
      return 'expired'
    default: // waiting, unavailable
      return undefined
  }
}

/** The toast when the owner answered a held call. */
export function answerToast(call: KiffCall): string {
  const what = call.amount ? `${call.tool} (${call.amount})` : call.tool
  return {
    approved: call.hasOperationId || call.collectId
      ? `KIFF: the owner approved ${what}. The agent is told to call it again to get the result.`
      : `KIFF: the owner approved ${what}. It had no kiff_operation_id, so the agent is told to ask you to check it in KIFF Cloud before calling again.`,
    refused: `KIFF: the owner refused ${what}. Nothing was sent.`,
    expired: `KIFF: the hold on ${what} ended without approval. Nothing was sent.`,
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
  // only. A call made without one is collected with KIFF's own key for it
  // (kiff_pending); without that key the agent is not told to call again.
  const again = call.operationId
    ? `Call ${call.tool} again with the same arguments and the same kiff_operation_id to get its result; it is sent once.`
    : call.hasOperationId
      ? `Call ${call.tool} again with the same arguments and the same kiff_operation_id you used for it to get its result; it is sent once.`
      : call.collectId
        ? `It was made without a kiff_operation_id: call ${call.tool} again with the same arguments and kiff_operation_id ${call.collectId} to get its result; it is sent once.`
        : `It was made without a kiff_operation_id, so calling ${call.tool} again now may count as a new call rather than this approved one. Ask the user to check it in KIFF Cloud (Needs you) before calling it again.`
  return {
    approved: `KIFF: the owner approved ${which}. ${again}`,
    refused: `KIFF: the owner refused ${which}. Nothing was sent. Do not call it again unless the user asks.`,
    expired: `KIFF: the hold on ${which} ended without approval. Nothing was sent.`,
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
