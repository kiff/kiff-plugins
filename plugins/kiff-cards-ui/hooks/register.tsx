// KIFF Cards UI: the agent's Card in Claude Code's status line, a notice when
// KIFF holds a call, and this session's KIFF calls in a /kiff pane.
//
// Display only. It reads what the KIFF gateway already answered and the
// gateway's read-only kiff_card tool. It never answers, retries or changes
// a call: a held call is answered by a person in KIFF Cloud, and only the
// agent's own retry of the same call gets that answer.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { KiffCall, KiffCard } from '../types'
import {
  CARD_TOOL,
  describeCall,
  heldToast,
  holdEnded,
  kiffTool,
  readAnswer,
  statusLine,
  summarizeCard,
  summarizeCardText,
  upsert,
} from './kiff'

const PANE = 'kiff'

const calls = atom({ plugin: 'kiff-cards-ui', key: 'calls' } as const, [] as KiffCall[])
const card = atom({ plugin: 'kiff-cards-ui', key: 'card' } as const, null as KiffCard | null)
const server = atom({ plugin: 'kiff-cards-ui', key: 'server' } as const, null as string | null)

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
  for (const t of await $.tool.list()) {
    if (t.mcp && kiffTool(t.name)?.tool === CARD_TOOL) {
      await noteServer($, t.name)
      return kiffTool(t.name)!.server
    }
  }
  return null
}

/** Reads the Card through the gateway's read-only kiff_card tool. */
async function refreshCard($: Engine) {
  const name = await findServer($)
  if (!name) return
  const res = await $.mcp.call(name, CARD_TOOL, {})
  if (res.isError) return
  const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
  const summary = summarizeCard(res.structuredContent) ?? summarizeCardText(text)
  if (summary) await update($, card, () => summary)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'kiff',
      description: "Show this agent's KIFF Card and this session's KIFF calls",
    })
    void refreshCard($)
      .then(() => showStatus($))
      .catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'kiff' }, async $ => {
    await refreshCard($).catch(() => {})
    await showStatus($)
    await $.ui.open({ id: PANE, title: 'KIFF' })
    const c = await read($, card)
    return { text: c ? `KIFF Card: ${c.summary}.` : 'KIFF pane opened. No KIFF gateway seen in this session yet.' }
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

    return (
      <Box flexDirection="column">
        <Text bold>{c ? `Card: ${c.summary}` : 'Card: not read yet'}</Text>
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
            {call.state === 'held' && !holdEnded(call, now) && call.reviewUrl && (
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
  if (holdEnded(call, now)) return 'wait ended'
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
  if (holdEnded(call, now)) return "If no one answered, the call was refused. The agent's retry of the same call shows the answer."
  if (call.state === 'held') return call.holdExpiresAt ? `Nothing sent. Waits until ${call.holdExpiresAt}.` : 'Nothing sent.'
  if (call.state === 'refused') return `Nothing sent.${call.reasons ? ` ${call.reasons.join(', ')}` : ''}`
  if (call.state === 'unknown') return 'KIFF cannot tell whether the tool received it. Check the tool before trying again.'
  return ''
}
