/**
 * The Coordinator's desk: the people list, and every act that changes what
 * somebody holds.
 *
 * **One surface for three gates.** ADR 0017 is explicit about it — "no new
 * queue and no new surface" — so the Orientation, the Release and the Consent
 * are all recorded from the row of the person they are about, beside the reason
 * that person is not yet rosterable. A gap here is the Coordinator's to-do
 * list, which is the whole point of showing it rather than hiding a disabled
 * button.
 *
 * Desktop admin, not the Work Surface (ADR 0007's three layouts). It is used at
 * a desk on real connectivity, which is why every refusal here can be shown and
 * argued with rather than queued and explained later.
 *
 * Everything goes through the typed client, so the paths and the answer shapes
 * are the contract's and a wrong one is a compile error rather than a 404 at
 * 6am (ADR 0021).
 *
 * The record is a modal of four tabs — Core Details, Paperwork, Roles,
 * Departure — and each tab is one form with one Save, the shape the horse
 * record already has (#62, ADR 0025). `src/components/record-modal.tsx` is
 * the modal both desks render, so the rule that **only one tab may ever be
 * unsaved** is one implementation rather than two that drift.
 */
import { createFileRoute } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Controller, useForm, type FieldValues } from 'react-hook-form'

import {
  Actions,
  AddButton,
  Choice,
  Empty,
  Field,
  Fields,
  Filter,
  Loading,
  SaveButton,
  Saved,
  Sheet,
  WideField,
  matches,
  useSaving,
} from '../../components/forms'
import {
  DANGER_CARD,
  InlineRefusal,
  RecordModal,
  StickySaved,
  useRecordForm,
} from '../../components/record-modal'
import { Refusal } from '../../components/refusal'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
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
import { ROLES, ROLE_NAMES, type Role } from '../../shared/roles'
import type { RosterGap } from '../../shared/rostering'
import { dayString, type DayString } from '../../shared/time'

export const Route = createFileRoute('/admin/volunteers')({
  component: Volunteers,
})

type People = Answers<typeof contract, '/volunteers'>
type Person = People['people'][number]
type Versions = Answers<typeof contract, '/release-versions'>

/**
 * What an open gate says out loud.
 *
 * The concrete fact rather than the internal name: a screen showing
 * `no_current_release` teaches nobody anything, and these are the sentences the
 * Coordinator repeats on the phone.
 */
const GAP_TEXT: Record<RosterGap, string> = {
  no_orientation: 'No orientation recorded',
  no_current_release: 'No current release on file',
  no_consent: 'No parental consent, and under 18',
}

/**
 * A sub-form inside a record tab, separated from what is above it — the
 * hairline `.record form` used to draw.
 */
const RECORD_FORM = 'mt-6 border-t border-border pt-4'

function Volunteers() {
  const [people, setPeople] = useState<People | null>(null)
  const [versions, setVersions] = useState<Versions | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const [listed, published] = await Promise.all([
      client.get('/volunteers'),
      client.get('/release-versions'),
    ])
    setPeople(listed)
    setVersions(published)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  /**
   * Adds the volunteer, then re-reads the list.
   *
   * Re-read rather than patched in place, because almost every act here changes
   * something derived — a signature recorded changes `rosterable`, a role
   * granted changes the scopes, and a screen that guessed at the derivation
   * would be a second answer to the question the server already answered. The
   * record's own acts each render their own refusal and call `load` directly.
   */
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

  const shown = useMemo(
    () =>
      (people?.people ?? []).filter((person) =>
        matches(filter, person.name, person.roles.map((role) => ROLE_NAMES[role]).join(' ')),
      ),
    [people, filter],
  )

  if (people === null) {
    return (
      <main>
        <h1 className="text-foreground">Volunteers</h1>
        {problem === null ? (
          <Loading what="people" />
        ) : (
          <Alert variant="destructive">
            <AlertTitle>
              <Refusal>{problem}</Refusal>
            </AlertTitle>
          </Alert>
        )}
      </main>
    )
  }

  const openPerson =
    openFor === null ? null : (people.people.find((person) => person.id === openFor) ?? null)
  const candidates = people.people.filter((person) => person.state === 'candidate')
  const flagged = people.people.filter(
    (person) => person.state === 'volunteer' && !person.rosterable,
  )

  return (
    <main>
      <h1 className="text-foreground">Volunteers</h1>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      {/* The two things the Coordinator opened this screen for, said before the
          list rather than found in it, and as figures rather than as a
          sentence to read past. */}
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
        <div className="rounded-lg bg-secondary p-4">
          <span className="block text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            {candidates.length}
          </span>
          <span className="block text-[13px] text-muted-foreground">awaiting orientation</span>
        </div>
        <div className="rounded-lg bg-secondary p-4">
          <span className="block text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            {flagged.length}
          </span>
          <span className="block text-[13px] text-muted-foreground">rostered with a gap</span>
        </div>
        <div className="rounded-lg bg-secondary p-4">
          <span className="block text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            {people.people.length}
          </span>
          <span className="block text-[13px] text-muted-foreground">people in total</span>
        </div>
      </div>

      {people.unstaffedScopes.length > 0 && (
        <p className="mb-5 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
          Nobody but an officer holds: {people.unstaffedScopes.join(', ')}. That is a staffing
          question rather than a fault.
        </p>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-foreground">Everyone at the rescue</h2>
        <AddButton
          onClick={() => {
            setAdding(true)
          }}
        >
          Add a volunteer
        </AddButton>
      </div>

      {people.people.length > 8 && (
        <Filter
          label="Find somebody"
          value={filter}
          onChange={setFilter}
          showing={shown.length}
          of={people.people.length}
          noun="people"
        />
      )}

      {shown.length === 0 ? (
        <Empty>
          {people.people.length === 0 ? 'Nobody at the rescue yet.' : `Nobody matches “${filter}”.`}
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">State</TableHead>
              <TableHead scope="col">Rosterable</TableHead>
              <TableHead scope="col">Roles</TableHead>
              <TableHead scope="col">Medication</TableHead>
              <TableHead scope="col" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((person) => (
              <TableRow key={person.id} data-state={openFor === person.id ? 'selected' : undefined}>
                <TableCell>
                  {person.name}
                  {person.isMinor && <Badge className="ml-2">Under 18</Badge>}
                </TableCell>
                <TableCell>{person.state === 'candidate' ? 'Candidate' : 'Volunteer'}</TableCell>
                <TableCell>
                  {person.rosterable ? (
                    <Badge variant="green">Yes</Badge>
                  ) : (
                    // Every open gate, each as its own tag: three of them run
                    // together in one sentence is what made this column unread.
                    <span className="inline-flex flex-wrap gap-1">
                      {person.gaps.map((gap) => (
                        <Badge key={gap} variant="orange">
                          {GAP_TEXT[gap]}
                        </Badge>
                      ))}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {person.roles.map((role) => ROLE_NAMES[role]).join(', ') || 'None'}
                </TableCell>
                <TableCell>{person.medicationAuthority ? 'Yes' : 'No'}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpenFor(person.id)
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

      {openPerson !== null && (
        <PersonRecord
          key={openPerson.id}
          person={openPerson}
          today={people.today}
          versions={versions?.versions ?? []}
          reload={load}
          onClose={() => {
            setOpenFor(null)
          }}
        />
      )}

      {adding && (
        <Sheet
          title="Add a volunteer"
          description="A name and an email address is the whole of it. No account, no code, no login."
          onClose={() => {
            setAdding(false)
          }}
        >
          <NewVolunteer
            act={act}
            onSaved={() => {
              setAdding(false)
            }}
          />
        </Sheet>
      )}
    </main>
  )
}

function NewVolunteer({
  act,
  onSaved,
}: {
  act: (work: () => Promise<unknown>) => Promise<void>
  onSaved: () => void
}) {
  const { pending, saved, save } = useSaving()
  // shadcn's Checkbox is a Radix button rather than an `<input>`, so it carries
  // no name and `FormData` never sees it — the same reason the release form
  // holds this in state.
  const [smsConsent, setSmsConsent] = useState(false)

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/volunteers', {
              name: String(data.get('name') ?? ''),
              email: String(data.get('email') ?? ''),
              mobile: String(data.get('mobile') ?? '') || null,
              smsConsent,
            }),
          ).then(onSaved),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      {/* A name and an email address is the whole of it: no Account, no code,
          no login (ADR 0008). They are rosterable once the three gates hold,
          and a Candidate until then. */}
      <Fields>
        <Field label="Name" htmlFor="new-name">
          <Input id="new-name" name="name" required maxLength={200} autoFocus />
        </Field>
        <Field
          label="Email address"
          htmlFor="new-email"
          hint="Where the six-digit sign-in code will go."
        >
          <Input
            id="new-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            required
            maxLength={320}
            aria-describedby="new-email-hint"
          />
        </Field>
        <Field label="Mobile" htmlFor="new-mobile" optional>
          <Input id="new-mobile" name="mobile" type="tel" inputMode="tel" maxLength={50} />
        </Field>
        {/* **SMS Consent, asked rather than assumed** (ADR 0028). Carriers want
            documented proof of opt-in, so the sentence beside the box is the
            opt-in language and has to be read to the volunteer — which is why
            it says what will be sent rather than *may we text you*. */}
        <WideField label="Texting" htmlFor="new-sms-consent">
          <label
            htmlFor="new-sms-consent"
            className="m-0 flex min-h-11 items-start gap-2 text-sm font-medium text-foreground"
          >
            <Checkbox
              id="new-sms-consent"
              className="mt-2.5"
              checked={smsConsent}
              onCheckedChange={(checked) => {
                setSmsConsent(checked === true)
              }}
            />
            <span className="py-2.5 font-normal">
              They agree to be texted when a shift they could work is short, or when there is rescue
              news that will not keep. Replying STOP ends it. Sign-in codes are not part of this.
            </span>
          </label>
        </WideField>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Add the volunteer</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

/* ------------------------------------------------------- the record modal -- */

const TAB_IDS = ['details', 'paperwork', 'roles', 'departure'] as const
type TabId = (typeof TAB_IDS)[number]

const TAB_LABEL: Record<TabId, string> = {
  details: 'Core Details',
  paperwork: 'Paperwork',
  roles: 'Roles',
  departure: 'Departure',
}

/**
 * One person's record: the gates, the grants, and the paper behind them —
 * the same modal of tabs the horse record is (#62, ADR 0025), so a desk that
 * has learned one has learned the other. `RecordModal` owns the rule that
 * only one tab may ever be unsaved.
 */
function PersonRecord({
  person,
  today,
  versions,
  reload,
  onClose,
}: {
  person: Person
  today: DayString
  versions: Versions['versions']
  reload: () => Promise<void>
  onClose: () => void
}) {
  const content: Record<TabId, ReactNode> = {
    details: <DetailsTab person={person} today={today} reload={reload} />,
    paperwork: <PaperworkTab person={person} today={today} versions={versions} reload={reload} />,
    roles: <RolesTab person={person} reload={reload} />,
    departure: <DepartureTab person={person} reload={reload} />,
  }

  return (
    <RecordModal
      onClose={onClose}
      tabs={TAB_IDS.map((id) => ({ id, label: TAB_LABEL[id], content: content[id] }))}
      header={
        <div>
          <DialogTitle>{person.name}</DialogTitle>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            {person.state === 'candidate' ? 'Candidate' : 'Volunteer'}
            {person.isMinor && ' · Under 18'}
          </p>
        </div>
      }
    />
  )
}

/**
 * Absent rather than empty: the reader does not hold `roster`, and saying so
 * beats showing blank fields that look like missing data.
 */
function BehindRoster() {
  return (
    <p className="m-0 text-sm text-muted-foreground">
      Contact details, the date of birth and the release history are behind `roster`.
    </p>
  )
}

/**
 * A button-only act — a grant, a revocation — with its refusal beside it
 * rather than at the top of a page. The forms use `useRecordForm`; these have
 * no form to be dirty, so they keep their own small state.
 */
function useButtonAct(reload: () => Promise<void>) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const run = (work: () => Promise<unknown>) => {
    setRefusal(null)
    setPending(true)
    void (async () => {
      try {
        await work()
        await reload()
      } catch (error: unknown) {
        setRefusal(refusalText(error))
      } finally {
        setPending(false)
      }
    })()
  }

  return { refusal, pending, run }
}

const RECORD_ROW = 'border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0'

/* --------------------------------------------------------- 1. Core Details -- */

function DetailsTab({
  person,
  today,
  reload,
}: {
  person: Person
  today: DayString
  reload: () => Promise<void>
}) {
  const behind = person.behindRoster
  if (behind === null) return <BehindRoster />

  return (
    <>
      <ul className="m-0 mb-4 list-none p-0">
        <li className={RECORD_ROW}>Email: {behind.email}</li>
        <li className={RECORD_ROW}>Mobile: {behind.mobile ?? '—'}</li>
        <li className={RECORD_ROW}>
          Date of birth: {behind.dateOfBirth ?? 'not established'}
          {behind.dateOfBirthProvenance !== null &&
            ` (${behind.dateOfBirthProvenance === 'photo_id' ? 'photo ID sighted' : 'provided by a parent'})`}
          {behind.age !== null && `, aged ${String(behind.age)}`}
        </li>
        {person.isMinor && behind.turnsEighteenOn !== null && (
          // The one gate failure that arrives on schedule. It obsoletes a
          // parent's signature and retires the Consent, derived on the day
          // and never by a job (ADR 0017).
          <li className={RECORD_ROW}>
            Turns 18 on {behind.turnsEighteenOn}, which obsoletes a parent&rsquo;s signature
          </li>
        )}
        <li className={RECORD_ROW}>
          Texting:{' '}
          {behind.smsStoppedAt !== null
            ? 'they replied STOP'
            : behind.smsConsentAt === null
              ? 'no consent recorded'
              : 'agreed'}
          {behind.mobile === null && ', and there is no number on file'}
        </li>
        <li className={RECORD_ROW}>Account: {person.hasAccount ? 'claimed' : 'never signed in'}</li>
      </ul>

      <RecordSmsConsent person={person} reload={reload} />

      <ClearSmsStop person={person} reload={reload} />

      <RecordDateOfBirth person={person} today={today} reload={reload} />
    </>
  )
}

/**
 * Recording or withdrawing SMS Consent for somebody who predates the question
 * (#77, ADR 0028).
 *
 * **Writing a STOP is not offered here**, and that is deliberate:
 * `sms_stopped_at` is the rescue's copy of what a volunteer told the carrier,
 * and a Coordinator writing into it would make two different facts
 * indistinguishable. What a Coordinator can do is withdraw the consent they
 * recorded, which is a different sentence and a different column — and, since
 * #82, *clear* a STOP the volunteer has already lifted with the carrier, which
 * is the button below this one.
 */
function RecordSmsConsent({ person, reload }: { person: Person; reload: () => Promise<void> }) {
  const { pending, saved, save } = useSaving()
  const behind = person.behindRoster
  const held = behind !== null && behind.smsConsentAt !== null

  return (
    <div className="mb-4">
      <Actions>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            void save(async () => {
              await client.post('/volunteers/sms-consent', {
                volunteerId: person.id,
                consented: !held,
              })
              await reload()
            })
          }}
        >
          {held ? 'Withdraw consent to text' : 'Record consent to text'}
        </Button>
        <Saved saved={saved} what="Recorded" />
      </Actions>
    </div>
  )
}

/**
 * Clearing a recorded STOP (#82, ADR 0028).
 *
 * **The un-stop is an act inside the app, not a webhook.** START, YES and
 * UNSTOP are keywords the campaign registers and Twilio honours, and this
 * application never hears about it — ADR 0028 owns no inbound webhook and that
 * decision stands. So the volunteer who did exactly what they were told to do
 * to come back needs a person to say so here, or their own screen to say it.
 * `/terms` promises both doors by name.
 *
 * **Offered only when there is one to clear**, because a button against a
 * column that is already null is a Coordinator wondering what it did. And it
 * says what it will *not* do: consent is a separate fact in a separate column,
 * and clearing this alone leaves somebody who never agreed still unreachable.
 */
function ClearSmsStop({ person, reload }: { person: Person; reload: () => Promise<void> }) {
  const { pending, saved, save } = useSaving()
  const behind = person.behindRoster
  if (behind === null || behind.smsStoppedAt === null) return null

  return (
    <div className="mb-4">
      <p className="text-sm text-muted-foreground">
        They replied STOP, so the carrier is refusing our messages and they are in nobody&rsquo;s
        reachable count. Once they have texted START back to the number, clear it here.
        {behind.smsConsentAt === null &&
          ' They have no consent recorded, so this alone is not enough.'}
      </p>
      <Actions>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            void save(async () => {
              await client.post('/volunteers/sms-stop-clearance', { volunteerId: person.id })
              await reload()
            })
          }}
        >
          Clear the recorded STOP
        </Button>
        <Saved saved={saved} what="Cleared" />
      </Actions>
    </div>
  )
}

interface DateOfBirthValues extends FieldValues {
  dateOfBirth: string
  provenance: 'photo_id' | 'parent_provided'
  reason: string
}

function RecordDateOfBirth({
  person,
  today,
  reload,
}: {
  person: Person
  today: DayString
  reload: () => Promise<void>
}) {
  const form = useForm<DateOfBirthValues>({
    defaultValues: {
      dateOfBirth: person.behindRoster?.dateOfBirth ?? '',
      // The read carries it as a plain string (`/volunteers`), so the two the
      // write accepts are the fence — anything else falls back to the default.
      provenance:
        person.behindRoster?.dateOfBirthProvenance === 'parent_provided'
          ? 'parent_provided'
          : 'photo_id',
      reason: '',
    },
  })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: 'date-of-birth',
    form,
    write: async (values) => {
      await client.post('/volunteers/date-of-birth', {
        volunteerId: person.id,
        dateOfBirth: dayString(values.dateOfBirth),
        provenance: values.provenance,
        reason: values.reason || null,
      })
      await reload()
    },
  })

  return (
    <form className={RECORD_FORM} onSubmit={onSubmit}>
      <h3 className="mt-0">Date of birth</h3>
      {/* The app never holds the identity document — only how the date was
          established (ADR 0017). */}
      <Fields>
        <Field label="Date" htmlFor="dob">
          <Input id="dob" type="date" max={today} required {...form.register('dateOfBirth')} />
        </Field>
        <div className="min-w-0">
          <Controller
            control={form.control}
            name="provenance"
            render={({ field }) => (
              <Choice
                legend="How it was established"
                name="provenance"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'photo_id', label: 'Photo ID sighted' },
                  { value: 'parent_provided', label: 'Provided by a parent' },
                ]}
              />
            )}
          />
        </div>
        <WideField
          label="Reason"
          htmlFor="dob-reason"
          optional
          hint="Only needed for a correction."
        >
          <Input
            id="dob-reason"
            maxLength={500}
            aria-describedby="dob-reason-hint"
            {...form.register('reason')}
          />
        </WideField>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Record</SaveButton>
        <StickySaved shown={saved} />
      </Actions>
    </form>
  )
}

/* ------------------------------------------------------------ 2. Paperwork -- */

/**
 * The three gates and the paper behind them (#34, ADR 0017). One surface, so
 * a gap is the Coordinator's to-do list rather than a disabled button.
 */
function PaperworkTab({
  person,
  today,
  versions,
  reload,
}: {
  person: Person
  today: DayString
  versions: Versions['versions']
  reload: () => Promise<void>
}) {
  const behind = person.behindRoster
  if (behind === null) return <BehindRoster />

  return (
    <>
      <ul className="m-0 mb-4 list-none p-0">
        <li className={RECORD_ROW}>Orientation: {behind.orientedOn ?? 'not recorded'}</li>
        <li className={RECORD_ROW}>
          Consent: {behind.consentedOn ?? 'none'}
          {behind.parentName !== null && ` (${behind.parentName})`}
          {person.consentIsHistorical && ' — historical, and no longer gating'}
        </li>
      </ul>

      {behind.orientedOn === null && (
        <RecordOrientation person={person} today={today} reload={reload} />
      )}
      {person.isMinor && <RecordConsent person={person} today={today} reload={reload} />}
      <RecordRelease person={person} today={today} versions={versions} reload={reload} />
      <Signatures person={person} reload={reload} />
    </>
  )
}

interface OrientationValues extends FieldValues {
  orientedOn: string
}

function RecordOrientation({
  person,
  today,
  reload,
}: {
  person: Person
  today: DayString
  reload: () => Promise<void>
}) {
  const form = useForm<OrientationValues>({ defaultValues: { orientedOn: today } })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: 'orientation',
    form,
    write: async (values) => {
      await client.post('/volunteers/orientation', {
        volunteerId: person.id,
        orientedOn: dayString(values.orientedOn),
      })
      await reload()
    },
  })

  return (
    <form className={RECORD_FORM} onSubmit={onSubmit}>
      <h3 className="mt-0">Orientation</h3>
      {/* It never lapses and is never revoked, so this appears once. */}
      <Fields>
        <Field
          label="The date they were oriented"
          htmlFor="oriented-on"
          hint="It never lapses, so this is recorded once."
        >
          <Input
            id="oriented-on"
            type="date"
            max={today}
            required
            aria-describedby="oriented-on-hint"
            {...form.register('orientedOn')}
          />
        </Field>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Record the orientation</SaveButton>
        <StickySaved shown={saved} />
      </Actions>
    </form>
  )
}

interface ConsentValues extends FieldValues {
  consentedOn: string
  parentName: string
}

function RecordConsent({
  person,
  today,
  reload,
}: {
  person: Person
  today: DayString
  reload: () => Promise<void>
}) {
  const form = useForm<ConsentValues>({
    defaultValues: { consentedOn: today, parentName: person.behindRoster?.parentName ?? '' },
  })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: 'consent',
    form,
    write: async (values) => {
      await client.post('/volunteers/consent', {
        volunteerId: person.id,
        consentedOn: dayString(values.consentedOn),
        parentName: values.parentName,
      })
      await reload()
    },
  })

  return (
    <form className={RECORD_FORM} onSubmit={onSubmit}>
      <h3 className="mt-0">Consent</h3>
      {/* A parent's permission, and a different record from the Release: one
          row cannot expire on two clocks (ADR 0017). */}
      <Fields>
        <Field label="Date given" htmlFor="consented-on">
          <Input
            id="consented-on"
            type="date"
            max={today}
            required
            {...form.register('consentedOn')}
          />
        </Field>
        <Field label="Parent or guardian" htmlFor="parent-name">
          <Input id="parent-name" required maxLength={200} {...form.register('parentName')} />
        </Field>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Record the consent</SaveButton>
        <StickySaved shown={saved} />
      </Actions>
    </form>
  )
}

interface ReleaseValues extends FieldValues {
  releaseVersionId: string
  signedOn: string
  byParent: boolean
}

function RecordRelease({
  person,
  today,
  versions,
  reload,
}: {
  person: Person
  today: DayString
  versions: Versions['versions']
  reload: () => Promise<void>
}) {
  const current = versions[0]
  const form = useForm<ReleaseValues>({
    defaultValues: {
      releaseVersionId: current?.id ?? '',
      signedOn: today,
      byParent: person.isMinor,
    },
  })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: 'release',
    form,
    write: async (values) => {
      await client.post('/volunteers/release', {
        volunteerId: person.id,
        releaseVersionId: values.releaseVersionId,
        signedOn: dayString(values.signedOn),
        byParent: values.byParent,
      })
      await reload()
    },
  })

  if (current === undefined) {
    return (
      <div className={RECORD_FORM}>
        <h3 className="mt-0">Release</h3>
        <p>No release version has been published yet, so nothing can be signed against one.</p>
      </div>
    )
  }

  return (
    <form className={RECORD_FORM} onSubmit={onSubmit}>
      <h3 className="mt-0">Release</h3>
      {/* The record that a piece of paper exists — who signed, when, which
          version. The paper itself stays in the cabinet (ADR 0017). */}
      <Fields>
        <Field label="Version signed" htmlFor="release-version">
          <Controller
            control={form.control}
            name="releaseVersionId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="release-version" aria-label="Version signed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {version.label} (from {version.validFrom})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Date on the paper" htmlFor="signed-on">
          <Input id="signed-on" type="date" max={today} required {...form.register('signedOn')} />
        </Field>
        <div className="sm:col-span-2">
          <label
            htmlFor="by-parent"
            className="m-0 flex min-h-11 items-center gap-2 text-sm font-medium text-foreground"
          >
            <Controller
              control={form.control}
              name="byParent"
              render={({ field }) => (
                <Checkbox
                  id="by-parent"
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked === true)
                  }}
                />
              )}
            />
            Signed by a parent or guardian
          </label>
        </div>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Record the release</SaveButton>
        <StickySaved shown={saved} />
      </Actions>
    </form>
  )
}

function Signatures({ person, reload }: { person: Person; reload: () => Promise<void> }) {
  const { refusal, pending, run } = useButtonAct(reload)
  const signatures = person.behindRoster?.signatures ?? []
  if (signatures.length === 0) return null

  return (
    <>
      <h3>Signatures on file</h3>
      <ul className="m-0 mb-4 list-none p-0">
        {signatures.map((signature) => (
          <li
            key={signature.id}
            className="flex items-center justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
          >
            <span>
              {signature.versionLabel}, signed {signature.signedOn}
              {signature.byParent && ' by a parent or guardian'}
            </span>
            {signature.revoked ? (
              <Badge>Revoked</Badge>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-none"
                disabled={pending}
                onClick={() => {
                  run(() =>
                    client.post('/volunteers/release-revocation', {
                      signatureId: signature.id,
                      reason: null,
                    }),
                  )
                }}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
    </>
  )
}

/* ---------------------------------------------------------------- 3. Roles -- */

/**
 * Roles and Medication Authority.
 *
 * Two different scopes confer these — `grants` and `horse_care` — and the
 * screen offers both to whoever is looking, because the server is what refuses
 * and a button that is not there is indistinguishable from a broken app
 * (ADR 0011's argument for the disabled-and-explained Cover action).
 */
function RolesTab({ person, reload }: { person: Person; reload: () => Promise<void> }) {
  const { refusal, pending, run } = useButtonAct(reload)
  const held = new Set<Role>(person.roles)

  return (
    <>
      {/* One row per Role, held or not, with the act on it. A bulleted list of
          fourteen names each trailing a button was a column of identical text
          the Coordinator had to read to find the one they came for. */}
      <ul className="m-0 mb-4 list-none overflow-hidden rounded-md border border-border p-0">
        {ROLES.map((role) => (
          <li
            key={role}
            className="m-0 flex items-center justify-between gap-4 border-b border-border bg-background px-4 py-2 last:border-b-0 data-[held=true]:bg-card"
            data-held={held.has(role)}
          >
            <span>
              {ROLE_NAMES[role]}
              {held.has(role) && (
                <Badge variant="green" className="ml-2">
                  Held
                </Badge>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-none"
              disabled={pending}
              onClick={() => {
                run(() =>
                  held.has(role)
                    ? client.post('/volunteers/role-revocation', {
                        volunteerId: person.id,
                        role,
                        reason: null,
                      })
                    : client.post('/volunteers/roles', {
                        volunteerId: person.id,
                        role,
                        reason: null,
                      }),
                )
              }}
            >
              {held.has(role) ? 'Revoke' : 'Grant'}
            </Button>
          </li>
        ))}
      </ul>

      <h3>Medication Authority</h3>
      {/* A qualification on the person, granted under `horse_care` and not a
          Domain Scope (ADR 0010). */}
      <p className="mb-2 text-[13px] leading-snug text-muted-foreground">
        Not a Role and not a Domain Scope. It is what lets somebody give medication on a Shift.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          run(() =>
            client.post('/volunteers/medication-authority', {
              volunteerId: person.id,
              granted: !person.medicationAuthority,
              reason: null,
            }),
          )
        }}
      >
        {person.medicationAuthority ? 'Revoke medication authority' : 'Grant medication authority'}
      </Button>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
    </>
  )
}

/* ------------------------------------------------------------ 4. Departure -- */

interface RemovalValues extends FieldValues {
  reason: string
}

/**
 * Leaving the rescue: a date rather than a delete, because the work they did
 * still happened and it still has to have a subject. Their grants go with them
 * (ADR 0010).
 *
 * It confirms inline inside the card, never on a Save button and never in a
 * second modal (#62): *I recorded her orientation* must not share a button
 * with *she is gone*.
 */
function DepartureTab({ person, reload }: { person: Person; reload: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const form = useForm<RemovalValues>({ defaultValues: { reason: '' } })

  const { pending, refusal, saved, submit } = useRecordForm({
    id: 'removal',
    form,
    // Confirmed inline in its own card (#62), so the modal's *Save them*
    // must never perform it.
    guarded: true,
    write: async (values) => {
      await client.post('/volunteers/removal', {
        volunteerId: person.id,
        reason: values.reason || null,
      })
      await reload()
      setConfirming(false)
    },
  })

  return (
    <form
      className={DANGER_CARD}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        // Only once the confirmation is on screen. Before that this card has
        // exactly one text field and renders no submit button, which is the
        // shape HTML submits on Enter — so the reflex that commits a field
        // would otherwise remove somebody from the rescue with nothing asked.
        if (!confirming) return
        void submit()
      }}
    >
      <h3 className="m-0 mb-1 text-base font-semibold text-foreground">Leaving the rescue</h3>
      <p className="m-0 text-sm text-muted-foreground">
        Their record stays and so does everything they did. What they hold goes with them, and the
        next request they make is refused.
      </p>
      <Fields>
        <WideField label="Reason" htmlFor="removal-reason" optional>
          <Input id="removal-reason" maxLength={500} {...form.register('reason')} />
        </WideField>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        {confirming ? (
          <>
            <span className="mr-1 text-sm font-medium text-foreground">
              Remove {person.name} from the rescue?
            </span>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Saving…' : 'Yes — they have left'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false)
              }}
            >
              Keep them
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setConfirming(true)
            }}
          >
            Remove from the rescue
          </Button>
        )}
        <StickySaved shown={saved} what="Removed" />
      </Actions>
    </form>
  )
}
