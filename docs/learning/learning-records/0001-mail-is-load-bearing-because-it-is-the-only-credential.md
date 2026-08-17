# The mail path is load-bearing because it is the only credential

Established at the start: ADR 0009 makes an emailed six-digit code the only way anyone signs in,
so a broken mail path is not a degraded feature — it is sixty volunteers locked out, showing up as
onboarding that quietly does not work rather than as an outage. This is the frame for every lesson
in this workspace, and it is why the mission is production confidence rather than local convenience.

**Implications:** lessons should always name the failure mode, not just the happy path. "What
happens when this breaks, and who finds out" is the question that ties local dev to Fastmail to
Resend.
