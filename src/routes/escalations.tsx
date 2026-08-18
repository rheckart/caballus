/**
 * Escalations: the routed report (`CONTEXT.md`'s Escalation; ADR 0014).
 *
 * **One browsable screen, on the floor** — "everyone reads everything," and
 * this is where a report a Lead marked *noted, no action* stays reachable by
 * a Scope holder who wants to adopt it, and where a reporter follows their
 * own report to a close. A holder's own **open** Escalations sit first,
 * because that is the home-section ADR 0014 asks for, read off this same
 * list rather than a second one.
 *
 * **The thread is floor-writable, before close and after** — ADR 0010's
 * fourth scope-free write. Closing stays a holder's own act, and needs a
 * note.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import type { DomainScope } from '../shared/domain-scopes'
import { client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/escalations')({
  component: Escalations,
})

type EscalationList = Answers<typeof contract, '/escalations'>
type Escalation = EscalationList['escalations'][number]
type Me = Answers<typeof contract, '/me'>

const SCOPE_LABEL: Record<DomainScope, string> = {
  horse_care: 'Horse care',
  maintenance: 'Maintenance',
  roster: 'Roster',
  supplies: 'Supplies',
  grants: 'Grants',
  financial: 'Financial',
  events: 'Events',
}

function EscalationCard({
  escalation,
  canClose,
  onChanged,
}: {
  escalation: Escalation
  canClose: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const comment = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = event.currentTarget
      const text = String(new FormData(form).get('text') ?? '')
      setProblem(null)
      setBusy(true)
      try {
        await client.post('/escalations/comments', { escalationId: escalation.id, text })
        form.reset()
        onChanged()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      } finally {
        setBusy(false)
      }
    },
    [escalation.id, onChanged],
  )

  const close = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = event.currentTarget
      const note = String(new FormData(form).get('note') ?? '')
      setProblem(null)
      setBusy(true)
      try {
        await client.post('/escalations/close', { escalationId: escalation.id, note })
        form.reset()
        onChanged()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      } finally {
        setBusy(false)
      }
    },
    [escalation.id, onChanged],
  )

  return (
    <li>
      <p>
        <strong>{SCOPE_LABEL[escalation.scope]}</strong>
        {escalation.observationSubjectLabel !== null && ` — ${escalation.observationSubjectLabel}`}
        {escalation.closedAt === null ? ' — Open' : ' — Closed'}
      </p>
      <p>
        <em>{escalation.framing}</em>
      </p>
      <p>The Observation: {escalation.observationText}</p>
      <p>
        Escalated by {escalation.escalatedByName}
        {escalation.closedAt !== null &&
          `. Closed by ${escalation.closedByName ?? 'somebody'}: ${escalation.closingNote ?? ''}`}
      </p>

      {escalation.comments.length > 0 && (
        <ul>
          {escalation.comments.map((comment) => (
            <li key={comment.id}>
              {comment.authoredByName}: {comment.text}
            </li>
          ))}
        </ul>
      )}

      {problem !== null && <p role="alert">{problem}</p>}

      <form onSubmit={(event) => void comment(event)}>
        <label htmlFor={`comment-${escalation.id}`}>Add to the thread</label>
        <input id={`comment-${escalation.id}`} name="text" required maxLength={2000} />
        <button type="submit" disabled={busy}>
          Comment
        </button>
      </form>

      {canClose && escalation.closedAt === null && (
        <form onSubmit={(event) => void close(event)}>
          <label htmlFor={`close-${escalation.id}`}>Close with a note</label>
          <input id={`close-${escalation.id}`} name="note" required maxLength={2000} />
          <button type="submit" disabled={busy}>
            Close
          </button>
        </form>
      )}
    </li>
  )
}

export function Escalations() {
  const [list, setList] = useState<EscalationList | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [listed, who] = await Promise.all([client.get('/escalations'), client.get('/me')])
    setList(listed)
    setMe(who)
  }, [])

  useEffect(() => {
    let current = true
    load().catch((error: unknown) => {
      if (current) setProblem(refusalText(error))
    })
    return () => {
      current = false
    }
  }, [load])

  const refresh = useCallback(() => {
    load().catch((error: unknown) => setProblem(refusalText(error)))
  }, [load])

  if (problem !== null && list === null) {
    return (
      <main>
        <h1>Escalations</h1>
        <p role="alert">{problem}</p>
      </main>
    )
  }

  if (list === null || me === null) {
    return (
      <main>
        <h1>Escalations</h1>
        <p>One moment…</p>
      </main>
    )
  }

  const held = new Set<DomainScope>(me.domainScopes)
  const myOpen = list.escalations.filter(
    (escalation) => escalation.closedAt === null && held.has(escalation.scope),
  )

  return (
    <main>
      <h1>Escalations</h1>
      {problem !== null && <p role="alert">{problem}</p>}

      {myOpen.length > 0 && (
        <section>
          <h2>Open, addressed to a Scope you hold</h2>
          <ul>
            {myOpen.map((escalation) => (
              <EscalationCard
                key={escalation.id}
                escalation={escalation}
                canClose={held.has(escalation.scope)}
                onChanged={refresh}
              />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Every Escalation</h2>
        {list.escalations.length === 0 ? (
          <p>Nothing has been escalated yet.</p>
        ) : (
          <ul>
            {list.escalations.map((escalation) => (
              <EscalationCard
                key={escalation.id}
                escalation={escalation}
                canClose={held.has(escalation.scope)}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
