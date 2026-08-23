/**
 * Contacts: who to phone, the hours it is answered, what it is for, and the
 * rescue's standing rules (`CONTEXT.md`'s Contacts; ADR 0014, ADR 0018).
 *
 * **Read-only.** Editing lives at `/admin/contacts`, under `roster` — the same
 * split `src/routes/horses/index.tsx` and `src/routes/admin/horses.tsx` keep,
 * so a volunteer standing in a barn reading a number never sees a form the
 * server would refuse them anyway.
 *
 * **It sits entirely outside the routing model.** Nothing on this screen
 * resolves an Escalation to a number here — there is no field on a Contact
 * that could, so there is nothing here to wire up even by accident (ADR
 * 0010).
 */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Empty, Loading } from '../components/forms'
import { Alert, AlertTitle } from '../components/ui/alert'
import { client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/contacts')({
  component: Contacts,
})

type ContactsPage = Answers<typeof contract, '/contacts'>

export function Contacts() {
  const [page, setPage] = useState<ContactsPage | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    client
      .get('/contacts')
      .then((answered) => {
        if (current) setPage(answered)
      })
      .catch((error: unknown) => {
        if (current) setProblem(refusalText(error))
      })
    return () => {
      current = false
    }
  }, [])

  if (problem !== null) {
    return (
      <main>
        <h1 className="text-foreground">Contacts</h1>
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      </main>
    )
  }

  if (page === null) {
    return (
      <main>
        <h1 className="text-foreground">Contacts</h1>
        <Loading what="contacts" />
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-foreground">Contacts</h1>
      {page.contacts.length === 0 ? (
        <Empty>No contacts posted yet.</Empty>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {page.contacts.map((contact) => (
              <li
                key={contact.id}
                className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
                <strong>{contact.name}</strong> — {contact.number}
                {contact.hours !== null && ` — ${contact.hours}`}
                {` — ${contact.purpose}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-3 mt-6 text-foreground">Standing rules</h2>
      {page.standingRules.length === 0 ? (
        <Empty>No standing rules posted yet.</Empty>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {page.standingRules.map((rule) => (
              <li
                key={rule.id}
                className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
                {rule.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
