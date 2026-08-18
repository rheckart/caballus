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
import {
  ROUTES,
  SHIFT_TYPES,
  type Route as FeedRoute,
  type ShiftType,
} from '../../shared/feed-schedule'
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
type ProductList = Answers<typeof contract, '/products'>
type HorseProfile = Answers<typeof contract, '/horses/:horseId'>

const KIND_LABEL: Record<SpaceKind, string> = { stall: 'Stall', field: 'Field', barn: 'Barn' }
const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
}
const ROUTE_LABEL: Record<FeedRoute, string> = {
  in_feed: 'In feed',
  oral_syringe: 'Oral syringe',
  topical: 'Topical',
  other: 'Other',
}

function Horses() {
  const [horses, setHorses] = useState<HorseList | null>(null)
  const [spaces, setSpaces] = useState<SpaceList | null>(null)
  const [products, setProducts] = useState<ProductList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [profile, setProfile] = useState<HorseProfile | null>(null)

  const load = useCallback(async () => {
    const [listed, listedSpaces, listedProducts] = await Promise.all([
      client.get('/horses'),
      client.get('/spaces'),
      client.get('/products'),
    ])
    setHorses(listed)
    setSpaces(listedSpaces)
    setProducts(listedProducts)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  // The Feed Schedule lives on the single-horse profile, not the list — a
  // directory of sixty rows has no use for another horse's feed lines (#36),
  // so it is fetched only for the horse actually open on this desk.
  const loadProfile = useCallback(async () => {
    if (openFor === null) {
      setProfile(null)
      return
    }
    setProfile(await client.get('/horses/:horseId', { horseId: openFor }))
  }, [openFor])

  useEffect(() => {
    void loadProfile().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [loadProfile])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      try {
        await work()
        await Promise.all([load(), loadProfile()])
      } catch (error: unknown) {
        setProblem(refusalText(error))
      }
    },
    [load, loadProfile],
  )

  if (horses === null || spaces === null || products === null) {
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
          products={products.products}
          profile={profile}
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
  products,
  profile,
  act,
}: {
  horse: Horse | null
  spaces: SpaceList['spaces']
  products: ProductList['products']
  profile: HorseProfile | null
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

      <FeedSchedules horse={horse} profile={profile} products={products} act={act} />
    </section>
  )
}

function FeedSchedules({
  horse,
  profile,
  products,
  act,
}: {
  horse: Horse
  profile: HorseProfile | null
  products: ProductList['products']
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <div>
      <h3>Feed Schedule</h3>
      {profile === null ? (
        <p>One moment…</p>
      ) : profile.feedSchedules.length === 0 ? (
        <p>No feed schedule recorded.</p>
      ) : (
        profile.feedSchedules.map((schedule) => (
          <div key={schedule.shiftType}>
            <h4>
              {SHIFT_TYPE_LABEL[schedule.shiftType]} — valid from {schedule.validFrom}
              {schedule.isNew && ' (New)'}
            </h4>
            {schedule.lines.length === 0 ? (
              <p>No feeding.</p>
            ) : (
              <ul>
                {schedule.lines.map((line) => (
                  <li key={line.productId}>
                    {line.amount} of {line.productName} — {ROUTE_LABEL[line.route]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}

      <PublishFeedSchedule horse={horse} products={products} act={act} />
    </div>
  )
}

interface DraftLine {
  readonly productId: string
  readonly amount: string
  readonly route: FeedRoute
}

/**
 * Publishes a new Feed Schedule version. Every edit creates a version rather
 * than updating a row (ADR 0003) — there is no edit action on the schedule
 * shown above, the same reason `release-versions.tsx` offers none on a
 * published Version.
 */
function PublishFeedSchedule({
  horse,
  products,
  act,
}: {
  horse: Horse
  products: ProductList['products']
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const [shiftType, setShiftType] = useState<ShiftType>('feed_am')
  const [validFrom, setValidFrom] = useState('')
  const [lines, setLines] = useState<readonly DraftLine[]>([
    { productId: '', amount: '', route: 'in_feed' },
  ])

  const [lineProblem, setLineProblem] = useState<string | null>(null)

  function updateLine(index: number, next: Partial<DraftLine>) {
    setLines(lines.map((line, at) => (at === index ? { ...line, ...next } : line)))
  }

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (validFrom === '') return
        const chosen = lines.filter((line) => line.productId !== '')
        // A line with no Product picked is just an unused row and is dropped
        // above; a line with a Product but a blank Amount is a mistake and
        // caught here, since HTML `required` cannot say "required only when a
        // Product is chosen" without JS of its own.
        if (chosen.some((line) => line.amount.trim() === '')) {
          setLineProblem('Every line with a Product needs an amount.')
          return
        }
        setLineProblem(null)
        void act(() =>
          client.post('/feed-schedules', {
            horseId: horse.id,
            shiftType,
            validFrom: dayString(validFrom),
            lines: chosen,
          }),
        ).then(() => {
          setLines([{ productId: '', amount: '', route: 'in_feed' }])
          setValidFrom('')
        })
      }}
    >
      {lineProblem !== null && <p role="alert">{lineProblem}</p>}
      <h4>Publish a version</h4>
      <label htmlFor={`feed-shift-type-${horse.id}`}>Shift Type</label>
      <select
        id={`feed-shift-type-${horse.id}`}
        value={shiftType}
        onChange={(event) => {
          setShiftType(event.target.value as ShiftType)
        }}
      >
        {SHIFT_TYPES.map((type) => (
          <option key={type} value={type}>
            {SHIFT_TYPE_LABEL[type]}
          </option>
        ))}
      </select>
      <label htmlFor={`feed-valid-from-${horse.id}`}>Valid from</label>
      <input
        id={`feed-valid-from-${horse.id}`}
        type="date"
        required
        value={validFrom}
        onChange={(event) => {
          setValidFrom(event.target.value)
        }}
      />

      <p>
        An empty line list retires this horse's schedule for this Shift Type — a version, not a
        deletion.
      </p>

      {lines.map((line, index) => (
        // A draft line has no id of its own yet, so the index is what there is.
        <div key={index}>
          <label htmlFor={`feed-line-product-${horse.id}-${String(index)}`}>Product</label>
          <select
            id={`feed-line-product-${horse.id}-${String(index)}`}
            value={line.productId}
            onChange={(event) => {
              updateLine(index, { productId: event.target.value })
            }}
          >
            <option value="">None</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <label htmlFor={`feed-line-amount-${horse.id}-${String(index)}`}>Amount</label>
          <input
            id={`feed-line-amount-${horse.id}-${String(index)}`}
            value={line.amount}
            placeholder="2 scoops"
            maxLength={200}
            onChange={(event) => {
              updateLine(index, { amount: event.target.value })
            }}
          />
          <label htmlFor={`feed-line-route-${horse.id}-${String(index)}`}>Route</label>
          <select
            id={`feed-line-route-${horse.id}-${String(index)}`}
            value={line.route}
            onChange={(event) => {
              updateLine(index, { route: event.target.value as FeedRoute })
            }}
          >
            {ROUTES.map((route) => (
              <option key={route} value={route}>
                {ROUTE_LABEL[route]}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setLines([...lines, { productId: '', amount: '', route: 'in_feed' }])
        }}
      >
        Add a line
      </button>
      <button type="submit">Publish</button>
    </form>
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
