// Fixture: no class Tailwind does not know.
// Four violations, one per position the rule has to see.
//
// Each fake class sits beside a real one, so a run that reports four here is
// also reporting that the real ones resolved — a rule that flagged everything
// would fail this count as surely as one that flagged nothing.
import { cva } from 'class-variance-authority'

const card = cva('rounded-md bg-canvas-soft', {
  variants: { tone: { warn: 'border text-warn-deep' } },
})

export const Card = () => (
  <div className={card({ tone: 'warn' })}>
    <span className="text-muted-foreground text-brnad-500">
      <em className={cn('flex', 'gap-huge')} />
    </span>
  </div>
)

declare function cn(...parts: string[]): string
