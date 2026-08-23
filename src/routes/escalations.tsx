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
import { Empty, Field, Loading } from '../components/forms'
import { Alert, AlertTitle } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
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
    <li className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <strong>{SCOPE_LABEL[escalation.scope]}</strong>
        {escalation.observationSubjectLabel !== null && (
          <span className="text-sm text-muted-foreground">
            {escalation.observationSubjectLabel}
          </span>
        )}
        {escalation.closedAt === null ? <Badge variant="green">Open</Badge> : <Badge>Closed</Badge>}
      </div>
      <p className="m-0 mb-1">
        <em>{escalation.framing}</em>
      </p>
      <p className="m-0 mb-1 text-sm">The Observation: {escalation.observationText}</p>
      <p className="m-0 mb-3 text-sm text-muted-foreground">
        Escalated by {escalation.escalatedByName}
        {escalation.closedAt !== null &&
          `. Closed by ${escalation.closedByName ?? 'somebody'}: ${escalation.closingNote ?? ''}`}
      </p>

      {escalation.comments.length > 0 && (
        <ul className="m-0 mb-3 list-none overflow-hidden rounded-md border border-border p-0">
          {escalation.comments.map((entry) => (
            <li
              key={entry.id}
              className="m-0 border-b border-border px-3 py-2 text-sm last:border-b-0"
            >
              {entry.authoredByName}: {entry.text}
            </li>
          ))}
        </ul>
      )}

      {problem !== null && (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      )}

      <form onSubmit={(event) => void comment(event)} className="mt-3">
        <Field label="Add to the thread" htmlFor={`comment-${escalation.id}`}>
          <Input id={`comment-${escalation.id}`} name="text" required maxLength={2000} />
        </Field>
        <div className="mt-2">
          <Button type="submit" variant="outline" disabled={busy}>
            Comment
          </Button>
        </div>
      </form>

      {canClose && escalation.closedAt === null && (
        <form onSubmit={(event) => void close(event)} className="mt-4">
          <Field label="Close with a note" htmlFor={`close-${escalation.id}`}>
            <Input id={`close-${escalation.id}`} name="note" required maxLength={2000} />
          </Field>
          <div className="mt-2">
            <Button type="submit" disabled={busy}>
              Close
            </Button>
          </div>
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
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      </main>
    )
  }

  if (list === null || me === null) {
    return (
      <main>
        <h1>Escalations</h1>
        <Loading what="escalations" />
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
      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      )}

      {myOpen.length > 0 && (
        <section>
          <h2 className="mb-3 mt-6">Open, addressed to a Scope you hold</h2>
          <ul className="m-0 list-none p-0">
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
        <h2 className="mb-3 mt-6">Every Escalation</h2>
        {list.escalations.length === 0 ? (
          <Empty>Nothing has been escalated yet.</Empty>
        ) : (
          <ul className="m-0 list-none p-0">
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
