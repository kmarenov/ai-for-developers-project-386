# AGENTS.md

## Commands

- `mise install` — install pinned tools and JS deps (the `postinstall` hook runs `pnpm install`).
- `mise run setup` — install deps and Git hooks (`hk install --mise`).
- `mise run dev` — start backend on `:8081` and frontend on `:5173` through mise daemons. The task returns while both keep running; use `mise daemons status|logs|stop`.
- `mise run check` — all current checks: format, oxlint, golangci-lint, jactionlint, typecheck, Go tests, Vitest. CI runs this exact command; the `hk` pre-commit hook runs the same steps.
- CI triggers on `push` only. There is no `pull_request` trigger, so check the Actions run for the branch push rather than PR checks.
- Focused runs: `mise run lint`, `mise run typecheck`, `mise run test`, `mise run build`.
- Single test: `cd backend && go test ./internal/httpapi -run TestHealthEndpoint`; `pnpm --dir frontend test -- src/App.test.tsx`.
- `mise run codegen` — after editing `spec/main.tsp`, regenerate `spec/openapi.yaml` and the Orval client in `frontend/src/api/generated/`.

## Layout

- `spec/` — TypeSpec contract. Flow is `main.tsp` -> `spec/openapi.yaml` -> Orval client; never hand-edit `openapi.yaml` or `frontend/src/api/generated/`.
- No TypeSpec emitter targets Go standard-library HTTP servers, so the backend is written by hand against the contract; API tests assert status codes and `ErrorResponse` bodies. Adding a server generator requires an ADR first.
- `backend/` — Go stdlib API. `cmd/server/main.go` is the entrypoint, `internal/httpapi` the router, `internal/config` env config. Env: `PORT` (default `8081`), `CORS_ALLOWED_ORIGIN` (default `http://localhost:5173`).
- `frontend/` — React + TypeScript + Vite. Routes in `src/App.tsx`, pages in `src/pages`, shadcn components in `src/components/ui` (vendor code, excluded from oxlint).
- `mise.toml` — pinned tools, tasks, daemons, postinstall hook. `mise.lock` and the `.mise/locks/` sidecars pin every platform and npm tool graph; commit them together. `hk.pkl` is the shared formatter/linter/test and Git-hook config.

## Rules

- **Conventional Commits are mandatory:** `<type>(<scope>): <description>`. Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`. The `hk` commit-msg hook enforces this.
- **Every implementation commit references its ticket:** end the subject with the ticket number in parentheses, e.g. `feat: запись на свободный слот (#12)`. GitHub turns the number into a link, so the history shows which commit closed which ticket. The ticket is closed after the integration branch is merged.
- Do not edit, delete, move, or rename `.github/workflows/hexlet-check.yml`; do not rename the repository. Hexlet runs its own checks on every push.
- Backend stays standard-library-first and in-memory (no database). Booking overlap must be mutex-protected; back-to-back slots are allowed. The 14-day window, working hours/timezone, slot step, and slot duration follow the README and contract.
- Generated artifacts are `spec/openapi.yaml`, `frontend/src/api/generated/**`, and any server artifacts emitted by a generator. Never edit them by hand. Change `spec/main.tsp` (or `orval.config.ts`) and run `mise run codegen`; CI re-runs codegen and fails on any diff, including new files. Use the generated TanStack Query hooks rather than duplicating request/response types.
- Frontend imports use the `@/` alias to `frontend/src`; Vite proxies API paths to `http://localhost:8081`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `kmarenov/ai-for-developers-project-386`, operated through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
