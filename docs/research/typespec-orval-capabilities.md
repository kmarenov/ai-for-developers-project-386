# TypeSpec и Orval: валидация и ошибки

Research-тикет: [#12](https://github.com/kmarenov/ai-for-developers-project-386/issues/12).
Дата: 2026-11-13.

Вопрос: что реально умеют TypeSpec и Orval в этом репозитории для валидации полей и
описания ошибок — и где валидация остаётся только на сервере.

## Как получены факты

Всё ниже проверено на локальных версиях, а не пересказано по вторичным статьям:

| Компонент                           | Версия | Где зафиксирована                                                                     |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| TypeSpec compiler / http / openapi3 | 1.18.0 | `spec/package.json`                                                                   |
| OpenAPI                             | 3.1.0  | `spec/tspconfig.yaml` (`openapi-versions: ["3.1.0"]`)                                 |
| Orval                               | 8.47.0 | `package.json` (`orval: ^8.47.0`), установлен 8.47.0                                  |
| TanStack Query                      | 5.x    | `orval.config.ts` (`override.query.version: 5`), `frontend/package.json` (`^5.107.1`) |

Метод: (1) чтение локального контракта и сгенерированного клиента; (2) компиляция
экспериментальных `.tsp` тем же компилятором 1.18.0 и просмотр полученного
`openapi.yaml`; (3) прогон Orval 8.47.0 по экспериментальной спецификации с
`400/404/409` и ограничениями полей и просмотр сгенерированного кода. Эксперименты
делались во временном каталоге, контракт репозитория не менялся.

## TL;DR

1. Ограничения полей в TypeSpec **работают** и попадают в `openapi.yaml`:
   `@minLength`/`@maxLength` → `minLength`/`maxLength`, `@minValue`/`@maxValue` →
   `minimum`/`maximum`, `@pattern` → `pattern`, `@format` → `format`.
2. Ответы `400/404/409` описываются через union с `@statusCode` (или через
   `BadRequestResponse`/`NotFoundResponse`/`ConflictResponse`) и **полностью
   попадают** в OpenAPI — с нужными кодами и схемами тела.
3. Orval из этих ограничений **не делает валидаторов**: в TypeScript-типах
   `@minLength`/`@pattern`/`@format` исчезают (остаётся `string`/`number`).
   Валидаторы появляются только если отдельно включить `client: 'zod'`.
4. Объявленные ответы ошибок дают Orval **типы** (`createBookingResponse400`,
   `CreateBookingMutationError = ErrorResponse`), но **не меняют рантайм**: по
   умолчанию fetch-клиент не бросает исключение на 4xx/5xx, а возвращает
   `{ data, status, headers }`. Чтобы ошибки доходили до TanStack Query, нужен
   `override.fetch.forceSuccessResponse: true` (или ручная проверка `status`).
5. Кросс-полевые и динамические правила (пересечение интервалов, окно 14 дней,
   рабочие часы, шаг слотов, «конец = начало + duration») в TypeSpec/OpenAPI
   выразить нельзя — они остаются на сервере в любом случае.

## 1. TypeSpec: ограничения полей

### 1.1 Что поддерживается

Декораторы стандартной библиотеки TypeSpec
([Built-in Decorators](https://typespec.io/docs/standard-library/built-in-decorators/))
и их отображение в OpenAPI 3.1 (проверено компиляцией `@typespec/openapi3` 1.18.0):

| TypeSpec                                    | OpenAPI 3.1                                     | Проверено       |
| ------------------------------------------- | ----------------------------------------------- | --------------- |
| `@minLength(n)`                             | `minLength: n`                                  | да              |
| `@maxLength(n)`                             | `maxLength: n`                                  | да              |
| `@minValue(n)` / `@maxValue(n)`             | `minimum` / `maximum`                           | да (на `int32`) |
| `@minValueExclusive` / `@maxValueExclusive` | `exclusiveMinimum` / `exclusiveMaximum`         | по докам        |
| `@pattern("...")`                           | `pattern: ...`                                  | да              |
| `@format("email")`                          | `format: email`                                 | да              |
| `@minItems(n)` / `@maxItems(n)`             | `minItems` / `maxItems`                         | по докам        |
| `@doc("...")`                               | `description` (на модели и на поле)             | да              |
| `@error`                                    | помечает модель как ошибку для `@typespec/http` | да              |
| `@statusCode`                               | ключ ответа в `responses`                       | да              |

Пример для нашего `MeetingType`:

```tsp
model MeetingType {
  id: string;

  @minLength(1)
  @maxLength(100)
  title: string;

  @maxLength(500)
  description: string;

  @minValue(5)
  @maxValue(240)
  duration_minutes: int32;
}
```

Разворачивается в:

```yaml
MeetingType:
  type: object
  required: [id, title, description, duration_minutes]
  properties:
    id: { type: string }
    title: { type: string, minLength: 1, maxLength: 100 }
    description: { type: string, maxLength: 500 }
    duration_minutes: { type: integer, format: int32, minimum: 5, maximum: 240 }
```

### 1.2 Что не поддерживается или не сохраняется

- **`@multipleOf` в TypeSpec 1.18.0 отсутствует.** Компилятор: `Unknown decorator
  @multipleOf`. Шаг «кратно 5/15 минутам» в контракт так не записать — только
  `@minValue/@maxValue` плюс серверная проверка (или `enum` допустимых значений,
  если набор фиксированный).
- **`@format` — это подсказка, а не валидация.** В документации прямо сказано:
  «The format names are open ended and are left to emitter to interpret». В
  JSON Schema `format` относится к annotation vocabulary и по умолчанию не
  является утверждением, которое обязано проверяться
  ([JSON Schema Validation, §7.2](https://json-schema.org/draft/2020-12/json-schema-validation#name-vocabularies-for-semantic-c)).
  `format: email` не мешает отправить `"not-an-email"` — ни TypeSpec, ни OpenAPI,
  ни Orval это не проверят.
- **`@format` нельзя повесить на `utcDateTime`.** `@format("date-time")` на
  `utcDateTime` даёт `decorator-wrong-target: Cannot apply @format decorator to
  type it is not a string`. Для дат формат выставляется самим типом
  (`utcDateTime` → `type: string, format: date-time`).
- **`@pattern` — упрощённый regex.** Разрешены альтернация, квантификаторы,
  `.` и группы; look-around, capture-группы и backreferences **не
  поддерживаются** ([документация `@pattern`](https://typespec.io/docs/standard-library/built-in-decorators/#@pattern)).
  Значит, «полный» email-regex туда не влезет — только простой.
- **`@minValue` на `utcDateTime` до OpenAPI не доходит.** Проверено:
  `@minValue(utcDateTime.fromISO("2026-01-01T00:00:00Z"))` на `start_time:
  utcDateTime` компилируется без ошибок, но в схеме остаётся только
  `type: string, format: date-time` — `minimum` не появляется. Для окна
  бронирования это и не помогло бы: граница скользящая (см. §4).
- **`@doc`/`@summary`/`@errorsDoc` доступны без установки `@typespec/openapi`.**
  В `spec/node_modules` есть только `compiler`, `http`, `openapi3`;
  `import "@typespec/openapi"` падает с `import-not-found`, но `@doc` работает.
  При этом `@errorsDoc` на операцию **не** меняет `description` у ответов
  `4xx` в `openapi.yaml` — описания остаются дефолтными от `@typespec/http`
  («The server could not understand the request due to invalid syntax» и т.п.).

### 1.3 Текущее состояние нашего контракта

`spec/main.tsp` не содержит ни одного ограничения: все поля — «голые»
`string`/`int32`/`utcDateTime`. В `spec/openapi.yaml` из валидационных ключей
есть только `format: date-time` и `format: int32`, которые TypeSpec выводит из
самих типов. `ErrorResponse` объявлен, но **не используется ни в одной
операции** — в OpenAPI он попадает в `components.schemas`, а в сгенерированном
клиенте `frontend/src/api/generated/model/errorResponse.ts` импортируется только
барелем `model/index.ts` и ни одним хуком.

## 2. TypeSpec: модели ошибок и ответы 400/404/409

### 2.1 Рабочий синтаксис

Два равнозначных по результату способа. Первый — union с `@statusCode`:

```tsp
@error
model ErrorResponse {
  message: string;
  code?: string;
}

@route("/bookings")
@post
op createBooking(@body body: CreateBookingRequest):
  | { @statusCode _: 201; @body body: Booking }
  | { @statusCode _: 400; @body body: ErrorResponse }
  | { @statusCode _: 404; @body body: ErrorResponse }
  | { @statusCode _: 409; @body body: ErrorResponse };
```

Второй — готовые модели из `@typespec/http`
([HTTP data types](https://typespec.io/docs/libraries/http/reference/data-types/)),
короче и с человеческими описаниями:

```tsp
op createBooking(@body body: CreateBookingRequest):
  | (CreatedResponse & Booking)
  | (BadRequestResponse & ErrorResponse)
  | (NotFoundResponse & ErrorResponse)
  | (ConflictResponse & ErrorResponse);
```

Оба варианта дают в `openapi.yaml` одинаковую структуру:

```yaml
responses:
  "201":
    {
      description: The request has succeeded and a new resource has been created as a result.,
      content: { application/json: { schema: { $ref: "#/components/schemas/Booking" } } },
    }
  "400":
    {
      description: The server could not understand the request due to invalid syntax.,
      content: { application/json: { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
    }
  "404": { ... }
  "409": { ... }
```

`@error` на модели сам по себе **не** создаёт ответы — он лишь помечает тип как
ошибочный для `@typespec/http`. Коды задаются `@statusCode` (или
`*Response`-моделями).

### 2.2 Пример для остальных операций контракта

```tsp
// 400 — невалидное тело/параметры
op createMeetingType(@body body: CreateMeetingTypeRequest):
  | (CreatedResponse & MeetingType)
  | (BadRequestResponse & ErrorResponse);

// 400 + 404: неизвестный typeId
op listAvailableSlots(@query typeId: string, @query date: string):
  | TimeSlot[]
  | (BadRequestResponse & ErrorResponse)
  | (NotFoundResponse & ErrorResponse);

// 409 — слот уже занят (пересечение интервалов)
```

Отдельно стоит решить, нужен ли `code` в `ErrorResponse` (`"slot_taken"`,
`"outside_window"`, …): машиночитаемый код — единственный способ отличить
разные `409` друг от друга на клиенте, потому что статус у них один.

### 2.3 Что важно помнить про 201

Сейчас `POST /bookings` и `POST /meeting-types` в OpenAPI возвращают **200**,
потому что TypeSpec по умолчанию ставит `200` на успешный ответ. Если менять
контракт на `201 Created`, это надо сделать явно (`CreatedResponse` или
`@statusCode _: 201`); сгенерированный Orval-клиент тогда будет типизировать
успех как `{ data: Booking; status: 201 }`.

## 3. Orval: что получается из OpenAPI

### 3.1 Типы

Для каждой `components.schemas`-модели генерируется `interface` в
`frontend/src/api/generated/model/<name>.ts` (у нас `mode: "split"`,
`schemas: "./frontend/src/api/generated/model"`). Для query-параметров —
отдельный тип (`listAvailableSlotsParams.ts`).

Ограничения из OpenAPI **не переносятся**:

```ts
// frontend/src/api/generated/model/meetingType.ts (после добавления @minLength/@maxLength)
export interface MeetingType {
  id: string;
  title: string; // minLength/maxLength потеряны
  description: string;
  duration_minutes: number; // minimum/maximum потеряны
}
```

`format: date-time` тоже превращается просто в `string`; `format: email` — в
`string`. Никаких branded-типов Orval не делает.

### 3.2 Функции и рантайм-поведение

Fetch-клиент Orval возвращает конверт, а не данные:

```ts
export type createBookingResponse200 = { data: Booking; status: 200 }

export const createBooking = async (body: CreateBookingRequest, options?: RequestInit)
  : Promise<createBookingResponse> => { ... }

  const data: createBookingResponse['data'] = body ? JSON.parse(body) : {}
  return { data, status: res.status, headers: res.headers } as createBookingResponse
```

Ключевое: в сгенерированном коде **нет** `if (!res.ok) throw`. Это не баг
нашего контракта, а дефолт Orval:

- `override.fetch.includeHttpResponseReturnType` — **default `true`**: статус
  попадает в возвращаемый тип;
- `override.fetch.forceSuccessResponse` — **default `false`**: «Throw on error
  responses instead of returning them»
  ([Output reference, override.fetch](https://orval.dev/docs/reference/configuration/output#forcesuccessresponse));
  в исходниках `@orval/fetch@8.47.0` (`dist/index.mjs`, функция `execute`)
  проверка выглядит как `if (args.throwOnError && !res.ok)`, а `throwOnError:
  true` эмитится только при `forceSuccessResponse`.

Практическое следствие для нашего кода: `useListAvailableSlots` при `404`
**успешно** резолвится с `{ data: <тело ответа или {}>, status: 404 }` —
TanStack Query считает запрос успешным, `error` пустой, UI покажет «нет слотов»
вместо ошибки. А если сервер вернёт не-JSON тело (например, `404 page not found`
от `http.ServeMux`), `JSON.parse` бросит `SyntaxError` — ошибка появится, но
бессмысленная и нетипизированная.

### 3.3 Что дают объявленные ответы ошибок

Проверено прогоном Orval по спеке с `201/400/404/409`. Orval генерирует
дискриминированный union и корректный `TError`:

```ts
export type createBookingResponse201 = { data: Booking; status: 201 }
export type createBookingResponse400 = { data: ErrorResponse; status: 400 }
export type createBookingResponse404 = { data: ErrorResponse; status: 404 }
export type createBookingResponse409 = { data: ErrorResponse; status: 409 }

export type createBookingResponseSuccess = createBookingResponse201 & { headers: Headers }
export type createBookingResponseError   = (createBookingResponse400 | createBookingResponse404 | createBookingResponse409) & { headers: Headers }
export type createBookingResponse        = createBookingResponseSuccess | createBookingResponseError

export type CreateBookingMutationError = ErrorResponse
export const useCreateBooking = <TError = ErrorResponse, ...>(...)
```

То есть **типы** становятся точными: `data` сужается по `status`, `TError` —
`ErrorResponse` вместо `unknown`. Но **рантайм не меняется**: без
`forceSuccessResponse` функция по-прежнему возвращает конверт и не бросает.
`onError` у мутации на 409 не сработает.

### 3.4 Как включить настоящие ошибки

```ts
// orval.config.ts
override: {
  query: { version: 5 },
  fetch: { forceSuccessResponse: true }, // включит `if (!res.ok) throw`
},
```

С этой опцией генерируется:

```ts
if (!res.ok) {
  const err: Error & { info?: createBookingResponseError["data"]; status?: number } = new Error();
  err.info = body ? JSON.parse(body) : {};
  err.status = res.status;
  throw err;
}
```

Дальше:

- `useCreateBooking` (мутация) — `onError` получает `Error` с `.status` и
  `.info` (тело `ErrorResponse`). Мутации TanStack Query по умолчанию не
  ретраятся (`retry: 0`,
  [useMutation](https://tanstack.com/query/latest/docs/framework/react/reference/useMutation)),
  так что 409 сразу доходит до UI.
- `useListAvailableSlots` / `useListBookings` (запросы) — TanStack Query по
  умолчанию ретраит упавший запрос **3 раза** с экспоненциальной задержкой
  ([Query Retries](https://tanstack.com/query/latest/docs/framework/react/guides/query-retries)).
  Для `404`/`409` это лишние 3 запроса; нужен `retry: (count, err) => err.status >= 500 && count < 2`.
- Обратная сторона: с `forceSuccessResponse` клиент обязан всегда возвращать
  JSON-тело ошибки. Пустой `409` без тела даст `err.info = {}` — это нормально,
  а вот HTML/plain-text тело снова приведёт к `SyntaxError` внутри обработчика
  ошибки. Поэтому сервер должен отвечать `ErrorResponse` на всех `4xx`.

### 3.5 Хуки TanStack Query

На каждый `operationId` генерируется:

- `GET` → `useXxxQueryKey`, `getXxxQueryOptions`, `useXxx` (перегрузки под
  `initialData`);
- `POST` → `useXxx` мутация + `getXxxMutationOptions`, `getXxxMutationKey`,
  `XxxMutationVariables = { data: Body }`;
- `queryKey` включает `baseUrl` и параметры: `[`${env.apiBaseUrl}/available-slots`, params]`
  — то есть кэш инвалидируется при смене `typeId`/`date` автоматически.

Query-параметры в `useListAvailableSlots` типизированы как `string` (наш
`date` — `string`, а не `format: date`), значения прогоняются через
`String(value)` и `URLSearchParams`. Никакой проверки формата даты клиент не
делает.

### 3.6 Zod: единственный способ получить клиентскую валидацию из контракта

Orval умеет генерировать Zod-схемы из тех же ограничений
([Zod guide](https://orval.dev/docs/guides/zod)). Проверено на нашей
экспериментальной спеке:

```ts
export const createBookingBodyGuestNameRegExp = new RegExp('^[A-Za-z ]{1,100}$');

export const CreateBookingBody = zod.object({
  meeting_type_id: zod.string(),
  start_time: zod.iso.datetime({ offset: true }),
  guest_name: zod.string().regex(createBookingBodyGuestNameRegExp),
  guest_email: zod.email(),
})

export const createMeetingTypeBodyTitleMax = 100;
export const createMeetingTypeBodyDurationMinutesMin = 5;
export const createMeetingTypeBodyDurationMinutesMax = 240;

export const CreateMeetingTypeBody = zod.object({
  title: zod.string().min(1).max(createMeetingTypeBodyTitleMax),
  description: zod.string().max(createMeetingTypeBodyDescriptionMax),
  duration_minutes: zod.number().min(...).max(...),
})
```

Важные детали:

- Zod-схемы генерируются **отдельным output** с `client: 'zod'`; для
  React Query-клиента это второй блок в `orval.config.ts` (паттерн
  [Client with Zod](https://orval.dev/docs/guides/client-with-zod)), например с
  `fileExtension: '.zod.ts'` и `target` рядом с клиентом.
- Нужна зависимость `zod`: в `frontend/package.json` её **сейчас нет**
  (README числит Zod как целевой стек, но пакет не установлен). Orval 8.47.0
  сам тянет zod как peer/optional — в `node_modules/.pnpm` он есть, но
  импортировать его из приложения нельзя, пока он не добавлен в `frontend`.
- Есть `override.fetch.runtimeValidation` — валидация **ответов** на рантайме
  (`Schema.parse()`), требует `schemas: { type: 'zod' }` или `valibot`
  ([Output reference, runtimeValidation](https://orval.dev/docs/reference/configuration/output#runtimevalidation-2)).
  Для валидации **форм** это не нужно — достаточно схем из `client: 'zod'` и
  React Hook Form + `zodResolver` (когда RHF появится).
- Сгенерированные Zod-схемы описывают **форму запроса/ответа**, а не бизнес-
  правила: они не знают про пересечение броней и окно в 14 дней.

## 4. Где валидация на клиенте невозможна

Эти правила нельзя выразить ни в TypeSpec, ни в OpenAPI, ни, соответственно,
получить в Orval. Они остаются на сервере и должны проверяться под `sync.Mutex`:

| Правило                                     | Почему не в контракте                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Пересечение интервалов броней               | Зависит от состояния всех броней; JSON Schema не умеет межзаписные ограничения                                                                       |
| «Конец = начало + duration_minutes»         | Кросс-полевое ограничение внутри одного объекта; в TypeSpec нет декоратора для этого                                                                 |
| Окно 14 дней от «сегодня»                   | Граница скользящая, зависит от серверного времени; статический `minimum`/`maximum` невозможен (и `@minValue` на `utcDateTime` до OpenAPI не доходит) |
| Рабочие часы 09:00–18:00 Asia/Yekaterinburg | Зависит от таймзоны и от даты (DST/смещения), это вычисление, а не схема                                                                             |
| Шаг слотов 15 минут                         | В TypeSpec 1.18 нет `@multipleOf`; можно только `enum` при фиксированном наборе                                                                      |
| Существование `meeting_type_id`             | Требует чтения хранилища → это `404`, а не `400`                                                                                                     |
| Уникальность/гонки при одновременных POST   | Только сервер, под мьютексом → `409`                                                                                                                 |
| `format: email` как реальная проверка       | `format` — аннотация; проверять надо Zod-схемой на клиенте и сервером                                                                                |

Что действительно можно продублировать на клиенте без риска расхождений:
`minLength`/`maxLength` для `title`/`description`, диапазон
`duration_minutes`, простой `pattern` для `guest_name`, `email`-формат,
«дата в пределах 14 дней» (относительно локального «сегодня» — но истина всё
равно за сервером).

## 5. Рекомендации для нашего контракта

1. **Добавить ограничения в `spec/main.tsp`** (`@minLength`, `@maxLength`,
   `@minValue`, `@maxValue`, `@pattern` для `guest_name`, `@format("email")` для
   `guest_email`) и прогнать `mise run codegen`. Это бесплатно: попадает в
   `openapi.yaml`, читается людьми и внешними инструментами, не ломает
   Go-бэкенд.
2. **Описать ответы ошибок на всех операциях**: `400` для `POST`, `404` для
   `available-slots`/`bookings` при неизвестном `typeId`, `409` для
   `createBooking`. Модель `ErrorResponse` уже есть — надо её использовать и,
   вероятно, добавить `code`.
3. **Решить про `201 Created`** для `POST /bookings` и `POST /meeting-types`,
   чтобы контракт не врал про 200.
4. **Включить `forceSuccessResponse: true`** в `orval.config.ts`, иначе
   `400/404/409` не доходят до TanStack Query и UI молча показывает пустые
   данные. Плюс настроить `retry` для запросов, чтобы `4xx` не ретраились.
5. **Добавить второй output `client: 'zod'`** (и зависимость `zod` во
   `frontend/package.json`), когда дойдёт до форм — это единственный способ
   получить клиентскую валидацию из контракта без ручного дублирования.
6. **Не пытаться выразить бизнес-правила в TypeSpec.** Пересечения, окно,
   рабочие часы и шаг слотов живут в Go-хендлерах; контракт описывает только
   форму данных и коды ответов.

Порядок безопасен: пункты 1–3 меняют только `spec/`, пункт 4 — `orval.config.ts`,
пункт 5 — `frontend/package.json` + `orval.config.ts`. Ни один не требует
ручной правки `frontend/src/api/generated/` (он перегенерируется).

## 6. Источники

TypeSpec:

- Built-in decorators (`@minValue`, `@maxValue`, `@minLength`, `@maxLength`,
  `@pattern`, `@format`, `@error`, `@doc`, `@minItems`, `@maxItems`) —
  <https://typespec.io/docs/standard-library/built-in-decorators/>
- `@typespec/http` decorators (`@statusCode`, `@body`, `@route`, `@query`) —
  <https://typespec.io/docs/libraries/http/reference/decorators/>
- `@typespec/http` data types (`CreatedResponse`, `BadRequestResponse`,
  `NotFoundResponse`, `ConflictResponse`) —
  <https://typespec.io/docs/libraries/http/reference/data-types/>
- OpenAPI3 emitter options (`openapi-versions`, `omit-unreachable-types`,
  `operation-id-strategy`) —
  <https://typespec.io/docs/emitters/openapi3/reference/emitter/>
- JSON Schema Validation, `format` как annotation vocabulary —
  <https://json-schema.org/draft/2020-12/json-schema-validation#name-vocabularies-for-semantic-c>

Orval:

- React Query guide (хуки, query keys, per-operation overrides) —
  <https://orval.dev/docs/guides/react-query>
- Fetch guide (форма `{ data, status, headers }`, `baseUrl.runtime`) —
  <https://orval.dev/docs/guides/fetch>
- Output reference: `override.fetch.includeHttpResponseReturnType` (default
  `true`), `forceSuccessResponse` (default `false`), `runtimeValidation`,
  `includeHttpErrorResponse` —
  <https://orval.dev/docs/reference/configuration/output>
- Zod guide (схемы из ограничений OpenAPI) — <https://orval.dev/docs/guides/zod>
- Client with Zod (два output'а: клиент + схемы) —
  <https://orval.dev/docs/guides/client-with-zod>

TanStack Query:

- Query retries (default `3`, экспоненциальная задержка) —
  <https://tanstack.com/query/latest/docs/framework/react/guides/query-retries>
- `useMutation` (`retry` default `0`) —
  <https://tanstack.com/query/latest/docs/framework/react/reference/useMutation>

Локальные файлы:

- `spec/main.tsp`, `spec/tspconfig.yaml`, `spec/openapi.yaml`
- `orval.config.ts`, `package.json`, `spec/package.json`, `frontend/package.json`
- `frontend/src/api/generated/calendar.ts`,
  `frontend/src/api/generated/model/errorResponse.ts`
- `backend/internal/httpapi/router.go` (сейчас только `GET /health`)
- исходники `@orval/fetch@8.47.0` → `dist/index.mjs` (`execute`,
  `throwOnError`)

## Приложение: как воспроизвести проверки

```bash
# 1. TypeSpec → OpenAPI (в каталоге с package.json и симлинком на spec/node_modules)
spec/node_modules/.bin/tsp compile . --emit=@typespec/openapi3
# смотреть out/openapi.yaml: minimum/maximum/minLength/pattern/format и responses 201/400/404/409

# 2. Orval по экспериментальной спеке (не трогая frontend/src)
node_modules/.bin/orval --config /tmp/orval.exp.config.ts
# сравнить: с forceSuccessResponse: true появляется `if (!res.ok) throw`
# и TError = ErrorResponse; без него — только union-типы и конверт { data, status, headers }

# 3. Zod-схемы
# в конфиге: output.client = 'zod' → zod.object({...}) с .min/.max/.regex/.email()
```
