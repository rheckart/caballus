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
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

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
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
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
 * A sub-form inside the record panel, separated from what is above it — the
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
   * Does the act, then re-reads the list.
   *
   * Re-read rather than patched in place, because almost every act here changes
   * something derived — a signature recorded changes `rosterable`, a role
   * granted changes the scopes, and a screen that guessed at the derivation
   * would be a second answer to the question the server already answered.
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
            <AlertTitle>{problem}</AlertTitle>
          </Alert>
        )}
      </main>
    )
  }

  const candidates = people.people.filter((person) => person.state === 'candidate')
  const flagged = people.people.filter(
    (person) => person.state === 'volunteer' && !person.rosterable,
  )

  return (
    <main>
      <h1 className="text-foreground">Volunteers</h1>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
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
                      setOpenFor(openFor === person.id ? null : person.id)
                    }}
                  >
                    {openFor === person.id ? 'Close' : 'Open'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {openFor !== null && (
        <PersonRecord
          person={people.people.find((person) => person.id === openFor) ?? null}
          today={people.today}
          versions={versions?.versions ?? []}
          act={act}
          onClose={() => {
            setOpenFor(null)
          }}
          problem={problem}
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
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Add the volunteer</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

/** One person's record: the gates, the grants, and the paper behind them. */
function PersonRecord({
  person,
  today,
  versions,
  act,
  onClose,
  problem,
}: {
  person: Person | null
  today: DayString
  versions: Versions['versions']
  act: (work: () => Promise<unknown>) => Promise<void>
  onClose: () => void
  problem: string | null
}) {
  if (person === null) return null
  const behind = person.behindRoster

  return (
    // The accent along the edge marks it as *this row, expanded* rather than
    // as a second page that arrived from nowhere.
    <section className="mb-4 rounded-lg border border-border border-l-3 border-l-primary bg-background p-4 sm:p-6">
      <header className="mb-4 flex items-center gap-4 border-b border-border pb-4">
        <h2 className="m-0 flex-1">{person.name}</h2>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      {/* The same message as the one at the top of the page, repeated here
          because this is where the Coordinator is looking when an act on this
          person's row fails — a banner above a table scrolled out of view
          reads as nothing having happened. */}
      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      )}

      {behind === null ? (
        // Absent rather than empty: the reader does not hold `roster`, and
        // saying so beats showing blank fields that look like missing data.
        <p>Contact details, the date of birth and the release history are behind `roster`.</p>
      ) : (
        <>
          <h3>Record</h3>
          <ul className="m-0 mb-4 list-none p-0">
            <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
              Email: {behind.email}
            </li>
            <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
              Mobile: {behind.mobile ?? '—'}
            </li>
            <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
              Date of birth: {behind.dateOfBirth ?? 'not established'}
              {behind.dateOfBirthProvenance !== null &&
                ` (${behind.dateOfBirthProvenance === 'photo_id' ? 'photo ID sighted' : 'provided by a parent'})`}
              {behind.age !== null && `, aged ${String(behind.age)}`}
            </li>
            {person.isMinor && behind.turnsEighteenOn !== null && (
              // The one gate failure that arrives on schedule. It obsoletes a
              // parent's signature and retires the Consent, derived on the day
              // and never by a job (ADR 0017).
              <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
                Turns 18 on {behind.turnsEighteenOn}, which obsoletes a parent&rsquo;s signature
              </li>
            )}
            <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
              Orientation: {behind.orientedOn ?? 'not recorded'}
            </li>
            <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
              Consent: {behind.consentedOn ?? 'none'}
              {behind.parentName !== null && ` (${behind.parentName})`}
              {person.consentIsHistorical && ' — historical, and no longer gating'}
            </li>
            <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
              Account: {person.hasAccount ? 'claimed' : 'never signed in'}
            </li>
          </ul>

          <RecordDateOfBirth person={person} today={today} act={act} />
          {behind.orientedOn === null && (
            <RecordOrientation person={person} today={today} act={act} />
          )}
          {person.isMinor && <RecordConsent person={person} today={today} act={act} />}
          <RecordRelease person={person} today={today} versions={versions} act={act} />
          <Signatures person={person} act={act} />
        </>
      )}

      <Grants person={person} act={act} />

      <Removal person={person} act={act} />
    </section>
  )
}

function RecordDateOfBirth({
  person,
  today,
  act,
}: {
  person: Person
  today: DayString
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      className={RECORD_FORM}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/volunteers/date-of-birth', {
              volunteerId: person.id,
              dateOfBirth: dayString(String(data.get('dateOfBirth') ?? '')),
              provenance:
                data.get('provenance') === 'parent_provided' ? 'parent_provided' : 'photo_id',
              reason: String(data.get('reason') ?? '') || null,
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <h3 className="mt-0">Date of birth</h3>
      {/* The app never holds the identity document — only how the date was
          established (ADR 0017). */}
      <Fields>
        <Field label="Date" htmlFor="dob">
          <Input id="dob" name="dateOfBirth" type="date" max={today} required />
        </Field>
        <div className="min-w-0">
          <Choice
            legend="How it was established"
            name="provenance"
            defaultValue="photo_id"
            options={[
              { value: 'photo_id', label: 'Photo ID sighted' },
              { value: 'parent_provided', label: 'Provided by a parent' },
            ]}
          />
        </div>
        <WideField
          label="Reason"
          htmlFor="dob-reason"
          optional
          hint="Only needed for a correction."
        >
          <Input id="dob-reason" name="reason" maxLength={500} aria-describedby="dob-reason-hint" />
        </WideField>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Record</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

function RecordOrientation({
  person,
  today,
  act,
}: {
  person: Person
  today: DayString
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      className={RECORD_FORM}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/volunteers/orientation', {
              volunteerId: person.id,
              orientedOn: dayString(String(data.get('orientedOn') ?? '')),
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
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
            name="orientedOn"
            type="date"
            defaultValue={today}
            max={today}
            required
            aria-describedby="oriented-on-hint"
          />
        </Field>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Record the orientation</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

function RecordConsent({
  person,
  today,
  act,
}: {
  person: Person
  today: DayString
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      className={RECORD_FORM}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/volunteers/consent', {
              volunteerId: person.id,
              consentedOn: dayString(String(data.get('consentedOn') ?? '')),
              parentName: String(data.get('parentName') ?? ''),
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <h3 className="mt-0">Consent</h3>
      {/* A parent's permission, and a different record from the Release: one
          row cannot expire on two clocks (ADR 0017). */}
      <Fields>
        <Field label="Date given" htmlFor="consented-on">
          <Input
            id="consented-on"
            name="consentedOn"
            type="date"
            defaultValue={today}
            max={today}
            required
          />
        </Field>
        <Field label="Parent or guardian" htmlFor="parent-name">
          <Input id="parent-name" name="parentName" required maxLength={200} />
        </Field>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Record the consent</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

function RecordRelease({
  person,
  today,
  versions,
  act,
}: {
  person: Person
  today: DayString
  versions: Versions['versions']
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const current = versions[0]
  const { pending, saved, save } = useSaving()
  // The panel can mount before `/release-versions` answers, so the current
  // version is the fallback rather than the initial state — the same default
  // the native select carried.
  const [versionId, setVersionId] = useState('')
  const [byParent, setByParent] = useState(person.isMinor)
  const chosenVersionId = versionId === '' ? (current?.id ?? '') : versionId

  if (current === undefined) {
    return (
      <div className={RECORD_FORM}>
        <h3 className="mt-0">Release</h3>
        <p>No release version has been published yet, so nothing can be signed against one.</p>
      </div>
    )
  }

  return (
    <form
      className={RECORD_FORM}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/volunteers/release', {
              volunteerId: person.id,
              releaseVersionId: chosenVersionId,
              signedOn: dayString(String(data.get('signedOn') ?? '')),
              byParent,
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <h3 className="mt-0">Release</h3>
      {/* The record that a piece of paper exists — who signed, when, which
          version. The paper itself stays in the cabinet (ADR 0017). */}
      <Fields>
        <Field label="Version signed" htmlFor="release-version">
          <Select value={chosenVersionId} onValueChange={setVersionId}>
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
        </Field>
        <Field label="Date on the paper" htmlFor="signed-on">
          <Input
            id="signed-on"
            name="signedOn"
            type="date"
            defaultValue={today}
            max={today}
            required
          />
        </Field>
        <div className="sm:col-span-2">
          <label
            htmlFor="by-parent"
            className="m-0 flex min-h-11 items-center gap-2 text-sm font-medium text-foreground"
          >
            <Checkbox
              id="by-parent"
              checked={byParent}
              onCheckedChange={(checked) => {
                setByParent(checked === true)
              }}
            />
            Signed by a parent or guardian
          </label>
        </div>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Record the release</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

function Signatures({
  person,
  act,
}: {
  person: Person
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
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
                onClick={() => {
                  void act(() =>
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
    </>
  )
}

/**
 * Roles and Medication Authority.
 *
 * Two different scopes confer these — `grants` and `horse_care` — and the
 * screen offers both to whoever is looking, because the server is what refuses
 * and a button that is not there is indistinguishable from a broken app
 * (ADR 0011's argument for the disabled-and-explained Cover action).
 */
function Grants({
  person,
  act,
}: {
  person: Person
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const held = new Set<Role>(person.roles)

  return (
    <>
      <h3>Roles</h3>
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
              onClick={() => {
                void act(() =>
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
                ).catch(() => {
                  // Already at the top of the screen, put there by `act`.
                })
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
        onClick={() => {
          void act(() =>
            client.post('/volunteers/medication-authority', {
              volunteerId: person.id,
              granted: !person.medicationAuthority,
              reason: null,
            }),
          ).catch(() => {
            // Already at the top of the screen, put there by `act`.
          })
        }}
      >
        {person.medicationAuthority ? 'Revoke medication authority' : 'Grant medication authority'}
      </Button>
    </>
  )
}

/**
 * Leaving the rescue: a date rather than a delete, because the work they did
 * still happened and it still has to have a subject. Their grants go with them
 * (ADR 0010).
 */
function Removal({
  person,
  act,
}: {
  person: Person
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      className="mt-5 rounded-md border border-destructive/30 border-l-3 border-l-destructive bg-destructive/4 p-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/volunteers/removal', {
              volunteerId: person.id,
              reason: String(data.get('reason') ?? '') || null,
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <h3 className="m-0 mb-1 text-base font-semibold">Leaving the rescue</h3>
      <p className="m-0 mb-2 text-sm text-muted-foreground">
        Their record stays and so does everything they did. What they hold goes with them, and the
        next request they make is refused.
      </p>
      <Fields>
        <WideField label="Reason" htmlFor="removal-reason" optional>
          <Input id="removal-reason" name="reason" maxLength={500} />
        </WideField>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Remove from the rescue</SaveButton>
        <Saved saved={saved} what="Removed" />
      </Actions>
    </form>
  )
}
