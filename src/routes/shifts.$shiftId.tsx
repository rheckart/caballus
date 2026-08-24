/**
 * The shift prep queue: a Shift's materialized checklist as per-horse cards
 * in stall order, per-Space Items grouped after, and a tick that queues
 * offline-safe through `TickQueue` (ADR 0005, ADR 0013, ADR 0020, #41, #42).
 *
 * **Blanks are blanks.** Generic instruction text renders before
 * subject-specific, a hint at which Shift Type normally does a per-Day Item
 * is never a gate, and "not yet decided" reads as an unanswered question,
 * never as no work.
 *
 * **A tick lands optimistically and drains through the typed client.**
 * `useTickQueue` owns one `TickQueue` per mount, backed by IndexedDB where the
 * phone has one (`src/shared/tick-store.browser.ts`) — a reload creates a
 * fresh queue over the same durable store, which is what makes an
 * airplane-mode tick survive one. `isUnsent` is read from the queue and never
 * from the server's `done`, so nothing looks Done that the server has not
 * confirmed and nothing the server confirmed still reads Unsent once the
 * checklist is re-read after a send.
 *
 * The tick's checkbox stays a native `<input type="checkbox">`, styled rather
 * than replaced: the TickQueue flow reads it through `onChange`, and a
 * composite control between a glove and an offline write buys nothing here.
 *
 * `materialized: false` is a Shift whose day nothing has fixed yet — shown as
 * that fact rather than as an empty checklist, so nobody reads *nothing to
 * do* where the honest sentence is *not fixed yet*.
 */
import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { Empty, Loading } from '../components/forms'
import { Refusal } from '../components/refusal'
import { Alert as AlertBox, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { client } from '../shared/api-client'
import type { Answers, contract } from '../shared/api-contract'
import { report } from '../shared/observability.browser'
import { ALERT_KIND_LABEL } from '../shared/alerts'
import { arrangePrepQueue } from '../shared/prep-queue'
import { refusalText } from '../shared/refusals'
import { closeBlockers, type CloseBlockerKind } from '../shared/shift-close'
import { resolveTickStore } from '../shared/tick-store.browser'
import { TickQueue, type TickDenial } from '../shared/tick-queue'

export const Route = createFileRoute('/shifts/$shiftId')({
  component: ShiftChecklist,
})

type Checklist = Answers<typeof contract, '/shifts/:shiftId'>
type Item = Checklist['items'][number]
type Alert = Checklist['alerts'][number]

const SHIFT_TYPE_LABEL: Record<Checklist['shiftType'], string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
}

const KIND_LABEL: Record<Item['kind'], string> = {
  feed: 'Feed',
  medicate: 'Medicate',
  task: 'Task',
}

const BLOCKER_LABEL: Record<CloseBlockerKind, string> = {
  unsent_work: 'Unsent work still on this phone',
  open_attendance: 'Somebody still signed in',
  undispositioned_observation: 'A report with no decision yet',
}

/** The card every grouped section of the checklist sits in. */
const CARD = 'mb-4 rounded-lg border border-border bg-background p-4 sm:p-6'

/**
 * One `TickQueue` for the life of this component. A page reload — the case
 * "survives a reload" means — makes a fresh one over the same durable store,
 * which `init` below reads back from.
 */
function useTickQueue() {
  const queueRef = useRef<TickQueue | null>(null)
  queueRef.current ??= new TickQueue(resolveTickStore(), (body, options) =>
    client.post('/items/done', body, options),
  )
  const queue = queueRef.current

  // Forces a render on every queue change — queuing, sending, denial, or the
  // client falling behind the server's version.
  const [, setGeneration] = useState(0)

  useEffect(() => {
    let current = true
    const unsubscribe = queue.subscribe(() => {
      if (current) setGeneration((generation) => generation + 1)
    })
    queue.init().catch((error: unknown) => report(error, { where: 'tick-queue-init' }))

    const onOnline = () => {
      queue.drain().catch((error: unknown) => report(error, { where: 'tick-queue-drain' }))
    }
    window.addEventListener('online', onOnline)

    return () => {
      current = false
      unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [queue])

  return queue
}

/**
 * Drop, Not done, and the assignment hint — the acts ADR 0013 gives no
 * offline queue: each is one deliberate act by whoever holds Shift Authority
 * or (Not done, self-claim) anybody rostered, rather than a tick fired
 * without looking (#45). A local `busy`/`problem` pair is enough, because
 * unlike a tick these are not expected to fire from a glove in a barn with no
 * signal — the close screen is where connectivity is actually required.
 */
function ItemActions({
  item,
  shiftId,
  myVolunteerId,
  onChanged,
}: {
  readonly item: Item
  readonly shiftId: string
  /** Null until `/me` answers — the self-claim button waits for it (#45). */
  readonly myVolunteerId: string | null
  readonly onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<'drop' | 'not_done' | null>(null)
  const [reason, setReason] = useState('')

  const run = useCallback(
    async (act: () => Promise<unknown>) => {
      setBusy(true)
      setProblem(null)
      try {
        await act()
        setReasonFor(null)
        setReason('')
        onChanged()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      } finally {
        setBusy(false)
      }
    },
    [onChanged],
  )

  const selfClaim = useCallback(() => {
    if (myVolunteerId === null) return
    run(() =>
      client.post('/items/assign', { shiftId, itemId: item.id, volunteerId: myVolunteerId }),
    ).catch(() => undefined)
  }, [run, shiftId, item.id, myVolunteerId])

  const submitReason = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const path = reasonFor === 'drop' ? '/items/drop' : '/items/not-done'
      run(() => client.post(path, { shiftId, itemId: item.id, reason })).catch(() => undefined)
    },
    [run, reasonFor, shiftId, item.id, reason],
  )

  if (item.done) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {item.assignedToVolunteerName !== null ? (
        <span className="text-sm text-muted-foreground">
          — assigned to {item.assignedToVolunteerName}
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || myVolunteerId === null}
          onClick={selfClaim}
        >
          It's mine
        </Button>
      )}
      {item.priority === 'discretionary' &&
        (item.overdue ? (
          <span className="text-sm text-muted-foreground">— overdue: Drop is withdrawn</span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setReasonFor('drop')}
          >
            Drop
          </Button>
        ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => setReasonFor('not_done')}
      >
        Not done
      </Button>
      {reasonFor !== null && (
        <form onSubmit={submitReason} className="flex w-full flex-wrap items-center gap-2">
          <label htmlFor={`why-${item.id}`} className="m-0 text-sm font-medium text-foreground">
            Why{reasonFor === 'not_done' ? ' (required)' : ''}:
          </label>
          <Input
            id={`why-${item.id}`}
            className="h-9 w-auto max-w-64 flex-1 basis-40"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setReasonFor(null)}>
            Cancel
          </Button>
        </form>
      )}
      {problem !== null && (
        <span role="alert" className="text-sm text-destructive">
          {problem}
        </span>
      )}
    </div>
  )
}

function ItemLine({
  item,
  shiftId,
  queue,
  myVolunteerId,
  onChanged,
}: {
  readonly item: Item
  readonly shiftId: string
  readonly queue: TickQueue
  readonly myVolunteerId: string | null
  readonly onChanged: () => void
}) {
  const unsent = queue.isUnsent(item.id)
  // The server's own answer, never overridden by a local guess — `done` reads
  // true only once `/shifts/:shiftId` has said so, which the checklist reload
  // after a send is what makes catch up with what just happened.
  const confirmedDone = item.done && !unsent
  const denial: TickDenial | null = queue.denialFor(item.id)
  const checked = confirmedDone || unsent

  const tick = useCallback(() => {
    queue.tick(shiftId, item.id).catch((error: unknown) => report(error, { itemId: item.id }))
  }, [queue, shiftId, item.id])

  return (
    <li className="border-b border-border py-2 first:pt-0 last:border-b-0 last:pb-0">
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          className="size-[22px] flex-none accent-primary"
          checked={checked}
          disabled={checked}
          onChange={tick}
        />
        <span className="min-w-0">
          <strong>{KIND_LABEL[item.kind]}</strong> — {item.instructionText}
          {item.requiresMedicationAuthority && <em> (needs Medication Authority)</em>}
          {item.priority === 'discretionary' && (
            <span className="text-muted-foreground"> (discretionary)</span>
          )}
          {item.closing && <span className="text-muted-foreground"> (closing)</span>}
          {item.assignedShiftType !== null && (
            <span className="text-muted-foreground">
              {' '}
              — normally {SHIFT_TYPE_LABEL[item.assignedShiftType]}'s
            </span>
          )}
          {/* The unanswered question, said as one — never silently read as no work (ADR 0013). */}
          {item.assignmentUndecided && (
            <span className="text-muted-foreground">
              {' '}
              — not yet decided which Shift normally does this
            </span>
          )}
          {item.prepForShiftType !== null && (
            <span className="text-muted-foreground">
              {' '}
              — Prep owed to {SHIFT_TYPE_LABEL[item.prepForShiftType]}
            </span>
          )}
        </span>
      </label>
      <div className="pl-[30px]">
        {unsent && (
          <span className="mr-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Unsent
          </span>
        )}
        {confirmedDone && (
          <span className="mr-2 text-sm text-success">
            Done{item.doneByName !== null ? ` — ${item.doneByName}` : ''}
          </span>
        )}
        {item.outcome === 'dropped' && (
          <span className="mr-2 text-sm text-muted-foreground">
            Dropped{item.outcomeByName !== null ? ` — ${item.outcomeByName}` : ''}
            {item.outcomeReason !== null ? ` (${item.outcomeReason})` : ''}
          </span>
        )}
        {item.outcome === 'not_done' && (
          <span role="alert" className="mr-2 text-sm text-destructive">
            Not done{item.outcomeByName !== null ? ` — ${item.outcomeByName}` : ''}
            {item.outcomeReason !== null ? `: ${item.outcomeReason}` : ''}
          </span>
        )}
        {denial !== null && (
          <span role="alert" className="text-sm text-destructive">
            {denial.message}
          </span>
        )}
        <ItemActions
          item={item}
          shiftId={shiftId}
          myVolunteerId={myVolunteerId}
          onChanged={onChanged}
        />
      </div>
    </li>
  )
}

/**
 * A horse's standing Alerts, above its work and in full text (ADR 0024).
 *
 * Nothing is shown when there are none — a card that says *no alerts* on
 * every horse teaches a volunteer to skip the place the words appear, which is
 * the opposite of what putting them at the top is for.
 */
function HorseAlerts({
  alerts,
  horseName,
}: {
  readonly alerts: readonly Alert[]
  readonly horseName: string
}) {
  if (alerts.length === 0) return null

  const kindTint: Record<Alert['kind'], string> = {
    prohibition: 'border-l-destructive bg-card-tint-rose dark:bg-transparent',
    care: 'border-l-warning bg-card-tint-peach dark:bg-transparent',
    allergy: 'border-l-brand-purple bg-card-tint-lavender dark:bg-transparent',
  }

  return (
    <ul className="m-0 mb-3 grid list-none gap-2 p-0" aria-label={`Alerts — ${horseName}`}>
      {alerts.map((alert) => (
        <li
          key={alert.id}
          className={`m-0 rounded-md border border-border border-l-4 px-3 py-2 ${kindTint[alert.kind]}`}
        >
          <strong className="mr-1 text-[13px] uppercase tracking-wide">
            {ALERT_KIND_LABEL[alert.kind]}
          </strong>{' '}
          {alert.text}
        </li>
      ))}
    </ul>
  )
}

/** Read-only: what this Shift is owed from an earlier one, never tickable from here (ADR 0013). */
function PrepOwedLine({ item }: { readonly item: Item }) {
  return (
    <li className="border-b border-border py-2 first:pt-0 last:border-b-0 last:pb-0">
      <strong>{KIND_LABEL[item.kind]}</strong> — {item.instructionText}
      {item.prepForShiftType !== null && (
        <span className="text-muted-foreground">
          {' '}
          — Prep owed to {SHIFT_TYPE_LABEL[item.prepForShiftType]}
        </span>
      )}
      <span className="text-muted-foreground">
        {item.done
          ? ` — done${item.doneByName !== null ? ` by ${item.doneByName}` : ''}`
          : ' — not yet done'}
      </span>
    </li>
  )
}

/**
 * Shift Notes: the handover log, curated by Shift Authority while the Shift
 * stands and by `horse_care` after it closes (ADR 0013, #45). Posting is
 * offered here to anyone — the server is where the real gate is, on
 * `holdsShiftAuthority`'s own precedent for `/observations`.
 */
function ShiftNotes({
  checklist,
  shiftId,
  onChanged,
}: {
  readonly checklist: Checklist
  readonly shiftId: string
  readonly onChanged: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setBusy(true)
      setProblem(null)
      try {
        await client.post('/shifts/notes', { shiftId, text, horseId: null })
        setText('')
        onChanged()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      } finally {
        setBusy(false)
      }
    },
    [shiftId, text, onChanged],
  )

  return (
    <section className={CARD}>
      <h2 className="m-0 mb-3">Shift Notes</h2>
      {checklist.shiftNotes.length === 0 ? (
        <p className="m-0 mb-3 text-sm text-muted-foreground">
          Nothing left for today or yesterday.
        </p>
      ) : (
        <ul className="m-0 mb-3 list-none p-0">
          {checklist.shiftNotes.map((note) => (
            <li
              key={note.id}
              className="border-b border-border py-2 first:pt-0 last:border-b-0 last:pb-0"
            >
              {note.text} — {note.authoredByName}
              {note.horseName !== null ? ` (${note.horseName})` : ''}
              {note.postClose && <em className="text-muted-foreground"> (added after close)</em>}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="shift-note-text" className="mb-1 block text-sm font-medium text-foreground">
          Add a note:
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="shift-note-text"
            className="max-w-96 flex-1 basis-52"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" disabled={busy || text.trim() === ''}>
            Save
          </Button>
        </div>
      </form>
      {problem !== null && (
        <AlertBox variant="destructive" className="mt-3">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </AlertBox>
      )}
    </section>
  )
}

/**
 * The close gate: blockers computed by the one pure function the write
 * itself checks, folding in this phone's own Unsent count beside the two the
 * server already read (ADR 0013, ADR 0014, #45).
 */
function CloseSection({
  checklist,
  shiftId,
  unsentCount,
  onClosed,
}: {
  readonly checklist: Checklist
  readonly shiftId: string
  readonly unsentCount: number
  readonly onClosed: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const blockers = closeBlockers({
    unsentCount,
    openAttendanceCount: checklist.openAttendanceCount,
    undispositionedObservationCount: checklist.undispositionedObservationCount,
  })

  const close = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    try {
      await client.post('/shifts/close', { shiftId })
      onClosed()
    } catch (error: unknown) {
      setProblem(refusalText(error))
    } finally {
      setBusy(false)
    }
  }, [shiftId, onClosed])

  if (checklist.closedAt !== null) {
    return (
      <p>
        <strong>Closed.</strong>
      </p>
    )
  }

  return (
    <section className="mt-6 border-t border-border pt-4">
      {blockers.length > 0 ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {blockers.map((blocker) => (
            <li
              key={blocker.kind}
              role="alert"
              className="m-0 rounded-md border border-destructive/35 border-l-3 border-l-destructive bg-destructive/8 px-4 py-3 text-sm text-foreground"
            >
              {BLOCKER_LABEL[blocker.kind]} ({blocker.count})
            </li>
          ))}
        </ul>
      ) : (
        <Button type="button" disabled={busy} onClick={() => void close()}>
          Close Shift
        </Button>
      )}
      {problem !== null && (
        <AlertBox variant="destructive" className="mt-3">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </AlertBox>
      )}
    </section>
  )
}

export function ShiftChecklist() {
  // `strict: false`, the same reason the horse profile reads its param: the
  // route that matched may be this file's own or a test harness's.
  const { shiftId } = useParams({ strict: false })
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [myVolunteerId, setMyVolunteerId] = useState<string | null>(null)
  const queue = useTickQueue()

  const load = useCallback(async () => {
    if (shiftId === undefined) return
    setChecklist(await client.get('/shifts/:shiftId', { shiftId }))
  }, [shiftId])

  useEffect(() => {
    let current = true
    load().catch((error: unknown) => {
      if (current) setProblem(refusalText(error))
    })
    return () => {
      current = false
    }
  }, [load])

  useEffect(() => {
    let current = true
    client
      .get('/me')
      .then((me) => {
        if (current) setMyVolunteerId(me.volunteerId)
      })
      .catch((error: unknown) => report(error, { where: 'shift-checklist-me' }))
    return () => {
      current = false
    }
  }, [])

  // Re-reads the checklist whenever the queue settles a claim, so a
  // server-confirmed tick and the queue's own "no longer Unsent" arrive
  // together — the pairing that keeps a confirmed Item from ever reading
  // Unsent, and an Unsent one from ever reading Done.
  useEffect(() => {
    let current = true
    const unsubscribe = queue.subscribe(() => {
      load().catch((error: unknown) => {
        if (current) report(error, { where: 'checklist-reload' })
      })
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [queue, load])

  const arranged = useMemo(() => arrangePrepQueue(checklist?.items ?? []), [checklist])

  // Grouped once rather than filtered per card: the read answers a flat list,
  // and sixty cards each scanning it is sixty passes over the same array.
  const alertsFor = useMemo(() => {
    const by = new Map<string, Alert[]>()
    for (const alert of checklist?.alerts ?? []) {
      const held = by.get(alert.horseId)
      if (held === undefined) by.set(alert.horseId, [alert])
      else held.push(alert)
    }
    return by
  }, [checklist])

  if (problem !== null) {
    return (
      <main>
        <AlertBox variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </AlertBox>
        <Link to="/shifts">Back to my shifts</Link>
      </main>
    )
  }

  if (checklist === null || shiftId === undefined) {
    return (
      <main>
        <Loading what="the checklist" />
      </main>
    )
  }

  if (!checklist.materialized) {
    return (
      <main>
        <h1>
          {SHIFT_TYPE_LABEL[checklist.shiftType]} — {checklist.day}
        </h1>
        <Empty>The checklist has not been fixed for today yet.</Empty>
        <Link to="/shifts">Back to my shifts</Link>
      </main>
    )
  }

  const nothingMaterialized =
    arranged.horses.length === 0 && arranged.spaces.length === 0 && arranged.rescue.length === 0

  return (
    <main>
      <h1>
        {SHIFT_TYPE_LABEL[checklist.shiftType]} — {checklist.day}
      </h1>
      <p className="mb-4">
        <Link to="/shifts">Back to my shifts</Link>
      </p>

      {queue.blocked && (
        <AlertBox variant="destructive" className="mb-4">
          <AlertTitle>
            This app is out of date and cannot send your ticks yet — they are saved, and will send
            once you reload.
          </AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </AlertDescription>
        </AlertBox>
      )}

      <ShiftNotes checklist={checklist} shiftId={shiftId} onChanged={() => void load()} />

      {checklist.prepOwed.length > 0 && (
        <section className={CARD}>
          <h2 className="m-0 mb-3">Prep owed to this Shift</h2>
          <ul className="m-0 list-none p-0">
            {checklist.prepOwed.map((item) => (
              <PrepOwedLine key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}

      {nothingMaterialized ? (
        <Empty>Nothing materialized for this Shift.</Empty>
      ) : (
        <>
          {arranged.horses.map((card) => (
            <section key={card.horseId} className={CARD}>
              <h2 className="m-0 mb-3">{card.horseName}</h2>
              {/* Above the work, in full: a volunteer who reads the card and
                  not the warning has already walked into the stall (ADR
                  0024). */}
              <HorseAlerts alerts={alertsFor.get(card.horseId) ?? []} horseName={card.horseName} />
              <ul className="m-0 list-none p-0">
                {card.items.map((item) => (
                  <ItemLine
                    key={item.id}
                    item={item}
                    shiftId={shiftId}
                    queue={queue}
                    myVolunteerId={myVolunteerId}
                    onChanged={() => void load()}
                  />
                ))}
              </ul>
            </section>
          ))}

          {arranged.spaces.map((card) => (
            <section key={card.spaceId} className={CARD}>
              <h2 className="m-0 mb-3">{card.spaceName}</h2>
              <ul className="m-0 list-none p-0">
                {card.items.map((item) => (
                  <ItemLine
                    key={item.id}
                    item={item}
                    shiftId={shiftId}
                    queue={queue}
                    myVolunteerId={myVolunteerId}
                    onChanged={() => void load()}
                  />
                ))}
              </ul>
            </section>
          ))}

          {arranged.rescue.length > 0 && (
            <section className={CARD}>
              <h2 className="m-0 mb-3">The rescue</h2>
              <ul className="m-0 list-none p-0">
                {arranged.rescue.map((item) => (
                  <ItemLine
                    key={item.id}
                    item={item}
                    shiftId={shiftId}
                    queue={queue}
                    myVolunteerId={myVolunteerId}
                    onChanged={() => void load()}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <CloseSection
        checklist={checklist}
        shiftId={shiftId}
        unsentCount={queue.pendingCount}
        onClosed={() => void load()}
      />
    </main>
  )
}
