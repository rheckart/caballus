// Fixture: no database handle except through forOrg.
// One violation.
import { rawDb } from '../src/db/client'

export const horses = rawDb()
