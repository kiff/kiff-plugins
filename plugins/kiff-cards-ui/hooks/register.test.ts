import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

type Engine = Parameters<TestBody>[0]

const NOW = Date.parse('2026-10-06T14:00:00Z')
const HELD =
  "Waiting for the owner's approval: this call is outside the agent's Card. Nothing has been sent to the tool. " +
  'The owner can answer at https://app.kiff.dev/exceptions/exc_1. Retry the same call later to get their answer ' +
  '(same kiff_operation_id); checking again in about 30 seconds is enough. If the owner has not answered by ' +
  '2026-10-06T15:00:00Z, the call is refused and nothing is sent.'
const CARD = {
  agent_id: 'agent_1',
  cards: [{ id: 'card_1', grants: [{ action: 'refund' }], limits: [{ quantity: 'sum(amount)', limit: 500, window: 'calendar_day', used: 180, remaining: 320, status: 'ok' }] }],
}
const PANE_PROPS = { title: 'KIFF', isFocused: false, bodyColumns: 80, bodyRows: 20 } as never

/** Stands in for the engine and the KIFF gateway beneath the plugin. */
function gateway(on: On, answer: (tool: string) => { text: string; isError: boolean; result?: unknown }) {
  const seen = { toasts: [] as string[], status: undefined as string | undefined, calls: [] as string[] }
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    seen.status = e.text
    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('ui.open', () => ({ value: {} }) as never)
  on('tool.list', () => ({ value: [{ name: 'mcp__kiff__kiff_card', description: 'Shows the KIFF Card', mcp: true }] }))
  on('mcp.call', (_$, e) => {
    seen.calls.push(`${e.server}/${e.tool}`)
    return { value: { content: [], isError: false, structuredContent: CARD } }
  })
  on('tool.call', (_$, e) => {
    const a = answer(e.tool)
    return { result: a.result ?? { content: [{ type: 'text', text: a.text }] }, text: a.text, isError: a.isError } as never
  })
  return seen
}

async function pane($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({ plugin: 'kiff-cards-ui', surface, component: 'Pane', requestId: 'kiff', props: PANE_PROPS })
}

test('a held call: the agent gets the answer unchanged, the person gets a notice', async ($, on) => {
  const seen = gateway(on, () => ({ text: HELD, isError: true }))
  const ran = await $.tool.call({ tool: 'mcp__kiff__refund', amount: 80, kiff_operation_id: 'op-1' })

  expect(ran.text).toBe(HELD)
  expect(ran.isError).toBe(true)
  expect(seen.toasts).toEqual([
    'KIFF is holding refund (amount 80) for approval. Nothing was sent. Answer in KIFF Cloud: https://app.kiff.dev/exceptions/exc_1',
  ])
  expect(seen.status).toMatch(/1 waiting for approval/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /waiting for approval/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: /Answer in KIFF Cloud/ })).toBeDefined()
    await ui.unmount()
  }
})

test("the agent's retry after approval replaces the hold, with no second notice", async ($, on) => {
  let approved = false
  const seen = gateway(on, () => (approved ? { text: 'Refund re_123 created.', isError: false } : { text: HELD, isError: true }))
  await $.tool.call({ tool: 'mcp__kiff__refund', amount: 80, kiff_operation_id: 'op-1' })
  approved = true
  await $.tool.call({ tool: 'mcp__kiff__refund', amount: 80, kiff_operation_id: 'op-1' })

  expect(seen.toasts.length).toBe(1)
  expect(seen.status ?? '').not.toMatch(/waiting/)
  const ui = await pane($)
  expect(await ui.findAll({ type: 'Text', text: /^allowed$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /waiting for approval/ })).toBeUndefined()
  await ui.unmount()
})

test('a held call retried without an operation id: one notice, and no phantom hold after approval', async ($, on) => {
  let approved = false
  const seen = gateway(on, () => (approved ? { text: 'Refund re_9 created.', isError: false } : { text: HELD, isError: true }))
  await $.tool.call({ tool: 'mcp__kiff__refund', amount: 80, order: 'o_1' })
  await $.tool.call({ tool: 'mcp__kiff__refund', amount: 80, order: 'o_1' })
  expect(seen.toasts.length).toBe(1)
  expect(seen.status).toMatch(/· 1 waiting for approval$/)
  approved = true
  await $.tool.call({ tool: 'mcp__kiff__refund', amount: 80, order: 'o_1' })
  expect(seen.status ?? '').not.toMatch(/waiting/)
})

test('reads the Card through kiff_card only, and shows what is left', async ($, on) => {
  const seen = gateway(on, () => ({ text: 'Refund re_1 created.', isError: false }))
  await $.tool.call({ tool: 'mcp__kiff__refund', amount: 20, kiff_operation_id: 'op-2' })
  await $.command.run({ command: 'kiff', args: '' } as never)

  expect(seen.calls.every(c => c === 'kiff/kiff_card')).toBe(true)
  expect(seen.status).toBe('KIFF · 320 of 500 amount left today')
})

test('leaves other tools alone', async ($, on) => {
  const seen = gateway(on, () => ({ text: 'ok', isError: false }))
  await $.tool.call({ tool: 'mcp__stripe__refund', amount: 80 })

  expect(seen.toasts).toEqual([])
  expect(seen.status).toBeUndefined()
  expect(seen.calls).toEqual([])
})

test('at session start, the Card is read once the gateway has connected', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const status: (string | undefined)[] = []
  let tries = 0
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/' }) as never)
  on('tool.list', () => ({ value: [{ name: 'mcp__claude_ai_KIFF__kiff_card', description: 'Shows the KIFF Card', mcp: true }] }))
  on('mcp.call', () => {
    tries++
    if (tries === 1) throw new Error('no connected MCP tool "kiff_card" on a server named "claude_ai_KIFF"')
    // As the claude.ai connector sends it: the Card's JSON as text.
    return { value: { content: [{ type: 'text', text: JSON.stringify(CARD) }], isError: false } }
  })
  await $.session.start({ cwd: '/' } as never)
  await clock.advance(5000)
  await clock.advance(0)
  expect(tries).toBe(2)
  expect(status.at(-1)).toBe('KIFF · 320 of 500 amount left today')
})
