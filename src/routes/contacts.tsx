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
        <h1>Contacts</h1>
        <p role="alert">{problem}</p>
      </main>
    )
  }

  if (page === null) {
    return (
      <main>
        <h1>Contacts</h1>
        <p>One moment…</p>
      </main>
    )
  }

  return (
    <main>
      <h1>Contacts</h1>
      <ul>
        {page.contacts.map((contact) => (
          <li key={contact.id}>
            <strong>{contact.name}</strong> — {contact.number}
            {contact.hours !== null && ` — ${contact.hours}`}
            {` — ${contact.purpose}`}
          </li>
        ))}
      </ul>
      {page.contacts.length === 0 && <p>No contacts posted yet.</p>}

      <h2>Standing rules</h2>
      <ul>
        {page.standingRules.map((rule) => (
          <li key={rule.id}>{rule.text}</li>
        ))}
      </ul>
      {page.standingRules.length === 0 && <p>No standing rules posted yet.</p>}
    </main>
  )
}
