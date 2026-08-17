/**
 * The audit log.
 *
 * Behind `roster`, which is one of ADR 0010's two carve-outs from the
 * read-everything floor — the other being contact details. Sixty people's
 * record of every correction somebody made is not the same artifact as the
 * whiteboard, and this is the one screen where that distinction bites.
 *
 * What is **not** here is as decided as what is. Denials are structured logs
 * and not rows, because a table of things that did not happen is a table nobody
 * reads. Publishing a Release Version writes nothing here, because a
 * versioned-tier change *is* a version (ADR 0003). And this table is derived:
 * it could be lost without losing the application, which is the property ADR
 * 0006's restore story depends on.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/audit')({
  component: Audit,
})

type Log = Answers<typeof contract, '/audit'>

/** What each entity is called out loud. */
const ENTITY_TEXT: Record<string, string> = {
  volunteer: 'Volunteer',
  volunteer_role: 'Role',
  medication_authority: 'Medication authority',
  release_signature: 'Release signature',
  volunteer_consent: 'Consent',
}

function Audit() {
  const [log, setLog] = useState<Log | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    client
      .get('/audit')
      .then(setLog)
      .catch((error: unknown) => {
        setProblem(refusalText(error))
      })
  }, [])

  return (
    <main>
      <h1>Audit log</h1>
      {problem !== null && <p role="alert">{problem}</p>}
      {log === null && problem === null && <p>One moment…</p>}
      {log !== null && (
        <table>
          <caption>Newest first</caption>
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Field</th>
              <th scope="col">Was</th>
              <th scope="col">Became</th>
              <th scope="col">Reason</th>
              <th scope="col">Who</th>
            </tr>
          </thead>
          <tbody>
            {log.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{ENTITY_TEXT[entry.entity] ?? entry.entity}</td>
                {/* Null means the record as a whole — a creation, a removal, a
                    grant. A grant has no field to name. */}
                <td>{entry.field ?? '—'}</td>
                <td>{entry.before ?? '—'}</td>
                <td>{entry.after ?? '—'}</td>
                <td>{entry.reason ?? '—'}</td>
                {/* Null only for the bootstrap command, which makes the first
                    President before anybody can sign in to be one. */}
                <td>{entry.actorVolunteerId ?? 'the bootstrap command'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
