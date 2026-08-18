/**
 * One horse's profile — a phone's read of the record: Alerts before anything
 * else is worked with (#32), then the descriptive attributes, then the Space
 * assignments.
 *
 * Alerts is a heading with nothing under it yet. Nothing in this ticket
 * writes one — no medical or feed domain exists to source it from — and the
 * section is here so the place is held rather than invented as a field on the
 * horse this ticket has no way to populate.
 *
 * The first parameterised endpoint the typed client calls (ADR 0021).
 */
import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/horses/$horseId')({
  component: HorseProfile,
})

type Horse = Answers<typeof contract, '/horses/:horseId'>

export function HorseProfile() {
  // `strict: false` rather than `Route.useParams()`: the route that supplies
  // `horseId` is whichever one matched, and a component test renders this
  // component under a harness route rather than this file's own.
  const { horseId } = useParams({ strict: false })
  const [horse, setHorse] = useState<Horse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (horseId === undefined) return
    let current = true
    client
      .get('/horses/:horseId', { horseId })
      .then((found) => {
        if (current) setHorse(found)
      })
      .catch((error: unknown) => {
        if (current) setProblem(refusalText(error))
      })
    return () => {
      current = false
    }
  }, [horseId])

  if (problem !== null) {
    return (
      <main>
        <p role="alert">{problem}</p>
        <Link to="/horses">Back to horses</Link>
      </main>
    )
  }

  if (horse === null) {
    return (
      <main>
        <p>One moment…</p>
      </main>
    )
  }

  return (
    <main>
      <Link to="/horses">Back to horses</Link>
      <h1>{horse.name}</h1>
      {horse.departedOn !== null && <p role="status">Departed {horse.departedOn}</p>}

      {horse.photoUrl !== null && <img src={horse.photoUrl} alt={horse.name} width={320} />}

      <h2>Alerts</h2>
      <p>No alerts recorded.</p>

      <h2>Attributes</h2>
      <ul>
        <li>Halter colour: {horse.halterColour ?? 'not recorded'}</li>
        <li>Blanket size: {horse.blanketSize ?? 'not recorded'}</li>
        <li>Height: {horse.height ?? 'not recorded'}</li>
      </ul>

      <h2>Space assignments</h2>
      <ul>
        <li>Stall: {horse.spaces.stall?.name ?? 'not assigned'}</li>
        <li>Field: {horse.spaces.field?.name ?? 'not assigned'}</li>
        <li>Barn: {horse.spaces.barn?.name ?? 'not assigned'}</li>
      </ul>
    </main>
  )
}
