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
 * The record is a modal of five tabs — Core Details, Location, Alerts,
 * Feeding, Departure — and each tab is one form with one Save (#62, ADR
 * 0025). The modal itself is `src/components/record-modal.tsx`, shared with
 * the volunteer record, and it carries the rule the shape rests on: **only
 * one tab may ever be unsaved**.
 *
 * Refusals render inline, under the button pressed. *Saved* stays until the
 * field is touched again. Departure and ending an Alert confirm inline inside
 * the card — never a second modal, and never on a Save button.
 */
import { createFileRoute } from '@tanstack/react-router'
import { Pencil, Plus, TriangleAlert } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  Controller,
  useFieldArray,
  useForm,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form'

import {
  Actions,
  AddButton,
  CHOICE_OPTION,
  Empty,
  Field,
  Fields,
  Filter,
  Loading,
  SaveButton,
  Sheet,
  WideField,
  matches,
  useSaving,
} from '../../components/forms'
import {
  DANGER_CARD,
  HandledRefusal,
  InlineRefusal,
  RecordModal,
  StickySaved,
  useRecordForm,
} from '../../components/record-modal'
import {
  BulkBar,
  BulkReview,
  SelectAllShowing,
  SelectRow,
  useSelection,
  type Selection,
} from '../../components/bulk'
import { Refusal } from '../../components/refusal'
import { Alert as AlertBox, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
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
import { HERD_KINDS, SPACE_KINDS, type HerdKind, type SpaceKind } from '../../shared/spaces'
import { dayString } from '../../shared/time'
import { SHIFT_TYPE_LABEL } from '../../shared/shifts'

export const Route = createFileRoute('/admin/horses')({
  component: Horses,
})

type HorseList = Answers<typeof contract, '/horses'>
type Horse = HorseList['horses'][number]
type SpaceList = Answers<typeof contract, '/spaces'>
type ProductList = Answers<typeof contract, '/products'>
type HorseProfile = Answers<typeof contract, '/horses/:horseId'>
type HorseAlert = HorseProfile['alerts'][number]

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
/** The screen says *How it's given*; the model keeps Route (`CONTEXT.md`). */
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
  // The profile read's own failure, kept apart from `problem` because it
  // belongs *inside* the modal: a banner on the page behind an open dialog is
  // invisible, and what the reader saw instead was *Loading the schedule…*
  // that never resolved.
  const [profileProblem, setProfileProblem] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('')
  // Whether the reader may move a herd at all (#99). Read on its own and
  // allowed to fail: a desk that could not learn the reader's Scopes shows the
  // list without the boxes, and the server refuses a batch regardless.
  const [holdsHorseCare, setHoldsHorseCare] = useState(false)

  useEffect(() => {
    void client
      .get('/me')
      .then((me) => {
        setHoldsHorseCare(me.domainScopes.includes('horse_care'))
      })
      .catch(() => {
        setHoldsHorseCare(false)
      })
  }, [])

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
      setProfileProblem(null)
      return
    }
    try {
      setProfile(await client.get('/horses/:horseId', { horseId: openFor }))
      setProfileProblem(null)
    } catch (error: unknown) {
      setProfile(null)
      setProfileProblem(refusalText(error))
    }
  }, [openFor])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  /**
   * Refreshes both reads after a tab's own save. Refusals no longer surface
   * here — each form renders its own, under the button pressed (#62).
   */
  const reload = useCallback(async () => {
    await Promise.all([load(), loadProfile()])
  }, [load, loadProfile])

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
  const shownIds = useMemo(() => shown.map((horse) => horse.id), [shown])
  const selection = useSelection(shownIds)

  if (horses === null || spaces === null || products === null) {
    return (
      <main>
        <h1 className="text-foreground">Horses</h1>
        {problem === null ? (
          <Loading what="horses" />
        ) : (
          <AlertBox variant="destructive">
            <AlertTitle>
              <Refusal>{problem}</Refusal>
            </AlertTitle>
          </AlertBox>
        )}
      </main>
    )
  }

  const openHorse = openFor === null ? null : (horses.horses.find((h) => h.id === openFor) ?? null)

  return (
    <main>
      <h1 className="text-foreground">Horses</h1>

      <p className="mb-5 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
        Every horse, whether or not it is still here. A Departed horse stays on this list, marked,
        because the record has to outlive the horse leaving.
      </p>

      {problem !== null && (
        <AlertBox variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </AlertBox>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-foreground">Every horse</h2>
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

          {holdsHorseCare && selection.ticked.size > 0 && (
            <HerdBar
              selection={selection}
              horses={horses.horses}
              spaces={spaces.spaces}
              reload={load}
            />
          )}

          {shown.length === 0 ? (
            <Empty>No horse matches “{filter}”.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {holdsHorseCare && (
                    <TableHead scope="col" className="w-10">
                      <SelectAllShowing selection={selection} />
                    </TableHead>
                  )}
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Halter</TableHead>
                  <TableHead scope="col">Stall</TableHead>
                  <TableHead scope="col">Pasture</TableHead>
                  <TableHead scope="col">Paddock</TableHead>
                  <TableHead scope="col">Barn</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((horse) => (
                  <TableRow
                    key={horse.id}
                    data-state={openFor === horse.id ? 'selected' : undefined}
                  >
                    {holdsHorseCare && (
                      <TableCell>
                        <SelectRow selection={selection} id={horse.id} name={horse.name} />
                      </TableCell>
                    )}
                    <TableCell>{horse.name}</TableCell>
                    <TableCell>{horse.halterColour ?? 'Not set'}</TableCell>
                    <TableCell>{horse.spaces.stall?.name ?? 'None'}</TableCell>
                    <TableCell>{horse.spaces.pasture?.name ?? 'None'}</TableCell>
                    <TableCell>{horse.spaces.paddock?.name ?? 'None'}</TableCell>
                    <TableCell>{horse.spaces.barn?.name ?? 'None'}</TableCell>
                    <TableCell>
                      {horse.departedOn === null ? (
                        <Badge variant="green">At the rescue</Badge>
                      ) : (
                        <Badge>Departed {horse.departedOn}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setOpenFor(horse.id)
                        }}
                      >
                        <Pencil aria-hidden="true" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      {openHorse !== null && (
        <HorseRecord
          key={openHorse.id}
          horse={openHorse}
          spaces={spaces.spaces}
          products={products.products}
          profile={profile}
          profileProblem={profileProblem}
          retryProfile={loadProfile}
          reload={reload}
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
            reload={reload}
            onSaved={() => {
              setAdding(false)
            }}
          />
        </Sheet>
      )}
    </main>
  )
}

/**
 * The action bar for a ticked herd (#99): a kind, a Space of that kind or
 * None, and a review of the names before anything is sent.
 *
 * **Only the kinds that hold a herd.** Stall is not offered — nothing refuses
 * two horses in one stall, so this is where twelve at once would happen — and
 * the contract refuses it besides.
 */
function HerdBar({
  selection,
  horses,
  spaces,
  reload,
}: {
  selection: Selection
  horses: HorseList['horses']
  spaces: SpaceList['spaces']
  reload: () => Promise<void>
}) {
  const [kind, setKind] = useState<HerdKind>('pasture')
  const [spaceId, setSpaceId] = useState<string>('')
  const [reviewing, setReviewing] = useState(false)

  const choices = spaces.filter((space) => space.kind === kind && space.retiredOn === null)
  const names = new Map(
    horses.filter((horse) => selection.isTicked(horse.id)).map((horse) => [horse.id, horse.name]),
  )
  const target = choices.find((space) => space.id === spaceId)
  const what =
    spaceId === NO_SPACE
      ? `Take them out of any ${KIND_LABEL[kind]}.`
      : `Put them in ${target?.name ?? ''}.`

  return (
    <BulkBar count={selection.ticked.size} noun={['horse', 'horses']} onClear={selection.clear}>
      <div className="min-w-40">
        <label htmlFor="herd-kind" className="mb-1 block text-sm font-medium text-foreground">
          Kind
        </label>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value as HerdKind)
            setSpaceId('')
          }}
        >
          <SelectTrigger id="herd-kind" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HERD_KINDS.map((herdKind) => (
              <SelectItem key={herdKind} value={herdKind}>
                {KIND_LABEL[herdKind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-48">
        <label htmlFor="herd-space" className="mb-1 block text-sm font-medium text-foreground">
          Move them to
        </label>
        <Select value={spaceId} onValueChange={setSpaceId}>
          <SelectTrigger id="herd-space" aria-label="Move them to">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SPACE}>None</SelectItem>
            {choices.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        disabled={spaceId === ''}
        onClick={() => {
          setReviewing(true)
        }}
      >
        Review
      </Button>

      {reviewing && (
        <BulkReview
          title={`Move ${String(names.size)} ${names.size === 1 ? 'horse' : 'horses'}`}
          what={what}
          names={names}
          confirm={async () => {
            const landed = await client.post('/horses/space/batch', {
              horseIds: [...names.keys()],
              kind,
              spaceId: spaceId === NO_SPACE ? null : spaceId,
            })
            return {
              done: landed.assigned,
              skipped: landed.skipped.map((skip) => ({ id: skip.horseId, because: skip.because })),
            }
          }}
          onDone={reload}
          onClose={(landed) => {
            setReviewing(false)
            if (landed) selection.clear()
          }}
        />
      )}
    </BulkBar>
  )
}

function NewHorse({ reload, onSaved }: { reload: () => Promise<void>; onSaved: () => void }) {
  const { pending, save } = useSaving()
  const [refusal, setRefusal] = useState<string | null>(null)

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setRefusal(null)
        void save(async () => {
          try {
            await client.post('/horses', {
              name: String(data.get('name') ?? ''),
              halterColour: String(data.get('halterColour') ?? '') || null,
              blanketSize: String(data.get('blanketSize') ?? '') || null,
              height: String(data.get('height') ?? '') || null,
              // No Photo URL input on this desk (#62): the column stays for
              // the day object storage lands, and a field nobody can fill is
              // worse than an absent one.
              photoUrl: null,
            })
            await reload()
            onSaved()
          } catch (error: unknown) {
            setRefusal(refusalText(error))
          }
        })
      }}
    >
      <Fields>
        <Field label="Name" htmlFor="new-horse-name">
          <Input id="new-horse-name" name="name" required maxLength={200} autoFocus />
        </Field>
        <Field label="Halter colour" htmlFor="new-horse-halter" optional>
          <Input id="new-horse-halter" name="halterColour" maxLength={100} />
        </Field>
        <Field label="Blanket size" htmlFor="new-horse-blanket" optional>
          <Input id="new-horse-blanket" name="blanketSize" maxLength={100} />
        </Field>
        <Field label="Height" htmlFor="new-horse-height" optional>
          <Input id="new-horse-height" name="height" maxLength={50} placeholder="15.2 hh" />
        </Field>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Add the horse</SaveButton>
      </Actions>
    </form>
  )
}

/* ------------------------------------------------------- the record modal -- */

const TAB_IDS = ['about', 'location', 'alerts', 'feeding', 'departed'] as const
type TabId = (typeof TAB_IDS)[number]

const TAB_LABEL: Record<TabId, string> = {
  about: 'Core Details',
  location: 'Location',
  alerts: 'Alerts',
  feeding: 'Feeding',
  departed: 'Departure',
}

/**
 * The modal of five tabs. `RecordModal` owns Escape, the backdrop and the tab
 * bar, and with them the one rule: unsaved typing stops the action and asks,
 * so only one tab can ever be dirty and nothing saves out of sight.
 */
function HorseRecord({
  horse,
  spaces,
  products,
  profile,
  profileProblem,
  retryProfile,
  reload,
  onClose,
}: {
  horse: Horse
  spaces: SpaceList['spaces']
  products: ProductList['products']
  profile: HorseProfile | null
  profileProblem: string | null
  retryProfile: () => Promise<void>
  reload: () => Promise<void>
  onClose: () => void
}) {
  const content: Record<TabId, ReactNode> = {
    about: <AboutTab horse={horse} reload={reload} />,
    location: <LocationTab horse={horse} spaces={spaces} reload={reload} />,
    alerts: (
      <AlertsTab
        horse={horse}
        profile={profile}
        profileProblem={profileProblem}
        retryProfile={retryProfile}
        reload={reload}
      />
    ),
    feeding: (
      <FeedingTab
        horse={horse}
        profile={profile}
        profileProblem={profileProblem}
        retryProfile={retryProfile}
        products={products}
        reload={reload}
      />
    ),
    departed: <DepartedTab horse={horse} reload={reload} />,
  }

  return (
    <RecordModal
      onClose={onClose}
      tabs={TAB_IDS.map((id) => ({ id, label: TAB_LABEL[id], content: content[id] }))}
      header={
        <div className="flex items-center gap-3">
          {horse.photoUrl !== null && (
            <img
              src={horse.photoUrl}
              alt={horse.name}
              className="size-14 flex-none rounded-md object-cover"
            />
          )}
          <div>
            <DialogTitle>{horse.name}</DialogTitle>
            {horse.departedOn !== null && (
              <p className="m-0 mt-1 text-sm text-muted-foreground">Departed {horse.departedOn}</p>
            )}
          </div>
        </div>
      }
    />
  )
}

/**
 * The profile read said no.
 *
 * Two tabs need `/horses/:horseId` and neither can do anything without it, so
 * the failure is theirs to show. It used to land in the page's own banner
 * behind the open dialog, which nobody can see — the tab simply said
 * *Loading…* for as long as the modal stayed open.
 */
function ProfileProblem({ because, retry }: { because: string; retry: () => Promise<void> }) {
  const [trying, setTrying] = useState(false)
  return (
    <AlertBox variant="destructive">
      <AlertTitle>
        <Refusal>{because}</Refusal>
      </AlertTitle>
      <div className="col-start-2 mt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={trying}
          onClick={() => {
            setTrying(true)
            void retry().finally(() => {
              setTrying(false)
            })
          }}
        >
          {trying ? 'Trying…' : 'Try again'}
        </Button>
      </div>
    </AlertBox>
  )
}

/* --------------------------------------------------------- 1. Core Details -- */

interface AboutValues extends FieldValues {
  name: string
  halterColour: string
  blanketSize: string
  height: string
  reason: string
}

function AboutTab({ horse, reload }: { horse: Horse; reload: () => Promise<void> }) {
  const form = useForm<AboutValues>({
    defaultValues: {
      name: horse.name,
      halterColour: horse.halterColour ?? '',
      blanketSize: horse.blanketSize ?? '',
      height: horse.height ?? '',
      reason: '',
    },
  })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: 'about',
    form,
    write: async (values) => {
      await client.post('/horses/attributes', {
        horseId: horse.id,
        name: values.name,
        halterColour: values.halterColour || null,
        blanketSize: values.blanketSize || null,
        height: values.height || null,
        reason: values.reason || null,
      })
      await reload()
    },
  })

  return (
    <form onSubmit={onSubmit}>
      <Fields>
        <Field label="Name" htmlFor="about-name">
          <Input id="about-name" required maxLength={200} {...form.register('name')} />
        </Field>
        <Field label="Halter colour" htmlFor="about-halter" optional>
          <Input id="about-halter" maxLength={100} {...form.register('halterColour')} />
        </Field>
        <Field label="Blanket size" htmlFor="about-blanket" optional>
          <Input id="about-blanket" maxLength={100} {...form.register('blanketSize')} />
        </Field>
        <Field label="Height" htmlFor="about-height" optional>
          <Input
            id="about-height"
            maxLength={50}
            placeholder="15.2 hh"
            {...form.register('height')}
          />
        </Field>
        <WideField label="Reason" htmlFor="about-reason" optional>
          <Input id="about-reason" maxLength={500} {...form.register('reason')} />
        </WideField>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Save</SaveButton>
        <StickySaved shown={saved} />
      </Actions>
    </form>
  )
}

/* ------------------------------------------------------------- 2. Location -- */

/** Radix's Select cannot carry an empty-string item, so None is a word. */
const NO_SPACE = 'none'

type LocationValues = Record<SpaceKind, string>

/**
 * The one tab behind more than one write. It saves the four assignments in
 * order and stops at the first refusal: the ones that saved lock, the failed
 * one keeps its message and the typing, the rest stay untouched (#62). Never
 * one error over the whole card.
 */
function LocationTab({
  horse,
  spaces,
  reload,
}: {
  horse: Horse
  spaces: SpaceList['spaces']
  reload: () => Promise<void>
}) {
  const initial = useRef(
    Object.fromEntries(
      SPACE_KINDS.map((kind) => [kind, horse.spaces[kind]?.id ?? NO_SPACE]),
    ) as LocationValues,
  )
  const form = useForm<LocationValues>({ defaultValues: initial.current })
  // What the server currently holds, per kind — the thing *dirty* is measured
  // against. A ref rather than RHF's own dirtyFields because the baseline
  // moves kind by kind as the ordered saves land.
  const baseline = useRef<LocationValues>({ ...initial.current })
  const [kindProblems, setKindProblems] = useState<Partial<Record<SpaceKind, string>>>({})

  const { pending, saved, onSubmit } = useRecordForm({
    id: 'location',
    form,
    write: async (values) => {
      setKindProblems({})
      for (const kind of SPACE_KINDS) {
        if (values[kind] === baseline.current[kind]) continue
        try {
          await client.post('/horses/space', {
            horseId: horse.id,
            kind,
            spaceId: values[kind] === NO_SPACE ? null : values[kind],
          })
          // This one saved: lock it by making its value the new baseline, so
          // a later refusal leaves it clean rather than dirty again.
          baseline.current[kind] = values[kind]
          form.resetField(kind, { defaultValue: values[kind] })
        } catch (error: unknown) {
          setKindProblems({ [kind]: refusalText(error) })
          await reload()
          throw new HandledRefusal()
        }
      }
      await reload()
    },
  })

  return (
    <form onSubmit={onSubmit}>
      <p className="m-0 mb-3 text-sm text-muted-foreground">
        Where the horse is: one Space of each kind at most. A horse turned out is in a Pasture and
        may in its Paddock at the same time.
      </p>
      <Fields>
        {SPACE_KINDS.map((kind) => {
          // A Retired Space stays off this list — `recordSpaceRetirement`
          // already refuses to retire one still occupied, so the currently
          // assigned Space is never among those excluded here.
          const choices = spaces.filter((space) => space.kind === kind && space.retiredOn === null)
          const problem = kindProblems[kind]
          return (
            <div key={kind} className="min-w-0">
              <label
                htmlFor={`space-${kind}`}
                className="mb-1 mt-3 block text-sm font-medium text-foreground"
              >
                {KIND_LABEL[kind]}
              </label>
              <Controller
                control={form.control}
                name={kind}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={`space-${kind}`} aria-label={KIND_LABEL[kind]}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SPACE}>None</SelectItem>
                      {choices.map((space) => (
                        <SelectItem key={space.id} value={space.id}>
                          {space.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {problem !== undefined && (
                <p role="alert" className="mt-1 text-sm font-medium text-destructive">
                  {problem}
                </p>
              )}
            </div>
          )
        })}
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Save</SaveButton>
        <StickySaved shown={saved} />
      </Actions>
    </form>
  )
}

/* --------------------------------------------------------------- 3. Alerts -- */

/**
 * The one desk where an Alert is raised, edited and ended (ADR 0024, #60).
 *
 * `horse_care` and nobody else, which is why this is here rather than on the
 * phone's profile: a volunteer who finds on a Saturday that a horse has
 * started biting records an Observation, which escalates and mails this
 * Scope's holders. An Alert anybody may post is a wall nobody reads.
 *
 * A read-only list; Edit and End expand one line in place; one *Add an
 * alert* (#62). Ending confirms inline inside the card — the required reason
 * is the confirmation — never in a second modal.
 */
function AlertsTab({
  horse,
  profile,
  profileProblem,
  retryProfile,
  reload,
}: {
  horse: Horse
  profile: HorseProfile | null
  profileProblem: string | null
  retryProfile: () => Promise<void>
  reload: () => Promise<void>
}) {
  const [openLine, setOpenLine] = useState<
    { id: string; mode: 'edit' | 'end' } | { id: 'new' } | null
  >(null)

  const kindTint: Record<AlertKind, string> = {
    prohibition: 'border-l-destructive bg-card-tint-rose dark:bg-transparent',
    care: 'border-l-warning bg-card-tint-yellow dark:bg-transparent',
    allergy: 'border-l-brand-teal bg-card-tint-lavender dark:bg-transparent',
  }

  return (
    <div>
      <p className="m-0 mb-3 text-sm text-muted-foreground">
        A standing warning a volunteer reads before working with this horse. It shows in full on the
        profile, the shift work surface and the Board, and it stays until somebody ends it.
      </p>

      {profileProblem !== null ? (
        <ProfileProblem because={profileProblem} retry={retryProfile} />
      ) : profile === null ? (
        <Loading what="the alerts" />
      ) : profile.alerts.length === 0 ? (
        <Empty>No alerts on this horse.</Empty>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {profile.alerts.map((alert) => (
            <li
              key={alert.id}
              className={`m-0 rounded-md border border-border border-l-4 px-3 py-2 ${kindTint[alert.kind]}`}
            >
              {openLine !== null && 'mode' in openLine && openLine.id === alert.id ? (
                openLine.mode === 'edit' ? (
                  <EditAlertForm
                    alert={alert}
                    reload={reload}
                    onDone={() => {
                      setOpenLine(null)
                    }}
                  />
                ) : (
                  <EndAlertForm
                    alert={alert}
                    reload={reload}
                    onDone={() => {
                      setOpenLine(null)
                    }}
                  />
                )
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-base text-foreground">
                    <strong className="mr-1 text-[13px] uppercase tracking-wide">
                      {ALERT_KIND_LABEL[alert.kind]}
                    </strong>
                    {alert.text}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpenLine({ id: alert.id, mode: 'edit' })
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpenLine({ id: alert.id, mode: 'end' })
                    }}
                  >
                    End
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {openLine !== null && 'id' in openLine && openLine.id === 'new' ? (
        <RaiseAlertForm
          horse={horse}
          reload={reload}
          onDone={() => {
            setOpenLine(null)
          }}
        />
      ) : (
        <div className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpenLine({ id: 'new' })
            }}
          >
            <Plus aria-hidden="true" />
            Add an alert
          </Button>
        </div>
      )}

      {/* Ended ones are not shown here. They appear on the horse profile and
          on no other surface (ADR 0024), which is where a history belongs. */}
    </div>
  )
}

interface AlertValues extends FieldValues {
  kind: AlertKind
  text: string
}

/** The kind, as buttons — RHF-controlled so dirtiness is answered with the rest. */
function AlertKindChoice({
  form,
  idPrefix,
}: {
  form: UseFormReturn<AlertValues>
  idPrefix: string
}) {
  return (
    <Controller
      control={form.control}
      name="kind"
      render={({ field }) => (
        <fieldset className="mt-3 min-w-0 border-0 p-0">
          <legend className="mb-1 block p-0 text-sm font-medium text-foreground">Kind</legend>
          <div className="flex flex-wrap gap-2">
            {ALERT_KIND_OPTIONS.map((option) => (
              <label key={option.value} className="m-0 block">
                <input
                  className="peer sr-only"
                  type="radio"
                  name={`${idPrefix}-kind`}
                  value={option.value}
                  checked={field.value === option.value}
                  onChange={() => {
                    field.onChange(option.value)
                  }}
                />
                <span className={CHOICE_OPTION}>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    />
  )
}

function RaiseAlertForm({
  horse,
  reload,
  onDone,
}: {
  horse: Horse
  reload: () => Promise<void>
  onDone: () => void
}) {
  const form = useForm<AlertValues>({ defaultValues: { kind: 'care', text: '' } })
  const { pending, refusal, onSubmit } = useRecordForm({
    id: 'alert-new',
    form,
    write: async (values) => {
      await client.post('/alerts', { horseId: horse.id, kind: values.kind, text: values.text })
      await reload()
      onDone()
    },
  })

  return (
    <form onSubmit={onSubmit} className="mt-4 rounded-md border border-border bg-card p-4">
      <h3 className="m-0 mb-1 flex items-center gap-1.5 text-base font-semibold text-foreground">
        <TriangleAlert aria-hidden="true" className="size-4" />
        Add an alert
      </h3>
      <Fields>
        <div className="min-w-0">
          <AlertKindChoice form={form} idPrefix="raise" />
        </div>
        <Field label="What a volunteer must know" htmlFor="raise-alert-text">
          <Input id="raise-alert-text" required maxLength={2000} {...form.register('text')} />
        </Field>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Raise the alert</SaveButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </Actions>
    </form>
  )
}

function EditAlertForm({
  alert,
  reload,
  onDone,
}: {
  alert: HorseAlert
  reload: () => Promise<void>
  onDone: () => void
}) {
  const form = useForm<AlertValues>({ defaultValues: { kind: alert.kind, text: alert.text } })
  const { pending, refusal, onSubmit } = useRecordForm({
    id: `alert-edit-${alert.id}`,
    form,
    write: async (values) => {
      await client.post('/alerts/edit', { alertId: alert.id, kind: values.kind, text: values.text })
      await reload()
      onDone()
    },
  })

  return (
    <form onSubmit={onSubmit}>
      <Fields>
        <div className="min-w-0">
          <AlertKindChoice form={form} idPrefix={`edit-${alert.id}`} />
        </div>
        <Field label="Text" htmlFor={`alert-text-${alert.id}`}>
          <Input
            id={`alert-text-${alert.id}`}
            required
            maxLength={2000}
            {...form.register('text')}
          />
        </Field>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>Save</SaveButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </Actions>
    </form>
  )
}

interface EndAlertValues extends FieldValues {
  reason: string
}

/**
 * Ending, confirmed inline inside the card: the required reason is the
 * confirmation (ADR 0024) — the audit entry answers who and when, and only
 * the reason answers *why the biting Alert is gone*. Never a delete, never
 * un-ended: a warning that is true again is a new Alert.
 */
function EndAlertForm({
  alert,
  reload,
  onDone,
}: {
  alert: HorseAlert
  reload: () => Promise<void>
  onDone: () => void
}) {
  const form = useForm<EndAlertValues>({ defaultValues: { reason: '' } })
  const { pending, refusal, onSubmit } = useRecordForm({
    id: `alert-end-${alert.id}`,
    form,
    // Confirmed inline in its own card (#62), so the modal's *Save them*
    // must never perform it.
    guarded: true,
    write: async (values) => {
      await client.post('/alerts/end', { alertId: alert.id, reason: values.reason })
      await reload()
      onDone()
    },
  })

  return (
    <form onSubmit={onSubmit}>
      <p className="m-0 text-sm text-foreground">
        <strong className="mr-1 text-[13px] uppercase tracking-wide">
          {ALERT_KIND_LABEL[alert.kind]}
        </strong>
        {alert.text}
      </p>
      <p className="m-0 mt-2 text-sm text-muted-foreground">
        The row stays and the profile keeps showing it under <em>ended</em>. Say why — it is the
        only place the answer lives.
      </p>
      <Fields>
        <WideField label="Why it is no longer true" htmlFor={`alert-end-${alert.id}`}>
          <Input
            id={`alert-end-${alert.id}`}
            required
            maxLength={500}
            {...form.register('reason')}
          />
        </WideField>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending}>End it</SaveButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Keep it
        </Button>
      </Actions>
    </form>
  )
}

/* -------------------------------------------------------------- 4. Feeding -- */

function FeedingTab({
  horse,
  profile,
  profileProblem,
  retryProfile,
  products,
  reload,
}: {
  horse: Horse
  profile: HorseProfile | null
  profileProblem: string | null
  retryProfile: () => Promise<void>
  products: ProductList['products']
  reload: () => Promise<void>
}) {
  const [changing, setChanging] = useState(false)
  const [published, setPublished] = useState(false)

  return (
    <div>
      {profileProblem !== null ? (
        <ProfileProblem because={profileProblem} retry={retryProfile} />
      ) : profile === null ? (
        <Loading what="the schedule" />
      ) : profile.feedSchedules.length === 0 ? (
        <Empty>No feed schedule recorded for this horse.</Empty>
      ) : (
        profile.feedSchedules.map((schedule) => (
          <div key={schedule.shiftType} className="mb-2 rounded-md border border-border px-4 py-3">
            <h4 className="m-0 mb-1 flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
              {SHIFT_TYPE_LABEL[schedule.shiftType]}
              <span className="text-[13px] font-normal text-muted-foreground">
                starting on {schedule.validFrom}
              </span>
              {schedule.isNew && <Badge variant="purple">New</Badge>}
              {schedule.lines.length === 0 && <Badge>Retired</Badge>}
            </h4>
            {schedule.lines.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                No feeding at this Shift Type. The Shift Type keeps its place here, because a
                deliberate none and a question nobody answered are different facts.
              </p>
            ) : (
              <>
                <ul className="m-0 list-disc pl-5">
                  {schedule.lines.map((line) => (
                    <li key={line.productId} className="mb-1">
                      <strong>{line.amount}</strong> of {line.productName}
                      {line.route !== 'in_feed' && `, ${ROUTE_LABEL[line.route].toLowerCase()}`}
                    </li>
                  ))}
                </ul>
                <RetireSchedule horse={horse} schedule={schedule} reload={reload} />
              </>
            )}
          </div>
        ))
      )}

      {changing ? (
        <ChangeFeedForm
          horse={horse}
          products={products}
          reload={reload}
          onDone={() => {
            setChanging(false)
            setPublished(true)
          }}
          onCancel={() => {
            setChanging(false)
          }}
        />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => {
              setChanging(true)
              setPublished(false)
            }}
          >
            <Pencil aria-hidden="true" />
            Change the feed
          </Button>
          <StickySaved shown={published} what="Published" />
        </div>
      )}
    </div>
  )
}

/**
 * Retiring one Shift Type's feeding, which is a **version with no lines** and
 * never a delete (ADR 0003). The catalogue tier has `retired_on` on a Product
 * and a Space (#64); the versioned tier already has the same act built in, and
 * a `retired_at` column here would be a second way to say what publishing an
 * empty version says — with the two free to disagree about what a horse eats.
 *
 * It was reachable before this only by setting every line of *Change the feed*
 * to None, which the form said in a sentence under the last row and nobody
 * read. It confirms inline inside the card, on the Departure tab's own
 * precedent: *stop feeding this horse in the morning* must not share a button
 * with an amount being corrected.
 */
function RetireSchedule({
  horse,
  schedule,
  reload,
}: {
  horse: Horse
  schedule: HorseProfile['feedSchedules'][number]
  reload: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const form = useForm<RetireValues>({ defaultValues: { validFrom: '' } })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: `feed-retire-${schedule.shiftType}`,
    form,
    // Confirmed inline in its own card (#62), so the modal's *Save them*
    // must never perform it.
    guarded: true,
    write: async (values) => {
      await client.post('/feed-schedules', {
        horseId: horse.id,
        shiftType: schedule.shiftType,
        validFrom: dayString(values.validFrom),
        lines: [],
      })
      await reload()
      setConfirming(false)
    },
  })

  if (!confirming) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setConfirming(true)
          }}
        >
          Retire this feeding
        </Button>
        <StickySaved shown={saved} what="Retired" />
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className={`mt-3 ${DANGER_CARD}`}>
      <h5 className="m-0 mb-1 text-sm font-semibold text-foreground">
        Stop feeding at {SHIFT_TYPE_LABEL[schedule.shiftType]}
      </h5>
      <p className="m-0 text-sm text-muted-foreground">
        A version with no lines, never a delete. What the horse ate before the date below stays
        exactly as it was recorded — and a Shift on or after it materializes no Feed Item.
      </p>
      <Fields>
        <Field
          label="Stopping on"
          htmlFor={`feed-retire-from-${schedule.shiftType}`}
          hint="Backdate it to the day a wrong schedule was published, if that is what happened."
        >
          <Input
            id={`feed-retire-from-${schedule.shiftType}`}
            type="date"
            required
            aria-describedby={`feed-retire-from-${schedule.shiftType}-hint`}
            {...form.register('validFrom')}
          />
        </Field>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? 'Publishing…' : 'Yes — retire this feeding'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setConfirming(false)
            form.reset()
          }}
        >
          Keep it
        </Button>
      </Actions>
    </form>
  )
}

interface RetireValues extends FieldValues {
  validFrom: string
}

interface FeedLineValues {
  productId: string
  amount: string
  route: FeedRoute
}

interface FeedValues extends FieldValues {
  shiftType: ShiftType
  validFrom: string
  lines: FeedLineValues[]
}

const NO_PRODUCT = 'none'

/**
 * Publishes a new Feed Schedule version — the screen says *Change the feed*;
 * the model keeps publish a version (`CONTEXT.md`). Every change creates a
 * version rather than updating a row (ADR 0003), which is why the schedules
 * above offer no edit.
 */
function ChangeFeedForm({
  horse,
  products,
  reload,
  onDone,
  onCancel,
}: {
  horse: Horse
  products: ProductList['products']
  reload: () => Promise<void>
  onDone: () => void
  onCancel: () => void
}) {
  const form = useForm<FeedValues>({
    defaultValues: {
      shiftType: 'feed_am',
      validFrom: '',
      lines: [{ productId: NO_PRODUCT, amount: '', route: 'in_feed' }],
    },
  })
  const linesArray = useFieldArray({ control: form.control, name: 'lines' })
  const [lineProblem, setLineProblem] = useState<string | null>(null)

  const { pending, refusal, onSubmit } = useRecordForm({
    id: 'feed-change',
    form,
    write: async (values) => {
      const chosen = values.lines.filter((line) => line.productId !== NO_PRODUCT)
      // A line with no Product picked is just an unused row and is dropped
      // above; a line with a Product but a blank Amount is a mistake and
      // caught here, since HTML `required` cannot say "required only when a
      // Product is chosen" without JS of its own.
      if (chosen.some((line) => line.amount.trim() === '')) {
        setLineProblem('Every line with a Product needs an amount.')
        throw new HandledRefusal()
      }
      setLineProblem(null)
      await client.post('/feed-schedules', {
        horseId: horse.id,
        shiftType: values.shiftType,
        validFrom: dayString(values.validFrom),
        lines: chosen,
      })
      await reload()
      onDone()
    },
  })

  return (
    <form onSubmit={onSubmit} className="mt-4 rounded-md border border-border bg-card p-4">
      <h3 className="m-0 mb-1 text-base font-semibold text-foreground">Change the feed</h3>

      <Fields>
        <div className="min-w-0">
          <Controller
            control={form.control}
            name="shiftType"
            render={({ field }) => (
              <fieldset className="mt-3 min-w-0 border-0 p-0">
                <legend className="mb-1 block p-0 text-sm font-medium text-foreground">
                  Shift Type
                </legend>
                <div className="flex flex-wrap gap-2">
                  {SHIFT_TYPE_OPTIONS.map((option) => (
                    <label key={option.value} className="m-0 block">
                      <input
                        className="peer sr-only"
                        type="radio"
                        name="feed-shift-type"
                        value={option.value}
                        checked={field.value === option.value}
                        onChange={() => {
                          field.onChange(option.value)
                        }}
                      />
                      <span className={CHOICE_OPTION}>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          />
        </div>
        <Field
          label="Starting on"
          htmlFor="feed-valid-from"
          hint="A version starts on a date. It never edits the one before it."
        >
          <Input
            id="feed-valid-from"
            type="date"
            required
            aria-describedby="feed-valid-from-hint"
            {...form.register('validFrom')}
          />
        </Field>
      </Fields>

      {linesArray.fields.map((line, index) => (
        <div
          key={line.id}
          className="mb-2 mt-3 grid grid-cols-1 items-end gap-x-4 rounded-md border border-border bg-background px-4 py-3 sm:grid-cols-[2fr_2fr_2fr_auto]"
        >
          <div className="min-w-0">
            <label
              htmlFor={`feed-line-product-${String(index)}`}
              className="mb-1 mt-3 block text-sm font-medium text-foreground sm:mt-0"
            >
              Product
            </label>
            <Controller
              control={form.control}
              name={`lines.${index}.productId`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`feed-line-product-${String(index)}`} aria-label="Product">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PRODUCT}>None</SelectItem>
                    {/* A Retired Product is offered nowhere a new line is
                        written — the same filter the Space picker keeps, and
                        the server refuses it besides (#64). */}
                    {products
                      .filter((product) => product.retiredOn === null)
                      .map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor={`feed-line-amount-${String(index)}`}
              className="mb-1 mt-3 block text-sm font-medium text-foreground sm:mt-0"
            >
              Amount
            </label>
            <Input
              id={`feed-line-amount-${String(index)}`}
              placeholder="2 scoops"
              maxLength={200}
              {...form.register(`lines.${index}.amount`)}
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor={`feed-line-route-${String(index)}`}
              className="mb-1 mt-3 block text-sm font-medium text-foreground sm:mt-0"
            >
              How it’s given
            </label>
            <Controller
              control={form.control}
              name={`lines.${index}.route`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={`feed-line-route-${String(index)}`}
                    aria-label="How it's given"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROUTES.map((route) => (
                      <SelectItem key={route} value={route}>
                        {ROUTE_LABEL[route]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {linesArray.fields.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 justify-self-start text-destructive sm:mt-0"
              onClick={() => {
                linesArray.remove(index)
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={() => {
          linesArray.append({ productId: NO_PRODUCT, amount: '', route: 'in_feed' })
        }}
      >
        <Plus aria-hidden="true" />
        Add a line
      </Button>

      <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
        To stop feeding at a Shift Type altogether, use <strong>Retire this feeding</strong> on the
        card above. Either way it is a version, not a deletion.
      </p>

      {lineProblem !== null && <InlineRefusal>{lineProblem}</InlineRefusal>}
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        <SaveButton pending={pending} pendingLabel="Publishing…">
          Publish
        </SaveButton>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </Actions>
    </form>
  )
}

/* ------------------------------------------------------------ 5. Departure -- */

interface DepartureValues extends FieldValues {
  departedOn: string
  reason: string
}

/**
 * Departure confirms inline inside the card, never on a Save button and
 * never in a second modal (#62): *I changed the halter colour* must not
 * share a button with *this horse is gone*.
 */
function DepartedTab({ horse, reload }: { horse: Horse; reload: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const form = useForm<DepartureValues>({ defaultValues: { departedOn: '', reason: '' } })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: 'departure',
    form,
    // Confirmed inline in its own card (#62), so the modal's *Save them*
    // must never perform it.
    guarded: true,
    write: async (values) => {
      await client.post('/horses/departure', {
        horseId: horse.id,
        departedOn: dayString(values.departedOn),
        reason: values.reason || null,
      })
      await reload()
      setConfirming(false)
    },
  })

  const correctionForm = useForm<FieldValues>({ defaultValues: {} })
  const correction = useRecordForm({
    id: 'departure-correction',
    form: correctionForm,
    write: async () => {
      await client.post('/horses/departure', { horseId: horse.id, departedOn: null, reason: null })
      await reload()
      setConfirming(false)
    },
  })

  if (horse.departedOn !== null) {
    return (
      <div className={DANGER_CARD}>
        <h3 className="m-0 mb-1 text-base font-semibold text-foreground">
          Departed on {horse.departedOn}
        </h3>
        {/* A date is a correction, never a delete (ADR 0002) — the same as
            setting one below. */}
        <p className="m-0 text-sm text-muted-foreground">
          The record stays either way. This only corrects the date.
        </p>
        {correction.refusal !== null && <InlineRefusal>{correction.refusal}</InlineRefusal>}
        <Actions>
          {confirming ? (
            <>
              <span className="mr-1 text-sm font-medium text-foreground">
                Put this horse back among the horses at the rescue?
              </span>
              <Button
                type="button"
                disabled={correction.pending}
                onClick={() => {
                  void correction.submit()
                }}
              >
                {correction.pending ? 'Saving…' : 'Yes — still at the rescue'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirming(false)
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(true)
              }}
            >
              Correct: has not departed
            </Button>
          )}
          <StickySaved shown={correction.saved} />
        </Actions>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className={DANGER_CARD}>
      <h3 className="m-0 mb-1 text-base font-semibold text-foreground">Departure</h3>
      <p className="m-0 text-sm text-muted-foreground">
        A date, never a delete. The horse stays on this list and its history stays reachable.
      </p>
      <Fields>
        <Field label="Date" htmlFor="departed-on">
          <Input id="departed-on" type="date" required {...form.register('departedOn')} />
        </Field>
        <Field label="Reason" htmlFor="departure-reason" optional>
          <Input id="departure-reason" maxLength={500} {...form.register('reason')} />
        </Field>
      </Fields>
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <Actions>
        {confirming ? (
          <>
            <span className="mr-1 text-sm font-medium text-foreground">
              Mark that this horse has left the rescue?
            </span>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Saving…' : 'Yes — has departed'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false)
              }}
            >
              Keep the horse
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              // The date is checked before the question is asked, so the
              // confirm never lands on an empty form.
              void form.trigger().then((valid) => {
                if (valid && form.getValues('departedOn') !== '') setConfirming(true)
              })
            }}
          >
            Mark as departed
          </Button>
        )}
        <StickySaved shown={saved} />
      </Actions>
    </form>
  )
}
