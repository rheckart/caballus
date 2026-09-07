/**
 * The record modal: a dialog of tabs where each tab is one form with one Save
 * (#62, ADR 0025), and the rule that **only one tab may ever be unsaved**.
 *
 * It was the horse record's own shape first, and the volunteer record is the
 * second desk that wants it — so it lives here rather than in either screen.
 * There is no Save-all: one button firing five writes has to explain a
 * half-failure. Switching tabs or closing with unsaved typing stops and asks,
 * so no save ever writes something the person cannot see.
 *
 * React Hook Form's `formState.isDirty` answers *dirty*; the zod contract in
 * `src/shared/api-contract.ts` stays the single source of what a payload may
 * be (ADR 0021) — RHF does not re-validate it.
 *
 * A tab's form reaches the modal through context rather than a threaded prop:
 * `useRecordForm` registers itself, so a tab added later cannot forget to.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

import { Refusal } from './refusal'
import { Alert as AlertBox, AlertTitle } from './ui/alert'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader } from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { cn } from '../shared/cn'
import { refusalText } from '../shared/refusals'

/** What a tab's form hands the modal, so the dirty-tab rule can hold. */
export interface TabFormControls {
  isDirty: () => boolean
  /** Runs the form's own save; true when it landed, false on a refusal. */
  save: () => Promise<boolean>
  discard: () => void
}

type RegisterForm = (id: string, controls: TabFormControls) => () => void

/** Thrown by a write that already put its refusal beside the control. */
export class HandledRefusal extends Error {}

/**
 * How a tab's form finds the modal it sits in. A form rendered outside one
 * registers with nobody, which is what lets the same hook serve a card that
 * is not in a modal at all.
 */
const RegisterContext = createContext<RegisterForm | null>(null)

/** One tab: its id, what the tab bar says, and what it shows. */
export interface RecordTab {
  id: string
  label: string
  content: ReactNode
}

type PendingAction = { kind: 'switch'; to: string } | { kind: 'close' }

export function RecordModal({
  header,
  tabs,
  onClose,
  className = 'sm:max-w-[780px]',
}: {
  /** Whatever names the record — it must contain its own `DialogTitle`. */
  header: ReactNode
  tabs: readonly RecordTab[]
  onClose: () => void
  className?: string
}) {
  const first = tabs[0]?.id ?? ''
  const [tab, setTab] = useState<string>(first)
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
      <DialogContent
        className={cn('max-h-[90dvh]', className)}
        {...{ 'aria-describedby': undefined }}
      >
        <DialogHeader>{header}</DialogHeader>

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

        <RegisterContext.Provider value={register}>
          {/*
            The tab panel is the one thing that scrolls, so the record's name
            and its tab bar stay where the thumb left them. `min-h-0` is what
            lets a flex child be shorter than its content and scroll at all;
            without it the whole sheet grows and the tab bar leaves the screen
            on the first swipe.
          */}
          <Tabs
            className="min-h-0 flex-1"
            value={tab}
            onValueChange={(next) => {
              if (next !== tab) attempt({ kind: 'switch', to: next })
            }}
          >
            <TabsList className="w-full">
              {tabs.map((one) => (
                <TabsTrigger key={one.id} value={one.id}>
                  {one.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {tabs.map((one) => (
              <TabsContent
                key={one.id}
                value={one.id}
                className="min-h-0 overflow-y-auto overscroll-contain"
              >
                {one.content}
              </TabsContent>
            ))}
          </Tabs>
        </RegisterContext.Provider>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One tab-resident form: RHF answers *dirty*, `save` runs the write and
 * reports whether it landed, the refusal renders under the button pressed,
 * and *Saved* stays until the field is touched again (#62).
 */
/**
 * What a guarded form says when the modal tries to save it for you.
 *
 * It says where the button is rather than what went wrong, because nothing
 * went wrong: the typing is still there and the act is still available, one
 * card down.
 */
const GUARDED = 'This one is confirmed here, not from Save them. Use the button below.'

export function useRecordForm<T extends FieldValues>({
  id,
  form,
  write,
  guarded = false,
}: {
  id: string
  form: UseFormReturn<T>
  write: (values: T) => Promise<void>
  /**
   * Whether this form's write sits behind an inline confirmation.
   *
   * A **guarded** form is never written by the modal's own *Save them* button.
   * #62's rule is that a destructive act confirms inline inside its own card —
   * *I recorded her orientation* must not share a button with *she is gone* —
   * and the unsaved-changes prompt is exactly that shared button wearing a
   * different name: a Coordinator who types a departure reason, thinks better
   * of it and switches tabs reads *Save them* as *keep my typing*, not as *yes,
   * remove her*.
   *
   * So a dirty guarded form still raises the prompt, and *Save them* refuses it
   * in words rather than performing it. The person confirms it where the
   * confirmation is, or throws it away.
   */
  guarded?: boolean
}) {
  const register = useContext(RegisterContext)
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
  const guardedRef = useRef(guarded)
  guardedRef.current = guarded

  useEffect(() => {
    if (register === null) return
    return register(id, {
      isDirty: () => dirtyRef.current,
      save: async () => {
        if (guardedRef.current) {
          setRefusal(GUARDED)
          return false
        }
        return submitRef.current()
      },
      discard: () => {
        formRef.current.reset()
      },
    })
  }, [id, register])

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
export function InlineRefusal({ children }: { children: ReactNode }) {
  return (
    <AlertBox variant="destructive" className="mt-3">
      <AlertTitle>
        <Refusal>{children}</Refusal>
      </AlertTitle>
    </AlertBox>
  )
}

/** The sticky *Saved*: visible from the moment it lands until the next touch. */
export function StickySaved({ shown, what = 'Saved' }: { shown: boolean; what?: string }) {
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

/** The card a destructive act sits in — Departure, and removal from the rescue. */
export const DANGER_CARD =
  'rounded-md border border-destructive/30 border-l-3 border-l-destructive bg-destructive/4 p-4'
