/**
 * What blocks a Shift from closing (ADR 0013, ADR 0014, #45): "Close is
 * blocked — with the concrete blockers listed — while any Unsent work, Open
 * Attendance, or undispositioned Observation remains."
 *
 * Pure, and table-driven, and read at both seams this ticket has: the write
 * itself refuses on the server's own two counts (it cannot see Unsent — that
 * is a fact about a phone's own queue), and the close screen merges the same
 * two with the phone's local queue length before this runs, so the button and
 * the write agree about what is blocking without either repeating the other's
 * arithmetic.
 */

export type CloseBlockerKind = 'unsent_work' | 'open_attendance' | 'undispositioned_observation'

export interface CloseBlocker {
  readonly kind: CloseBlockerKind
  readonly count: number
}

export interface CloseBlockerCounts {
  /** Ticks and other writes this Shift's own phones have not yet sent (ADR 0005) — a client-only fact. */
  readonly unsentCount: number
  /** Attendance rows on this Shift with no departure recorded yet (ADR 0012). */
  readonly openAttendanceCount: number
  /** Observations recorded on this Shift with no Disposition yet (ADR 0014). */
  readonly undispositionedObservationCount: number
}

/**
 * The concrete blockers, in the order the close screen states them — the
 * order ADR 0013's own sentence lists them in. Empty means the Shift may
 * close.
 */
export function closeBlockers(counts: CloseBlockerCounts): readonly CloseBlocker[] {
  const blockers: CloseBlocker[] = []
  if (counts.unsentCount > 0) blockers.push({ kind: 'unsent_work', count: counts.unsentCount })
  if (counts.openAttendanceCount > 0) {
    blockers.push({ kind: 'open_attendance', count: counts.openAttendanceCount })
  }
  if (counts.undispositionedObservationCount > 0) {
    blockers.push({
      kind: 'undispositioned_observation',
      count: counts.undispositionedObservationCount,
    })
  }
  return blockers
}

/** Whether a Shift may close at all — the same test the screen's own button state runs. */
export function mayClose(counts: CloseBlockerCounts): boolean {
  return closeBlockers(counts).length === 0
}
