# Deploy runbook

Operator/agent notes for the Railway stand. User-facing setup lives in
[README.md](../README.md#-деплой-на-railway); this page records the exact MCP
sequence and the pitfalls that already cost a debugging session.

## Current stand

- Platform: Railway.
- Public URL: https://web-main-production-bb7a7b4d.up.railway.app
- Service: `web-main` in project `calendar-slot`, environment `production`.
- Build: root `Dockerfile`; the container listens on `PORT` (Railway variable
  is `8080`, the image default is also `8080`).
- Healthcheck: `GET /health`.

The project also contains an older service `web` from the first deployment.
`web-main` is canonical; do not point documentation at `web`. Delete `web`
only after explicit user confirmation.

## Prerequisites

1. `mise install`.
2. OpenCode in the repository root sees `opencode.json`.
3. Run `/mcps` → `railway` → OAuth sign-in. Do not put tokens in the repo.
4. Verify with `opencode mcp list`.

If `opencode mcp list` reports `needs authentication` while
`tools.railway.*` is already available in the session, trust the working tool
connection and do not loop on auth. Do not run the interactive
`opencode mcp auth` through a non-TTY shell; use `/mcps`.

## Deploy via MCP

Discover ids first; do not guess them.

1. `list-projects` or `list-workspaces` → project id.
2. `list-services` / `describe-environment` → environment id.
3. Create the service from the repository when it does not exist yet:

   ```text
   create-deployment({
     projectId,
     environmentId,
     repo: "kmarenov/ai-for-developers-project-386",
     branch: "main",
     name: "web-main"
   })
   ```

   `create-deployment` creates a service and triggers its first build. It may
   create a second service if one already exists; keep one canonical service.

4. Set the public port explicitly. Railway did not inject `PORT` on the first
   deploy, so the image default was not enough for the domain:

   ```text
   set-variables({ projectId, environmentId, serviceId, variables: { PORT: "8080" } })
   ```

5. Wait for the deployment to succeed:

   ```text
   get-status({ projectId, environmentId })
   get-logs({ projectId, environmentId, serviceId, deploymentId, types: ["build", "deploy"] })
   ```

   In the build logs, confirm `[internal] load build definition from
   Dockerfile`. `describe-service` may display `RAILPACK` as the builder even
   when Railway used the Dockerfile; the build log is authoritative.
   `railway.json` keeps `builder: "DOCKERFILE"` and the `/health` check.

6. Create the public domain and point it at the container port:

   ```text
   generate-domain({ projectId, environmentId, serviceId, port: 8080 })
   update-domain({ projectId, environmentId, serviceId, domain, targetPort: 8080 })
   ```

   Without `targetPort`, the first requests to the generated hostname timed out.
   If the domain still times out, check `list-domains` and retry
   `update-domain` before assuming the app is broken.

7. Verify the platform:

   ```bash
   BASE_URL=https://web-main-production-bb7a7b4d.up.railway.app
   curl -fsS "$BASE_URL/health"
   curl -fsS "$BASE_URL/config"
   curl -fsS -o /dev/null -w '%{http_code}\n' "$BASE_URL/"
   curl -fsS -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html' "$BASE_URL/meeting-types"
   curl -fsS -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html' "$BASE_URL/admin"
   ```

## Known limitations

- **Source switching.** `connect-service-source` returned `User does not have
  access to the repo` for this public GitHub repository even though
  `create-deployment` worked. Do not burn time retrying the switch: use
  `create-deployment` for a new canonical service, or the Railway CLI
  (`railway login`, `railway link`, `railway up`) against the existing service.
- **Auto-deploy on push is not guaranteed.** A push to `main` did not create a
  new deployment in this setup. After a merge that changes runtime code, trigger
  a deployment explicitly and compare `latestDeployment.createdAt` with the
  commit time.
- **Data resets.** The backend is in-memory. Every restart or redeploy wipes
  meeting types and bookings. Always reseed after the final deployment.

## Acceptance scenario

After the final deployment, seed a meeting type and keep both a normal slot and
an overlapping slot for the conflict check:

```bash
BASE_URL=https://web-main-production-bb7a7b4d.up.railway.app
TYPE_ID=$(curl -fsS -X POST "$BASE_URL/meeting-types" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Демо-встреча 30 минут","description":"Проверка публичного стенда","duration_minutes":30}' \
  | jq -r .id)

SLOTS=$(curl -fsS "$BASE_URL/available-slots?meeting_type_id=$TYPE_ID")
START=$(printf '%s' "$SLOTS" | jq -r '.[0].start_time')
OVERLAP=$(printf '%s' "$SLOTS" | jq -r '.[1].start_time')

curl -fsS -X POST "$BASE_URL/bookings" \
  -H 'Content-Type: application/json' \
  -d "{\"meeting_type_id\":\"$TYPE_ID\",\"start_time\":\"$START\",\"guest_name\":\"Публичный гость\",\"guest_email\":\"guest@example.com\"}"

# Exact repeat and partial overlap must both be rejected.
curl -sS -o /tmp/repeat.json -w '%{http_code}\n' -X POST "$BASE_URL/bookings" \
  -H 'Content-Type: application/json' \
  -d "{\"meeting_type_id\":\"$TYPE_ID\",\"start_time\":\"$START\",\"guest_name\":\"Повтор\",\"guest_email\":\"repeat@example.com\"}"
curl -sS -o /tmp/overlap.json -w '%{http_code}\n' -X POST "$BASE_URL/bookings" \
  -H 'Content-Type: application/json' \
  -d "{\"meeting_type_id\":\"$TYPE_ID\",\"start_time\":\"$OVERLAP\",\"guest_name\":\"Пересечение\",\"guest_email\":\"overlap@example.com\"}"

# Both must return 409 with code slot_taken.
cat /tmp/repeat.json /tmp/overlap.json
```

Then verify the guest UI, `/admin` owner list, direct `/meeting-types` document
navigation and reload. A temporary Playwright script can live in
`test-results/` (gitignored); do not commit a script with a hard-coded public
URL.

## Local container smoke

Run this whenever `Dockerfile`, `docker/`, `PORT` handling or the nginx template
changes:

```bash
mise run test:docker
```

The task builds the image, starts it on `SMOKE_PORT` (default `18080`), checks
`/health`, `/` and `/meeting-types`, then removes the container. The pre-commit
hook stays browser- and Docker-free; this task is run explicitly or after a
deploy-related change.
