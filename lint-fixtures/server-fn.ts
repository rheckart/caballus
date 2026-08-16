// Fixture: queueable writes POST to /api/v1, never a server function.
// Two violations — the import, and the re-export ADR 0016 names as the way an
// import ban goes intact and useless.
import { createServerFn } from '@tanstack/react-start'

export { createServerFn } from '@tanstack/react-start'

export const tickChecklistItem = createServerFn({ method: 'POST' })
