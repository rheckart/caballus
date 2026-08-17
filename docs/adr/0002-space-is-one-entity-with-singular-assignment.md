---
status: accepted
---

# Space is one entity, and a horse is assigned exactly one of each kind

Stalls and turnout fields are the same kind of thing: a named area that can be **physically joined to its neighbour**. The partition between stalls 2 and 3 was removed so that Blue, who is large and struggles to stand from lying down, has room to get up. The gates between the lettered fields can be closed, and when they are open a horse turned out into "all of C and D" is in one space, not two.

So there is a single **Space** entity with a _kind_ — stall, field, barn — composed of one or more named units, and a horse is assigned to exactly **one** Space per kind. `2 & 3` and `All of C + D` are single spaces with compound names, not sets.

Barriers themselves — gates, partitions — are deliberately **not** modelled.

## Considered options

**A string on the horse** (`horse.stall = "2 & 3"`) fails three real cases: stall 7 stands OPEN and the feed board keeps a row for it, because an empty stall is information; `"2 & 3"` is unqueryable; and the two Small Barn horses have no stall at all.

**A many-to-many between horse and stall** was the first proposal in the #10 grilling and was rejected on the rescue's own framing — _"horses do not have 2 assigned Fields"_ — and on how the work addresses it. You do not muck half of Blue's stall, and hay goes into a space rather than into a letter. A set-of-units model invites code that treats each unit separately, which is wrong for every joined case.

**Modelling the barriers** and deriving spaces from gate state was rejected because it creates a fact somebody has to maintain. A gate state nobody updated is worse than no gate data at all, since it will be trusted. Closing the gate between C and D is instead an infrequent administrative edit that redefines two Spaces.

## Consequences

Per-area checklist items address Spaces, which is what the brief's separation of _muck stalls_ from _muck paddocks_ already implies: one entity, two kinds.

An unoccupied Space is a Space with no horse — representable, and visible, exactly as the board has it.

Splitting a joined Space requires an edit by someone with the authority to make it, rather than falling out of a gate sensor or a checkbox on a shift. That is the intended trade: the model is quiet and occasionally manual, rather than chatty and often wrong.
