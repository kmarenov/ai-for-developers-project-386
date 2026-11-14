# Календарь звонков

«Календарь звонков» — это упрощённый сервис бронирования времени по мотивам Cal.com.
Владелец календаря (один, задан заранее) настраивает типы встреч и просматривает расписание. Гость без регистрации выбирает тип встречи и бронирует свободный слот.

**Публичный демо-стенд:** [https://web-main-production-bb7a7b4d.up.railway.app](https://web-main-production-bb7a7b4d.up.railway.app)

## 🚀 Запуск и проверки

Для управления инструментами используется [mise](https://mise.jdx.dev/).

```bash
mise install
mise run setup
mise run dev
```

- Backend: http://localhost:8081
- Frontend: http://localhost:5173
- Все проверки: `mise run check`

`mise run dev` запускает оба сервиса в фоне и завершается; управление — `mise daemons status|logs|stop`. Порт backend переопределяется через `PORT`, разрешённый origin — через `CORS_ALLOWED_ORIGIN`. Подробности по командам и структуре — в [AGENTS.md](AGENTS.md).

### 🎭 E2E-тесты

```bash
mise run e2e:install   # один раз: скачать chromium
mise run test:e2e      # E2E на настоящих backend и frontend
```

- Playwright сам поднимает backend на `:8091` и frontend на `:5191` и гасит их после прогона, поэтому `mise run dev` на `:8081`/`:5173` можно не останавливать. `reuseExistingServer: false` гарантирует чистый in-memory backend на каждый прогон.
- `mise run check` запускает `hk check --all` и `mise run test:e2e`; `mise run check:fast` — только быстрые проверки без браузеров, её использует pre-commit.
- Конфиг — `playwright.config.ts` в корне, сценарии и фикстуры — `e2e/`. Прогон последовательный (`workers: 1`, только chromium), с обязательным `globalTimeout`.
- Отчёты и артефакты попадают в `playwright-report/` и `test-results/` и не коммитятся. В CI job `check` ставит chromium с системными зависимостями и складывает `playwright-report/` артефактом.
- Тесты ходят в настоящий API без моков; нужные данные готовятся через API в самих сценариях.

### 🐳 Docker

```bash
mise run build:docker
mise run test:docker
docker run --rm -p 8080:8080 -e PORT=8080 calendar-slot-code:local
```

`mise run test:docker` собирает образ, запускает его на нестандартном `SMOKE_PORT` (по умолчанию `18080`), проверяет `/health`, SPA и API, затем удаляет контейнер.

Полноценный образ собирает SPA и Go API в один контейнер: nginx отдаёт фронтенд и проксирует API на внутренний `:8081`, наружу смотрит `$PORT` (по умолчанию `8080`). Этот же `Dockerfile` использует hexlet-check.

### 🌐 Деплой на Railway

Стенд развёрнут на [Railway](https://railway.com/) из этого репозитория:

- **Публичный URL:** https://web-main-production-bb7a7b4d.up.railway.app
- **Сборка:** корневой `Dockerfile`; Railway не использует собственный билдер.
- **Порт:** платформа передаёт `PORT`, приложение слушает его. Локально значение по умолчанию — `8080`.
- **Healthcheck:** `GET /health`.
- **Конфигурация:** `railway.json` (Dockerfile, healthcheck, рестарты, без засыпания) и `opencode.json` (MCP).

Проверить стенд:

```bash
curl -fsS https://web-main-production-bb7a7b4d.up.railway.app/health
curl -fsS https://web-main-production-bb7a7b4d.up.railway.app/config
```

### 🔌 MCP для деплоя

В репозитории лежит проектная конфигурация OpenCode — `opencode.json` с remote MCP Railway. Секретов в ней нет, только URL.

Порядок подключения:

1. Установите зависимости и откройте OpenCode в корне репозитория:

   ```bash
   mise install
   ```

2. В OpenCode выполните `/mcps`, выберите `railway` и пройдите OAuth-вход в браузере.
3. Проверьте подключение:

   ```bash
   opencode mcp list
   ```

   Ожидается `railway connected`.

4. Попросите агента выполнить деплой. Агент использует MCP-инструменты Railway: создание проекта и сервиса из GitHub-репозитория, настройка healthcheck, генерация домена, чтение логов и статуса.

Точная последовательность MCP-вызовов, известные ограничения и команды приёмки — в [docs/deploy.md](docs/deploy.md).

OAuth-токены хранятся в данных OpenCode вне репозитория. Файлы `.env` и `.env.*` исключены из Git; `.env.example` — безопасный шаблон на случай перехода на `RAILWAY_API_TOKEN` вместо OAuth.

### 💾 Данные на публичном стенде

Бэкенд хранит типы встреч и брони в памяти процесса. После **любого перезапуска или redeploy** контейнера на Railway данные сбрасываются: типы встреч и записи исчезают. Базы данных и постоянного хранилища нет.

После деплоя создайте демо-тип встречи заново:

```bash
curl -fsS -X POST https://web-main-production-bb7a7b4d.up.railway.app/meeting-types \
  -H 'Content-Type: application/json' \
  -d '{"title":"Демо-встреча 30 минут","description":"Проверка публичного стенда","duration_minutes":30}'
```

## 🛠 Технологический стек

### Backend

| Компонент                 | Технология                                         |
| :------------------------ | :------------------------------------------------- |
| **Язык**                  | Go                                                 |
| **HTTP-сервер и роутинг** | `net/http` + `http.ServeMux`                       |
| **JSON**                  | `encoding/json`                                    |
| **Логирование**           | `log/slog`                                         |
| **Конфигурация**          | `os.Getenv`                                        |
| **Синхронизация**         | `sync` (Mutex/RWMutex для защиты In-Memory данных) |
| **Тестирование**          | `testing` + `httptest`                             |
| **API Контракт**          | TypeSpec -> OpenAPI                                |
| **Хранение данных**       | В оперативной памяти процесса (In-Memory)          |

#### Архитектурные принципы (Backend)

- **Standard Library First** — минимум внешних зависимостей.
- **Modular Monolith** — организация кода по бизнес-модулям.
- **Explicit Dependency Injection** — зависимости через конструкторы.
- **Thin Handlers** — отделение HTTP-слоя от бизнес-логики.
- **Simplicity over Abstraction** — интерфейсы и абстракции только по необходимости.
- **Middleware** — обязательное использование CORS-мидлвари для взаимодействия с фронтендом.

### Frontend

| Компонент               | Технология          | Назначение                              |
| :---------------------- | :------------------ | :-------------------------------------- |
| **UI-фреймворк**        | React               | Компонентная архитектура                |
| **Язык**                | TypeScript          | Строгая типизация                       |
| **Сборка**              | Vite                | Разработка и production-сборка          |
| **Маршрутизация**       | React Router        | Навигация и маршруты                    |
| **UI-компоненты**       | shadcn/ui           | Основа собственной дизайн-системы       |
| **Стили**               | Tailwind CSS        | Адаптивная стилизация                   |
| **Иконки**              | Lucide              | Единый набор иконок                     |
| **API-клиент**          | Orval               | Генерация клиента из OpenAPI            |
| **Серверное состояние** | TanStack Query      | Запросы, кеширование, обновление данных |
| **Работа с датами**     | `date-fns`          | Форматирование, парсинг и таймзоны      |
| **Формы**               | React Hook Form     | Управление формами                      |
| **Валидация**           | Zod                 | Проверка пользовательского ввода        |
| **Тестирование**        | Vitest + Playwright | Модульные и E2E-тесты                   |

`date-fns` (вместе с `@date-fns/tz`) форматирует даты и время в таймзоне владельца из `GET /config`, React Hook Form управляет формой записи, Zod проверяет имя и email по правилам контракта.

## 🚢 Релизы

Релизы ведёт [release-please](https://github.com/googleapis/release-please) в manifest-режиме: workflow `.github/workflows/release-please.yml` запускается по `push` в `main`, конфиг — `release-please-config.json`, текущие версии — `.release-please-manifest.json`. Пакетов два: `frontend` (`release-type: node`, версия в `frontend/package.json`) и `backend` (`release-type: go`, только `backend/CHANGELOG.md`). `spec/` отдельно не версионируется и уезжает вместе с `frontend`.

- Текущая версия — `1.0.0`. При манифесте `0.0.0` release-please-action v5 выпустил `1.0.0`; чтобы начать с `0.1.0`, задайте `initial-version` до первого релиза. Дальше `feat` двигает minor, `fix`/`perf` — patch.
- Теги: `frontend-vX.Y.Z` и `backend/vX.Y.Z` — слэш у Go нужен, чтобы тег работал как тег подмодуля (`tag-separator: "/"`).
- Один релизный PR `chore: release main` обновляет оба пакета и манифест.
- Заголовки PR при squash-мерже должны быть conventional: в `main` попадает именно заголовок PR, и release-please парсит его как коммит.

Чтобы workflow мог создавать PR, в настройках репозитория должно быть включено **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. Без этой опции запуск падает на создании релизного PR.

## ⚠️ Ограничения и правила работы

- **Хранение данных:** База данных не используется. Все данные (типы встреч и бронирования) хранятся в памяти. **При перезапуске сервера все записи сбрасываются**, в том числе при restart или redeploy контейнера на Railway.
- **Отсутствие интеграций:** Нет авторизации, личных кабинетов, уведомлений и синхронизации с внешними календарями (Google Calendar, Outlook и т.д.).
- **Правила слотов и бронирования:**
  - Окно записи: 14 календарных дней (сдвигается динамически с течением времени).
  - Пересечение интервалов строго запрещено (включая частичное наложение разных типов встреч).
  - Следующая встреча может начаться ровно в момент окончания предыдущей.
  - Защита от состояния гонки (race condition): правила пересечения интервалов действуют и для двух запросов, пришедших одновременно (проверка занятости и вставка брони выполняются в одной критической секции под `sync.RWMutex` на бэкенде).
  - Рабочие часы — 09:00–18:00, часовой пояс владельца — Europe/Moscow.
  - Шаг доступных стартов фиксируется в спецификации (например, каждые 15 минут).
  - Длительность слота совпадает с длительностью выбранного типа встречи.

---

## 📖 Пользовательские сценарии

### 👤 Сценарий Владельца (Администратора)

1.  **Публикация типа встречи:** формы создания в админке нет. Владелец создаёт тип встречи запросом `POST /meeting-types` (см. curl-демо ниже), после чего тип появляется в каталоге для гостей.
2.  **Просмотр записей:** В разделе «Админка» (`/admin`) владелец видит список предстоящих встреч, сгруппированных по дням: название и длительность типа, интервал времени, имя гостя и его email. Список обновляется автоматически.

### 🚶 Сценарий Гостя

1.  **Главная страница:** Гость открывает приложение и видит приветственный экран с кнопкой «Записаться».
2.  **Каталог встреч:** Гость попадает на страницу со списком доступных типов встреч. Нажимает на карточку, например, «Встреча 15 минут».
3.  **Выбор даты и времени:**
    - Открывается календарь на ближайшие 14 дней.
    - Гость выбирает день.
    - Система запрашивает свободные слоты у бэкенда и отображает их (с учетом занятости и рабочих часов).
    - Гость выбирает свободное время (например, 09:45 – 10:00).
4.  **Оформление записи:** Гость вводит свои данные (Имя, Email) и нажимает «Записаться».
5.  **Успех:** Гость видит экран успешной записи. Созданная бронь немедленно появляется в списке предстоящих встреч у Владельца.

---

## 🔌 Требования к API и Контракту

В `TypeSpec` контракте заданы модели и роуты, из которых генерируется `openapi.yaml`. На основе этой спецификации с помощью **Orval** генерируется типизированный API-клиент для фронтенда.

**Основные модели:**

- `HealthResponse`: `status`.
- `ConfigResponse`: `timezone`, `working_hours_start`, `working_hours_end`, `slot_step_minutes`, `booking_window_days`, `today`.
- `MeetingType`: `id`, `title`, `description`, `duration_minutes`.
- `CreateMeetingTypeRequest`: `title`, `description`, `duration_minutes` (без `id`).
- `TimeSlot`: `start_time`, `end_time` — только свободные слоты, без `is_available`.
- `Booking`: `id`, `meeting_type_id`, `start_time`, `end_time`, `guest_name`, `guest_email`.
- `CreateBookingRequest`: `meeting_type_id`, `start_time`, `guest_name`, `guest_email` (без `end_time`).
- `ErrorResponse`: `{code, message}`; `code` — закрытый union: `invalid_request`, `invalid_slot`, `meeting_type_not_found`, `slot_taken`, `not_found`, `method_not_allowed`, `internal_error`.

**Основные эндпоинты:**

| Метод  | Путь                                      | Успех | Ошибки                                                                                           |
| :----- | :---------------------------------------- | :---- | :----------------------------------------------------------------------------------------------- |
| `GET`  | `/health`                                 | `200` | `500`                                                                                            |
| `GET`  | `/config`                                 | `200` | `500`                                                                                            |
| `GET`  | `/meeting-types`                          | `200` | `500`                                                                                            |
| `POST` | `/meeting-types`                          | `201` | `400 invalid_request`, `500`                                                                     |
| `GET`  | `/available-slots?meeting_type_id={uuid}` | `200` | `400 invalid_request`, `404 meeting_type_not_found`, `500`                                       |
| `GET`  | `/bookings`                               | `200` | `500`                                                                                            |
| `POST` | `/bookings`                               | `201` | `400 invalid_request`, `404 meeting_type_not_found`, `400 invalid_slot`, `409 slot_taken`, `500` |

### 🧪 curl-демо каталога

После `mise run dev` (на свежем сервере стор в памяти пуст):

```bash
# 1. Пустой список типов встреч
curl -s http://localhost:8081/meeting-types
# []

# 2. Создание типа встречи: title тримится, сервер выдаёт UUID v4
curl -s -X POST http://localhost:8081/meeting-types \
  -H 'Content-Type: application/json' \
  -d '{"title":"  Встреча 30 минут  ","description":"Обсудим проект","duration_minutes":30}'
# {"id":"<uuid-v4>","title":"Встреча 30 минут","description":"Обсудим проект","duration_minutes":30}

# 3. Список с созданным типом
curl -s http://localhost:8081/meeting-types

# 4. Ошибка валидации — 400 invalid_request
curl -s -w '\n%{http_code}\n' -X POST http://localhost:8081/meeting-types \
  -H 'Content-Type: application/json' \
  -d '{"title":"","description":"","duration_minutes":4}'
# {"code":"invalid_request","message":"Некорректные данные типа встречи"}
# 400

# 5. Неподдерживаемый метод — 405 method_not_allowed
curl -s -w '\n%{http_code}\n' -X PUT http://localhost:8081/meeting-types
# {"code":"method_not_allowed","message":"Метод не поддерживается"}
# 405

# 6. Неизвестный путь — 404 not_found
curl -s -w '\n%{http_code}\n' http://localhost:8081/unknown
# {"code":"not_found","message":"Ресурс не найден"}
# 404
```
