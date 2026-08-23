/**
 * The horse list — the phone's directory. Departed horses are left out here:
 * hiding one from a work surface is this screen's job, never the read's
 * (#32, ADR 0002) — the profile a Departed horse's row would link to still
 * answers, at `/horses/$horseId`.
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Empty, Loading } from '../../components/forms'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/horses/')({
  component: HorseList,
})

type Horses = Answers<typeof contract, '/horses'>

function HorseList() {
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
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      </main>
    )
  }

  if (horses === null) {
    return (
      <main>
        <h1>Horses</h1>
        <Loading what="horses" />
      </main>
    )
  }

  const here = horses.horses.filter((horse) => horse.departedOn === null)

  return (
    <main>
      <h1>Horses</h1>
      {here.length === 0 ? (
        <Empty>No horses yet.</Empty>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {here.map((horse) => (
              <li
                key={horse.id}
                className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
                <Link to="/horses/$horseId" params={{ horseId: horse.id }}>
                  {horse.photoUrl !== null && (
                    <img
                      src={horse.photoUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="mr-3 inline-block rounded-md object-cover align-middle"
                    />
                  )}
                  {horse.name}
                  {horse.spaces.stall !== null && ` — ${horse.spaces.stall.name}`}
                  {horse.spaces.pasture !== null && ` — ${horse.spaces.pasture.name}`}
                  {horse.spaces.paddock !== null && ` — ${horse.spaces.paddock.name}`}
                  {horse.spaces.barn !== null && ` — ${horse.spaces.barn.name}`}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

export default HorseList
