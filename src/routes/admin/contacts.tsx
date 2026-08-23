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
 *
 * This is the screen ADR 0025's install was proved on (#61): the first one
 * rendered through shadcn's components and Tailwind's tokens, correct in
 * Light and in Dark.
 */
import { createFileRoute } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
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
  WideField,
  useSaving,
} from '../../components/forms'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
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
      <h1 className="text-foreground">Contacts</h1>

      <p className="mb-5 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
        A posted number, its hours and what it is for. Nothing here ever resolves an Escalation:
        that is the point of the Contacts screen (ADR 0010, ADR 0014).
      </p>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-foreground">Posted numbers</h2>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Number</TableHead>
              <TableHead scope="col">Hours</TableHead>
              <TableHead scope="col">Purpose</TableHead>
              <TableHead scope="col" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>{contact.name}</TableCell>
                <TableCell>{contact.number}</TableCell>
                <TableCell>{contact.hours ?? 'Any time'}</TableCell>
                <TableCell>{contact.purpose}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpen({ kind: 'contact', contact })
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-foreground">Standing rules</h2>
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
        <section className="rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {page.standingRules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
                <span>{rule.text}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-none"
                  onClick={() => {
                    setOpen({ kind: 'rule', rule })
                  }}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
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
          <Input
            id="contact-name"
            name="name"
            defaultValue={contact?.name}
            required
            maxLength={200}
            autoFocus
          />
        </Field>
        <Field label="Number" htmlFor="contact-number">
          <Input
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
          <Input
            id="contact-hours"
            name="hours"
            defaultValue={contact?.hours ?? ''}
            maxLength={200}
            placeholder="9am to 5pm, Monday to Friday"
            aria-describedby="contact-hours-hint"
          />
        </Field>
        <Field label="What it is for" htmlFor="contact-purpose">
          <Input
            id="contact-purpose"
            name="purpose"
            defaultValue={contact?.purpose}
            required
            maxLength={500}
          />
        </Field>
        {contact !== null && (
          <WideField label="Reason" htmlFor="contact-reason" optional>
            <Input id="contact-reason" name="reason" maxLength={500} />
          </WideField>
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
        <WideField label="Text" htmlFor="rule-text">
          <Input
            id="rule-text"
            name="text"
            defaultValue={rule?.text}
            required
            maxLength={500}
            placeholder="No scissors in fields"
            autoFocus
          />
        </WideField>
        {rule !== null && (
          <WideField label="Reason" htmlFor="rule-reason" optional>
            <Input id="rule-reason" name="reason" maxLength={500} />
          </WideField>
        )}
      </Fields>
      <Actions>
        <SaveButton pending={pending}>{rule === null ? 'Add the rule' : 'Save'}</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}
