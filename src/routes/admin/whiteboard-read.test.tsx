/**
 * The Whiteboard Read screen at the UI seam: the real route component, the
 * real typed client, and only `fetch` stubbed (#32's testing decisions, #59).
 *
 * What is claimed here is the half of ADR 0023 that lives on the screen — the
 * person picks the panel before shooting, an oversized photograph is refused
 * **in words** here rather than downstream, and the report names all four of
 * its sections rather than only what worked.
 */
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PANEL_LABEL, MOST_IMAGE_BASE64_CHARS } from '../../shared/whiteboard'
import { stubApi } from '../../test/api-stub'
import { renderRoute } from '../../test/route-harness'
import { Route } from './whiteboard-read'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderScreen() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoute('/admin/whiteboard-read', component)
}

/** A photograph of `bytes` bytes. The content never matters; the size does. */
function photograph(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'panel.png', { type: 'image/png' })
}

/** The router mounts asynchronously, so every test waits for the form first. */
async function photographInput(): Promise<HTMLElement> {
  return screen.findByLabelText('The photograph')
}

function chooseFile(input: HTMLElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

const REPORT = {
  created: [{ record: 'horse', name: 'Blue', id: 'blue-1' }],
  skipped: [{ record: 'product', name: 'Senior' }],
  blank: ['Row 6’s PM grain cell is smudged.'],
  couldNotPlace: ['A Horse reading did not parse: {"name":""}'],
  check: ['Previcox was read as a medication. Check it.'],
}

describe('the Whiteboard Read screen', () => {
  it('offers every panel, so a person says which one it is before shooting', async () => {
    stubApi({})
    renderScreen()

    await photographInput()
    for (const label of Object.values(PANEL_LABEL)) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })

  it('takes a photograph already on the phone, not only a fresh one', async () => {
    // `capture` would force the camera and hide the gallery. The panels are
    // shot on a walk round the barn and read at the desk afterwards, so that
    // is the ordinary case rather than the exception.
    stubApi({})
    renderScreen()

    const input = await photographInput()
    expect(input.hasAttribute('capture')).toBe(false)
    expect(input.getAttribute('accept')).toContain('image/jpeg')
  })

  it('refuses an oversized photograph in words, without sending it', async () => {
    stubApi({ '/whiteboard-read': REPORT })
    renderScreen()

    // Base64 is four characters per three bytes, so this is comfortably over.
    chooseFile(await photographInput(), photograph(MOST_IMAGE_BASE64_CHARS))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('too big')
    // Nothing left the phone: the cap is enforced before the send, not after.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('sends the panel and the photograph, and shows every section of the report', async () => {
    let sent: Record<string, unknown> = {}
    stubApi({
      '/whiteboard-read': (init: RequestInit) => {
        sent = JSON.parse(String(init.body)) as Record<string, unknown>
        return REPORT
      },
    })
    renderScreen()

    const input = await photographInput()
    fireEvent.click(screen.getByLabelText(PANEL_LABEL.contacts))
    chooseFile(input, photograph(16))
    // Reading the file to base64 is asynchronous; the screen says when it has.
    await screen.findByText('Ready to read: panel.png')
    fireEvent.click(screen.getByRole('button', { name: 'Read this panel' }))

    expect(await screen.findByRole('heading', { name: 'What that panel said' })).toBeTruthy()
    expect(sent.panel).toBe('contacts')
    expect(sent.mediaType).toBe('image/png')
    expect(typeof sent.image).toBe('string')

    // All four sections, plus the medications to check — the report *is* the
    // answer, and a run that only showed what worked would hide the gaps.
    expect(screen.getByRole('heading', { name: 'Created' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Already on file' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Left blank' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Could not be placed' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Check these' })).toBeTruthy()
    expect(screen.getByText('Row 6’s PM grain cell is smudged.')).toBeTruthy()
  })

  it('says what a refusal means in words the person can act on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'whiteboard_reader_not_set' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    )
    renderScreen()

    chooseFile(await photographInput(), photograph(16))
    await screen.findByText('Ready to read: panel.png')
    fireEvent.click(screen.getByRole('button', { name: 'Read this panel' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('OPENROUTER_API_KEY')
  })
})
