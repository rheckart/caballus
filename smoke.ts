import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { postgresIdempotency } from './src/db/idempotency'
import { API_BASE, newIdempotencyKey } from './src/shared/api-client'
import { anonymousContext } from './src/server/request-context'
import { buildApi } from './src/server/api/app'

const owner = postgres(process.env.ADMIN_DATABASE_URL ?? '', { max: 1 })
const [me] = await owner`select id from volunteers where email = 'rob@heckart.me' limit 1`
const volunteerId = String(me?.id)

const api = buildApi({
  idempotency: postgresIdempotency(),
  context: (request) => ({
    ...anonymousContext(request),
    actor: { volunteerId, domainScopes: ['horse_care', 'roster'] },
  }),
})

const response = await api.fetch(
  new Request(`http://barn.invalid${API_BASE}/whiteboard-read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      panel: 'grid',
      mediaType: 'image/png',
      image: readFileSync('/tmp/panel.png').toString('base64'),
      idempotencyKey: newIdempotencyKey(),
    }),
  }),
)
console.log('STATUS', response.status)
console.log(JSON.stringify(JSON.parse(await response.text()), null, 1))
await owner.end()
