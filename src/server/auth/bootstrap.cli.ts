/**
 * The entry point for `npm run bootstrap`, and nothing else.
 *
 * One line, so that `./bootstrap.ts` stays a module the tests can import
 * without it deciding for itself whether it is being run.
 */
import { runBootstrap } from './bootstrap'

await runBootstrap(process.argv.slice(2))
