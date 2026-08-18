/**
 * The measurement-series vocabulary (`CONTEXT.md`'s Weight; ADR 0003's
 * measurement tier). A weight or body-condition entry is appended, never
 * edited, and carries no reason field — the tier is its own record.
 */

/** What was measured. */
export const MEASUREMENT_KINDS = ['weight', 'body_condition'] as const

export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number]

export function isMeasurementKind(stored: string): stored is MeasurementKind {
  return (MEASUREMENT_KINDS as readonly string[]).includes(stored)
}

/**
 * How a weight was taken. #15 concluded no method field was needed and was
 * wrong about the consequence: two people weighed the same horse 23 lb apart on
 * the same day, best explained by weight-tape technique (ADR 0003).
 * Body-condition entries carry no method.
 */
export const MEASUREMENT_METHODS = ['tape', 'scale'] as const

export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number]

export function isMeasurementMethod(stored: string): stored is MeasurementMethod {
  return (MEASUREMENT_METHODS as readonly string[]).includes(stored)
}
