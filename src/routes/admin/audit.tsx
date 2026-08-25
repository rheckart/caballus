/**
 * The audit log.
 *
 * Behind `roster`, which is one of ADR 0010's two carve-outs from the
 * read-everything floor — the other being contact details. Sixty people's
 * record of every correction somebody made is not the same artifact as the
 * whiteboard, and this is the one screen where that distinction bites.
 *
 * What is **not** here is as decided as what is. Denials are structured logs
 * and not rows, because a table of things that did not happen is a table nobody
 * reads. Publishing a Release Version writes nothing here, because a
 * versioned-tier change *is* a version (ADR 0003). And this table is derived:
 * it could be lost without losing the application, which is the property ADR
 * 0006's restore story depends on.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Loading } from '../../components/forms'
import { Refusal } from '../../components/refusal'
import { Alert, AlertTitle } from '../../components/ui/alert'
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
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/audit')({
  component: Audit,
})

type Log = Answers<typeof contract, '/audit'>

/** What each entity is called out loud. */
const ENTITY_TEXT: Record<string, string> = {
  volunteer: 'Volunteer',
  volunteer_role: 'Role',
  medication_authority: 'Medication authority',
  release_signature: 'Release signature',
  volunteer_consent: 'Consent',
}

function Audit() {
  const [log, setLog] = useState<Log | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    client
      .get('/audit')
      .then(setLog)
      .catch((error: unknown) => {
        setProblem(refusalText(error))
      })
  }, [])

  return (
    <main>
      <h1 className="text-foreground">Audit log</h1>
      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}
      {log === null && problem === null && <Loading what="the log" />}
      {log !== null && (
        <Table>
          <TableCaption>Newest first</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">What</TableHead>
              <TableHead scope="col">Field</TableHead>
              <TableHead scope="col">Was</TableHead>
              <TableHead scope="col">Became</TableHead>
              <TableHead scope="col">Reason</TableHead>
              <TableHead scope="col">Who</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{ENTITY_TEXT[entry.entity] ?? entry.entity}</TableCell>
                {/* Null means the record as a whole — a creation, a removal, a
                    grant. A grant has no field to name. */}
                <TableCell>{entry.field ?? '—'}</TableCell>
                <TableCell>{entry.before ?? '—'}</TableCell>
                <TableCell>{entry.after ?? '—'}</TableCell>
                <TableCell>{entry.reason ?? '—'}</TableCell>
                {/* Null only for the bootstrap command, which makes the first
                    President before anybody can sign in to be one. */}
                <TableCell>{entry.actorVolunteerId ?? 'the bootstrap command'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  )
}
