/**
 * The horse list — the phone's directory. Departed horses are left out here:
 * hiding one from a work surface is this screen's job, never the read's
 * (#32, ADR 0002) — the profile a Departed horse's row would link to still
 * answers, at `/horses/$horseId`.
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/horses/')({
  component: HorseList,
})

type Horses = Answers<typeof contract, '/horses'>

export function HorseList() {
  const [horses, setHorses] = useState<Horses | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    client
      .get('/horses')
      .then((listed) => {
        if (current) setHorses(listed)
      })
      .catch((error: unknown) => {
        if (current) setProblem(refusalText(error))
      })
    return () => {
      current = false
    }
  }, [])

  if (problem !== null) {
    return (
      <main>
        <h1>Horses</h1>
        <p role="alert">{problem}</p>
      </main>
    )
  }

  if (horses === null) {
    return (
      <main>
        <h1>Horses</h1>
        <p>One moment…</p>
      </main>
    )
  }

  const here = horses.horses.filter((horse) => horse.departedOn === null)

  return (
    <main>
      <h1>Horses</h1>
      <ul>
        {here.map((horse) => (
          <li key={horse.id}>
            <Link to="/horses/$horseId" params={{ horseId: horse.id }}>
              {horse.photoUrl !== null && (
                <img src={horse.photoUrl} alt="" width={48} height={48} />
              )}
              {horse.name}
              {horse.spaces.stall !== null && ` — ${horse.spaces.stall.name}`}
              {horse.spaces.field !== null && ` — ${horse.spaces.field.name}`}
              {horse.spaces.barn !== null && ` — ${horse.spaces.barn.name}`}
            </Link>
          </li>
        ))}
      </ul>
      {here.length === 0 && <p>No horses yet.</p>}
    </main>
  )
}
