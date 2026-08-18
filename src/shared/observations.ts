/**
 * Observations and Escalations, the parts of ADR 0014 pure enough to test as
 * arithmetic: the closed vocabulary of subject kinds and the Scope a subject
 * *suggests* — the app suggests, and whoever escalates confirms (ADR 0014
 * refuses to let the app decide routing unaided).
 */
import type { DomainScope } from './domain-scopes'

/** Where the subject came from — picked from wherever the volunteer was standing, never chosen from a list (ADR 0014). */
export const OBSERVATION_SUBJECT_KINDS = ['horse', 'space', 'product', 'record'] as const

export type ObservationSubjectKind = (typeof OBSERVATION_SUBJECT_KINDS)[number]

export function isObservationSubjectKind(value: string): value is ObservationSubjectKind {
  return (OBSERVATION_SUBJECT_KINDS as readonly string[]).includes(value)
}

/**
 * ADR 0014's table: Horse suggests `horse_care`, Space suggests `maintenance`,
 * Product suggests `supplies`. A `record` subject suggests "whichever Scope
 * owns that record" — nothing this table alone can name — and no subject
 * suggests nothing at all: "the Lead picks unaided."
 */
const SUGGESTED_SCOPE: Readonly<Record<ObservationSubjectKind, DomainScope | null>> = {
  horse: 'horse_care',
  space: 'maintenance',
  product: 'supplies',
  record: null,
}

/** The Scope the app suggests for a subject kind — never a requirement, and null when there is nothing to suggest. */
export function suggestedScope(subjectKind: ObservationSubjectKind | null): DomainScope | null {
  return subjectKind === null ? null : SUGGESTED_SCOPE[subjectKind]
}

/**
 * The two exits open to a Visit's own recorder at sign-out (ADR 0014). A
 * Shift's third exit — curated into Shift Notes — is #45's, because a Visit
 * has no Shift Notes to curate into.
 */
export const OBSERVATION_DISPOSITIONS = ['escalated', 'noted_no_action'] as const

export type ObservationDisposition = (typeof OBSERVATION_DISPOSITIONS)[number]

export function isObservationDisposition(value: string): value is ObservationDisposition {
  return (OBSERVATION_DISPOSITIONS as readonly string[]).includes(value)
}
