/**
 * The hours report Grace produces for the Board and for a student's letter of
 * time (ADR 0012). Behind `roster`, on the desktop.
 *
 * **One ledger, two renderings.** Calvert wants one row per visit with a
 * signature line each; Anne Arundel wants dates and a total with no line
 * items. Both come off the same `/attendance` read — "rows compose upward
 * into totals; totals do not decompose into rows" — through the pure
 * functions in `src/shared/attendance.ts`, so the two counties can never
 * silently disagree about one volunteer's hours.
 *
 * **Generated, not templated.** Nothing here signs anything or sends
 * anything; a human reads this table and does that part by hand, which is
 * the whole of ADR 0012's point about staying in the loop.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { Loading } from '../../components/forms'
import { Refusal } from '../../components/refusal'
import { Alert, AlertTitle } from '../../components/ui/alert'
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
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { client } from '../../shared/api-client'
import {
  anneArundelReport,
  calvertReport,
  hoursOf,
  COUNTIES,
  type County,
  type LedgerRow,
} from '../../shared/attendance'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/attendance')({
  component: AttendanceReport,
})

type Ledger = Answers<typeof contract, '/attendance'>

const COUNTY_LABEL: Record<County, string> = {
  calvert: 'Calvert',
  anne_arundel: 'Anne Arundel',
}

function rowsOf(ledger: Ledger): readonly LedgerRow[] {
  return ledger.entries.map((entry) => ({
    id: entry.id,
    volunteerName: entry.volunteerName,
    day: entry.day,
    hours: hoursOf({
      volunteerId: entry.volunteerId,
      arrivedAt: entry.arrivedAt,
      departedAt: entry.departedAt,
    }),
    description: entry.description ?? '(shift)',
    supervisorName: entry.supervisingAdultName,
  }))
}

function AttendanceReport() {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [county, setCounty] = useState<County>('calvert')

  useEffect(() => {
    let current = true
    client
      .get('/attendance')
      .then((read) => {
        if (current) setLedger(read)
      })
      .catch((error: unknown) => {
        if (current) setProblem(refusalText(error))
      })
    return () => {
      current = false
    }
  }, [])

  const rows = useMemo(() => (ledger === null ? [] : rowsOf(ledger)), [ledger])

  if (problem !== null) {
    return (
      <main>
        <h1 className="text-foreground">Volunteer hours</h1>
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      </main>
    )
  }

  if (ledger === null) {
    return (
      <main>
        <h1 className="text-foreground">Volunteer hours</h1>
        <Loading what="the ledger" />
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-foreground">Volunteer hours</h1>
      <div className="mb-5 max-w-xs">
        <label htmlFor="county" className="mb-1 block text-sm font-medium text-foreground">
          County
        </label>
        <Select
          value={county}
          onValueChange={(next) => {
            setCounty(next as County)
          }}
        >
          <SelectTrigger id="county" aria-label="County">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTIES.map((option) => (
              <SelectItem key={option} value={option}>
                {COUNTY_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {county === 'calvert' ? <CalvertTable rows={rows} /> : <AnneArundelTable rows={rows} />}
    </main>
  )
}

/** One row per visit, with a signature line each — Calvert's own shape. */
function CalvertTable({ rows }: { rows: readonly LedgerRow[] }) {
  const report = calvertReport(rows)
  return (
    <Table>
      <TableCaption>One row per visit, for a signature each</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Volunteer</TableHead>
          <TableHead scope="col">Date</TableHead>
          <TableHead scope="col">Hours</TableHead>
          <TableHead scope="col">Description of service</TableHead>
          <TableHead scope="col">Supervisor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.map((row, index) => (
          // Calvert's own row carries no id: the visit's ledger row does, but
          // the report is a derived reshaping of it, so the tuple below —
          // unique within one rendered report — stands in for one.
          <TableRow key={`${row.volunteerName}|${row.day}|${String(index)}`}>
            <TableCell>{row.volunteerName}</TableCell>
            <TableCell>{row.day}</TableCell>
            <TableCell>
              {row.hours}
              {/* Flagged, never truncated: Calvert's cap of eight
                  service-learning hours per twenty-four is a report note, not
                  a fabrication in the record (ADR 0012). */}
              {row.overCap && <strong> — over the 8-hour cap for this day</strong>}
            </TableCell>
            <TableCell>{row.description}</TableCell>
            <TableCell>{row.supervisorName ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Dates and a total, no line items — Anne Arundel's own shape. */
function AnneArundelTable({ rows }: { rows: readonly LedgerRow[] }) {
  const report = anneArundelReport(rows)
  return (
    <Table>
      <TableCaption>Dates and a total, no line items</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Volunteer</TableHead>
          <TableHead scope="col">Total hours</TableHead>
          <TableHead scope="col">Visits</TableHead>
          <TableHead scope="col">Dates</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.map((total) => (
          <TableRow key={total.volunteerName}>
            <TableCell>{total.volunteerName}</TableCell>
            <TableCell>{total.totalHours}</TableCell>
            <TableCell>{total.visits}</TableCell>
            <TableCell>{total.days.join(', ')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
