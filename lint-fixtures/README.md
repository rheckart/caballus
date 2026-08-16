# Lint fixtures

Deliberately-violating files, one per rule of [ADR 0016](../docs/adr/0016-an-invariant-is-a-type-where-it-can-be-and-a-lint-rule-where-it-cannot.md).

They exist because a selector that matches nothing is green in exactly the way a
clean codebase is. These are hand-written AST queries and their failure mode is
silent: the guardrail reports clean forever and nobody learns it was never armed.

`npm run lint:fixtures` lints this directory with `eslint.guardrails.config.ts`
and asserts the **exact** violation count per rule, plus the exemption counts
ADR 0016 states. Change a rule, a count breaks. Add an exemption, a count
breaks. Either way somebody reads the ADR.

Nothing here is compiled, imported or shipped: the directory is outside `src`,
excluded from `tsconfig.json`, and ignored by `npm run lint`.
