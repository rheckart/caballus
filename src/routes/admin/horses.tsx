/**
 * Horses: every horse at the rescue, current or Departed, and the desk where
 * a horse_care holder creates one, edits its descriptive attributes, assigns
 * it a Space per kind, and marks it Departed.
 *
 * Departed is a date and never a delete (ADR 0002, #32) — this screen keeps
 * showing a Departed horse, marked, because admin is where the history stays
 * reachable. Hiding one from a work surface is the phone list's concern, in
 * `src/routes/horses/index.tsx`.
 *
 * The record for one horse stays a panel rather than a sheet, because unlike
 * every other edit on this desk it is not one form: it is five, and one of
 * them publishes a Feed Schedule with a line per Product. A sheet is right for
 * a form; a panel is right for a record.
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
  matches,
  useSaving,
} from '../../components/forms'
import { ALERT_KINDS, ALERT_KIND_LABEL, type AlertKind } from '../../shared/alerts'
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

/** The three, as the radio group takes them (ADR 0024). */
const ALERT_KIND_OPTIONS = ALERT_KINDS.map((kind) => ({
  value: kind,
  label: ALERT_KIND_LABEL[kind],
}))

const KIND_LABEL: Record<SpaceKind, string> = {
  stall: 'Stall',
  pasture: 'Pasture',
  paddock: 'Paddock',
  barn: 'Barn',
}
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

const SHIFT_TYPE_OPTIONS = SHIFT_TYPES.map((type) => ({
  value: type,
  label: SHIFT_TYPE_LABEL[type],
}))

function Horses() {
  const [horses, setHorses] = useState<HorseList | null>(null)
  const [spaces, setSpaces] = useState<SpaceList | null>(null)
  const [products, setProducts] = useState<ProductList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [profile, setProfile] = useState<HorseProfile | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('')

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
        throw error
      }
    },
    [load, loadProfile],
  )

  const shown = useMemo(
    () =>
      (horses?.horses ?? []).filter((horse) =>
        matches(
          filter,
          horse.name,
          horse.halterColour,
          horse.spaces.stall?.name ?? null,
          horse.spaces.pasture?.name ?? null,
          horse.spaces.paddock?.name ?? null,
        ),
      ),
    [horses, filter],
  )

  if (horses === null || spaces === null || products === null) {
    return (
      <main>
        <h1>Horses</h1>
        {problem === null ? <Loading what="horses" /> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  return (
    <main>
      <h1>Horses</h1>

      <p className="lede">
        Every horse, whether or not it is still here. A Departed horse stays on this list, marked,
        because the record has to outlive the horse leaving.
      </p>

      {problem !== null && <p role="alert">{problem}</p>}

      <div className="list-head">
        <h2>Every horse</h2>
        <AddButton
          onClick={() => {
            setAdding(true)
          }}
        >
          Add a horse
        </AddButton>
      </div>

      {horses.horses.length === 0 ? (
        <Empty>No horses yet.</Empty>
      ) : (
        <>
          {horses.horses.length > 8 && (
            <Filter
              label="Find a horse"
              value={filter}
              onChange={setFilter}
              showing={shown.length}
              of={horses.horses.length}
              noun="horses"
            />
          )}

          {shown.length === 0 ? (
            <Empty>No horse matches “{filter}”.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Halter</th>
                  <th scope="col">Stall</th>
                  <th scope="col">Pasture</th>
                  <th scope="col">Paddock</th>
                  <th scope="col">Barn</th>
                  <th scope="col">Status</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {shown.map((horse) => (
                  <tr key={horse.id} data-open={openFor === horse.id}>
                    <td>{horse.name}</td>
                    <td>{horse.halterColour ?? 'Not set'}</td>
                    <td>{horse.spaces.stall?.name ?? 'None'}</td>
                    <td>{horse.spaces.pasture?.name ?? 'None'}</td>
                    <td>{horse.spaces.paddock?.name ?? 'None'}</td>
                    <td>{horse.spaces.barn?.name ?? 'None'}</td>
                    <td>
                      {horse.departedOn === null ? (
                        <span className="badge badge-green">At the rescue</span>
                      ) : (
                        <span className="badge">Departed {horse.departedOn}</span>
                      )}
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
          )}
        </>
      )}

      {openFor !== null && (
        <HorseRecord
          horse={horses.horses.find((horse) => horse.id === openFor) ?? null}
          spaces={spaces.spaces}
          products={products.products}
          profile={profile}
          act={act}
          onClose={() => {
            setOpenFor(null)
          }}
        />
      )}

      {adding && (
        <Sheet
          title="Add a horse"
          description="A name is the only thing required. The rest can be filled in later."
          onClose={() => {
            setAdding(false)
          }}
        >
          <NewHorse
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

function NewHorse({
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
            client.post('/horses', {
              name: String(data.get('name') ?? ''),
              halterColour: String(data.get('halterColour') ?? '') || null,
              blanketSize: String(data.get('blanketSize') ?? '') || null,
              height: String(data.get('height') ?? '') || null,
              photoUrl: String(data.get('photoUrl') ?? '') || null,
            }),
          ).then(onSaved),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      <Fields>
        <Field label="Name" htmlFor="new-horse-name">
          <input id="new-horse-name" name="name" required maxLength={200} autoFocus />
        </Field>
        <Field label="Halter colour" htmlFor="new-horse-halter" optional>
          <input id="new-horse-halter" name="halterColour" maxLength={100} />
        </Field>
        <Field label="Blanket size" htmlFor="new-horse-blanket" optional>
          <input id="new-horse-blanket" name="blanketSize" maxLength={100} />
        </Field>
        <Field label="Height" htmlFor="new-horse-height" optional>
          <input id="new-horse-height" name="height" maxLength={50} placeholder="15.2 hh" />
        </Field>
        <div className="field-wide">
          <Field label="Photo URL" htmlFor="new-horse-photo" optional>
            <input id="new-horse-photo" name="photoUrl" type="url" maxLength={2000} />
          </Field>
        </div>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Add the horse</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

function HorseRecord({
  horse,
  spaces,
  products,
  profile,
  act,
  onClose,
}: {
  horse: Horse | null
  spaces: SpaceList['spaces']
  products: ProductList['products']
  profile: HorseProfile | null
  act: (work: () => Promise<unknown>) => Promise<void>
  onClose: () => void
}) {
  if (horse === null) return null

  return (
    <section className="record">
      <header className="record-head">
        {horse.photoUrl !== null && (
          <img src={horse.photoUrl} alt={horse.name} className="record-photo" />
        )}
        <h2>{horse.name}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <Alerts horse={horse} profile={profile} act={act} />

      <EditAttributes horse={horse} act={act} />

      <h3>Space assignments</h3>
      <div className="assignments">
        {SPACE_KINDS.map((kind) => (
          <AssignSpace key={kind} horse={horse} kind={kind} options={spaces} act={act} />
        ))}
      </div>

      <FeedSchedules horse={horse} profile={profile} products={products} act={act} />

      <Departure horse={horse} act={act} />
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
        <Loading what="the schedule" />
      ) : profile.feedSchedules.length === 0 ? (
        <Empty>No feed schedule recorded for this horse.</Empty>
      ) : (
        profile.feedSchedules.map((schedule) => (
          <div key={schedule.shiftType} className="schedule">
            <h4>
              {SHIFT_TYPE_LABEL[schedule.shiftType]}
              <span className="schedule-from">valid from {schedule.validFrom}</span>
              {schedule.isNew && <span className="badge badge-purple">New</span>}
            </h4>
            {schedule.lines.length === 0 ? (
              <p className="schedule-none">No feeding at this Shift Type.</p>
            ) : (
              <ul>
                {schedule.lines.map((line) => (
                  <li key={line.productId}>
                    <strong>{line.amount}</strong> of {line.productName}
                    {line.route !== 'in_feed' && `, ${ROUTE_LABEL[line.route].toLowerCase()}`}
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
 *
 * A line can now be removed as well as added, which it could not before: the
 * only way to withdraw a line typed by mistake was to reload the screen and
 * start the version over.
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
  const { pending, saved, save } = useSaving()

  function updateLine(index: number, next: Partial<DraftLine>) {
    setLines(lines.map((line, at) => (at === index ? { ...line, ...next } : line)))
  }

  return (
    <form
      className="publisher"
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
        void save(() =>
          act(() =>
            client.post('/feed-schedules', {
              horseId: horse.id,
              shiftType,
              validFrom: dayString(validFrom),
              lines: chosen,
            }),
          ).then(() => {
            setLines([{ productId: '', amount: '', route: 'in_feed' }])
            setValidFrom('')
          }),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <h4>Publish a version</h4>
      {lineProblem !== null && <p role="alert">{lineProblem}</p>}

      <Fields>
        <div className="field">
          <Choice
            legend="Shift Type"
            name="shiftType"
            options={SHIFT_TYPE_OPTIONS}
            value={shiftType}
            onChange={setShiftType}
          />
        </div>
        <Field
          label="Valid from"
          htmlFor={`feed-valid-from-${horse.id}`}
          hint="A version starts on a date. It never edits the one before it."
        >
          <input
            id={`feed-valid-from-${horse.id}`}
            type="date"
            required
            value={validFrom}
            aria-describedby={`feed-valid-from-${horse.id}-hint`}
            onChange={(event) => {
              setValidFrom(event.target.value)
            }}
          />
        </Field>
      </Fields>

      {lines.map((line, index) => (
        // A draft line has no id of its own yet, so the index is what there is.
        <div key={index} className="line">
          <Field label="Product" htmlFor={`feed-line-product-${horse.id}-${String(index)}`}>
            <select
              id={`feed-line-product-${horse.id}-${String(index)}`}
              value={line.productId}
              onChange={(event) => {
                updateLine(index, { productId: event.target.value })
              }}
            >
              <option value="">None</option>
              {/* A Retired Product is offered nowhere a new line is written — the
                  same filter the Space picker above keeps, and the server
                  refuses it besides (#64). */}
              {products
                .filter((product) => product.retiredOn === null)
                .map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Amount" htmlFor={`feed-line-amount-${horse.id}-${String(index)}`}>
            <input
              id={`feed-line-amount-${horse.id}-${String(index)}`}
              value={line.amount}
              placeholder="2 scoops"
              maxLength={200}
              onChange={(event) => {
                updateLine(index, { amount: event.target.value })
              }}
            />
          </Field>
          <Field label="Route" htmlFor={`feed-line-route-${horse.id}-${String(index)}`}>
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
          </Field>
          {lines.length > 1 && (
            <button
              type="button"
              className="line-remove"
              onClick={() => {
                setLines(lines.filter((_, at) => at !== index))
              }}
            >
              Remove
            </button>
          )}
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

      <p className="field-hint">
        Publishing with every line set to None retires this horse’s schedule for this Shift Type. A
        version, not a deletion.
      </p>

      <Actions>
        <SaveButton pending={pending} pendingLabel="Publishing…">
          Publish
        </SaveButton>
        <Saved saved={saved} what="Published" />
      </Actions>
    </form>
  )
}

/**
 * The one desk where an Alert is raised, edited and ended (ADR 0024, #60).
 *
 * `horse_care` and nobody else, which is why this is here rather than on the
 * phone's profile: a volunteer who finds on a Saturday that a horse has
 * started biting records an Observation, which escalates and mails this
 * Scope's holders. An Alert anybody may post is a wall nobody reads.
 *
 * The standing list is read off the profile rather than the row, because the
 * row is one of sixty and this panel is open on exactly one horse.
 */
function Alerts({
  horse,
  profile,
  act,
}: {
  horse: Horse
  profile: HorseProfile | null
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <div>
      <h3>Alerts</h3>
      <p>
        A standing warning a volunteer reads before working with this horse. It shows in full on the
        profile, the shift work surface and the Board, and it stays until somebody ends it.
      </p>
      {profile === null ? (
        <Loading what="the alerts" />
      ) : profile.alerts.length === 0 ? (
        <Empty>No alerts on this horse.</Empty>
      ) : (
        <ul className="alerts">
          {profile.alerts.map((alert) => (
            <li key={alert.id} className="alert" data-kind={alert.kind}>
              <EditAlert alert={alert} act={act} />
            </li>
          ))}
        </ul>
      )}

      <RaiseAlert horse={horse} act={act} />

      {/* Ended ones are not shown here. They appear on the horse profile and
          on no other surface (ADR 0024), which is where a history belongs. */}
    </div>
  )
}

function RaiseAlert({
  horse,
  act,
}: {
  horse: Horse
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void save(() =>
          act(() =>
            client.post('/alerts', {
              horseId: horse.id,
              kind: String(data.get('kind') ?? 'care') as AlertKind,
              text: String(data.get('text') ?? ''),
            }),
          ),
        )
          .then(() => {
            form.reset()
          })
          .catch(() => {
            // Already at the top of the screen, put there by `act`.
          })
      }}
    >
      <Fields>
        <div className="field">
          <Choice legend="Kind" name="kind" options={ALERT_KIND_OPTIONS} defaultValue="care" />
        </div>
        <Field label="What a volunteer must know" htmlFor="raise-alert-text">
          <input id="raise-alert-text" name="text" required maxLength={2000} />
        </Field>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Raise an alert</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

/**
 * One standing Alert: edited in place, or ended with a reason.
 *
 * Ending is its own form because the reason is **required** — the audit entry
 * answers who and when, and only the reason answers *why the biting Alert is
 * gone* (ADR 0024). It is never a delete, and there is no un-ending: a warning
 * that is true again is a new Alert.
 */
function EditAlert({
  alert,
  act,
}: {
  alert: HorseProfile['alerts'][number]
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()
  const ending = useSaving()
  const [endingOpen, setEndingOpen] = useState(false)

  return (
    <>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void save(() =>
            act(() =>
              client.post('/alerts/edit', {
                alertId: alert.id,
                kind: String(data.get('kind') ?? alert.kind) as AlertKind,
                text: String(data.get('text') ?? ''),
              }),
            ),
          ).catch(() => {
            // Already at the top of the screen, put there by `act`.
          })
        }}
      >
        <Fields>
          <div className="field">
            <Choice
              legend="Kind"
              name="kind"
              options={ALERT_KIND_OPTIONS}
              defaultValue={alert.kind}
            />
          </div>
          <Field label="Text" htmlFor={`alert-text-${alert.id}`}>
            <input
              id={`alert-text-${alert.id}`}
              name="text"
              defaultValue={alert.text}
              required
              maxLength={2000}
            />
          </Field>
        </Fields>
        <Actions>
          <SaveButton pending={pending}>Save</SaveButton>
          <Saved saved={saved} />
          {!endingOpen && (
            <button
              type="button"
              onClick={() => {
                setEndingOpen(true)
              }}
            >
              End this alert
            </button>
          )}
        </Actions>
      </form>

      {endingOpen && (
        <form
          className="danger"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void ending
              .save(() =>
                act(() =>
                  client.post('/alerts/end', {
                    alertId: alert.id,
                    reason: String(data.get('reason') ?? ''),
                  }),
                ),
              )
              .catch(() => {
                // Already at the top of the screen, put there by `act`.
              })
          }}
        >
          <p>
            The row stays and the profile keeps showing it under <em>ended</em>. Say why — it is the
            only place the answer lives.
          </p>
          <Fields>
            <Field label="Why it is no longer true" htmlFor={`alert-end-${alert.id}`}>
              <input id={`alert-end-${alert.id}`} name="reason" required maxLength={500} />
            </Field>
          </Fields>
          <Actions>
            <SaveButton pending={ending.pending}>End it</SaveButton>
            <Saved saved={ending.saved} />
            <button
              type="button"
              onClick={() => {
                setEndingOpen(false)
              }}
            >
              Keep it
            </button>
          </Actions>
        </form>
      )}
    </>
  )
}

function EditAttributes({
  horse,
  act,
}: {
  horse: Horse
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/horses/attributes', {
              horseId: horse.id,
              name: String(data.get('name') ?? ''),
              halterColour: String(data.get('halterColour') ?? '') || null,
              blanketSize: String(data.get('blanketSize') ?? '') || null,
              height: String(data.get('height') ?? '') || null,
              photoUrl: String(data.get('photoUrl') ?? '') || null,
              reason: String(data.get('reason') ?? '') || null,
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <h3>Attributes</h3>
      <Fields>
        <Field label="Name" htmlFor="edit-horse-name">
          <input
            id="edit-horse-name"
            name="name"
            defaultValue={horse.name}
            required
            maxLength={200}
          />
        </Field>
        <Field label="Halter colour" htmlFor="edit-horse-halter" optional>
          <input
            id="edit-horse-halter"
            name="halterColour"
            defaultValue={horse.halterColour ?? ''}
            maxLength={100}
          />
        </Field>
        <Field label="Blanket size" htmlFor="edit-horse-blanket" optional>
          <input
            id="edit-horse-blanket"
            name="blanketSize"
            defaultValue={horse.blanketSize ?? ''}
            maxLength={100}
          />
        </Field>
        <Field label="Height" htmlFor="edit-horse-height" optional>
          <input
            id="edit-horse-height"
            name="height"
            defaultValue={horse.height ?? ''}
            maxLength={50}
          />
        </Field>
        <Field label="Photo URL" htmlFor="edit-horse-photo" optional>
          <input
            id="edit-horse-photo"
            name="photoUrl"
            type="url"
            defaultValue={horse.photoUrl ?? ''}
            maxLength={2000}
          />
        </Field>
        <Field label="Reason" htmlFor="edit-horse-reason" optional>
          <input id="edit-horse-reason" name="reason" maxLength={500} />
        </Field>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Save</SaveButton>
        <Saved saved={saved} />
      </Actions>
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
  // A Retired Space stays off this list — `recordSpaceRetirement` already
  // refuses to retire one still occupied, so the currently assigned Space is
  // never among those excluded here.
  const choices = options.filter((space) => space.kind === kind && space.retiredOn === null)
  const { pending, saved, save } = useSaving()

  return (
    <form
      className="assign"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const chosen = String(data.get('spaceId') ?? '')
        void save(() =>
          act(() =>
            client.post('/horses/space', {
              horseId: horse.id,
              kind,
              spaceId: chosen === '' ? null : chosen,
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <Field label={KIND_LABEL[kind]} htmlFor={`space-${kind}-${horse.id}`}>
        <select id={`space-${kind}-${horse.id}`} name="spaceId" defaultValue={current?.id ?? ''}>
          <option value="">None</option>
          {choices.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </Field>
      <SaveButton pending={pending}>Set</SaveButton>
      <Saved saved={saved} />
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
  const { pending, saved, save } = useSaving()

  if (horse.departedOn !== null) {
    return (
      <form
        className="danger"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void save(() =>
            act(() =>
              client.post('/horses/departure', {
                horseId: horse.id,
                departedOn: null,
                reason: null,
              }),
            ),
          ).catch(() => {
            // Already at the top of the screen, put there by `act`.
          })
        }}
      >
        <h3>Departed {horse.departedOn}</h3>
        {/* A date is a correction, never a delete (ADR 0002) — the same as
            setting one below. */}
        <p>The record stays either way. This only corrects the date.</p>
        <Actions>
          <SaveButton pending={pending}>Correct: not Departed</SaveButton>
          <Saved saved={saved} />
        </Actions>
      </form>
    )
  }

  return (
    <form
      className="danger"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/horses/departure', {
              horseId: horse.id,
              departedOn: dayString(String(data.get('departedOn') ?? '')),
              reason: String(data.get('reason') ?? '') || null,
            }),
          ),
        ).catch(() => {
          // Already at the top of the screen, put there by `act`.
        })
      }}
    >
      <h3>Departure</h3>
      <p>A date, never a delete. The horse stays on this list and its history stays reachable.</p>
      <Fields>
        <Field label="Date" htmlFor="departed-on">
          <input id="departed-on" name="departedOn" type="date" required />
        </Field>
        <Field label="Reason" htmlFor="departure-reason" optional>
          <input id="departure-reason" name="reason" maxLength={500} />
        </Field>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Mark Departed</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}
