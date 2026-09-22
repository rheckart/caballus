/**
 * One change applied to many records, from a desk list (#99, #100).
 *
 * **Bulk means one change applied to many records, never a spreadsheet**, and
 * the three pieces here are the whole of how a desk says it: a checkbox per
 * row with a *select all showing* box that follows the list's own filter, an
 * action bar that appears only while something is ticked, and a **review step
 * that names every record before Confirm** — there is no undo, and the audit
 * log is the only trail. Afterwards the skipped are listed with the reason
 * each, in `BATCH_SKIP_WORDS`, so the horse desk and the volunteer desk cannot
 * word the same skip two ways.
 */
import { useMemo, useState, type ReactNode } from 'react'

import { BATCH_SKIP_WORDS, type HorseBatchSkip, type VolunteerBatchSkip } from '../shared/batch'
import { refusalText } from '../shared/refusals'
import { Actions, Sheet } from './forms'
import { InlineRefusal } from './record-modal'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'

/**
 * Which rows are ticked. Ticks survive a filter change — somebody may search
 * twice to build one list — but *select all* only ever means the rows showing.
 */
export function useSelection(showingIds: readonly string[]) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())

  return useMemo(() => {
    const allShowing = showingIds.length > 0 && showingIds.every((id) => ticked.has(id))
    const someShowing = showingIds.some((id) => ticked.has(id))
    return {
      ticked,
      isTicked: (id: string) => ticked.has(id),
      toggle: (id: string, on: boolean) => {
        setTicked((before) => {
          const after = new Set(before)
          if (on) after.add(id)
          else after.delete(id)
          return after
        })
      },
      allShowing,
      someShowing,
      toggleAllShowing: (on: boolean) => {
        setTicked((before) => {
          const after = new Set(before)
          for (const id of showingIds) {
            if (on) after.add(id)
            else after.delete(id)
          }
          return after
        })
      },
      clear: () => {
        setTicked(new Set())
      },
    }
  }, [showingIds, ticked])
}

export type Selection = ReturnType<typeof useSelection>

/** The header cell's box: every row showing, not every row there is. */
export function SelectAllShowing({ selection }: { selection: Selection }) {
  return (
    <Checkbox
      aria-label="Select all showing"
      checked={selection.allShowing ? true : selection.someShowing ? 'indeterminate' : false}
      onCheckedChange={(checked) => {
        selection.toggleAllShowing(checked === true)
      }}
    />
  )
}

/** One row's box, labelled by the name it ticks. */
export function SelectRow({
  selection,
  id,
  name,
}: {
  selection: Selection
  id: string
  name: string
}) {
  return (
    <Checkbox
      aria-label={`Select ${name}`}
      checked={selection.isTicked(id)}
      onCheckedChange={(checked) => {
        selection.toggle(id, checked === true)
      }}
    />
  )
}

/** The bar that appears while anything is ticked, holding the acts on offer. */
export function BulkBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number
  noun: readonly [one: string, many: string]
  onClear: () => void
  children: ReactNode
}) {
  return (
    <section
      aria-label="With the ticked"
      className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-secondary p-3"
    >
      <p className="m-0 self-center text-sm font-medium text-foreground">
        {count} {count === 1 ? noun[0] : noun[1]} ticked
      </p>
      {children}
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </section>
  )
}

export interface BatchResult {
  readonly done: readonly string[]
  readonly skipped: readonly {
    readonly id: string
    readonly because: HorseBatchSkip | VolunteerBatchSkip
  }[]
}

/**
 * The review step, then the result: every name before Confirm, and every
 * skipped name with its reason after. Nothing is sent until Confirm.
 */
export function BulkReview({
  title,
  what,
  names,
  confirm,
  onDone,
  onClose,
}: {
  title: string
  /** The change, in a sentence: *Put them in North pasture.* */
  what: string
  /** Every ticked record, by id, as the list shows it. */
  names: ReadonlyMap<string, string>
  confirm: () => Promise<BatchResult>
  /** Called once a batch has landed, however much of it, so the list re-reads. */
  onDone: () => Promise<void>
  /**
   * `landed` says whether a batch went through, so the caller clears its
   * ticks only then — clearing them sooner would take the bar, and this sheet
   * with it, away before the skipped are read.
   */
  onClose: (landed: boolean) => void
}) {
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)

  if (result !== null) {
    return (
      <Sheet
        title={title}
        onClose={() => {
          onClose(true)
        }}
      >
        <p className="m-0 text-base text-foreground">
          {`Done for ${String(result.done.length)} of ${String(names.size)}.`}
        </p>
        {result.skipped.length > 0 && (
          <>
            <p className="m-0 mt-3 text-sm font-medium text-foreground">Left alone:</p>
            <ul className="m-0 mt-1 pl-5 text-sm">
              {result.skipped.map((skip) => (
                <li key={skip.id}>
                  {`${names.get(skip.id) ?? 'Somebody no longer listed'} — ${BATCH_SKIP_WORDS[skip.because]}`}
                </li>
              ))}
            </ul>
          </>
        )}
        <Actions>
          <Button
            type="button"
            onClick={() => {
              onClose(true)
            }}
          >
            Close
          </Button>
        </Actions>
      </Sheet>
    )
  }

  return (
    <Sheet
      title={title}
      description={`${what} There is no undo.`}
      onClose={() => {
        onClose(false)
      }}
    >
      <ul className="m-0 max-h-72 overflow-y-auto pl-5 text-sm">
        {[...names].map(([id, name]) => (
          <li key={id}>{name}</li>
        ))}
      </ul>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true)
            setRefusal(null)
            void (async () => {
              try {
                const landed = await confirm()
                setResult(landed)
                await onDone()
              } catch (error: unknown) {
                setRefusal(refusalText(error))
              } finally {
                setPending(false)
              }
            })()
          }}
        >
          {pending ? 'Working…' : `Confirm for ${String(names.size)}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onClose(false)
          }}
        >
          Back
        </Button>
      </Actions>
    </Sheet>
  )
}
