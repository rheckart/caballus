// Fixture: no database handle except through forOrg.
// Four shapes of the same door: the import, the import with the extension an
// editor sometimes writes, and both of those again as dynamic imports.
import { rawDb } from '../src/db/client'
import '../src/db/client.js'

export const horses = rawDb()
export const later = () => import('../src/db/client')
export const laterStill = () => import('../src/db/client.js')
