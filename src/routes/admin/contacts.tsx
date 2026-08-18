/**
 * The desk where a `roster` holder posts and edits Contacts and the rescue's
 * standing rules (`CONTEXT.md`'s Contacts; ADR 0014, ADR 0018).
 *
 * The read-only screen everybody reads is `src/routes/contacts.tsx` — the
 * same split `src/routes/admin/horses.tsx` keeps from
 * `src/routes/horses/index.tsx`.
 *
 * There is no delete for either: a stale number is edited, not removed, the
 * same discipline every other current-state record in this application
 * follows.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/contacts')({
  component: ContactsAdmin,
})

type ContactsPage = Answers<typeof contract, '/contacts'>
type Contact = ContactsPage['contacts'][number]
type StandingRule = ContactsPage['standingRules'][number]

function ContactsAdmin() {
  const [page, setPage] = useState<ContactsPage | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editingContact, setEditingContact] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<string | null>(null)

  const load = useCallback(async () => {
    setPage(await client.get('/contacts'))
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      try {
        await work()
        await load()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      }
    },
    [load],
  )

  return (
    <main>
      <h1>Contacts</h1>

      {problem !== null && <p role="alert">{problem}</p>}

      <p>
        A posted number, its hours and what it is for. This screen never resolves an Escalation to
        anything here — that is the point of the Contacts screen (ADR 0010, ADR 0014).
      </p>

      <section>
        <h2>Posted numbers</h2>

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/contacts', {
                name: String(data.get('name') ?? ''),
                number: String(data.get('number') ?? ''),
                hours: String(data.get('hours') ?? '') || null,
                purpose: String(data.get('purpose') ?? ''),
              }),
            ).then(() => {
              form.reset()
            })
          }}
        >
          <h3>Add a contact</h3>
          <label htmlFor="new-contact-name">Name</label>
          <input id="new-contact-name" name="name" required maxLength={200} />
          <label htmlFor="new-contact-number">Number</label>
          <input id="new-contact-number" name="number" required maxLength={50} />
          <label htmlFor="new-contact-hours">Hours (optional)</label>
          <input id="new-contact-hours" name="hours" maxLength={200} placeholder="9am–5pm M–F" />
          <label htmlFor="new-contact-purpose">What it is for</label>
          <input id="new-contact-purpose" name="purpose" required maxLength={500} />
          <button type="submit">Add</button>
        </form>

        {page === null ? (
          <p>One moment…</p>
        ) : (
          <table>
            <caption>Every posted number</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Number</th>
                <th scope="col">Hours</th>
                <th scope="col">Purpose</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {page.contacts.map((contact) => (
                <tr key={contact.id}>
                  {editingContact === contact.id ? (
                    <EditContact
                      contact={contact}
                      onCancel={() => {
                        setEditingContact(null)
                      }}
                      act={async (work) => {
                        await act(work)
                        setEditingContact(null)
                      }}
                    />
                  ) : (
                    <>
                      <td>{contact.name}</td>
                      <td>{contact.number}</td>
                      <td>{contact.hours ?? '—'}</td>
                      <td>{contact.purpose}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingContact(contact.id)
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Standing rules</h2>

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/standing-rules', { text: String(data.get('text') ?? '') }),
            ).then(() => {
              form.reset()
            })
          }}
        >
          <h3>Add a standing rule</h3>
          <label htmlFor="new-rule-text">Text</label>
          <input
            id="new-rule-text"
            name="text"
            required
            maxLength={500}
            placeholder="No scissors in fields"
          />
          <button type="submit">Add</button>
        </form>

        {page === null ? (
          <p>One moment…</p>
        ) : (
          <ul>
            {page.standingRules.map((rule) =>
              editingRule === rule.id ? (
                <li key={rule.id}>
                  <EditStandingRule
                    rule={rule}
                    onCancel={() => {
                      setEditingRule(null)
                    }}
                    act={async (work) => {
                      await act(work)
                      setEditingRule(null)
                    }}
                  />
                </li>
              ) : (
                <li key={rule.id}>
                  {rule.text}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRule(rule.id)
                    }}
                  >
                    Edit
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </main>
  )
}

function EditContact({
  contact,
  onCancel,
  act,
}: {
  contact: Contact
  onCancel: () => void
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <td colSpan={5}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void act(() =>
            client.post('/contacts/edit', {
              contactId: contact.id,
              name: String(data.get('name') ?? ''),
              number: String(data.get('number') ?? ''),
              hours: String(data.get('hours') ?? '') || null,
              purpose: String(data.get('purpose') ?? ''),
              reason: String(data.get('reason') ?? '') || null,
            }),
          )
        }}
      >
        <label htmlFor={`edit-contact-name-${contact.id}`}>Name</label>
        <input
          id={`edit-contact-name-${contact.id}`}
          name="name"
          defaultValue={contact.name}
          required
          maxLength={200}
        />
        <label htmlFor={`edit-contact-number-${contact.id}`}>Number</label>
        <input
          id={`edit-contact-number-${contact.id}`}
          name="number"
          defaultValue={contact.number}
          required
          maxLength={50}
        />
        <label htmlFor={`edit-contact-hours-${contact.id}`}>Hours</label>
        <input
          id={`edit-contact-hours-${contact.id}`}
          name="hours"
          defaultValue={contact.hours ?? ''}
          maxLength={200}
        />
        <label htmlFor={`edit-contact-purpose-${contact.id}`}>What it is for</label>
        <input
          id={`edit-contact-purpose-${contact.id}`}
          name="purpose"
          defaultValue={contact.purpose}
          required
          maxLength={500}
        />
        <label htmlFor={`edit-contact-reason-${contact.id}`}>Reason (optional)</label>
        <input id={`edit-contact-reason-${contact.id}`} name="reason" maxLength={500} />
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </td>
  )
}

function EditStandingRule({
  rule,
  onCancel,
  act,
}: {
  rule: StandingRule
  onCancel: () => void
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/standing-rules/edit', {
            standingRuleId: rule.id,
            text: String(data.get('text') ?? ''),
            reason: String(data.get('reason') ?? '') || null,
          }),
        )
      }}
    >
      <label htmlFor={`edit-rule-text-${rule.id}`}>Text</label>
      <input
        id={`edit-rule-text-${rule.id}`}
        name="text"
        defaultValue={rule.text}
        required
        maxLength={500}
      />
      <label htmlFor={`edit-rule-reason-${rule.id}`}>Reason (optional)</label>
      <input id={`edit-rule-reason-${rule.id}`} name="reason" maxLength={500} />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}
