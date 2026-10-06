import { describe, expect, test } from 'claude-code/testing'

import { describeCall, heldToast, holdEnded, kiffTool, readAnswer, statusLine, summarizeCard, upsert } from './kiff'

// Texts as apps/gateway writes them (gateway.go heldResult, result.go).
const HELD =
  "Waiting for the owner's approval: this call is outside the agent's Card. Nothing has been sent to the tool. " +
  'The owner can answer at https://app.kiff.dev/exceptions/exc_1. Retry the same call later to get their answer ' +
  '(same kiff_operation_id); checking again in about 30 seconds is enough. If the owner has not answered by ' +
  '2026-10-06T15:00:00Z, the call is refused and nothing is sent.'
const REFUSED =
  'Refused by KIFF (blocked: mandate_per_action_exceeded). Nothing was sent to the tool. Next: This call is above the ' +
  "Card's per-call limit."

describe('kiffTool', () => {
  test('recognizes every way the gateway is connected', () => {
    expect(kiffTool('mcp__kiff__refund')).toEqual({ server: 'kiff', tool: 'refund' })
    expect(kiffTool('mcp__plugin_kiff-cards_kiff__kiff_card')).toEqual({ server: 'plugin_kiff-cards_kiff', tool: 'kiff_card' })
    expect(kiffTool('mcp__claude_ai_KIFF__get_order')).toEqual({ server: 'claude_ai_KIFF', tool: 'get_order' })
  })
  test('ignores other servers and built-in tools', () => {
    expect(kiffTool('mcp__stripe__refund')).toBeUndefined()
    expect(kiffTool('mcp__kiffany__refund')).toBeUndefined()
    expect(kiffTool('Bash')).toBeUndefined()
  })
})

describe('readAnswer', () => {
  test('prefers the gateway metadata', () => {
    const result = {
      content: [{ type: 'text', text: 'anything' }],
      _meta: {
        'dev.kiff/call': {
          state: 'held',
          sent: 'no',
          retry: 'same_call',
          review_url: 'https://app.kiff.dev/x',
          hold_expires_at: '2026-10-06T15:00:00Z',
        },
      },
    }
    expect(readAnswer(result, 'anything', true)).toEqual({
      state: 'held',
      reasons: undefined,
      reviewUrl: 'https://app.kiff.dev/x',
      holdExpiresAt: '2026-10-06T15:00:00Z',
    })
  })
  test('reads a hold from the text', () => {
    expect(readAnswer(undefined, HELD, true)).toEqual({
      state: 'held',
      reviewUrl: 'https://app.kiff.dev/exceptions/exc_1',
      holdExpiresAt: '2026-10-06T15:00:00Z',
    })
  })
  test('reads a refusal and its reasons from the text', () => {
    expect(readAnswer(undefined, REFUSED, true)).toEqual({ state: 'refused', reasons: ['mandate_per_action_exceeded'] })
  })
  test("a forwarded call is the tool's own result", () => {
    expect(readAnswer({ content: [] }, 'Refund re_123 created.', false)).toEqual({ state: 'allowed' })
    expect(readAnswer({ content: [] }, 'Stripe: card declined', true)).toEqual({ state: 'tool_error' })
  })
  test('maps the in-between states', () => {
    expect(readAnswer(undefined, 'This call is still being decided. Nothing has been sent yet;', true).state).toBe('deciding')
    expect(readAnswer({ _meta: { 'dev.kiff/call': { state: 'unknown' } } }, '', true).state).toBe('unknown')
  })
})

describe('calls', () => {
  test('key is the operation id, amount the amount argument', () => {
    expect(describeCall({ tool: 'x', amount: 80, kiff_operation_id: 'op-1' }, 'tu_1')).toEqual({ key: 'op-1', amount: 'amount 80' })
    expect(describeCall({ tool: 'x' }, 'tu_1')).toEqual({ key: 'tu_1', amount: undefined })
  })
  test("a retry's answer replaces the hold", () => {
    const held = { key: 'op-1', tool: 'refund', state: 'held' as const, at: 1 }
    const after = upsert(upsert([], held), { ...held, state: 'allowed', at: 2 })
    expect(after).toEqual([{ ...held, state: 'allowed', at: 2 }])
  })
  test('a hold ends at its expiry', () => {
    const held = { key: 'op-1', tool: 'refund', state: 'held' as const, at: 1, holdExpiresAt: '2026-10-06T15:00:00Z' }
    expect(holdEnded(held, Date.parse('2026-10-06T14:59:59Z'))).toBe(false)
    expect(holdEnded(held, Date.parse('2026-10-06T15:00:00Z'))).toBe(true)
  })
  test('the toast says nothing was sent and where to answer', () => {
    expect(heldToast({ key: 'k', tool: 'refund', amount: 'amount 80', state: 'held', at: 1, reviewUrl: 'https://app.kiff.dev/x' })).toBe(
      'KIFF is holding refund (amount 80) for approval. Nothing was sent. Answer in KIFF Cloud: https://app.kiff.dev/x',
    )
  })
})

describe('the Card', () => {
  const card = {
    agent_id: 'agent_1',
    cards: [
      {
        id: 'card_1',
        grants: [{ action: 'refund' }],
        limits: [
          { quantity: 'count', limit: 100, window: 'calendar_day', used: 10, remaining: 90, status: 'ok' },
          { quantity: 'sum(amount)', limit: 500, window: 'calendar_day', used: 180, remaining: 320, status: 'ok' },
        ],
      },
    ],
  }
  test('shows the total with the least left', () => {
    expect(summarizeCard(card)).toEqual({ summary: '320 of 500 amount left today', issued: true })
  })
  test('says when no Card applies', () => {
    expect(summarizeCard({ agent_id: 'a', cards: [] })).toEqual({ summary: 'no Card issued', issued: false })
  })
  test('skips totals whose use could not be read', () => {
    const unread = { cards: [{ limits: [{ quantity: 'sum(amount)', limit: 500, window: 'calendar_day', status: 'unavailable' }] }] }
    expect(summarizeCard(unread)).toEqual({ summary: 'Card active', issued: true })
  })
  test('is not fooled by other results', () => {
    expect(summarizeCard('text')).toBeUndefined()
    expect(summarizeCard({ content: [] })).toBeUndefined()
  })
  test('status line counts the calls still waiting', () => {
    const c = { summary: '320 of 500 amount left today', issued: true }
    const held = { key: 'k', tool: 'refund', state: 'held' as const, at: 1 }
    expect(statusLine(c, [held], 0)).toBe('KIFF · 320 of 500 amount left today · 1 waiting for approval')
    expect(statusLine(null, [], 0)).toBeUndefined()
  })
})
