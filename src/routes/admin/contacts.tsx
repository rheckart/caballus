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
 * follows. Adding and editing are the same sheet and the same form, for both
 * records.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  Actions,
  AddButton,
  Empty,
  Field,
  Fields,
  Loading,
  SaveButton,
  Saved,
  Sheet,
  useSaving,
} from '../../components/forms'
import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/contacts')({
  component: ContactsAdmin,
})

type ContactsPage = Answers<typeof contract, '/contacts'>
type Contact = ContactsPage['contacts'][number]
type StandingRule = ContactsPage['standingRules'][number]

type Open =
  | { readonly kind: 'contact'; readonly contact: Contact | null }
  | { readonly kind: 'rule'; readonly rule: StandingRule | null }
  | null

function ContactsAdmin() {
  const [page, setPage] = useState<ContactsPage | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<Open>(null)

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
        throw error
      }
    },
    [load],
  )

  const close = () => {
    setOpen(null)
  }

  return (
    <main>
      <h1>Contacts</h1>

      <p className="lede">
        A posted number, its hours and what it is for. Nothing here ever resolves an Escalation:
        that is the point of the Contacts screen (ADR 0010, ADR 0014).
      </p>

      {problem !== null && <p role="alert">{problem}</p>}

      <div className="list-head">
        <h2>Posted numbers</h2>
        <AddButton
          onClick={() => {
            setOpen({ kind: 'contact', contact: null })
          }}
        >
          Add a contact
        </AddButton>
      </div>

      {page === null ? (
        <Loading what="contacts" />
      ) : page.contacts.length === 0 ? (
        <Empty>No numbers posted yet. The vet is usually the first one.</Empty>
      ) : (
        <table>
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
                <td>{contact.name}</td>
                <td>{contact.number}</td>
                <td>{contact.hours ?? 'Any time'}</td>
                <td>{contact.purpose}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen({ kind: 'contact', contact })
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="list-head">
        <h2>Standing rules</h2>
        <AddButton
          onClick={() => {
            setOpen({ kind: 'rule', rule: null })
          }}
        >
          Add a rule
        </AddButton>
      </div>

      {page === null ? (
        <Loading what="standing rules" />
      ) : page.standingRules.length === 0 ? (
        <Empty>No standing rules yet. These are the things that are always true in the barn.</Empty>
      ) : (
        <section>
          <ul>
            {page.standingRules.map((rule) => (
              <li key={rule.id} className="row">
                <span>{rule.text}</span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen({ kind: 'rule', rule })
                  }}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open?.kind === 'contact' && (
        <Sheet
          title={open.contact === null ? 'Add a contact' : `Edit ${open.contact.name}`}
          description="This is posted on the Contacts screen every volunteer reads."
          onClose={close}
        >
          <ContactForm contact={open.contact} act={act} onSaved={close} />
        </Sheet>
      )}

      {open?.kind === 'rule' && (
        <Sheet
          title={open.rule === null ? 'Add a standing rule' : 'Edit the rule'}
          description="One sentence that is always true in this barn."
          onClose={close}
        >
          <RuleForm rule={open.rule} act={act} onSaved={close} />
        </Sheet>
      )}
    </main>
  )
}

function ContactForm({
  contact,
  act,
  onSaved,
}: {
  contact: Contact | null
  act: (work: () => Promise<unknown>) => Promise<void>
  onSaved: () => void
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const common = {
          name: String(data.get('name') ?? ''),
          number: String(data.get('number') ?? ''),
          hours: String(data.get('hours') ?? '') || null,
          purpose: String(data.get('purpose') ?? ''),
        }
        void save(() =>
          act(() =>
            contact === null
              ? client.post('/contacts', common)
              : client.post('/contacts/edit', {
                  contactId: contact.id,
                  ...common,
                  reason: String(data.get('reason') ?? '') || null,
                }),
          ).then(onSaved),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      <Fields>
        <Field label="Name" htmlFor="contact-name">
          <input
            id="contact-name"
            name="name"
            defaultValue={contact?.name}
            required
            maxLength={200}
            autoFocus
          />
        </Field>
        <Field label="Number" htmlFor="contact-number">
          <input
            id="contact-number"
            name="number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={contact?.number}
            required
            maxLength={50}
          />
        </Field>
        <Field label="Hours" htmlFor="contact-hours" optional hint="Blank means any time.">
          <input
            id="contact-hours"
            name="hours"
            defaultValue={contact?.hours ?? ''}
            maxLength={200}
            placeholder="9am to 5pm, Monday to Friday"
            aria-describedby="contact-hours-hint"
          />
        </Field>
        <Field label="What it is for" htmlFor="contact-purpose">
          <input
            id="contact-purpose"
            name="purpose"
            defaultValue={contact?.purpose}
            required
            maxLength={500}
          />
        </Field>
        {contact !== null && (
          <div className="field-wide">
            <Field label="Reason" htmlFor="contact-reason" optional>
              <input id="contact-reason" name="reason" maxLength={500} />
            </Field>
          </div>
        )}
      </Fields>
      <Actions>
        <SaveButton pending={pending}>{contact === null ? 'Add the contact' : 'Save'}</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

function RuleForm({
  rule,
  act,
  onSaved,
}: {
  rule: StandingRule | null
  act: (work: () => Promise<unknown>) => Promise<void>
  onSaved: () => void
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            rule === null
              ? client.post('/standing-rules', { text: String(data.get('text') ?? '') })
              : client.post('/standing-rules/edit', {
                  standingRuleId: rule.id,
                  text: String(data.get('text') ?? ''),
                  reason: String(data.get('reason') ?? '') || null,
                }),
          ).then(onSaved),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      <Fields>
        <div className="field-wide">
          <Field label="Text" htmlFor="rule-text">
            <input
              id="rule-text"
              name="text"
              defaultValue={rule?.text}
              required
              maxLength={500}
              placeholder="No scissors in fields"
              autoFocus
            />
          </Field>
        </div>
        {rule !== null && (
          <div className="field-wide">
            <Field label="Reason" htmlFor="rule-reason" optional>
              <input id="rule-reason" name="reason" maxLength={500} />
            </Field>
          </div>
        )}
      </Fields>
      <Actions>
        <SaveButton pending={pending}>{rule === null ? 'Add the rule' : 'Save'}</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}
