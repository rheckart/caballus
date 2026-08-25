/**
 * shadcn's Collapsible (#66, ADR 0025), source this repo owns — a disclosure,
 * which is Radix's primitive with no styling of its own.
 *
 * The Admin group in the sidebar is the caller. An officer holding `roster`
 * and `horse_care` is offered eleven desk Destinations under one heading, and
 * a heading that can be folded away is what keeps the five they open every day
 * above the fold on a laptop.
 */
import {
  CollapsibleContent as CollapsibleContentPrimitive,
  Root as CollapsibleRootPrimitive,
  CollapsibleTrigger as CollapsibleTriggerPrimitive,
} from '@radix-ui/react-collapsible'
import type { ComponentProps } from 'react'

function Collapsible(props: ComponentProps<typeof CollapsibleRootPrimitive>) {
  return <CollapsibleRootPrimitive data-slot="collapsible" {...props} />
}

function CollapsibleTrigger(props: ComponentProps<typeof CollapsibleTriggerPrimitive>) {
  return <CollapsibleTriggerPrimitive data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent(props: ComponentProps<typeof CollapsibleContentPrimitive>) {
  return <CollapsibleContentPrimitive data-slot="collapsible-content" {...props} />
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger }
