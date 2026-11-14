# Coding standards for review

Judgement calls the review agent should enforce. Mechanical rules live in `AGENTS.md`,
`hk.pkl`, and CI; don't restate them here.

- **Config values are tested away from defaults.** For values delivered by `GET /config`
  (timezone, working hours, slot step, booking window), at least one test uses a non-default
  value. Tests that only exercise `Europe/Moscow`, `09:00–18:00`, and a 15-minute step cannot
  catch a hardcoded copy.
- **Generated contract types are the source of truth.** Hand-written code derives request,
  response, and `ErrorCode` shapes from the generated client instead of redeclaring them.
- **Shared rules have one owner.** The booking-overlap predicate and slot-generation rules
  live in `internal/timerules`; handlers and components call them rather than reimplementing
  the same loop.
- **E2E tests own their data.** No test assumes an empty store; each creates a unique meeting
  type and guest. Direct document navigation and reload are covered for SPA routes that
  collide with API prefixes (`/meeting-types`).
- **Docs move with behaviour.** A behaviour change updates `README.md`/`AGENTS.md` in the same
  PR, and release documentation describes what release-please actually emitted.
