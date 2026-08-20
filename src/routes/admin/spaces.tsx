/**
 * Spaces: every stall, field and barn, occupied or not — and the desk where
 * splitting or merging one happens.
 *
 * There is no delete here on purpose: splitting `2 & 3` back into `2` and `3`,
 * or merging `C` and `D` into `All of C + D`, is an edit of the row's kind and
 * name rather than a new one, which is the whole of how ADR 0002 says a
 * physical change to the barn becomes a change to the record.
 *
 * Adding and editing are **the same form in the same sheet**, because they are
 * the same six decisions and a rescue that has learnt one has learnt both. The
 * sheet is what took the edit out of the table row: eight fields laid sideways
 * inside a `colSpan` cell is a phone scrolling horizontally to type a name.
 *
 * **A run of Spaces is one act.** Describing a barn is the first thing anybody
 * does with this application and it was the most repetitive: ten stalls was
 * ten trips through a two-field form. So the add sheet asks *how many* as well
 * as *what*, and shows the names it is about to create before it creates them
 * — `seriesNames` in `src/shared/spaces.ts` makes them, the preview renders
 * exactly that list, and `/spaces/batch` is sent exactly that list, so there is
 * no rule on the server that could disagree with what somebody approved.
 *
 * The preview also marks a name the rescue already has, because *ten stalls*
 * from somebody who added three by hand last week is the ordinary case and
 * not a mistake: those three are left alone and the preview says so first.
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
import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'
import {
  DEFAULT_PREFIX,
  MOST_SPACES_AT_ONCE,
  NAME_SERIES_STYLES,
  SPACE_KINDS,
  seriesNames,
  type NameSeriesStyle,
  type SpaceKind,
} from '../../shared/spaces'

export const Route = createFileRoute('/admin/spaces')({
  component: Spaces,
})

type SpaceList = Answers<typeof contract, '/spaces'>
type Space = SpaceList['spaces'][number]

const KIND_LABEL: Record<SpaceKind, string> = { stall: 'Stall', field: 'Field', barn: 'Barn' }

const KIND_OPTIONS = SPACE_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))

/** What the sheet is open for: adding one, or editing the one it names. */
type Open =
  | { readonly kind: 'add' }
  | { readonly kind: 'several' }
  | { readonly kind: 'edit'; readonly space: Space }
  | null

function Spaces() {
  const [spaces, setSpaces] = useState<SpaceList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<Open>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setSpaces(await client.get('/spaces'))
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
        throw error
      }
    },
    [load],
  )

  const shown = useMemo(
    () =>
      (spaces?.spaces ?? []).filter((space) =>
        matches(filter, space.name, KIND_LABEL[space.kind], ...space.occupants.map((h) => h.name)),
      ),
    [spaces, filter],
  )

  return (
    <main>
      <h1>Spaces</h1>

      <p className="lede">
        A Space is one named area, a stall, a field or a barn, that may be more than one physical
        unit joined together. An empty Space is shown exactly like an occupied one: nothing here is
        removed for having nobody in it.
      </p>

      {problem !== null && <p role="alert">{problem}</p>}

      <div className="list-head">
        <h2>Every Space</h2>
        <div className="list-head-actions">
          {/* The run is the primary act on this screen, not the exception:
              describing a barn is where everybody starts. */}
          <AddButton
            onClick={() => {
              setOpen({ kind: 'several' })
            }}
          >
            Add several
          </AddButton>
          <button
            type="button"
            onClick={() => {
              setOpen({ kind: 'add' })
            }}
          >
            Add one
          </button>
        </div>
      </div>

      {spaces === null ? (
        <Loading what="Spaces" />
      ) : spaces.spaces.length === 0 ? (
        <Empty>
          No Spaces yet. <strong>Add several</strong> is how a whole barn gets described in one go.
        </Empty>
      ) : (
        <>
          {spaces.spaces.length > 8 && (
            <Filter
              label="Find a Space"
              value={filter}
              onChange={setFilter}
              showing={shown.length}
              of={spaces.spaces.length}
              noun="Spaces"
            />
          )}

          {shown.length === 0 ? (
            <Empty>No Space matches “{filter}”.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Occupied by</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {shown.map((space) => (
                  <tr key={space.id}>
                    <td>{space.name}</td>
                    <td>{KIND_LABEL[space.kind]}</td>
                    <td>
                      {space.occupants.length === 0
                        ? 'Nobody'
                        : space.occupants.map((horse) => horse.name).join(', ')}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen({ kind: 'edit', space })
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {open?.kind === 'several' && (
        <Sheet
          title="Add several Spaces"
          description="Say how many and what to call them. You will see the names before they are made."
          onClose={() => {
            setOpen(null)
          }}
        >
          <SeveralSpacesForm
            existing={spaces?.spaces ?? []}
            act={act}
            onSaved={() => {
              setOpen(null)
            }}
          />
        </Sheet>
      )}

      {(open?.kind === 'add' || open?.kind === 'edit') && (
        <Sheet
          title={open.kind === 'add' ? 'Add a Space' : `Edit ${open.space.name}`}
          description={
            open.kind === 'add'
              ? 'One named area. It may be several physical units joined together.'
              : 'Splitting or merging a Space is an edit of this name and kind, never a new row.'
          }
          onClose={() => {
            setOpen(null)
          }}
        >
          <SpaceForm
            space={open.kind === 'edit' ? open.space : null}
            act={act}
            onSaved={() => {
              setOpen(null)
            }}
          />
        </Sheet>
      )}
    </main>
  )
}

/**
 * The one form both doors open into. A `null` Space is the add; a Space is the
 * edit, and the only difference between them is the reason, which is what the
 * audit entry carries and a first creation has none of (ADR 0003).
 */
function SpaceForm({
  space,
  act,
  onSaved,
}: {
  space: Space | null
  act: (work: () => Promise<unknown>) => Promise<void>
  onSaved: () => void
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const kind = data.get('kind') as SpaceKind
        const name = String(data.get('name') ?? '')
        void save(() =>
          act(() =>
            space === null
              ? client.post('/spaces', { kind, name })
              : client.post('/spaces/edit', {
                  spaceId: space.id,
                  kind,
                  name,
                  reason: String(data.get('reason') ?? '') || null,
                }),
          ).then(onSaved),
        ).catch(() => {
          // The refusal is already on the screen behind the sheet, put there by
          // `act`; the sheet stays open with what was typed still in it.
        })
      }}
    >
      <Fields>
        <Field label="Name" htmlFor="space-name" hint="What the barn calls it. “Stall 7”, “2 & 3”.">
          <input
            id="space-name"
            name="name"
            defaultValue={space?.name}
            required
            maxLength={200}
            autoFocus
            aria-describedby="space-name-hint"
          />
        </Field>
        <div className="field">
          <Choice
            legend="Kind"
            name="kind"
            options={KIND_OPTIONS}
            defaultValue={space?.kind ?? 'stall'}
          />
        </div>
        {space !== null && (
          <div className="field-wide">
            <Field
              label="Reason"
              htmlFor="space-reason"
              optional
              hint="Why it changed. This is what the audit entry carries."
            >
              <input
                id="space-reason"
                name="reason"
                maxLength={500}
                aria-describedby="space-reason-hint"
              />
            </Field>
          </div>
        )}
      </Fields>

      <Actions>
        <SaveButton pending={pending}>{space === null ? 'Add the Space' : 'Save'}</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

/**
 * The run: *how many stalls do you have*, and the names it is about to make.
 *
 * **The preview is the point.** A count and a prefix is a rule, and a rule is
 * a thing people get wrong in ways they only find out about afterwards — off
 * by one, starting at the wrong number, a prefix with no space in it. So the
 * names are rendered, all of them, before anything is created, and a name the
 * rescue already carries under this kind is marked as one this will leave
 * alone. What the screen shows is literally what is sent (`names`), so there
 * is no second derivation on the server to drift from it.
 */
function SeveralSpacesForm({
  existing,
  act,
  onSaved,
}: {
  existing: readonly Space[]
  act: (work: () => Promise<unknown>) => Promise<void>
  onSaved: () => void
}) {
  const [kind, setKind] = useState<SpaceKind>('stall')
  const [style, setStyle] = useState<NameSeriesStyle>('numbers')
  const [prefix, setPrefix] = useState(DEFAULT_PREFIX.stall)
  const [from, setFrom] = useState('1')
  const [count, setCount] = useState('10')
  const { pending, saved, save } = useSaving()

  const names = seriesNames({
    prefix,
    style,
    from: Number(from) || 1,
    count: Number(count) || 0,
  })

  // What this kind already carries, so the preview can mark what it will skip.
  const held = useMemo(
    () => new Set(existing.filter((space) => space.kind === kind).map((space) => space.name)),
    [existing, kind],
  )
  const fresh = names.filter((name) => !held.has(name))
  const clashes = names.length - fresh.length

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (names.length === 0) return
        void save(() =>
          act(() => client.post('/spaces/batch', { kind, names: [...names] })).then(onSaved),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      <Fields>
        <div className="field-wide">
          <Choice
            legend="What are you adding?"
            name="kind"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(next) => {
              setKind(next)
              // The prefix follows the kind until somebody types their own, so
              // picking Field does not leave the preview saying "Stall A".
              setPrefix(DEFAULT_PREFIX[next])
              setStyle(next === 'field' ? 'letters' : 'numbers')
            }}
          />
        </div>

        <Field
          label="How many?"
          htmlFor="several-count"
          hint={`Up to ${String(MOST_SPACES_AT_ONCE)} at a time.`}
        >
          <input
            id="several-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MOST_SPACES_AT_ONCE}
            value={count}
            autoFocus
            aria-describedby="several-count-hint"
            onChange={(event) => {
              setCount(event.target.value)
            }}
          />
        </Field>

        <Field
          label="Called"
          htmlFor="several-prefix"
          hint="What goes before the number. Keep the trailing space."
        >
          <input
            id="several-prefix"
            value={prefix}
            maxLength={180}
            aria-describedby="several-prefix-hint"
            onChange={(event) => {
              setPrefix(event.target.value)
            }}
          />
        </Field>

        <div className="field">
          <Choice
            legend="Numbered"
            name="style"
            options={NAME_SERIES_STYLES.map((each) => ({
              value: each,
              label: each === 'numbers' ? '1, 2, 3' : 'A, B, C',
            }))}
            value={style}
            onChange={setStyle}
          />
        </div>

        <Field
          label="Starting at"
          htmlFor="several-from"
          hint="Where the run begins, for a barn that already has some."
        >
          <input
            id="several-from"
            type="number"
            inputMode="numeric"
            min={1}
            value={from}
            aria-describedby="several-from-hint"
            onChange={(event) => {
              setFrom(event.target.value)
            }}
          />
        </Field>
      </Fields>

      {/* Every name, not a summary of them: the whole reason this is safe to
          press is that nothing about it has to be imagined. */}
      <div className="preview">
        <p className="preview-head" role="status" aria-live="polite">
          {fresh.length === 0
            ? 'Nothing to add.'
            : `Adds ${String(fresh.length)} ${fresh.length === 1 ? 'Space' : 'Spaces'}.`}
          {clashes > 0 &&
            ` ${String(clashes)} ${clashes === 1 ? 'name is' : 'names are'} already taken and will be left alone.`}
        </p>
        {names.length > 0 && (
          <ul className="preview-names" aria-label="The names to be added">
            {names.map((name) => (
              <li key={name} data-held={held.has(name)}>
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Actions>
        <SaveButton pending={pending} pendingLabel="Adding…">
          {fresh.length === 1 ? 'Add 1 Space' : `Add ${String(fresh.length)} Spaces`}
        </SaveButton>
        <Saved saved={saved} what="Added" />
      </Actions>
    </form>
  )
}
