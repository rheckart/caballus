/**
 * **No two database-backed suites may seed the same organisation.**
 *
 * This has bitten twice. Every suite that touches Postgres picks an `org_id`
 * by hand and wipes everything under it in `beforeAll` and `afterEach`, and
 * vitest runs files in parallel — so two suites sharing an id delete each
 * other's rows mid-test. The failure is a foreign-key violation in somebody
 * else's teardown, it names no suite, and it only appears when the two happen
 * to overlap, which is why "it passed on my machine" is the usual first
 * reaction to it. `1411574` in this repository's history is one occurrence and
 * #77's own suite was the next.
 *
 * The ids are read off disk rather than listed here, on
 * `src/shared/navigation.test.ts`'s own precedent: a list would be a second
 * copy of the thing it is checking, and the third collision would be somebody
 * forgetting to add to it.
 *
 * **Only suites that actually seed one count.** `src/server/api/route.test.ts`
 * names an organisation in a context it builds by hand and never writes a row
 * under it, so it can share an id with anybody; the hazard is two files
 * *inserting into and deleting from* `orgs`, which is what this looks for.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, it } from 'vitest'

const SERVER = 'src/server'

/** `00000000-0000-0000-0000-0000000000ab`, as any test file spells one. */
const ORG_ID = /'(00000000-0000-0000-0000-[0-9a-f]{12})'/g

function testFiles(directory = SERVER): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const here = join(directory, entry.name)
    if (entry.isDirectory()) return testFiles(here)
    return entry.name.endsWith('.test.ts') ? [here] : []
  })
}

it('gives every suite an organisation of its own', () => {
  const claimedBy = new Map<string, string[]>()
  for (const file of testFiles()) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('insert into orgs')) continue
    for (const id of new Set([...source.matchAll(ORG_ID)].map((match) => match[1] ?? ''))) {
      claimedBy.set(id, [...(claimedBy.get(id) ?? []), file])
    }
  }

  // A suite that seeds a **second** organisation to prove a scoped read sees
  // one of them is doing the right thing, so an id may appear twice within one
  // file. What must never happen is two files sharing one.
  const shared = [...claimedBy].filter(([, files]) => files.length > 1)

  expect(shared).toEqual([])
})
