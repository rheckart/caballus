/**
 * Opening a Shift: its materialized checklist, grouped per horse and per
 * Space the way a volunteer's loop through the barn runs (ADR 0013).
 *
 * **Blanks are blanks.** This ticket reads the checklist and does not tick
 * it — no outcome exists yet on an Item, so nothing here claims a Feed or a
 * Prep "happened"; a later ticket wires that in. What this screen already
 * gets right is the shape: generic instruction text before subject-specific,
 * a hint at which Shift Type normally does a per-Day Item rather than a gate
 * on it, and **"not yet decided" rendered as an unanswered question, never as
 * no work**.
 *
 * `materialized: false` is a Shift whose day nothing has fixed yet — shown as
 * that fact rather than as an empty checklist, so nobody reads *nothing to
 * do* where the honest sentence is *not fixed yet*.
 */
import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'

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

function ItemLine({ item }: { item: Item }) {
  return (
    <li>
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
    </li>
  )
}

export function ShiftChecklist() {
  // `strict: false`, the same reason the horse profile reads its param: the
  // route that matched may be this file's own or a test harness's.
  const { shiftId } = useParams({ strict: false })
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

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

  if (problem !== null) {
    return (
      <main>
        <p role="alert">{problem}</p>
        <Link to="/shifts">Back to my shifts</Link>
      </main>
    )
  }

  if (checklist === null) {
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

  const horseIds = [
    ...new Set(
      checklist.items.filter((item) => item.horseId !== null).map((item) => item.horseId as string),
    ),
  ]
  const spaceIds = [
    ...new Set(
      checklist.items.filter((item) => item.spaceId !== null).map((item) => item.spaceId as string),
    ),
  ]
  const rescueItems = checklist.items.filter((item) => item.subjectKind === 'rescue')

  return (
    <main>
      <h1>
        {SHIFT_TYPE_LABEL[checklist.shiftType]} — {checklist.day}
      </h1>
      <Link to="/shifts">Back to my shifts</Link>

      {checklist.prepOwed.length > 0 && (
        <section>
          <h2>Prep owed to this Shift</h2>
          <ul>
            {checklist.prepOwed.map((item) => (
              <ItemLine key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}

      {horseIds.length === 0 && spaceIds.length === 0 && rescueItems.length === 0 ? (
        <p>Nothing materialized for this Shift.</p>
      ) : (
        <>
          {horseIds.map((horseId) => {
            const items = checklist.items.filter((item) => item.horseId === horseId)
            return (
              <section key={horseId}>
                <h2>{items[0]?.horseName ?? 'A horse'}</h2>
                <ul>
                  {items.map((item) => (
                    <ItemLine key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            )
          })}

          {spaceIds.map((spaceId) => {
            const items = checklist.items.filter((item) => item.spaceId === spaceId)
            return (
              <section key={spaceId}>
                <h2>{items[0]?.spaceName ?? 'A Space'}</h2>
                <ul>
                  {items.map((item) => (
                    <ItemLine key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            )
          })}

          {rescueItems.length > 0 && (
            <section>
              <h2>The rescue</h2>
              <ul>
                {rescueItems.map((item) => (
                  <ItemLine key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
