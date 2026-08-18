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
import { useCallback, useEffect, useState, type FormEvent } from 'react'

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

function Volunteers() {
  const [people, setPeople] = useState<People | null>(null)
  const [versions, setVersions] = useState<Versions | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)

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
      }
    },
    [load],
  )

  if (people === null) {
    return (
      <main>
        <h1>Volunteers</h1>
        {problem === null ? <p>One moment…</p> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  const candidates = people.people.filter((person) => person.state === 'candidate')
  const flagged = people.people.filter(
    (person) => person.state === 'volunteer' && !person.rosterable,
  )

  return (
    <main>
      <h1>Volunteers</h1>

      {problem !== null && <p role="alert">{problem}</p>}

      {/* The two things the Coordinator opened this screen for, said before the
          list rather than found in it. */}
      <p>
        {candidates.length} awaiting orientation, {flagged.length} rostered with a gap.
      </p>
      {people.unstaffedScopes.length > 0 && (
        <p>
          Nobody but an officer holds: {people.unstaffedScopes.join(', ')}. That is a staffing
          question rather than a fault.
        </p>
      )}

      <NewVolunteer onCreate={(details) => act(() => client.post('/volunteers', details))} />

      <table>
        <caption>Everyone at the rescue</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">State</th>
            <th scope="col">Rosterable</th>
            <th scope="col">Roles</th>
            <th scope="col">Medication</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {people.people.map((person) => (
            <tr key={person.id}>
              <td>
                {person.name}
                {person.isMinor && <span> (under 18)</span>}
              </td>
              <td>{person.state === 'candidate' ? 'Candidate' : 'Volunteer'}</td>
              <td>
                {person.rosterable ? 'Yes' : person.gaps.map((gap) => GAP_TEXT[gap]).join('; ')}
              </td>
              <td>{person.roles.map((role) => ROLE_NAMES[role]).join(', ') || '—'}</td>
              <td>{person.medicationAuthority ? 'Yes' : 'No'}</td>
              <td>
                <button
                  type="button"
                  onClick={() => {
                    setOpenFor(openFor === person.id ? null : person.id)
                  }}
                >
                  {openFor === person.id ? 'Close' : 'Open'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {openFor !== null && (
        <PersonRecord
          person={people.people.find((person) => person.id === openFor) ?? null}
          today={people.today}
          versions={versions?.versions ?? []}
          act={act}
        />
      )}
    </main>
  )
}

function NewVolunteer({
  onCreate,
}: {
  onCreate: (details: { name: string; email: string; mobile: string | null }) => Promise<void>
}) {
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void onCreate({
          name: String(data.get('name') ?? ''),
          email: String(data.get('email') ?? ''),
          mobile: String(data.get('mobile') ?? '') || null,
        }).then(() => {
          form.reset()
        })
      }}
    >
      <h2>Add a volunteer</h2>
      {/* A name and an email address is the whole of it: no Account, no code,
          no login (ADR 0008). They are rosterable once the three gates hold,
          and a Candidate until then. */}
      <label htmlFor="new-name">Name</label>
      <input id="new-name" name="name" required maxLength={200} />
      <label htmlFor="new-email">Email address</label>
      <input id="new-email" name="email" type="email" required maxLength={320} />
      <label htmlFor="new-mobile">Mobile (optional)</label>
      <input id="new-mobile" name="mobile" maxLength={50} />
      <button type="submit">Add</button>
    </form>
  )
}

/** One person's record: the gates, the grants, and the paper behind them. */
function PersonRecord({
  person,
  today,
  versions,
  act,
}: {
  person: Person | null
  today: DayString
  versions: Versions['versions']
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  if (person === null) return null
  const behind = person.behindRoster

  return (
    <section>
      <h2>{person.name}</h2>

      {behind === null ? (
        // Absent rather than empty: the reader does not hold `roster`, and
        // saying so beats showing blank fields that look like missing data.
        <p>Contact details, the date of birth and the release history are behind `roster`.</p>
      ) : (
        <>
          <h3>Record</h3>
          <ul>
            <li>Email: {behind.email}</li>
            <li>Mobile: {behind.mobile ?? '—'}</li>
            <li>
              Date of birth: {behind.dateOfBirth ?? 'not established'}
              {behind.dateOfBirthProvenance !== null &&
                ` (${behind.dateOfBirthProvenance === 'photo_id' ? 'photo ID sighted' : 'provided by a parent'})`}
              {behind.age !== null && `, aged ${String(behind.age)}`}
            </li>
            {person.isMinor && behind.turnsEighteenOn !== null && (
              // The one gate failure that arrives on schedule. It obsoletes a
              // parent's signature and retires the Consent, derived on the day
              // and never by a job (ADR 0017).
              <li>
                Turns 18 on {behind.turnsEighteenOn}, which obsoletes a parent&rsquo;s signature
              </li>
            )}
            <li>Orientation: {behind.orientedOn ?? 'not recorded'}</li>
            <li>
              Consent: {behind.consentedOn ?? 'none'}
              {behind.parentName !== null && ` (${behind.parentName})`}
              {person.consentIsHistorical && ' — historical, and no longer gating'}
            </li>
            <li>Account: {person.hasAccount ? 'claimed' : 'never signed in'}</li>
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

      <h3>Leaving the rescue</h3>
      {/* A date rather than a delete: the work they did still happened, and it
          still has to have a subject. Their grants go with them (ADR 0010). */}
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void act(() =>
            client.post('/volunteers/removal', {
              volunteerId: person.id,
              reason: String(data.get('reason') ?? '') || null,
            }),
          )
        }}
      >
        <label htmlFor="removal-reason">Reason (optional)</label>
        <input id="removal-reason" name="reason" maxLength={500} />
        <button type="submit">Remove from the rescue</button>
      </form>
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
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/volunteers/date-of-birth', {
            volunteerId: person.id,
            dateOfBirth: dayString(String(data.get('dateOfBirth') ?? '')),
            provenance:
              data.get('provenance') === 'parent_provided' ? 'parent_provided' : 'photo_id',
            reason: String(data.get('reason') ?? '') || null,
          }),
        )
      }}
    >
      <h3>Date of birth</h3>
      {/* The app never holds the identity document — only how the date was
          established (ADR 0017). */}
      <label htmlFor="dob">Date</label>
      <input id="dob" name="dateOfBirth" type="date" max={today} required />
      <label htmlFor="dob-provenance">How it was established</label>
      <select id="dob-provenance" name="provenance" defaultValue="photo_id">
        <option value="photo_id">Photo ID sighted</option>
        <option value="parent_provided">Provided by a parent</option>
      </select>
      <label htmlFor="dob-reason">Reason (for a correction)</label>
      <input id="dob-reason" name="reason" maxLength={500} />
      <button type="submit">Record</button>
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
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/volunteers/orientation', {
            volunteerId: person.id,
            orientedOn: dayString(String(data.get('orientedOn') ?? '')),
          }),
        )
      }}
    >
      <h3>Orientation</h3>
      {/* It never lapses and is never revoked, so this appears once. */}
      <label htmlFor="oriented-on">The date they were oriented</label>
      <input
        id="oriented-on"
        name="orientedOn"
        type="date"
        defaultValue={today}
        max={today}
        required
      />
      <button type="submit">Record the orientation</button>
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
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/volunteers/consent', {
            volunteerId: person.id,
            consentedOn: dayString(String(data.get('consentedOn') ?? '')),
            parentName: String(data.get('parentName') ?? ''),
          }),
        )
      }}
    >
      <h3>Consent</h3>
      {/* A parent's permission, and a different record from the Release: one
          row cannot expire on two clocks (ADR 0017). */}
      <label htmlFor="consented-on">Date given</label>
      <input
        id="consented-on"
        name="consentedOn"
        type="date"
        defaultValue={today}
        max={today}
        required
      />
      <label htmlFor="parent-name">Parent or guardian</label>
      <input id="parent-name" name="parentName" required maxLength={200} />
      <button type="submit">Record the consent</button>
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

  if (current === undefined) {
    return (
      <>
        <h3>Release</h3>
        <p>No release version has been published yet, so nothing can be signed against one.</p>
      </>
    )
  }

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/volunteers/release', {
            volunteerId: person.id,
            releaseVersionId: String(data.get('releaseVersionId') ?? ''),
            signedOn: dayString(String(data.get('signedOn') ?? '')),
            byParent: data.get('byParent') === 'on',
          }),
        )
      }}
    >
      <h3>Release</h3>
      {/* The record that a piece of paper exists — who signed, when, which
          version. The paper itself stays in the cabinet (ADR 0017). */}
      <label htmlFor="release-version">Version signed</label>
      <select id="release-version" name="releaseVersionId" defaultValue={current.id}>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.label} (from {version.validFrom})
          </option>
        ))}
      </select>
      <label htmlFor="signed-on">Date on the paper</label>
      <input id="signed-on" name="signedOn" type="date" defaultValue={today} max={today} required />
      <label htmlFor="by-parent">Signed by a parent or guardian</label>
      <input id="by-parent" name="byParent" type="checkbox" defaultChecked={person.isMinor} />
      <button type="submit">Record the release</button>
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
      <ul>
        {signatures.map((signature) => (
          <li key={signature.id}>
            {signature.versionLabel}, signed {signature.signedOn}
            {signature.byParent && ' by a parent or guardian'}
            {signature.revoked ? (
              ' — revoked'
            ) : (
              <button
                type="button"
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
              </button>
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
      <ul>
        {ROLES.map((role) => (
          <li key={role}>
            {ROLE_NAMES[role]}
            {held.has(role) ? (
              <button
                type="button"
                onClick={() => {
                  void act(() =>
                    client.post('/volunteers/role-revocation', {
                      volunteerId: person.id,
                      role,
                      reason: null,
                    }),
                  )
                }}
              >
                Revoke
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void act(() =>
                    client.post('/volunteers/roles', {
                      volunteerId: person.id,
                      role,
                      reason: null,
                    }),
                  )
                }}
              >
                Grant
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3>Medication Authority</h3>
      {/* A qualification on the person, granted under `horse_care` and not a
          Domain Scope (ADR 0010). */}
      <button
        type="button"
        onClick={() => {
          void act(() =>
            client.post('/volunteers/medication-authority', {
              volunteerId: person.id,
              granted: !person.medicationAuthority,
              reason: null,
            }),
          )
        }}
      >
        {person.medicationAuthority ? 'Revoke medication authority' : 'Grant medication authority'}
      </button>
    </>
  )
}
