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
 * `materialized: false` is a Shift whose day nothing has fixed yet — shown as
 * that fact rather than as an empty checklist, so nobody reads *nothing to
 * do* where the honest sentence is *not fixed yet*.
 */
import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { client } from '../shared/api-client'
import type { Answers, contract } from '../shared/api-contract'
import { report } from '../shared/observability.browser'
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
    <span>
      {' '}
      {item.assignedToVolunteerName !== null ? (
        <span>— assigned to {item.assignedToVolunteerName} </span>
      ) : (
        <button type="button" disabled={busy || myVolunteerId === null} onClick={selfClaim}>
          It's mine
        </button>
      )}
      {item.priority === 'discretionary' &&
        (item.overdue ? (
          <span> — overdue: Drop is withdrawn</span>
        ) : (
          <button type="button" disabled={busy} onClick={() => setReasonFor('drop')}>
            Drop
          </button>
        ))}
      <button type="button" disabled={busy} onClick={() => setReasonFor('not_done')}>
        Not done
      </button>
      {reasonFor !== null && (
        <form onSubmit={submitReason}>
          <label>
            Why{reasonFor === 'not_done' ? ' (required)' : ''}:
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => setReasonFor(null)}>
            Cancel
          </button>
        </form>
      )}
      {problem !== null && <span role="alert"> {problem}</span>}
    </span>
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
    <li>
      <label>
        <input type="checkbox" checked={checked} disabled={checked} onChange={tick} />
        <strong>{KIND_LABEL[item.kind]}</strong> — {item.instructionText}
        {item.requiresMedicationAuthority && <em> (needs Medication Authority)</em>}
        {item.priority === 'discretionary' && <span> (discretionary)</span>}
        {item.closing && <span> (closing)</span>}
        {item.assignedShiftType !== null && (
          <span> — normally {SHIFT_TYPE_LABEL[item.assignedShiftType]}'s</span>
        )}
        {/* The unanswered question, said as one — never silently read as no work (ADR 0013). */}
        {item.assignmentUndecided && <span> — not yet decided which Shift normally does this</span>}
        {item.prepForShiftType !== null && (
          <span> — Prep owed to {SHIFT_TYPE_LABEL[item.prepForShiftType]}</span>
        )}
      </label>
      {unsent && <span> Unsent</span>}
      {confirmedDone && <span> Done{item.doneByName !== null ? ` — ${item.doneByName}` : ''}</span>}
      {item.outcome === 'dropped' && (
        <span>
          {' '}
          Dropped{item.outcomeByName !== null ? ` — ${item.outcomeByName}` : ''}
          {item.outcomeReason !== null ? ` (${item.outcomeReason})` : ''}
        </span>
      )}
      {item.outcome === 'not_done' && (
        <span role="alert">
          {' '}
          Not done{item.outcomeByName !== null ? ` — ${item.outcomeByName}` : ''}
          {item.outcomeReason !== null ? `: ${item.outcomeReason}` : ''}
        </span>
      )}
      {denial !== null && <span role="alert"> {denial.message}</span>}
      <ItemActions
        item={item}
        shiftId={shiftId}
        myVolunteerId={myVolunteerId}
        onChanged={onChanged}
      />
    </li>
  )
}

/** Read-only: what this Shift is owed from an earlier one, never tickable from here (ADR 0013). */
function PrepOwedLine({ item }: { readonly item: Item }) {
  return (
    <li>
      <strong>{KIND_LABEL[item.kind]}</strong> — {item.instructionText}
      {item.prepForShiftType !== null && (
        <span> — Prep owed to {SHIFT_TYPE_LABEL[item.prepForShiftType]}</span>
      )}
      <span>
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
    <section>
      <h2>Shift Notes</h2>
      {checklist.shiftNotes.length === 0 ? (
        <p>Nothing left for today or yesterday.</p>
      ) : (
        <ul>
          {checklist.shiftNotes.map((note) => (
            <li key={note.id}>
              {note.text} — {note.authoredByName}
              {note.horseName !== null ? ` (${note.horseName})` : ''}
              {note.postClose && <em> (added after close)</em>}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Add a note:
          <input value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || text.trim() === ''}>
          Save
        </button>
      </form>
      {problem !== null && <p role="alert">{problem}</p>}
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
    <section>
      {blockers.length > 0 ? (
        <ul>
          {blockers.map((blocker) => (
            <li key={blocker.kind} role="alert">
              {BLOCKER_LABEL[blocker.kind]} ({blocker.count})
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" disabled={busy} onClick={() => void close()}>
          Close Shift
        </button>
      )}
      {problem !== null && <p role="alert">{problem}</p>}
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

  if (problem !== null) {
    return (
      <main>
        <p role="alert">{problem}</p>
        <Link to="/shifts">Back to my shifts</Link>
      </main>
    )
  }

  if (checklist === null || shiftId === undefined) {
    return (
      <main>
        <p>One moment…</p>
      </main>
    )
  }

  if (!checklist.materialized) {
    return (
      <main>
        <h1>
          {SHIFT_TYPE_LABEL[checklist.shiftType]} — {checklist.day}
        </h1>
        <p>The checklist has not been fixed for today yet.</p>
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
      <Link to="/shifts">Back to my shifts</Link>

      {queue.blocked && (
        <p role="alert">
          This app is out of date and cannot send your ticks yet — they are saved, and will send
          once you reload.{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}

      <ShiftNotes checklist={checklist} shiftId={shiftId} onChanged={() => void load()} />

      {checklist.prepOwed.length > 0 && (
        <section>
          <h2>Prep owed to this Shift</h2>
          <ul>
            {checklist.prepOwed.map((item) => (
              <PrepOwedLine key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}

      {nothingMaterialized ? (
        <p>Nothing materialized for this Shift.</p>
      ) : (
        <>
          {arranged.horses.map((card) => (
            <section key={card.horseId}>
              <h2>{card.horseName}</h2>
              <ul>
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
            <section key={card.spaceId}>
              <h2>{card.spaceName}</h2>
              <ul>
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
            <section>
              <h2>The rescue</h2>
              <ul>
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
