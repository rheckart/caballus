/**
 * Release Versions: what has been published, and publishing another.
 *
 * A Version is immutable, so there is nothing on this screen that edits one —
 * a correction is a new Version, published without the obsoletes flag so it
 * invalidates nobody (ADR 0017). That is the whole of the immutability, and it
 * is why the screen offers no edit action rather than offering one that fails.
 *
 * The obsoletes-prior checkbox is the sharpest control in the application. Set
 * it, and every signature given before this Version's valid-from stales on the
 * next read of the people list — **flagged, never removed**, because a
 * re-papering would otherwise empty every roster in the system on a single
 * morning. The screen says so above the box rather than in a tooltip.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'
import { dayString } from '../../shared/time'

export const Route = createFileRoute('/admin/release-versions')({
  component: ReleaseVersions,
})

type Versions = Answers<typeof contract, '/release-versions'>

function ReleaseVersions() {
  const [versions, setVersions] = useState<Versions | null>(null)
  const [day, setDay] = useState<string>('')
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [published, today] = await Promise.all([
      client.get('/release-versions'),
      // The day from the server, in the organisation's timezone — a browser
      // deriving its own is right for most of the year and wrong at the edges
      // that matter (ADR 0007).
      client.get('/day'),
    ])
    setVersions(published)
    setDay(today.day)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setProblem(null)
    void client
      .post('/release-versions', {
        label: String(data.get('label') ?? ''),
        validFrom: dayString(String(data.get('validFrom') ?? '')),
        obsoletesPrior: data.get('obsoletesPrior') === 'on',
      })
      .then(async () => {
        form.reset()
        await load()
      })
      .catch((error: unknown) => {
        setProblem(refusalText(error))
      })
  }

  return (
    <main>
      <h1>Release versions</h1>

      {problem !== null && <p role="alert">{problem}</p>}

      <p>
        A version is one issue of the release text. It is immutable — a correction is a new version,
        and the current one is the newest. The signed papers stay in the cabinet; what is here is
        the record that they exist.
      </p>

      {versions === null ? (
        <p>One moment…</p>
      ) : (
        <table>
          <caption>Published, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Valid from</th>
              <th scope="col">Obsoleted prior signatures</th>
            </tr>
          </thead>
          <tbody>
            {versions.versions.map((version) => (
              <tr key={version.id}>
                <td>{version.label}</td>
                <td>{version.validFrom}</td>
                <td>{version.obsoletesPrior ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={publish}>
        <h2>Publish a version</h2>
        <label htmlFor="label">Label</label>
        <input id="label" name="label" required maxLength={200} placeholder="Updated 2020" />
        <label htmlFor="valid-from">Valid from</label>
        <input id="valid-from" name="validFrom" type="date" defaultValue={day} required />
        <p>
          Obsoleting prior signatures stales every release signed before that date. Nobody is
          removed from any roster: they are flagged on the people list, and the Coordinator works
          the list.
        </p>
        <label htmlFor="obsoletes-prior">Obsolete every prior signature</label>
        <input id="obsoletes-prior" name="obsoletesPrior" type="checkbox" />
        <button type="submit">Publish</button>
      </form>
    </main>
  )
}
