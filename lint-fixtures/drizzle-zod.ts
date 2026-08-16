// Fixture: wire shapes are hand-written Zod.
// One violation. The package is not installed; the rule reads the import
// string and needs no type information, which is what makes it affordable to
// run on every file write.
import { createInsertSchema } from 'drizzle-zod'

export const insertHorse = createInsertSchema
