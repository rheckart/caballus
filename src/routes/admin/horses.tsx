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
 * The record is a modal of five tabs — About her, Location, Alerts, Feeding,
 * She has left — and each tab is one form with one Save (#62, ADR 0025).
 * There is no Save-all: one button firing five writes has to explain a
 * half-failure. The rule the shape rests on is that **only one tab may ever
 * be unsaved**: switching tabs or closing with unsaved typing stops and asks,
 * so no save ever writes something the person cannot see. React Hook Form's
 * `formState.isDirty` answers *dirty*; the zod contract in
 * `src/shared/api-contract.ts` stays the single source of what a payload may
 * be (ADR 0021) — RHF does not re-validate it.
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
  AddButton,
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
import { Alert as AlertBox, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
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
const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
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

  if (horses === null || spaces === null || products === null) {
    return (
      <main>
        <h1 className="text-foreground">Horses</h1>
        {problem === null ? (
          <Loading what="horses" />
        ) : (
          <AlertBox variant="destructive">
            <AlertTitle>{problem}</AlertTitle>
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
          <AlertTitle>{problem}</AlertTitle>
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

          {shown.length === 0 ? (
            <Empty>No horse matches “{filter}”.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <SaveButton pending={pending}>Add the horse</SaveButton>
      </div>
    </form>
  )
}

/* ------------------------------------------------------- the record modal -- */

/** What a tab's form hands the modal, so the dirty-tab rule can hold. */
interface TabFormControls {
  isDirty: () => boolean
  /** Runs the form's own save; true when it landed, false on a refusal. */
  save: () => Promise<boolean>
  discard: () => void
}

type RegisterForm = (id: string, controls: TabFormControls) => () => void

/** Thrown by a write that already put its refusal beside the control. */
class HandledRefusal extends Error {}

const TAB_IDS = ['about', 'location', 'alerts', 'feeding', 'departed'] as const
type TabId = (typeof TAB_IDS)[number]

const TAB_LABEL: Record<TabId, string> = {
  about: 'About her',
  location: 'Location',
  alerts: 'Alerts',
  feeding: 'Feeding',
  departed: 'She has left',
}

type PendingAction = { kind: 'switch'; to: TabId } | { kind: 'close' }

/**
 * The modal of five tabs. Escape, the backdrop and the tab bar all pass
 * through `attempt`, which is where the one rule lives: unsaved typing stops
 * the action and asks, so only one tab can ever be dirty and nothing saves
 * out of sight.
 */
function HorseRecord({
  horse,
  spaces,
  products,
  profile,
  reload,
  onClose,
}: {
  horse: Horse
  spaces: SpaceList['spaces']
  products: ProductList['products']
  profile: HorseProfile | null
  reload: () => Promise<void>
  onClose: () => void
}) {
  const [tab, setTab] = useState<TabId>('about')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [savingThem, setSavingThem] = useState(false)
  const forms = useRef(new Map<string, TabFormControls>())

  const register = useCallback<RegisterForm>((id, controls) => {
    forms.current.set(id, controls)
    return () => {
      forms.current.delete(id)
    }
  }, [])

  const dirtyForms = () => [...forms.current.values()].filter((controls) => controls.isDirty())

  const perform = (action: PendingAction) => {
    if (action.kind === 'close') onClose()
    else setTab(action.to)
  }

  const attempt = (action: PendingAction) => {
    if (dirtyForms().length === 0) {
      setPending(null)
      perform(action)
    } else {
      setPending(action)
    }
  }

  const saveThem = async () => {
    setSavingThem(true)
    try {
      let allSaved = true
      for (const controls of dirtyForms()) {
        if (!(await controls.save())) allSaved = false
      }
      const action = pending
      setPending(null)
      // A refusal keeps the tab open with its message beside the button; the
      // action the person wanted is dropped rather than done half-blind.
      if (allSaved && action !== null) perform(action)
    } finally {
      setSavingThem(false)
    }
  }

  const throwThemAway = () => {
    for (const controls of dirtyForms()) controls.discard()
    const action = pending
    setPending(null)
    if (action !== null) perform(action)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) attempt({ kind: 'close' })
      }}
    >
      <DialogContent className="sm:max-w-[780px]" {...{ 'aria-describedby': undefined }}>
        <DialogHeader>
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
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  Departed {horse.departedOn}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        {pending !== null && (
          <div
            role="alertdialog"
            aria-label="Unsaved changes"
            className="rounded-md border border-warning/40 bg-card-tint-peach/60 p-3 dark:bg-transparent"
          >
            <p className="m-0 mb-2 text-sm font-medium text-foreground">
              You have changes you haven’t saved.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={savingThem}
                onClick={() => {
                  void saveThem()
                }}
              >
                {savingThem ? 'Saving…' : 'Save them'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={throwThemAway}>
                Throw them away
              </Button>
            </div>
          </div>
        )}

        <Tabs
          value={tab}
          onValueChange={(next) => {
            if (next !== tab) attempt({ kind: 'switch', to: next as TabId })
          }}
        >
          <TabsList className="w-full">
            {TAB_IDS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {TAB_LABEL[id]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="about">
            <AboutTab horse={horse} register={register} reload={reload} />
          </TabsContent>
          <TabsContent value="location">
            <LocationTab horse={horse} spaces={spaces} register={register} reload={reload} />
          </TabsContent>
          <TabsContent value="alerts">
            <AlertsTab horse={horse} profile={profile} register={register} reload={reload} />
          </TabsContent>
          <TabsContent value="feeding">
            <FeedingTab
              horse={horse}
              profile={profile}
              products={products}
              register={register}
              reload={reload}
            />
          </TabsContent>
          <TabsContent value="departed">
            <DepartedTab horse={horse} register={register} reload={reload} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------- the form plumbing -- */

/**
 * One tab-resident form: RHF answers *dirty*, `save` runs the write and
 * reports whether it landed, the refusal renders under the button pressed,
 * and *Saved* stays until the field is touched again (#62).
 */
function useRecordForm<T extends FieldValues>({
  id,
  register,
  form,
  write,
}: {
  id: string
  register: RegisterForm
  form: UseFormReturn<T>
  write: (values: T) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)

  const { isDirty } = form.formState
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty

  const submit = useCallback(async (): Promise<boolean> => {
    let landed = false
    await form.handleSubmit(async (values) => {
      setPending(true)
      setRefusal(null)
      try {
        await write(values)
        // Resetting *to the submitted values* is what clears dirty while
        // keeping the typing: the saved state becomes the new baseline.
        form.reset(values)
        setSavedOnce(true)
        landed = true
      } catch (error: unknown) {
        if (!(error instanceof HandledRefusal)) setRefusal(refusalText(error))
      } finally {
        setPending(false)
      }
    })()
    return landed
  }, [form, write])

  const submitRef = useRef(submit)
  submitRef.current = submit
  const formRef = useRef(form)
  formRef.current = form

  useEffect(
    () =>
      register(id, {
        isDirty: () => dirtyRef.current,
        save: () => submitRef.current(),
        discard: () => {
          formRef.current.reset()
        },
      }),
    [id, register],
  )

  return {
    pending,
    refusal,
    saved: savedOnce && !isDirty,
    submit,
    onSubmit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void submit()
    },
  }
}

/** A refusal, rendered where the button is rather than at the top of a page. */
function InlineRefusal({ children }: { children: ReactNode }) {
  return (
    <AlertBox variant="destructive" className="mt-3">
      <AlertTitle>{children}</AlertTitle>
    </AlertBox>
  )
}

/** The sticky *Saved*: visible from the moment it lands until the next touch. */
function StickySaved({ shown, what = 'Saved' }: { shown: boolean; what?: string }) {
  return (
    <span
      className="inline-flex min-h-[1lh] items-center gap-1 text-sm font-medium text-success"
      role="status"
      aria-live="polite"
    >
      {shown && what}
    </span>
  )
}

/** The row a tab's form ends with. */
function TabActions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------ 1. About her -- */

interface AboutValues extends FieldValues {
  name: string
  halterColour: string
  blanketSize: string
  height: string
  reason: string
}

function AboutTab({
  horse,
  register,
  reload,
}: {
  horse: Horse
  register: RegisterForm
  reload: () => Promise<void>
}) {
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
    register,
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
      <TabActions>
        <SaveButton pending={pending}>Save</SaveButton>
        <StickySaved shown={saved} />
      </TabActions>
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
  register,
  reload,
}: {
  horse: Horse
  spaces: SpaceList['spaces']
  register: RegisterForm
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
  const saved_ = useRef<LocationValues>({ ...initial.current })
  const [kindProblems, setKindProblems] = useState<Partial<Record<SpaceKind, string>>>({})

  const { pending, saved, onSubmit } = useRecordForm({
    id: 'location',
    register,
    form,
    write: async (values) => {
      setKindProblems({})
      for (const kind of SPACE_KINDS) {
        if (values[kind] === saved_.current[kind]) continue
        try {
          await client.post('/horses/space', {
            horseId: horse.id,
            kind,
            spaceId: values[kind] === NO_SPACE ? null : values[kind],
          })
          // This one saved: lock it by making its value the new baseline, so
          // a later refusal leaves it clean rather than dirty again.
          saved_.current[kind] = values[kind]
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
        Where she is: one Space of each kind at most. A horse turned out is in a Pasture and may be
        in its Paddock at the same time.
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
      <TabActions>
        <SaveButton pending={pending}>Save</SaveButton>
        <StickySaved shown={saved} />
      </TabActions>
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
  register,
  reload,
}: {
  horse: Horse
  profile: HorseProfile | null
  register: RegisterForm
  reload: () => Promise<void>
}) {
  const [openLine, setOpenLine] = useState<
    { id: string; mode: 'edit' | 'end' } | { id: 'new' } | null
  >(null)

  const kindTint: Record<AlertKind, string> = {
    prohibition: 'border-l-destructive bg-card-tint-rose dark:bg-transparent',
    care: 'border-l-warning bg-card-tint-peach dark:bg-transparent',
    allergy: 'border-l-brand-purple bg-card-tint-lavender dark:bg-transparent',
  }

  return (
    <div>
      <p className="m-0 mb-3 text-sm text-muted-foreground">
        A standing warning a volunteer reads before working with this horse. It shows in full on the
        profile, the shift work surface and the Board, and it stays until somebody ends it.
      </p>

      {profile === null ? (
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
                    register={register}
                    reload={reload}
                    onDone={() => {
                      setOpenLine(null)
                    }}
                  />
                ) : (
                  <EndAlertForm
                    alert={alert}
                    register={register}
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
          register={register}
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
                <span className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
                  {option.label}
                </span>
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
  register,
  reload,
  onDone,
}: {
  horse: Horse
  register: RegisterForm
  reload: () => Promise<void>
  onDone: () => void
}) {
  const form = useForm<AlertValues>({ defaultValues: { kind: 'care', text: '' } })
  const { pending, refusal, onSubmit } = useRecordForm({
    id: 'alert-new',
    register,
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
      <TabActions>
        <SaveButton pending={pending}>Raise the alert</SaveButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </TabActions>
    </form>
  )
}

function EditAlertForm({
  alert,
  register,
  reload,
  onDone,
}: {
  alert: HorseAlert
  register: RegisterForm
  reload: () => Promise<void>
  onDone: () => void
}) {
  const form = useForm<AlertValues>({ defaultValues: { kind: alert.kind, text: alert.text } })
  const { pending, refusal, onSubmit } = useRecordForm({
    id: `alert-edit-${alert.id}`,
    register,
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
      <TabActions>
        <SaveButton pending={pending}>Save</SaveButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </TabActions>
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
  register,
  reload,
  onDone,
}: {
  alert: HorseAlert
  register: RegisterForm
  reload: () => Promise<void>
  onDone: () => void
}) {
  const form = useForm<EndAlertValues>({ defaultValues: { reason: '' } })
  const { pending, refusal, onSubmit } = useRecordForm({
    id: `alert-end-${alert.id}`,
    register,
    form,
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
      <TabActions>
        <SaveButton pending={pending}>End it</SaveButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Keep it
        </Button>
      </TabActions>
    </form>
  )
}

/* -------------------------------------------------------------- 4. Feeding -- */

function FeedingTab({
  horse,
  profile,
  products,
  register,
  reload,
}: {
  horse: Horse
  profile: HorseProfile | null
  products: ProductList['products']
  register: RegisterForm
  reload: () => Promise<void>
}) {
  const [changing, setChanging] = useState(false)
  const [published, setPublished] = useState(false)

  return (
    <div>
      {profile === null ? (
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
            </h4>
            {schedule.lines.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No feeding at this Shift Type.</p>
            ) : (
              <ul className="m-0 list-disc pl-5">
                {schedule.lines.map((line) => (
                  <li key={line.productId} className="mb-1">
                    <strong>{line.amount}</strong> of {line.productName}
                    {line.route !== 'in_feed' && `, ${ROUTE_LABEL[line.route].toLowerCase()}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}

      {changing ? (
        <ChangeFeedForm
          horse={horse}
          products={products}
          register={register}
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
            Change her feed
          </Button>
          <StickySaved shown={published} what="Published" />
        </div>
      )}
    </div>
  )
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
 * Publishes a new Feed Schedule version — the screen says *Change her feed*;
 * the model keeps publish a version (`CONTEXT.md`). Every change creates a
 * version rather than updating a row (ADR 0003), which is why the schedules
 * above offer no edit.
 */
function ChangeFeedForm({
  horse,
  products,
  register,
  reload,
  onDone,
  onCancel,
}: {
  horse: Horse
  products: ProductList['products']
  register: RegisterForm
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
    register,
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
      <h3 className="m-0 mb-1 text-base font-semibold text-foreground">Change her feed</h3>

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
                      <span className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
                        {option.label}
                      </span>
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
        Publishing with every line set to None retires this horse’s schedule for this Shift Type. A
        version, not a deletion.
      </p>

      {lineProblem !== null && <InlineRefusal>{lineProblem}</InlineRefusal>}
      {refusal !== null && <InlineRefusal>{refusal}</InlineRefusal>}
      <TabActions>
        <SaveButton pending={pending} pendingLabel="Publishing…">
          Publish
        </SaveButton>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </TabActions>
    </form>
  )
}

/* ---------------------------------------------------------- 5. She has left -- */

interface DepartureValues extends FieldValues {
  departedOn: string
  reason: string
}

/**
 * Departure confirms inline inside the card, never on a Save button and
 * never in a second modal (#62): *I changed her halter colour* must not
 * share a button with *she is gone*.
 */
function DepartedTab({
  horse,
  register,
  reload,
}: {
  horse: Horse
  register: RegisterForm
  reload: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const form = useForm<DepartureValues>({ defaultValues: { departedOn: '', reason: '' } })

  const { pending, refusal, saved, onSubmit } = useRecordForm({
    id: 'departure',
    register,
    form,
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
    register,
    form: correctionForm,
    write: async () => {
      await client.post('/horses/departure', { horseId: horse.id, departedOn: null, reason: null })
      await reload()
      setConfirming(false)
    },
  })

  const dangerCard =
    'rounded-md border border-destructive/30 border-l-3 border-l-destructive bg-destructive/4 p-4'

  if (horse.departedOn !== null) {
    return (
      <div className={dangerCard}>
        <h3 className="m-0 mb-1 text-base font-semibold text-foreground">
          She left on {horse.departedOn}
        </h3>
        {/* A date is a correction, never a delete (ADR 0002) — the same as
            setting one below. */}
        <p className="m-0 text-sm text-muted-foreground">
          The record stays either way. This only corrects the date.
        </p>
        {correction.refusal !== null && <InlineRefusal>{correction.refusal}</InlineRefusal>}
        <TabActions>
          {confirming ? (
            <>
              <span className="mr-1 text-sm font-medium text-foreground">
                Put her back among the horses at the rescue?
              </span>
              <Button
                type="button"
                disabled={correction.pending}
                onClick={() => {
                  void correction.submit()
                }}
              >
                {correction.pending ? 'Saving…' : 'Yes — she is still here'}
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
              Correct: she has not left
            </Button>
          )}
          <StickySaved shown={correction.saved} />
        </TabActions>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className={dangerCard}>
      <h3 className="m-0 mb-1 text-base font-semibold text-foreground">She has left</h3>
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
      <TabActions>
        {confirming ? (
          <>
            <span className="mr-1 text-sm font-medium text-foreground">
              Mark that she has left the rescue?
            </span>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Saving…' : 'Yes — she has left'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false)
              }}
            >
              Keep her
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
            Mark her as departed
          </Button>
        )}
        <StickySaved shown={saved} />
      </TabActions>
    </form>
  )
}
