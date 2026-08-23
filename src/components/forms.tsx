/**
 * The data-entry primitives every screen with a form is built from.
 *
 * Behaviour is bought rather than built now (ADR 0025): `Sheet` wraps
 * shadcn's Dialog — Radix under `src/components/ui/`, source this repo owns —
 * and the rest of these primitives are the house rules the component library
 * does not carry: one `Field` that puts a label, a hint and an error together
 * in the one order a screen reader reads them, one `SaveButton` that cannot
 * be pressed twice, one `Filter` for a table long enough to need one, and
 * `useSaving`, the submit lifecycle shadcn's Form deliberately does not
 * replace (pending, the sticky *Saved*, the refusal routed to a
 * `role="alert"`).
 *
 * Two rules the primitives keep that the screens used to keep unevenly, and
 * `www.tasteskill.dev`'s own pre-flight list asks for both: **every state is
 * built** (loading, empty, error, pending, saved), and **nothing is announced
 * only by colour** — the saved flash is `role="status"` and the refusal is
 * `role="alert"`, so both are read aloud as well as seen.
 */
import { Check, Plus } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'

/**
 * A modal: shadcn's Dialog (ADR 0025 — the native `<dialog>` was argued for
 * and consistency won). Escape, the backdrop click and the close button all
 * land on `onClose`.
 *
 * On a phone it is a sheet the full width of the screen risen from the
 * bottom, which is why editing no longer means scrolling a table sideways.
 */
export function Sheet({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* Without a description Radix wants the wiring explicitly absent,
          or it warns; with one it wires the id itself. */}
      <DialogContent {...(description === undefined ? { 'aria-describedby': undefined } : {})}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * A labelled control, with its hint and its refusal wired to it.
 *
 * The hint is `aria-describedby` rather than another line of text near the
 * box, because near is a sighted reader's word and a screen reader has no
 * equivalent for it.
 */
export function Field({
  label,
  htmlFor,
  hint,
  optional,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  optional?: boolean
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={htmlFor}
        className="mb-1 mt-3 block text-sm font-medium text-foreground first:mt-0"
      >
        {label}
        {optional === true && (
          <span className="ml-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Optional
          </span>
        )}
      </label>
      {children}
      {hint !== undefined && (
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** Lays fields out in two columns once there is room for two. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">{children}</div>
}

/** A field that takes the full width of the grid whatever else is beside it. */
export function WideField(props: Parameters<typeof Field>[0]) {
  return (
    <div className="sm:col-span-2">
      <Field {...props} />
    </div>
  )
}

/**
 * The face of one option in a `Choice`: the sr-only radio's visible twin.
 * Exported because the RHF-controlled radio groups (the horse record, the
 * thresholds desk) render the same pill from their own state — one string, so
 * the controlled and uncontrolled spellings cannot drift apart.
 */
export const CHOICE_OPTION =
  'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background'

/**
 * A short, closed list of options, spent as buttons rather than a picker.
 *
 * Radio inputs underneath, so it is a radio group to everything that reads the
 * page and the form posts the same `name=value` a `<select>` posted. Worth the
 * pixels only while the list is short: past about six the picker wins, and the
 * caller keeps a `<select>` there.
 */
export function Choice<Value extends string>({
  legend,
  name,
  options,
  defaultValue,
  value,
  onChange,
}: {
  legend: string
  name: string
  options: readonly { readonly value: Value; readonly label: string }[]
  defaultValue?: Value
  value?: Value
  onChange?: (value: Value) => void
}) {
  return (
    <fieldset className="mt-3 min-w-0 border-0 p-0">
      <legend className="mb-1 block p-0 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="m-0 block">
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={
                defaultValue === undefined ? undefined : defaultValue === option.value
              }
              checked={value === undefined ? undefined : value === option.value}
              onChange={
                onChange === undefined
                  ? undefined
                  : () => {
                      onChange(option.value)
                    }
              }
            />
            <span className={CHOICE_OPTION}>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** The row a form ends with, the save first in the source and under the thumb. */
export function Actions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {children}
    </div>
  )
}

/**
 * The submit button, which says what it is doing and cannot be pressed twice.
 *
 * A double-posted write is safe — every write carries an idempotency key and a
 * repeat gets the first response (ADR 0020) — but a button that looks inert
 * for two seconds on a barn's connectivity is why it gets pressed twice.
 */
export function SaveButton({
  pending,
  children,
  pendingLabel,
}: {
  pending: boolean
  children: string
  pendingLabel?: string
}) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </Button>
  )
}

/**
 * Running one write: pending while it is in flight, and *Saved* for a moment
 * after, which is the feedback these screens had none of.
 *
 * The refusal is the caller's own `act`, because every screen already routes
 * one to a `role="alert"` at the top of the page; what none of them had was
 * any sign of the happy path landing.
 */
export function useSaving() {
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const save = useCallback(async (work: () => Promise<unknown>) => {
    setPending(true)
    try {
      await work()
      setSaved(true)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setSaved(false)
      }, 2500)
    } finally {
      setPending(false)
    }
  }, [])

  return { pending, saved, save }
}

/** *Saved*, briefly, and read aloud rather than only shown. */
export function Saved({ saved, what = 'Saved' }: { saved: boolean; what?: string }) {
  return (
    <span
      className="inline-flex min-h-[1lh] items-center gap-1 text-sm font-medium text-success"
      role="status"
      aria-live="polite"
    >
      {saved && (
        <>
          <Check aria-hidden="true" className="size-4" />
          {what}
        </>
      )}
    </span>
  )
}

/**
 * Type-to-filter over a list, with the count of what survived it.
 *
 * A hundred horses is a scroll; a hundred horses and a box that says *3 of 104*
 * is a lookup. The count is stated because a filter that silently hides
 * ninety-nine rows and a read that returned one row look identical.
 */
export function Filter({
  label,
  value,
  onChange,
  showing,
  of,
  noun,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  showing: number
  of: number
  noun: string
}) {
  const id = useId()
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor={id} className="m-0 text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="search"
        value={value}
        placeholder="Type to filter"
        autoComplete="off"
        className="max-w-80 flex-1 basis-52"
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
      <p
        className="m-0 whitespace-nowrap text-[13px] text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {showing === of ? `${of} ${noun}` : `${showing} of ${of} ${noun}`}
      </p>
    </div>
  )
}

/** Whether `haystack` contains every word of `needle`, in any order. */
export function matches(needle: string, ...haystack: readonly (string | null)[]) {
  const words = needle.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = haystack
    .filter((part): part is string => part !== null)
    .join(' ')
    .toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * Nothing here yet, said in words and with the way out beside it.
 *
 * Never an empty table: a heading with nothing under it reads as a screen that
 * failed rather than a rescue that has not added a horse yet.
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 rounded-lg border border-dashed border-input bg-secondary px-4 py-5 text-center text-sm text-muted-foreground">
      {children}
    </p>
  )
}

/**
 * The list is on its way. Words, not a spinner, and not a blank screen.
 *
 * `aria-live` rather than `role="status"`: the role would make every loading
 * line the page's status element, and screens that already have one — a horse
 * marked Departed, a Board with its age against it — would find this one
 * first while it is still loading.
 */
export function Loading({ what }: { what: string }) {
  return (
    <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
      Loading {what}
      {'…'}
    </p>
  )
}

/** The button that opens a `Sheet`. Primary where it is the screen's one act. */
export function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button type="button" onClick={onClick}>
      <Plus aria-hidden="true" />
      {children}
    </Button>
  )
}
