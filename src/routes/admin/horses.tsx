/**
 * Horses: every horse at the rescue, current or Departed, and the desk where
 * a horse_care holder creates one, edits its descriptive attributes, assigns
 * it a Space per kind, and marks it Departed.
 *
 * Departed is a date and never a delete (ADR 0002, #32) — this screen keeps
 * showing a Departed horse, marked, because admin is where the history stays
 * reachable. Hiding one from a work surface is the phone list's concern, in
 * `src/routes/horses/index.tsx`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'
import { SPACE_KINDS, type SpaceKind } from '../../shared/spaces'
import { dayString } from '../../shared/time'

export const Route = createFileRoute('/admin/horses')({
  component: Horses,
})

type HorseList = Answers<typeof contract, '/horses'>
type Horse = HorseList['horses'][number]
type SpaceList = Answers<typeof contract, '/spaces'>

const KIND_LABEL: Record<SpaceKind, string> = { stall: 'Stall', field: 'Field', barn: 'Barn' }

function Horses() {
  const [horses, setHorses] = useState<HorseList | null>(null)
  const [spaces, setSpaces] = useState<SpaceList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [listed, listedSpaces] = await Promise.all([client.get('/horses'), client.get('/spaces')])
    setHorses(listed)
    setSpaces(listedSpaces)
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

  if (horses === null || spaces === null) {
    return (
      <main>
        <h1>Horses</h1>
        {problem === null ? <p>One moment…</p> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  return (
    <main>
      <h1>Horses</h1>

      {problem !== null && <p role="alert">{problem}</p>}

      <NewHorse onCreate={(details) => act(() => client.post('/horses', details))} />

      <table>
        <caption>Every horse</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Halter colour</th>
            <th scope="col">Stall</th>
            <th scope="col">Field</th>
            <th scope="col">Barn</th>
            <th scope="col">Status</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {horses.horses.map((horse) => (
            <tr key={horse.id}>
              <td>{horse.name}</td>
              <td>{horse.halterColour ?? '—'}</td>
              <td>{horse.spaces.stall?.name ?? '—'}</td>
              <td>{horse.spaces.field?.name ?? '—'}</td>
              <td>{horse.spaces.barn?.name ?? '—'}</td>
              <td>
                {horse.departedOn === null ? 'At the rescue' : `Departed ${horse.departedOn}`}
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => {
                    setOpenFor(openFor === horse.id ? null : horse.id)
                  }}
                >
                  {openFor === horse.id ? 'Close' : 'Open'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {openFor !== null && (
        <HorseRecord
          horse={horses.horses.find((horse) => horse.id === openFor) ?? null}
          spaces={spaces.spaces}
          act={act}
        />
      )}
    </main>
  )
}

function NewHorse({
  onCreate,
}: {
  onCreate: (details: {
    name: string
    halterColour: string | null
    blanketSize: string | null
    height: string | null
    photoUrl: string | null
  }) => Promise<void>
}) {
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void onCreate({
          name: String(data.get('name') ?? ''),
          halterColour: String(data.get('halterColour') ?? '') || null,
          blanketSize: String(data.get('blanketSize') ?? '') || null,
          height: String(data.get('height') ?? '') || null,
          photoUrl: String(data.get('photoUrl') ?? '') || null,
        }).then(() => {
          form.reset()
        })
      }}
    >
      <h2>Add a horse</h2>
      <label htmlFor="new-horse-name">Name</label>
      <input id="new-horse-name" name="name" required maxLength={200} />
      <label htmlFor="new-horse-halter">Halter colour</label>
      <input id="new-horse-halter" name="halterColour" maxLength={100} />
      <label htmlFor="new-horse-blanket">Blanket size</label>
      <input id="new-horse-blanket" name="blanketSize" maxLength={100} />
      <label htmlFor="new-horse-height">Height</label>
      <input id="new-horse-height" name="height" maxLength={50} placeholder="15.2 hh" />
      <label htmlFor="new-horse-photo">Photo URL</label>
      <input id="new-horse-photo" name="photoUrl" type="url" maxLength={2000} />
      <button type="submit">Add</button>
    </form>
  )
}

function HorseRecord({
  horse,
  spaces,
  act,
}: {
  horse: Horse | null
  spaces: SpaceList['spaces']
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  if (horse === null) return null

  return (
    <section>
      <h2>{horse.name}</h2>
      {horse.photoUrl !== null && <img src={horse.photoUrl} alt={horse.name} width={200} />}

      <EditAttributes horse={horse} act={act} />

      <h3>Space assignments</h3>
      {SPACE_KINDS.map((kind) => (
        <AssignSpace key={kind} horse={horse} kind={kind} options={spaces} act={act} />
      ))}

      <Departure horse={horse} act={act} />
    </section>
  )
}

function EditAttributes({
  horse,
  act,
}: {
  horse: Horse
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/horses/attributes', {
            horseId: horse.id,
            name: String(data.get('name') ?? ''),
            halterColour: String(data.get('halterColour') ?? '') || null,
            blanketSize: String(data.get('blanketSize') ?? '') || null,
            height: String(data.get('height') ?? '') || null,
            photoUrl: String(data.get('photoUrl') ?? '') || null,
            reason: String(data.get('reason') ?? '') || null,
          }),
        )
      }}
    >
      <h3>Attributes</h3>
      <label htmlFor="edit-horse-name">Name</label>
      <input id="edit-horse-name" name="name" defaultValue={horse.name} required maxLength={200} />
      <label htmlFor="edit-horse-halter">Halter colour</label>
      <input
        id="edit-horse-halter"
        name="halterColour"
        defaultValue={horse.halterColour ?? ''}
        maxLength={100}
      />
      <label htmlFor="edit-horse-blanket">Blanket size</label>
      <input
        id="edit-horse-blanket"
        name="blanketSize"
        defaultValue={horse.blanketSize ?? ''}
        maxLength={100}
      />
      <label htmlFor="edit-horse-height">Height</label>
      <input
        id="edit-horse-height"
        name="height"
        defaultValue={horse.height ?? ''}
        maxLength={50}
      />
      <label htmlFor="edit-horse-photo">Photo URL</label>
      <input
        id="edit-horse-photo"
        name="photoUrl"
        type="url"
        defaultValue={horse.photoUrl ?? ''}
        maxLength={2000}
      />
      <label htmlFor="edit-horse-reason">Reason (optional)</label>
      <input id="edit-horse-reason" name="reason" maxLength={500} />
      <button type="submit">Save</button>
    </form>
  )
}

function AssignSpace({
  horse,
  kind,
  options,
  act,
}: {
  horse: Horse
  kind: SpaceKind
  options: SpaceList['spaces']
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const current = horse.spaces[kind]
  const choices = options.filter((space) => space.kind === kind)

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const chosen = String(data.get('spaceId') ?? '')
        void act(() =>
          client.post('/horses/space', {
            horseId: horse.id,
            kind,
            spaceId: chosen === '' ? null : chosen,
          }),
        )
      }}
    >
      <label htmlFor={`space-${kind}-${horse.id}`}>{KIND_LABEL[kind]}</label>
      <select id={`space-${kind}-${horse.id}`} name="spaceId" defaultValue={current?.id ?? ''}>
        <option value="">None</option>
        {choices.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
      <button type="submit">Set</button>
    </form>
  )
}

function Departure({
  horse,
  act,
}: {
  horse: Horse
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  if (horse.departedOn !== null) {
    return (
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void act(() =>
            client.post('/horses/departure', { horseId: horse.id, departedOn: null, reason: null }),
          )
        }}
      >
        <h3>Departed {horse.departedOn}</h3>
        {/* A date is a correction, never a delete (ADR 0002) — the same as
            setting one below. */}
        <button type="submit">Correct: not Departed</button>
      </form>
    )
  }

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/horses/departure', {
            horseId: horse.id,
            departedOn: dayString(String(data.get('departedOn') ?? '')),
            reason: String(data.get('reason') ?? '') || null,
          }),
        )
      }}
    >
      <h3>Departure</h3>
      <label htmlFor="departed-on">Date</label>
      <input id="departed-on" name="departedOn" type="date" required />
      <label htmlFor="departure-reason">Reason (optional)</label>
      <input id="departure-reason" name="reason" maxLength={500} />
      <button type="submit">Mark Departed</button>
    </form>
  )
}
