# Playwright с настоящим сервером

Research по issue #14. Вопрос: как поднять браузерный сценарий Playwright против настоящих
backend (`:8081`) и frontend (`:5173`), как изолировать in-memory состояние, как запускать это
локально на macOS и в CI на Linux, где лежит тест и как он соотносится с `mise run check`.

Дата: 2026-11-13. Playwright: `@playwright/test` 1.65.0 (актуальная на дату, требует Node >= 20;
в репозитории пин `node = "24.22.3"`).

## TL;DR

1. **`webServer` в `playwright.config.ts`, а не `mise run dev`.** Playwright сам поднимает и гасит
   оба процесса, ждёт готовности по URL и не оставляет «висящих» демонов. `mise run dev` остаётся
   для ручной разработки.
2. **Два сервера в массиве `webServer`**: backend (`go run ./cmd/server`) и frontend
   (`pnpm dev`), готовность — по `http://127.0.0.1:<port>/health` и корню Vite.
3. **E2E на отдельных портах** (`8091` / `5191`) + `reuseExistingServer: false`. Это даёт чистый
   in-memory backend на каждый прогон и не конфликтует с `mise run dev` на `8081`/`5173`.
   Vite-клиент уже умеет ходить на произвольный backend через `VITE_API_BASE_URL`.
4. **`workers: 1`, `fullyParallel: false`**: состояние живёт в процессе Go-сервера, а не в
   browser context. Параллельные тесты будут драться за одни и те же слоты.
5. **Данные готовим через API (`request` fixture)**: уникальный тип встречи на тест, слот берём
   из `GET /available-slots`, время не хардкодим.
6. **`mise run test:e2e` — отдельная таска**, не внутри `mise run check`. Браузеры ставятся
   отдельной таской `mise run e2e:install`; в CI — отдельный job с `playwright install --with-deps`.
7. Сценарий «гость бронирует слот, владелец видит бронь» **пока не может пройти**: backend
   реализует только `GET /health`, а страницы `/meeting-types` и `/admin` — заглушки. Ниже —
   рабочий smoke-тест и draft полного сценария, который включается после #8 и #11.

## Что есть в репозитории сейчас (проверено)

| Факт                                                                                                                                                | Источник                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Backend на `:8081`, только `GET /health`, in-memory, CORS по `CORS_ALLOWED_ORIGIN`                                                                  | `backend/cmd/server/main.go`, `backend/internal/httpapi/router.go`, `backend/internal/config/config.go` |
| Frontend на `:5173`, Vite proxy для `/health`, `/meeting-types`, `/available-slots`, `/bookings` на `http://localhost:8081`                         | `frontend/vite.config.ts`                                                                               |
| API-клиент Orval собирает URL из `env.apiBaseUrl` (`VITE_API_BASE_URL`, по умолчанию пусто → относительные пути → proxy)                            | `orval.config.ts`, `frontend/src/config/env.ts`, `frontend/src/api/generated/calendar.ts`               |
| `mise run dev` — два демона (`backend`, `frontend`) с `ready_port` 8081/5173, таска завершается, процессы остаются                                  | `mise.toml`                                                                                             |
| `mise run check` = `hk check --all`; шаги: go-fmt, golangci-lint, oxfmt, oxlint, jactionlint, mise, typecheck, test (`mise run test` = Go + Vitest) | `mise.toml`, `hk.pkl`                                                                                   |
| CI: один job на `ubuntu-latest`, `mise-action` + `mise run check`, timeout 15 мин                                                                   | `.github/workflows/ci.yml`                                                                              |
| `@playwright/test` в зависимостях нет; в README Playwright заявлен как целевой стек                                                                 | `frontend/package.json`, `package.json`, `README.md`                                                    |
| Страницы `/meeting-types` и `/admin` — заглушки, бронирования в UI нет                                                                              | `frontend/src/pages/*.tsx`, `frontend/src/App.tsx`                                                      |
| Контракт: `GET/POST /meeting-types`, `GET /available-slots?typeId&date`, `GET/POST /bookings`                                                       | `spec/main.tsp`                                                                                         |

Отсюда два ограничения, которые нельзя обойти конфигом:

- **Полный сценарий бронирования заблокирован** до реализации эндпоинтов (#8) и UI (#11).
- **Рабочие часы, таймзона, шаг и длительность слотов ещё не зафиксированы в контракте** (#4, #5).
  Пока они не решены, в конфиге нельзя жёстко прописывать `timezoneId` и время слотов — только
  вычислять дату/время из ответов API.

## 1. Рекомендуемый `playwright.config.ts`

Кладём конфиг в корень репозитория, тесты — в `e2e/`. Причина: `@playwright/test` логичнее держать
рядом с корневым `package.json`, где уже живут скрипты-обёртки над mise; `frontend/tsconfig.app.json`
включает только `src`, поэтому тесты не попадут в `tsc -b` фронтенда.

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

// Отдельные порты: не пересекаемся с `mise run dev` (8081/5173) и всегда стартуем с чистым
// in-memory состоянием. Vite-клиент ходит на backend напрямую через VITE_API_BASE_URL.
const BACKEND_PORT = 8091;
const FRONTEND_PORT = 5191;
const backendUrl = `http://127.0.0.1:${BACKEND_PORT}`;
const frontendUrl = `http://127.0.0.1:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",

  // Backend хранит данные в памяти процесса и общий для всех тестов.
  fullyParallel: false,
  workers: 1,

  retries: CI ? 2 : 0,
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // CI-док рекомендует всегда задавать globalTimeout.
  globalTimeout: CI ? 10 * 60_000 : undefined,

  reporter: CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL: frontendUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "ru-RU",
    // Должно совпадать с таймзоной из контракта (#4). Пока это плейсхолдер.
    timezoneId: "Asia/Yekaterinburg",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      name: "backend",
      command: "go run ./cmd/server",
      cwd: "backend", // относительно каталога конфига
      url: `${backendUrl}/health`,
      timeout: 120_000, // холодная сборка `go run` + старт
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
      // env мержится с process.env и PLAYWRIGHT_TEST=1 (см. исходник Playwright ниже)
      env: {
        PORT: String(BACKEND_PORT),
        CORS_ALLOWED_ORIGIN: frontendUrl,
      },
    },
    {
      name: "frontend",
      command: `pnpm dev --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      cwd: "frontend",
      url: frontendUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: { VITE_API_BASE_URL: backendUrl },
    },
  ],
});
```

Почему именно так:

- **`webServer` массивом** — официально поддерживается: несколько серверов поднимаются
  одновременно, каждый со своим `name`, `url`, `timeout`, `reuseExistingServer`. Playwright
  запускает их перед тестами и гасит после прогона.
- **Готовность по `url`**, а не по `port` (последний deprecated). Сервер считается готовым, если
  URL отвечает 2xx/3xx/400/401/402/403. Поэтому у backend проверяем `/health` (там честный 200), а
  не корень, который отдаёт 404.
- **`reuseExistingServer: false`** — при занятом порте Playwright падает с явной ошибкой
  «is already used…», а не подхватывает чужой процесс с грязным состоянием. На отдельных портах это
  безопасно: `mise run dev` можно не останавливать.
- **`cwd`** задаёт рабочий каталог команды (по умолчанию — каталог конфига), поэтому не нужны
  `cd backend && …`.
- **`gracefulShutdown`** для Go-сервера: `SIGTERM` + 500 мс, затем `SIGKILL`. По умолчанию
  Playwright жёстко убивает группу процессов `SIGKILL`; для backend это допустимо, но `SIGTERM`
  даёт отработать `server.Shutdown` из `main.go`.
- **`VITE_API_BASE_URL`**: сгенерированный Orval-клиент подставляет `env.apiBaseUrl` в каждый URL,
  значит фронтенд может ходить на `8091` напрямую. CORS при этом разрешает ровно `frontendUrl`
  (`CORS_ALLOWED_ORIGIN`), а `withCORS` уже отвечает на `OPTIONS` для GET/POST.
- **Один проект `chromium`**: быстрее и стабильнее. Дополнительные браузеры добавляются как
  `projects` и запускаются `--project=webkit`; в CI это отдельное расширение матрицы.
- **`trace: "on-first-retry"`**, скриншоты и видео по падению — стандартная связка для разбора
  flaky-тестов, артефакты уезжают в `test-results/` и `playwright-report/`.

### Вариант без отдельных портов (проще, но грязнее)

Если менять порты не хочется, можно оставить `8081`/`5173` и убрать `env` у frontend (запросы
пойдут через Vite proxy). Тогда обязательно:

- `reuseExistingServer: false` и **`mise daemons stop`** перед `mise run test:e2e`, иначе прогон
  упадёт на занятом порте (это лучше, чем молча тестировать грязное состояние);
- либо `reuseExistingServer: !process.env.CI` — но локально это переиспользует запущенный
  `mise run dev` и его накопленные брони, что делает тесты недетерминированными.

Отдельные порты выигрывают: чистый старт, параллельная работа с dev-сервером, никаких «а почему
локально прошло, а в CI нет».

## 2. Изоляция in-memory состояния

Playwright изолирует только браузер: у каждого теста свой `BrowserContext` (куки, storage,
модульные глобалы в worker-процессе). Всё, что живёт **вне** теста — в нашем случае map в
Go-процессе — общее. Официальный гайд прямо называет это источником flakiness и советует давать
каждому тесту свои данные (`testInfo.testId`) и не полагаться на порядок тестов.

Практическая схема:

1. **Свежий backend на прогон.** `reuseExistingServer: false` + Playwright запускает процесс на
   старте прогона → все map пустые. Это самая надёжная «транзакция» для in-memory сервиса:
   рестарт процесса = откат.
2. **`workers: 1` и `fullyParallel: false`.** Два теста, бронирующие один слот, гоняются за
   `sync.Mutex`; кто-то получит 409. Последовательный запуск убирает этот класс флаки.
3. **Уникальные данные на тест.** Тип встречи создаём через API с заголовком
   `Встреча ${testInfo.testId}` — он уникален и не пересекается с другими тестами и с ручными
   данными, если сервер всё-таки переиспользован.
4. **Слот не хардкодим.** Берём `GET /available-slots?typeId=…&date=…` и бронируем первый
   `is_available: true`. Это автоматически учитывает рабочие часы, шаг, длительность и уже
   занятые интервалы. Хардкод «09:45» сломается при смене констант (#4, #5) и при повторном
   прогоне на живом сервере.
5. **Дата внутри 14-дневного окна.** Вычисляем `сегодня + 1..3 дня` в таймзоне контракта
   (`Intl.DateTimeFormat` с `timeZone`), а не в таймзоне машины: CI на UTC, разработчик — на
   локальной, и «завтра» может отличаться.
6. **Повторные прогоны.** Если сервер не перезапускали (`--repeat-each`, отладка через `--ui`),
   слоты накапливаются. Тест остаётся зелёным, пока в дне есть хоть один свободный слот; для
   длинной серии прогонов надёжнее перезапустить backend (обычный прогон это и делает).
7. **Не добавляем `POST /test/reset` в контракт.** Это тестовый рычаг в проде-API: лишний роут,
   который надо защищать. Рестарт процесса решает задачу без изменения TypeSpec. Если когда-то
   понадобится состояние «много броней», лучше сидировать их через `POST /bookings` в `beforeAll`.

Проверка постусловий — через API, а не только через UI: после UI-брони `GET /bookings` должен
содержать гостя. Это ловит баг «UI показал успех, а запись не сохранилась».

## 3. Запуск: локально (macOS) и в CI (Linux)

### Локально, macOS

```bash
mise install                      # Node/pnpm/Go по пинам
mise run e2e:install              # pnpm exec playwright install chromium
mise run test:e2e                 # поднимет 8091/5191 и прогонит e2e/
mise run test:e2e -- --headed     # глазами
pnpm exec playwright test --ui    # UI mode
```

- Браузеры качаются в `~/Library/Caches/ms-playwright`, системные зависимости на macOS не нужны.
- `--with-deps` на macOS не требуется (и не делает ничего полезного).
- `mise run dev` можно держать запущенным: E2E на других портах.
- Playwright сам скачивает только нужный браузер: `install chromium` вместо всех трёх экономит
  ~400 МБ.

### CI, Linux (`ubuntu-latest`)

```yaml
e2e:
  runs-on: ubuntu-latest
  timeout-minutes: 15
  steps:
    - uses: actions/checkout@<pin>
    - uses: jdx/mise-action@<pin>
    - run: pnpm exec playwright install --with-deps chromium
    - run: mise run test:e2e
    - uses: actions/upload-artifact@<pin>
      if: ${{ !cancelled() }}
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 7
```

- На Linux браузерам нужны системные библиотеки: `playwright install --with-deps` ставит их через
  apt (runner даёт passwordless sudo). Без `--with-deps` — ошибки запуска вида
  «Host system is missing dependencies».
- Заголовки/headed в CI не нужны: по умолчанию headless. Если понадобится headed — только через
  `xvfb-run`.
- Кэшировать браузеры **не рекомендуется**: восстановление кэша сопоставимо по времени со
  скачиванием, а системные зависимости всё равно не кэшируются. Если кэшировать — ключ по версии
  Playwright.
- `workers: 1` в CI рекомендует сам Playwright: стабильность и воспроизводимость важнее скорости.
- `globalTimeout` обязателен, иначе зависший прогон убьёт job без отчёта. Job-level
  `timeout-minutes` держим заметно выше `globalTimeout`.
- Артефакты (`playwright-report/`, `test-results/`) грузим всегда, не только при падении: трейсы
  нужны именно после фейла.

### Зависимости и версии

```bash
pnpm add -D -w @playwright/test@^1.65.0
```

- Ставим в корень workspace (`-w`), конфиг и `e2e/` — тоже в корне.
- `pnpm install --frozen-lockfile` в `mise run install` подхватит пакет только после обновления
  `pnpm-lock.yaml` — не забыть закоммитить лок.
- Браузеры — отдельным шагом: `postinstall` их качать нельзя (сотни мегабайт на каждом
  `mise install`, в том числе в CI, где кэш не помогает).
- Версия Playwright и версия браузеров жёстко связаны: после апгрейда пакета нужно повторить
  `playwright install`.

## 4. Где живёт тест и какая mise-таска его запускает

```
playwright.config.ts        # корень
e2e/
  fixtures.ts               # api-контекст на backend
  smoke.spec.ts             # работает уже сейчас
  booking.spec.ts           # draft, включается после #8/#11
test-results/               # gitignore
playwright-report/          # gitignore
```

Таски в `mise.toml`:

```toml
[tasks."e2e:install"]
description = "Install Playwright browsers (chromium)"
run = "pnpm exec playwright install chromium"

[tasks."test:e2e"]
description = "Run Playwright E2E against real backend and frontend"
raw_args = true
run = "pnpm exec playwright test"
```

- `raw_args = true` — чтобы `mise run test:e2e -- --headed`, `--project=chromium`, `-g "бронь"`
  уходили в Playwright без разбора аргументов mise.
- `pnpm exec` (а не `npx`) — резолвит бинарь из локального `node_modules` с пином из lockfile.
- `e2e:install` не входит в `mise run setup`: setup должен оставаться быстрым; браузеры — явный
  шаг.

### Как это соотносится с `mise run check`

Сейчас `mise run check` = `hk check --all` → format, lint, typecheck, Go tests, Vitest. E2E туда
**не добавляем**, и вот почему:

- `hk` запускает шаги и в pre-commit хуке. Скачивание/запуск браузеров на каждый коммит — это
  минуты и мегабайты, разработчики начнут обходить хук.
- В каталоге builtins `hk` 2.12.0 нет Playwright-шага (есть oxlint/oxfmt/prettier/tsc/vitest-подобные
  обёртки, но не Playwright) — шаг пришлось бы писать вручную.
- `mise run check` в CI не ставит браузеры. Если добавить E2E шагом, `mise run check` начнёт
  падать на чистом runner без `playwright install --with-deps`.

Рекомендуемая связка:

| Команда                | Что делает                                                | Где вызывается                          |
| ---------------------- | --------------------------------------------------------- | --------------------------------------- |
| `mise run check`       | format + lint + typecheck + unit/integration (Go, Vitest) | pre-commit, CI job `check`              |
| `mise run test:e2e`    | Playwright против реальных backend+frontend               | локально, CI job `e2e`                  |
| `mise run e2e:install` | ставит chromium                                           | один раз локально, шагом в CI job `e2e` |

Если проект решит, что «`check` — это вообще всё», есть два варианта:

1. **Отдельный job** (рекомендуется): `ci.yml` получает job `e2e` рядом с `check`. `mise run check`
   не меняется, AGENTS.md/README уточняют, что E2E — отдельная стадия.
2. **Шаг hk с профилем**: `["e2e"] = { check = "mise run test:e2e", profiles = List("e2e") }` и
   таска `check:e2e = "hk check --all --profile e2e"`. Тогда `mise run check` остаётся быстрым, а
   полный прогон — `mise run check:e2e`. Минус: ещё одна команда, о которой надо помнить.

Чего делать не стоит: молча добавлять `test:e2e` в `[tasks.test]`. `mise run test` вызывается из
hk-шага `test` и из pre-commit — коммит станет невозможно быстрым.

## 5. Набросок сценария «гость бронирует слот, владелец видит бронь»

### Что работает уже сейчас

`e2e/smoke.spec.ts` — проверяет, что реальный frontend отдаётся Vite, React монтируется, роутинг
жив, а backend отвечает:

```ts
import { expect, test } from "./fixtures";

test("гость открывает главную и переходит к записи", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Календарь звонков" })).toBeVisible();

  await page.getByRole("link", { name: /Записаться/ }).click();

  await expect(page.getByRole("heading", { name: "Типы встреч" })).toBeVisible();
  await expect(page).toHaveURL(/\/meeting-types$/);
});

test("backend отвечает на /health", async ({ api }) => {
  const response = await api.get("/health");

  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ status: "ok" });
});
```

`e2e/fixtures.ts` — отдельный `APIRequestContext` на backend (не через Vite proxy), чтобы сидировать
данные и проверять постусловия:

```ts
import { test as base, expect, request, type APIRequestContext } from "@playwright/test";

const API_URL = "http://127.0.0.1:8091";

export const test = base.extend<{ api: APIRequestContext }>({
  api: async ({}, use) => {
    const context = await request.newContext({ baseURL: API_URL });
    await use(context);
    await context.dispose();
  },
});

export { expect };
```

### Draft полного сценария

Включается, когда появятся `POST /meeting-types`, `GET /available-slots`, `POST /bookings` (#8) и
UI выбора слота/формы/админки (#11). Селекторы — по ролям и доступным именам (рекомендация
Playwright), `data-testid` добавляем только там, где текст нестабилен (например, ячейка даты).

```ts
// e2e/booking.spec.ts
import { expect, test } from "./fixtures";

// Должно совпадать с timezone из контракта (#4).
const TIME_ZONE = "Asia/Yekaterinburg";

function dateInTimeZone(daysAhead: number): string {
  const timestamp = Date.now() + daysAhead * 24 * 60 * 60 * 1000;
  // en-CA даёт YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

test("гость бронирует слот, владелец видит бронь", async ({ page, api }, testInfo) => {
  // 1. Данные: уникальный тип встречи на тест.
  const title = `Встреча ${testInfo.testId}`;
  const created = await api.post("/meeting-types", {
    data: { title, description: "E2E", duration_minutes: 30 },
  });
  expect(created.ok()).toBeTruthy();
  const meetingType = await created.json();

  // 2. Слот: берём первый свободный на завтра, время не хардкодим.
  const date = dateInTimeZone(1);
  const slotsResponse = await api.get(`/available-slots?typeId=${meetingType.id}&date=${date}`);
  expect(slotsResponse.ok()).toBeTruthy();
  const slots: Array<{ start_time: string; end_time: string; is_available: boolean }> =
    await slotsResponse.json();
  const slot = slots.find((candidate) => candidate.is_available);
  expect(slot, "на завтра должен быть хотя бы один свободный слот").toBeTruthy();
  if (!slot) throw new Error("нет свободных слотов на завтра");

  // 3. Гость: каталог → карточка типа встречи → дата → слот.
  await page.goto("/meeting-types");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: date }).click(); // либо data-testid="day-<date>"
  await page.getByRole("button", { name: timeLabel(slot.start_time) }).click();

  // 4. Форма гостя.
  await page.getByLabel("Имя").fill("Гость E2E");
  await page.getByLabel("Email").fill("guest-e2e@example.com");
  await page.getByRole("button", { name: "Подтвердить" }).click();

  // 5. Успех у гостя.
  await expect(page.getByRole("heading", { name: /записались|успешно/i })).toBeVisible();

  // 6. Владелец видит бронь в админке.
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: "guest-e2e@example.com" });
  await expect(row).toContainText(title);
  await expect(row).toContainText(timeLabel(slot.start_time));

  // 7. Постусловие на сервере, а не только в UI.
  const bookingsResponse = await api.get("/bookings");
  expect(bookingsResponse.ok()).toBeTruthy();
  expect(await bookingsResponse.json()).toContainEqual(
    expect.objectContaining({
      meeting_type_id: meetingType.id,
      guest_email: "guest-e2e@example.com",
      start_time: slot.start_time,
    }),
  );
});
```

Дополнительно стоит покрыть правило занятости на уровне API (когда контракт зафиксирует код
ответа, #7): второй `POST /bookings` на тот же интервал возвращает ошибку, а соседний слот,
начинающийся ровно в `end_time`, — успешно.

Замечания к сценарию:

- `getByLabel("Имя")`/`getByLabel("Email")` требуют настоящих `<label>`; если UI использует
  placeholder — `getByPlaceholder`, но label лучше для доступности.
- Карточка типа встречи должна быть ссылкой или кнопкой с доступным именем, содержащим `title`.
  Если это `<div onClick>` — тест выявит проблему доступности, и это правильно.
- Кнопки слотов должны иметь доступное имя с временем; иначе добавляем
  `data-testid={`slot-${slot.start_time}`}` и локатор `getByTestId`.
- Тест намеренно не проверяет «красивость» — только бизнес-результат и постусловие.

## 6. Что нужно добавить в репозиторий (чеклист реализации)

1. `pnpm add -D -w @playwright/test@^1.65.0` + обновлённый `pnpm-lock.yaml`.
2. `playwright.config.ts` в корне (раздел 1).
3. `e2e/fixtures.ts`, `e2e/smoke.spec.ts`, позже `e2e/booking.spec.ts`.
4. `mise.toml`: таски `e2e:install`, `test:e2e` (раздел 4).
5. `package.json` (корень): `"test:e2e": "mise run test:e2e"` для единообразия с остальными
   скриптами.
6. `.github/workflows/ci.yml`: job `e2e` (раздел 3). `hexlet-check.yml` не трогать.
7. `.gitignore`: `test-results/`, `playwright-report/`, `blob-report/`, `.playwright/`.
8. `AGENTS.md`/`README.md`: команда `mise run test:e2e`, требование `mise run e2e:install`,
   и явное «E2E не входит в `mise run check`».
9. Позже, при стабилизации: `projects` для webkit/firefox, `--shard` в CI, `workers` > 1 после
   появления изоляции данных на сервере.

## 7. Риски и подводные камни

| Риск                                              | Как обойти                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Порт 8081/5173 занят `mise run dev`               | отдельные порты 8091/5191 (раздел 1)                                                                             |
| Vite проксирует только фиксированный список путей | в E2E-режиме ходим напрямую через `VITE_API_BASE_URL`; новые эндпоинты в proxy не нужны                          |
| `go run` долго собирается на холодном кэше        | `timeout: 120_000` у webServer, а не дефолтные 60 с                                                              |
| `go run` не отвечает на SIGTERM как сервер        | `gracefulShutdown` + Playwright всё равно добивает группу процессов                                              |
| CORS-ошибка при прямых запросах                   | `CORS_ALLOWED_ORIGIN` = точный origin фронтенда (`http://127.0.0.1:5191`), middleware уже обрабатывает `OPTIONS` |
| Таймзона машины ≠ таймзона контракта              | даты считаем через `Intl` с явным `timeZone`, в конфиге — `timezoneId`                                           |
| 14-дневное окно и шаг 15 минут                    | дата `+1..3 дня`, слот из `GET /available-slots`                                                                 |
| Пересечение броней                                | `workers: 1`, уникальный тип встречи, первый свободный слот                                                      |
| Playwright обновился → браузеры не те             | `playwright install` после апгрейда; версия в lockfile                                                           |
| `mise run check` внезапно стал медленным          | E2E отдельной таской и отдельным CI job                                                                          |

## Источники

Документация Playwright (проверено 2026-11-13):

- Web server: `webServer`, массив серверов, `url`/`timeout`/`reuseExistingServer`/`cwd`/`env`,
  `gracefulShutdown`, `baseURL` — <https://playwright.dev/docs/test-webserver>
- Configuration (use): `baseURL`, `locale`, `timezoneId`, `trace`, `screenshot`, `video` —
  <https://playwright.dev/docs/test-use-options>
- API testing: `request` fixture, `request.newContext()`, сидирование и постусловия —
  <https://playwright.dev/docs/api-testing>
- Parallelism: `workers`, `fullyParallel`, serial, «state that lives outside a single test»,
  `testInfo.testId` — <https://playwright.dev/docs/test-parallel>
- Timeouts: тест 30 с, expect 5 с, `globalTimeout` — <https://playwright.dev/docs/test-timeouts>
- Continuous Integration: `playwright install --with-deps`, `workers: 1`, `globalTimeout`,
  GitHub Actions, кэш браузеров, `xvfb-run` — <https://playwright.dev/docs/ci>
- Browsers: установка браузеров и системных зависимостей, пути кэша, `--only-shell` —
  <https://playwright.dev/docs/browsers>
- Locators: приоритет role/label, `getByTestId` — <https://playwright.dev/docs/locators>
- Projects: несколько браузеров через `projects`, `--project` — <https://playwright.dev/docs/test-projects>
- Исходник webServer-плагина (мерж `env` с `process.env`, ошибка при занятом URL,
  `PLAYWRIGHT_TEST=1`) — <https://github.com/microsoft/playwright/blob/main/packages/playwright/src/plugins/webServerPlugin.ts>

Инструменты:

- mise tasks: `depends`, массив `run`, `env`, `raw_args`, `dir` — <https://mise.jdx.dev/tasks/task-configuration.html>
- hk builtins 2.12.0 (Playwright-шага нет) — <https://hk.jdx.dev/builtins.html>
- `@playwright/test` 1.65.0, `engines.node >= 20` — <https://registry.npmjs.org/@playwright/test/latest>

Репозиторий:

- `mise.toml` — таски и демоны `dev`, `check`, `test`
- `hk.pkl` — шаги `hk check`
- `.github/workflows/ci.yml` — единственный job `check`
- `frontend/package.json`, `package.json`, `pnpm-workspace.yaml`
- `frontend/vite.config.ts` — proxy и алиасы
- `frontend/src/config/env.ts`, `orval.config.ts` — `VITE_API_BASE_URL`
- `backend/cmd/server/main.go`, `backend/internal/config/config.go`,
  `backend/internal/httpapi/router.go` — порт, CORS, graceful shutdown, `/health`
- `spec/main.tsp` — контракт эндпоинтов
- `README.md` — правила слотов, окно 14 дней, таймзона, шаг
