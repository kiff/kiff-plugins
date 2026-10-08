// KIFF in Claude Code: the agent's Card in the status line, a notice when
// KIFF holds a call, the owner's answer once it is in, and this session's
// KIFF calls in a /kiff pane.
//
// It reads what the KIFF gateway already answered and the gateway's
// read-only kiff_card tool. It never answers, retries or changes a call: a
// held call is answered by a person in KIFF Cloud, and only the agent's own
// retry of the same call gets that answer. While a call is held it asks
// kiff_pending every 15 seconds whether the owner answered; when they have, it
// says so once and starts one turn telling the agent, which decides
// whether to call again.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, McpToolResult, Register } from 'claude-code'

import type { KiffCall, KiffCard } from '../types'
import type { PendingHold } from './kiff'
import {
  answerPrompt,
  answerToast,
  CARD_TOOL,
  describeCall,
  heldToast,
  holdEnded,
  checkEnded,
  holdsToCheck,
  kiffTool,
  unanswered,
  permissionRefused,
  PENDING_TOOL,
  readAnswer,
  readPending,
  statusLine,
  summarizeCard,
  summarizeCardText,
  upsert,
} from './kiff'

const PANE = 'kiff'
// How often a held call's answer is asked for, only while one is held.
const HOLD_CHECK_MS = 15000
// The most kiff_pending pages one check reads (50 calls each).
const MAX_PENDING_PAGES = 10

const calls = atom({ plugin: 'kiff', key: 'calls' } as const, [] as KiffCall[])
const card = atom({ plugin: 'kiff', key: 'card' } as const, null as KiffCard | null)
const server = atom({ plugin: 'kiff', key: 'server' } as const, null as string | null)

async function showStatus($: Engine) {
  $.ui.status(statusLine(await read($, card), await read($, calls), await $.clock.now()))
}

/** Remembers which MCP server is the KIFF gateway, from a tool name. */
async function noteServer($: Engine, name: string) {
  const kiff = kiffTool(name)
  if (kiff && (await read($, server)) !== kiff.server) await update($, server, () => kiff.server)
}

/** Finds the gateway among the session's tools, if it has connected. */
async function findServer($: Engine): Promise<string | null> {
  const known = await read($, server)
  if (known) return known
  // Any of the gateway's tools names its server; kiff_card may be missing
  // when a deny rule removed it, which callCard then reports as blocked.
  for (const t of await $.tool.list()) {
    if (t.mcp && kiffTool(t.name)) {
      await noteServer($, t.name)
      return kiffTool(t.name)!.server
    }
  }
  return null
}

// Set when a kiff_card read failed with anything but KIFF's own "could not
// read" message (see permissionRefused): background reads stop, so nobody
// is asked after every call. /kiff still reads, since the person asked for
// it, and a read that succeeds turns background reads back on.
let cardReadRefused = false
// The failure is explained once per session, in a notice and in /kiff.
let refusalShown = false
// The first line of the failed read's error, shown in the explanation.
let cardReadError = ''

/**
 * Why the Card could not be read, without claiming a cause: the error may be
 * Claude Code's permissions, the gateway, or the connector (an expired
 * sign-in, the network). Names the exact tool in case it was a permission.
 */
async function refusalText($: Engine): Promise<string> {
  const tool = await cardToolName($)
  const why = cardReadError ? ` (${cardReadError})` : ''
  return `KIFF can't read your Card${why}. If Claude Code blocked it, type /kiff to be asked, or in /permissions → Allow, add the rule ${tool} (just that name), saved under User settings so it applies in every folder.`
}

/** The one-line notice: the action first, since a terminal cuts the line short. */
async function refusalNotice($: Engine): Promise<string> {
  return `KIFF Card not read. If Claude Code blocked it, add the rule ${await cardToolName($)} in /permissions → Allow (User settings). Details: /kiff`
}

async function cardToolName($: Engine): Promise<string> {
  const name = await read($, server)
  return name ? `mcp__${name}__${CARD_TOOL}` : `the gateway's ${CARD_TOOL} tool`
}

/** The first line of an error, short enough for a notice. */
function firstLine(text: string): string {
  const line = text.replace(/^Error: /, '').split('\n')[0]!.trim()
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}

// The gateway's server names, in the tool-name spelling $.mcp.call takes:
// this repo's kiff-cards plugin, a connect link added as "kiff", and the
// claude.ai connector. Tried when the tool list has no KIFF tool, which
// happens when Claude Code defers MCP tools behind tool search.
const KNOWN_SERVERS = ['plugin_kiff-cards_kiff', 'kiff', 'claude_ai_KIFF']

// What $.mcp.call throws when the server or its kiff_card is not there
// (seen live). Any other throw means the call reached Claude Code's checks
// or the gateway and failed there: interactively, a permission or auto mode
// block arrives as a throw, not as an error result.
const NOT_CONNECTED = /no connected MCP tool/i

/** A thrown $.mcp.call error as an error result, so it is explained like one. */
function thrownResult(err: unknown): McpToolResult {
  // e.g. "HooksError: kiff: $.mcp.call(claude_ai_KIFF, kiff_card) refused: <why>"
  const text = String(err).replace(/^[\s\S]*?\$\.mcp\.call(\([^)]*\))?( refused)?: /, '')
  return { content: [{ type: 'text', text }], isError: true }
}

/** Calls kiff_card on the gateway: the one already found, or the first known name that answers. */
async function callCard($: Engine): Promise<McpToolResult | null> {
  return callGatewayTool($, CARD_TOOL)
}

/** Calls one of the gateway's own read-only tools (kiff_card, kiff_pending). */
async function callGatewayTool($: Engine, tool: string, args: Record<string, unknown> = {}): Promise<McpToolResult | null> {
  const name = await findServer($)
  if (name) {
    try {
      return await $.mcp.call(name, tool, args)
    } catch (err) {
      if (!NOT_CONNECTED.test(String(err))) return thrownResult(err)
      // Listed but not answering: the connector is still connecting, so let
      // the caller try again later.
      if ((await $.tool.list()).some(t => t.name === `mcp__${name}__${tool}`)) throw err
      // The gateway always serves its own tools (the names are reserved),
      // so on a server we know one is missing only when Claude Code
      // removed it.
      return { content: [{ type: 'text', text: `${tool} is not available in this session` }], isError: true }
    }
  }
  for (const candidate of KNOWN_SERVERS) {
    let res: McpToolResult
    try {
      res = await $.mcp.call(candidate, tool, args)
    } catch (err) {
      if (NOT_CONNECTED.test(String(err))) continue // no such server here
      res = thrownResult(err) // the server is there; the read was blocked or failed
    }
    await update($, server, () => candidate)
    return res
  }
  return null
}

/**
 * A failed kiff_card read, background or hold check alike: a refusal stops
 * every background read (the Card and held calls) until a read succeeds,
 * and is explained once.
 */
async function cardReadFailed($: Engine, res: McpToolResult) {
  const errorText = res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
  if (!permissionRefused(errorText)) return
  cardReadRefused = true
  cardReadError = firstLine(errorText)
  if (!refusalShown) {
    refusalShown = true
    $.ui.toast(await refusalNotice($), { timeoutMs: 15000 })
  }
}

/** Reads the Card through the gateway's read-only kiff_card tool. */
async function refreshCard($: Engine, asked = false) {
  if (cardReadRefused && !asked) return
  const res = await callCard($)
  if (!res) return
  if (res.isError) {
    await cardReadFailed($, res)
    return
  }
  cardReadRefused = false
  const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
  const summary = summarizeCard(res.structuredContent) ?? summarizeCardText(text)
  if (summary) await update($, card, () => summary)
}

let checking = false
// Set when a kiff_pending read was refused (its own permission, apart from
// kiff_card's): hold checks stop until /kiff reads it again.
let pendingReadRefused = false
let pendingRefusalShown = false

/** A refused kiff_pending read: stop checking, and say so once. */
async function pendingReadFailed($: Engine, res: McpToolResult) {
  const errorText = res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
  if (!permissionRefused(errorText)) return
  pendingReadRefused = true
  if (!pendingRefusalShown) {
    pendingRefusalShown = true
    $.ui.toast(await pendingRefusalNotice($), { timeoutMs: 15000 })
  }
}

async function pendingRefusalNotice($: Engine): Promise<string> {
  const name = await read($, server)
  const tool = name ? `mcp__${name}__${PENDING_TOOL}` : `the gateway's ${PENDING_TOOL} tool`
  return `KIFF can't see whether held calls were answered. If Claude Code blocked it, add the rule ${tool} in /permissions → Allow (User settings). Details: /kiff`
}

/**
 * Asks kiff_pending whether the owner answered the held calls: one read
 * lists every held call of this agent's, with its answer. Each answer is
 * shown once, in a toast, and the agent is told once, in a turn of its own
 * that Claude Code starts when the session is idle. Nothing here calls the
 * held tool: the agent does, if it decides to. asked is true for /kiff,
 * which reads again after a refusal.
 */
async function checkHolds($: Engine, asked = false) {
  if (checking || (pendingReadRefused && !asked)) return
  const wanted = holdsToCheck(await read($, calls), await $.clock.now(), asked)
  if (wanted.length === 0) return
  checking = true
  try {
    // Page through kiff_pending until every hold asked about is found, or
    // the pages run out (review on kiff-cloud#1077: none is left out).
    const listed = new Map<string, PendingHold>()
    const missing = new Set(wanted.map(c => c.exceptionId!))
    let cursor: string | undefined
    for (let page = 0; page < MAX_PENDING_PAGES; page++) {
      const res = await callGatewayTool($, PENDING_TOOL, cursor ? { cursor } : {})
      if (!res) return
      if (res.isError) {
        await pendingReadFailed($, res)
        return
      }
      pendingReadRefused = false
      const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
      const pageRead = readPending(res.structuredContent, text)
      for (const [id, p] of pageRead.holds) {
        listed.set(id, p)
        missing.delete(id)
      }
      cursor = pageRead.next
      if (missing.size === 0 || !cursor) break
    }
    const now = await $.clock.now()
    const told: KiffCall[] = []
    await update($, calls, list =>
      list.map(c => {
        if (c.state !== 'held' || !c.exceptionId || c.announced) return c
        // An answer kiff_pending reports always counts, however late it is
        // read (review on #12): an approval given in time stands.
        const p = listed.get(c.exceptionId)
        if (p?.answer) {
          const done = { ...c, answer: p.answer, collectId: c.hasOperationId ? undefined : p.collectId, announced: true }
          told.push(done)
          return done
        }
        // Past its bound with no answer: that was its last read.
        return checkEnded(c, now) ? { ...c, finalChecked: true } : c
      }),
    )
    for (const call of told) {
      $.ui.toast(answerToast(call), { timeoutMs: 12000 })
      const text = answerPrompt(call)
      if (asked) {
        // Read by /kiff: a turn cannot be submitted from the command's own
        // hook (the host refuses it, as it would wait on the turn the hook
        // holds), so it goes from a timer just after.
        $.clock.after(1, () => {
          void $.prompt.submit({ text }).catch(() => {})
        })
      } else {
        void $.prompt.submit({ text }).catch(() => {})
      }
    }
  } finally {
    checking = false
    await showStatus($)
  }
}

/**
 * Reads the Card through Claude Code's normal tool path, which shows its
 * permission prompt. Only for /kiff: the person asked, and says so.
 */
async function askForCard($: Engine) {
  const name = await read($, server)
  if (!name) return
  const ran = await $.tool.call({
    tool: `mcp__${name}__${CARD_TOOL}`,
    consent: 'The user typed /kiff to see their KIFF Card.',
  })
  if (ran.deny !== undefined || ran.isError) return
  const structured = (ran.result as { structuredContent?: unknown } | undefined)?.structuredContent
  const summary = summarizeCard(structured) ?? summarizeCardText(ran.text)
  if (!summary) return
  cardReadRefused = false
  await update($, card, () => summary)
}

/**
 * Reads kiff_pending through Claude Code's normal tool path, which shows its
 * permission prompt. Only for /kiff while a call is held: the person asked.
 * Once it runs, hold checks resume on the next tick.
 */
async function askForPending($: Engine) {
  const name = await read($, server)
  if (!name || unanswered(await read($, calls)).length === 0) return
  const ran = await $.tool.call({
    tool: `mcp__${name}__${PENDING_TOOL}`,
    consent: 'The user typed /kiff to see whether held KIFF calls were answered.',
  })
  if (ran.deny !== undefined || ran.isError) return
  // Allowed now: read again, and apply what it says.
  pendingReadRefused = false
  await checkHolds($, true)
}

/** Reads the Card once the gateway has connected: a few tries, 5 s apart. */
async function readCardAtStart($: Engine) {
  for (let i = 0; i < 4; i++) {
    if (i > 0) await $.clock.sleep(5000)
    try {
      await refreshCard($)
    } catch {
      continue
    }
    if ((await read($, card)) || cardReadRefused) break
  }
  await showStatus($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'kiff',
      description: "Show this agent's KIFF Card and this session's KIFF calls",
    })
    // MCP servers may still be connecting when the session starts.
    void readCardAtStart($).catch(() => {})
    // Asks only while a call is held; otherwise a tick does nothing.
    $.clock.every(HOLD_CHECK_MS, () => {
      void checkHolds($).catch(() => {})
    })
    return next(e)
  })

  on('command.run', { command: 'kiff' }, async $ => {
    await refreshCard($, true).catch(() => {})
    await checkHolds($, true).catch(() => {})
    // The same for kiff_pending, which Claude Code's permissions name apart.
    if (pendingReadRefused) await askForPending($).catch(() => {})
    // The quiet read above cannot ask. When Claude Code refused it, read
    // again the way the model does, so the person typing /kiff gets Claude
    // Code's own permission prompt instead of a trip to /permissions.
    if (cardReadRefused && !(await read($, card))) await askForCard($).catch(() => {})
    await showStatus($)
    await $.ui.open({ id: PANE, title: 'KIFF' })
    const c = await read($, card)
    if (c) return { text: `KIFF Card: ${c.summary}.` }
    if (cardReadRefused) return { text: await refusalText($) }
    if (await read($, server)) return { text: 'KIFF pane opened. KIFF could not read the Card just now; it is read again after the next KIFF call.' }
    return { text: 'KIFF pane opened. No KIFF gateway seen in this session yet.' }
  })

  on('tool.call', async ($, e, next) => {
    const kiff = kiffTool(e.tool)
    if (!kiff) return next(e)

    const ran = await next(e)
    // Everything below only records and shows; the call's answer is
    // returned to the agent unchanged, whatever happens here.
    try {
      await noteServer($, e.tool)
      if (ran.deny !== undefined) return ran

      if (kiff.tool === CARD_TOOL) {
        const structured = (ran.result as { structuredContent?: unknown } | undefined)?.structuredContent
        const summary = summarizeCard(structured) ?? summarizeCardText(ran.text)
        if (summary) await update($, card, () => summary)
      } else {
        const answer = readAnswer(ran.result, ran.text, ran.isError)
        const call: KiffCall = {
          ...describeCall(kiff.server, kiff.tool, e as Record<string, unknown>),
          tool: kiff.tool,
          ...answer,
          at: await $.clock.now(),
        }
        const before = (await read($, calls)).find(c => c.key === call.key)
        await update($, calls, list => upsert(list, call))
        if (call.state === 'held' && before?.state !== 'held') {
          $.ui.toast(heldToast(call), { timeoutMs: 12000 })
        }
        void refreshCard($)
          .then(() => showStatus($))
          .catch(() => {})
      }
      await showStatus($)
    } catch {
      // Display only: never let the pane break the agent's call.
    }
    return ran
  }).catch(($, e, next) => next(e)) // fail open: the gateway enforces the Card, not this display

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const c = await read($, card)
    const list = [...(await read($, calls))].reverse()
    const now = await $.clock.now()
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 5) / 2))
    const why = !c && cardReadRefused ? await refusalText($) : ''

    return (
      <Box flexDirection="column">
        <Text bold>{c ? `Card: ${c.summary}` : 'Card: not read yet'}</Text>
        {why !== '' && <Text color="warning">{why}</Text>}
        <Text dimColor>Calls are checked by KIFF when they are made. A person answers held calls in KIFF Cloud.</Text>
        {list.length === 0 && <Text dimColor>No KIFF calls in this session yet.</Text>}
        {list.slice(0, room).map(call => (
          <Box flexDirection="column" key={call.key}>
            <Text>
              <Text color={COLORS[call.state]} bold>
                {label(call, now)}
              </Text>
              {` ${call.tool}${call.amount ? ` · ${call.amount}` : ''}`}
            </Text>
            {detail(call, now) !== '' && <Text dimColor>{`  ${detail(call, now)}`}</Text>}
            {call.state === 'held' && !call.answer && !holdEnded(call, now) && call.reviewUrl && (
              <Link href={call.reviewUrl} label="  Answer in KIFF Cloud" />
            )}
          </Box>
        ))}
      </Box>
    )
  })
}

const COLORS: Record<KiffCall['state'], 'success' | 'warning' | 'error' | 'subtle'> = {
  allowed: 'success',
  held: 'warning',
  refused: 'error',
  deciding: 'subtle',
  sending: 'subtle',
  unknown: 'warning',
  tool_error: 'error',
  failed: 'error',
}

function label(call: KiffCall, now: number): string {
  if (call.answer === 'approved') return 'approved'
  if (call.answer === 'refused') return 'refused by the owner'
  if (call.answer === 'expired' || holdEnded(call, now) || checkEnded(call, now)) return 'wait ended'
  return {
    allowed: 'allowed',
    held: 'waiting for approval',
    refused: 'refused',
    deciding: 'deciding',
    sending: 'sent, result pending',
    unknown: 'outcome unknown',
    tool_error: 'tool error',
    failed: 'failed',
  }[call.state]
}

function detail(call: KiffCall, now: number): string {
  if (call.answer === 'approved') return 'The agent was told to call it again; that call gets the result.'
  if (call.answer === 'refused') return 'Nothing sent.'
  if (holdEnded(call, now) || checkEnded(call, now) || call.answer === 'expired') return "If no one answered, the call was refused. The agent's retry of the same call shows the answer."
  if (call.state === 'held') return call.holdExpiresAt ? `Nothing sent. Waits until ${call.holdExpiresAt}.` : 'Nothing sent.'
  if (call.state === 'refused') return `Nothing sent.${call.reasons ? ` ${call.reasons.join(', ')}` : ''}`
  if (call.state === 'unknown') return 'KIFF cannot tell whether the tool received it. Check the tool before trying again.'
  return ''
}
