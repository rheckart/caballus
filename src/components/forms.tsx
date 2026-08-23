/**
 * The data-entry primitives every screen with a form is built from.
 *
 * The screens were written as plain semantic HTML and the redesign kept that,
 * because `src/styles/app.css` can carry an element. What an element cannot
 * carry is *behaviour*, and behaviour is what made the edit screens hard: a
 * form that gave no sign it had saved, an eight-field row edited sideways
 * inside a table on a phone, a select of three options behind a tap-and-scroll
 * native picker, and a hundred-row table with no way to find a row in it.
 *
 * So: one `Sheet` that every add and every edit opens into, one `Field` that
 * puts a label, a hint and an error together in the one order a screen reader
 * reads them, one `Choice` that spends a short list of options as buttons
 * rather than a picker, one `SaveButton` that cannot be pressed twice, and one
 * `Filter` for a table long enough to need one.
 *
 * Two rules the primitives keep that the screens used to keep unevenly, and
 * `www.tasteskill.dev`'s own pre-flight list asks for both: **every state is
 * built** (loading, empty, error, pending, saved), and **nothing is announced
 * only by colour** — the saved flash is `role="status"` and the refusal is
 * `role="alert"`, so both are read aloud as well as seen.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** Closes a dialog wherever `close` exists, and removes `open` where it does not. */
function close(element: HTMLDialogElement | null) {
  if (element === null) return
  if (typeof element.close === 'function') {
    element.close()
    return
  }
  // The fallback path has to raise the event `close()` would have raised, or
  // the caller's `onClose` never runs and the sheet cannot be dismissed.
  element.removeAttribute('open')
  element.dispatchEvent(new Event('close'))
}

/**
 * A modal: a real `<dialog>`, so Escape closes it, focus is trapped and the
 * page behind it is inert without a line of our own code doing any of it.
 *
 * On a phone it is a sheet the full width of the screen with its actions at
 * the bottom, which is why editing no longer means scrolling a table sideways.
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
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (element === null || element.open) return
    // `showModal` is what makes it modal — the top layer, the backdrop, the
    // focus trap and Escape all come with it, and `open` alone gets none.
    //
    // Guarded, because it is not everywhere: jsdom has `<dialog>` and not this
    // method, and so did every browser for a while. Falling back to `open`
    // renders the same markup without the top layer, which is the difference
    // between a test that reads the form and a test that throws.
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
  }, [])

  return (
    <dialog
      ref={dialog}
      className="sheet"
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the dialog element itself is a click on the
        // backdrop: the content is a child, so anything inside stops here.
        if (event.target === dialog.current) close(dialog.current)
      }}
    >
      <div className="sheet-body">
        <header className="sheet-head">
          <div>
            <h2>{title}</h2>
            {description !== undefined && <p className="sheet-what">{description}</p>}
          </div>
          <button
            type="button"
            className="sheet-close"
            aria-label="Close"
            onClick={() => {
              close(dialog.current)
            }}
          >
            {'×'}
          </button>
        </header>
        {children}
      </div>
    </dialog>
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
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {optional === true && <span className="field-optional">Optional</span>}
      </label>
      {children}
      {hint !== undefined && (
        <p className="field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** Lays fields out in two columns once there is room for two. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="fields">{children}</div>
}

/** A field that takes the full width of the grid whatever else is beside it. */
export function WideField(props: Parameters<typeof Field>[0]) {
  return (
    <div className="field-wide">
      <Field {...props} />
    </div>
  )
}

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
    <fieldset className="choice">
      <legend>{legend}</legend>
      <div className="choice-options">
        {options.map((option) => (
          <label key={option.value}>
            <input
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
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** The row a form ends with. On a phone it sticks to the bottom of the sheet. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>
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
    <button type="submit" disabled={pending}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </button>
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
    <span className="saved" role="status" aria-live="polite">
      {saved ? what : ''}
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
    <div className="filter">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder="Type to filter"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
      <p className="filter-count" role="status" aria-live="polite">
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
  return <p className="empty">{children}</p>
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
    <p className="loading" aria-live="polite">
      Loading {what}
      {'…'}
    </p>
  )
}

/** The button that opens a `Sheet`. Primary where it is the screen's one act. */
export function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" className="add" onClick={onClick}>
      <span aria-hidden="true">+</span> {children}
    </button>
  )
}
