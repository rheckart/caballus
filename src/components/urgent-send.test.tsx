/**
 * The Urgent Send's first tap asks how many it would reach — and, since #113,
 * whether this rescue may text at all. A rescue the one Twilio sender is not
 * registered for is told so before the confirm, in the sentence a box with no
 * Twilio already shows, rather than offered a count and refused after.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../test/api-stub'
import { UrgentSend } from './urgent-send'

const REACH = { everyone: { reachable: 47, total: 60 }, shifts: [] }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Urgent Send', () => {
  it('offers the count to confirm when the rescue texts', async () => {
    stubApi({ '/reach': { ...REACH, texts: true } })
    const onSend = vi.fn()
    render(<UrgentSend audience={{ kind: 'everyone' }} label="Text everyone" onSend={onSend} />)

    fireEvent.click(screen.getByRole('button', { name: 'Text everyone' }))

    expect(await screen.findByRole('button', { name: 'Send it' })).toBeTruthy()
    expect(document.body.textContent).toContain('47')
  })

  it('says nothing can be sent, and offers no confirm, when the rescue cannot text', async () => {
    stubApi({ '/reach': { ...REACH, texts: false } })
    const onSend = vi.fn()
    render(<UrgentSend audience={{ kind: 'everyone' }} label="Text everyone" onSend={onSend} />)

    fireEvent.click(screen.getByRole('button', { name: 'Text everyone' }))

    const said = await screen.findByRole('alert')
    expect(said.textContent).toBe('Texting is not set up for this rescue, so no text can be sent.')
    expect(screen.queryByRole('button', { name: 'Send it' })).toBeNull()
    expect(onSend).not.toHaveBeenCalled()
  })
})
