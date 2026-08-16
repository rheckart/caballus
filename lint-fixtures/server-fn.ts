// Fixture: queueable writes POST to /api/v1, never a server function.
// Three violations — the import, the re-export ADR 0016 names as the way an
// import ban goes intact and useless, and the upstream package the framework
// re-exports the same function from.
import { createServerFn } from '@tanstack/react-start'
import { createServerFn as sameThingOtherDoor } from '@tanstack/start-client-core'

export { createServerFn } from '@tanstack/react-start'

export const tickChecklistItem = createServerFn({ method: 'POST' })
export const alsoTick = sameThingOtherDoor
