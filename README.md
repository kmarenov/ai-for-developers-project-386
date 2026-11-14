# Календарь звонков

«Календарь звонков» — это упрощённый сервис бронирования времени по мотивам Cal.com.
Владелец календаря (один, задан заранее) настраивает типы встреч и просматривает расписание. Гость без регистрации выбирает тип встречи и бронирует свободный слот.

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

`date-fns`, React Hook Form и Zod указаны как целевой стек и подключаются на следующих шагах. В каркасе уже работают React, Vite, React Router, shadcn/ui, Tailwind CSS, Lucide, Orval, TanStack Query, Vitest и Playwright (E2E).

## 🚢 Релизы

Релизы ведёт [release-please](https://github.com/googleapis/release-please) в manifest-режиме: workflow `.github/workflows/release-please.yml` запускается по `push` в `main`, конфиг — `release-please-config.json`, текущие версии — `.release-please-manifest.json`. Пакетов два: `frontend` (`release-type: node`, версия в `frontend/package.json`) и `backend` (`release-type: go`, только `backend/CHANGELOG.md`). `spec/` отдельно не версионируется и уезжает вместе с `frontend`.

- Стартовая версия — `0.0.0`, поэтому первый `feat` даёт `0.1.0` (`bump-minor-pre-major`); `fix`/`perf` дают patch.
- Теги: `frontend-vX.Y.Z` и `backend/vX.Y.Z` — слэш у Go нужен, чтобы тег работал как тег подмодуля (`tag-separator: "/"`).
- Один релизный PR `chore: release main` обновляет оба пакета и манифест.
- Заголовки PR при squash-мерже должны быть conventional: в `main` попадает именно заголовок PR, и release-please парсит его как коммит.

Чтобы workflow мог создавать PR, в настройках репозитория должно быть включено **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. Без этой опции запуск падает на создании релизного PR.

## ⚠️ Ограничения и правила работы

- **Хранение данных:** База данных не используется. Все данные (типы встреч и бронирования) хранятся в памяти. **При перезапуске сервера все записи сбрасываются.**
- **Отсутствие интеграций:** Нет авторизации, личных кабинетов, уведомлений и синхронизации с внешними календарями (Google Calendar, Outlook и т.д.).
- **Правила слотов и бронирования:**
  - Окно записи: 14 календарных дней (сдвигается динамически с течением времени).
  - Пересечение интервалов строго запрещено (включая частичное наложение разных типов встреч).
  - Следующая встреча может начаться ровно в момент окончания предыдущей.
  - Защита от состояния гонки (race condition): правила пересечения интервалов действуют и для двух запросов, пришедших одновременно (реализуется через `sync.Mutex` на бэкенде).
  - Рабочие часы — 09:00–18:00, часовой пояс владельца — Europe/Moscow.
  - Шаг доступных стартов фиксируется в спецификации (например, каждые 15 минут).
  - Длительность слота совпадает с длительностью выбранного типа встречи.

---

## 📖 Пользовательские сценарии

### 👤 Сценарий Владельца (Администратора)

1.  **Создание типа встречи:** Владелец переходит в раздел «Админка» (`/admin`). Нажимает «Создать тип встречи».
2.  **Заполнение данных:** Указывает название (например, «Встреча 15 минут»), описание и длительность (15 или 30 минут).
3.  **Сохранение:** Тип встречи сохраняется в системе и становится доступным на главной странице для гостей.
4.  **Просмотр записей:** В админке владелец видит список всех предстоящих встреч (дата, время, тип встречи, данные гостя), отсортированных по времени начала.

### 🚶 Сценарий Гостя

1.  **Главная страница:** Гость открывает приложение и видит приветственный экран с кнопкой «Записаться».
2.  **Каталог встреч:** Гость попадает на страницу со списком доступных типов встреч. Нажимает на карточку, например, «Встреча 15 минут».
3.  **Выбор даты и времени:**
    - Открывается календарь на ближайшие 14 дней.
    - Гость выбирает день.
    - Система запрашивает свободные слоты у бэкенда и отображает их (с учетом занятости и рабочих часов).
    - Гость выбирает свободное время (например, 09:45 – 10:00).
4.  **Оформление записи:** Гость вводит свои данные (Имя, Email, возможно, комментарий) и нажимает «Подтвердить».
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
