/**
 * ADR 0016's six rules, alone.
 *
 * This is what the `PostToolUse` hook runs on every file write and what
 * `npm run lint:fixtures` counts violations against. It is deliberately not
 * the whole config: a hook running everything would block on formatting noise
 * mid-refactor, and the only thing permitted to stop work mid-file is this
 * class of error.
 */
import { guardrails } from './eslint.config'

export default guardrails
