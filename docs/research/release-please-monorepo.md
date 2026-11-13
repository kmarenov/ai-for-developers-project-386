# release-please в монорепо pnpm + Go

Исследование по тикету #13. Всё ниже проверено по исходникам `googleapis/release-please`
(`main`, версия `17.11.2` на 2026-11-13) и `googleapis/release-please-action` (`v5.0.0`),
а также по текущим файлам репозитория.

## TL;DR

1. Включаем **manifest-режим**: два пакета — `frontend` (`release-type: node`) и `backend`
   (`release-type: go`), один общий релизный PR на все пакеты.
2. Первая версия — **0.1.0**: в манифесте ставим `0.0.0`, тогда первый `feat` даёт `0.1.0`.
3. Workflow — отдельный файл `.github/workflows/release-please.yml` на `push` в `main`;
   `permissions: {}` на уровне workflow и `contents/issues/pull-requests: write`
   на уровне job (иначе `jactionlint` в `hk` ругается). Существующий `ci.yml` не трогаем.
4. До включения нужны две правки вне workflow: исключить `CHANGELOG.md` из `oxfmt` в
   `hk.pkl` (иначе `mise run check` начнёт падать) и включить в настройках репозитория
   «Allow GitHub Actions to create and approve pull requests».
5. `node-workspace` плагин **не включаем**: он умеет только `package-lock.json` (npm),
   про pnpm в исходниках release-please нет ни одного упоминания.

## 1. Что есть в репозитории сейчас

| Факт            | Значение                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm-воркспейс  | `pnpm-workspace.yaml`: `frontend`, `spec`                                                                                                                |
| Версии пакетов  | `frontend/package.json` → `0.0.0` (private), `spec/package.json` → `0.0.0` (private)                                                                     |
| Корневой пакет  | `package.json` → `call-calendar`, private, без поля `version`                                                                                            |
| Go-модуль       | `backend/go.mod` → `github.com/kmarenov/ai-for-developers-project-386/backend`, `go 1.26.11`                                                             |
| CI              | `.github/workflows/ci.yml`: `on: push` (все ветки и теги), `permissions: contents: read`, `concurrency: ci-${{ github.ref }}`, один job `mise run check` |
| Git-хуки        | `hk.pkl`: `commit-msg` → `Builtins.check_conventional_commit`                                                                                            |
| Теги            | нет ни одного (`git tag` пуст)                                                                                                                           |
| История         | 7 коммитов, корневой `90e4748d0f59567201a3538b61495161d7906d76`                                                                                          |
| Пиннинг actions | по полному SHA с комментарием версии (`actions/checkout@3d3c42e5… # v7.0.1`)                                                                             |

Важно: `frontend` и `backend` — непересекающиеся директории, поэтому release-please
естественно разложит коммиты по пакетам (пакет получает только коммиты, затрагивающие
его путь — `docs/customizing.md`, раздел «Subdirectories (paths) in a repository»).

## 2. Конфиг (готов к копированию)

`release-please-config.json` в корне:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "bump-minor-pre-major": true,
  "separate-pull-requests": false,
  "packages": {
    "frontend": {
      "release-type": "node",
      "component": "frontend"
    },
    "backend": {
      "release-type": "go",
      "component": "backend",
      "tag-separator": "/"
    }
  }
}
```

`.release-please-manifest.json` в корне:

```json
{
  "backend": "0.0.0",
  "frontend": "0.0.0"
}
```

Почему именно так:

- `packages` — ключ это путь от корня репозитория **до директории** (не до файла).
  `release-type` по умолчанию `node`, но здесь он задан явно у каждого пакета
  (`docs/manifest-releaser.md`, «Configfile»).
- `component` управляет и тегом, и заголовком релиза. Без него `node` возьмёт `name`
  из `package.json` (`frontend`), а `go` не возьмёт ничего и получит тег без префикса —
  `v0.1.0` вместо `backend/v0.1.0` (у `go`-стратегии нет своего имени пакета —
  `src/strategies/base.ts`, `getDefaultPackageName()` возвращает пустую строку).
- `tag-separator: "/"` нужен только Go: у Go-подмодуля тег обязан быть
  `backend/v0.1.0`, а не `backend-v0.1.0`. Разделитель по умолчанию — `-`
  (`src/util/tag-name.ts`, `DEFAULT_SEPARATOR`), и Go-стратегия его **не**
  переопределяет (в отличие, например, от `ruby` — `src/strategies/ruby.ts`).
  Ровно такой шаблон используется в тестах самого release-please для Go-монорепо:
  `{releaseType: 'go-librarian', component: 'pubsub', tagSeparator: '/'}`
  (`test/manifest.ts`, ~строка 2090).
- `bump-minor-pre-major: true` — пока версия `0.x`, breaking change поднимает minor
  (`0.1.0` → `0.2.0`), а не прыгает сразу в `1.0.0`
  (`src/versioning-strategies/default.ts`, `determineReleaseType`).
- `separate-pull-requests: false` — значение по умолчанию; один PR на все пакеты
  с заголовком `chore: release main` (`group-pull-request-title-pattern` по умолчанию
  `chore: release ${branch}`).

Итоговые теги и файлы релиза:

| Пакет      | Тег               | Файлы, которые обновит release-please                        |
| ---------- | ----------------- | ------------------------------------------------------------ |
| `frontend` | `frontend-v0.1.0` | `frontend/package.json` (`version`), `frontend/CHANGELOG.md` |
| `backend`  | `backend/v0.1.0`  | `backend/CHANGELOG.md`                                       |

Плюс оба релиза пишут новую версию в `.release-please-manifest.json`.

`spec` в пакеты не включён: это приватный пакет только со сгенерированным контрактом,
его изменения уезжают вместе с `frontend`. Если хочется версионировать контракт отдельно —
добавьте `"spec": {"release-type": "node", "component": "spec"}`.

## 3. Workflow (готов к копированию)

`.github/workflows/release-please.yml`:

```yaml
name: Release Please

on:
  push:
    branches:
      - main

permissions: {}

concurrency:
  group: release-please-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        with:
          # GITHUB_TOKEN достаточно, если не нужен CI на релизном PR.
          # Альтернатива: secrets.RELEASE_PLEASE_TOKEN (PAT) — см. раздел 5.
          token: ${{ secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

Обоснование деталей:

- `on.push.branches: [main]` — фильтр по веткам отсекает пуши тегов, поэтому
  релизные теги не будут запускать этот workflow (для `push` без `branches`
  теги тоже матчатся).
- `permissions` — ровно тот набор, который требует README action: `contents: write`
  (теги/релизы/коммиты), `pull-requests: write` (релизный PR),
  `issues: write` (лейблы `autorelease: pending` / `autorelease: tagged`).
  Права выданы **на уровне job**, а на уровне workflow стоит `permissions: {}`:
  иначе `jactionlint` 2.5.0 (тот, что запускает `hk`) валит проверку правилом
  `excessive-permissions` — «set `permissions: {}` at the workflow level and grant
  `contents: write` on the job». Проверено локально:
  `mise x jactionlint@2.5.0 -- jactionlint .github/workflows/release-please.yml`
  → `exit=0`. `ci.yml` остаётся с `contents: read`, его менять не нужно.
- `concurrency` без `cancel-in-progress` — параллельные запуски release-please
  гоняются за один и тот же релизный PR, отменять их не нужно.
- Пиннинг по SHA — по конвенции репозитория. `v5.0.0` → коммит
  `45996ed1f6d02564a971a2fa1b5860e934307cf7` (проверено `git ls-remote --tags`).
  В v5.0.0 главное (breaking) изменение — переход на Node 24, набор входов тот же, что в v4.
- `config-file` / `manifest-file` можно не указывать (это дефолты), но с ними
  конфиг самодокументируется.
- Сам `token` тоже опционален (по умолчанию `secrets.GITHUB_TOKEN`), оставлен для
  наглядности и как точка замены на PAT.

## 4. Тип релиза: `node` vs `go` vs `simple`

| Тип      | Что обновляет                                                                                                                             | Начальная версия | Комментарий                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------- |
| `node`   | `package.json` (`version`), `CHANGELOG.md`; пытается `package-lock.json`, `npm-shrinkwrap.json`, `samples/package.json`, `changelog.json` | `1.0.0`          | `src/strategies/node.ts`   |
| `go`     | только `CHANGELOG.md` (+ `version-file`, если задан)                                                                                      | `1.0.0`          | `src/strategies/go.ts`     |
| `simple` | `version.txt` + `CHANGELOG.md`                                                                                                            | `1.0.0`          | `src/strategies/simple.ts` |

Что это значит на практике:

- **`node` для `frontend`** — единственный тип, который держит версию в `package.json`
  в актуальном состоянии. Отсутствующие `package-lock.json` и `samples/package.json`
  не создаются: у апдейтов `createIfMissing: false`, а `src/github.ts` (~строка 858)
  при отсутствии файла пишет `file … did not exist` и пропускает апдейт.
- **`go` для `backend`** — Go-модуль не хранит версию в файлах, поэтому стратегия
  пишет только CHANGELOG, а версия живёт в git-теге и манифесте. `go.mod` не трогается.
  Опционально можно включить `"version-file": "internal/version/version.go"` — тогда
  обновится строка вида `const Version = "0.1.0"` (регексп в
  `src/updaters/go/version-go.ts` жёстко ищет `const Version = "x.y.z"`).
- **`simple` не нужен**: он требует `version.txt`, которого в репозитории нет
  (файл не создаётся, `createIfMissing: false`), и даёт только CHANGELOG.
- **Корневой пакет `.` не заводим**: `package.json` в корне — приватный набор скриптов
  без версии, отдельный «релиз всего репозитория» только добавит шума. Побочный эффект:
  коммиты, которые трогают только корень (`mise.toml`, `hk.pkl`, `docs/`), релиз не
  порождают — это ожидаемо.

Про начальную версию: документация `docs/manifest-releaser.md` говорит про «0.1.0 для
node», но это устаревшая фраза. В коде `BaseStrategy.initialReleaseVersion()` возвращает
`Version.parse('1.0.0')`, если не задан `initial-version`, и ни `node`, ни `go`, ни
`simple` его не переопределяют. Это же зафиксировано тестами
`test/strategies/{node,go,simple}.ts` → `defaultInitialVersion` = `1.0.0`.
Вывод: начальную версию задаём **явно через манифест**, а не полагаемся на дефолт.

## 5. Первый релиз и «первая функция»

Механика: release-please не релизит по расписанию, он реагирует на коммиты. Пока с
последнего релиза нет ни одного «видимого» коммита, релизного PR не будет.

**«Первая функция»** — первый `feat(...)`-коммит, попавший в `main` после того, как
конфиг и манифест там оказались. В истории проекта это уже случилось
(`feat: add application skeleton`, `feat(frontend): add landing page with booking CTA`),
так что первый релизный PR появится сразу после включения workflow.

Порядок действий:

1. Смержить `release-please-config.json`, `.release-please-manifest.json` и
   `.github/workflows/release-please.yml` в `main`.
2. Workflow отработает на этом же пуше и откроет PR `chore: release main` с версиями
   `frontend 0.1.0` и `backend 0.1.0`, двумя CHANGELOG и обновлённым манифестом.
3. Смержить этот PR. В этот момент создаются теги `frontend-v0.1.0`, `backend/v0.1.0`
   и два GitHub Release.
4. Дальше всё автоматически: следующий `feat` → `0.2.0`, `fix`/`perf` → `0.1.1`,
   `feat!`/`BREAKING CHANGE` → `0.2.0` (из-за `bump-minor-pre-major`). Коммиты
   `docs`/`chore`/`ci`/`test`/`build`/`style`/`refactor` в одиночку релиз не порождают
   (см. раздел 6).

Почему `0.0.0` в манифесте, а не пустой манифест:

- пустой манифест → `initialReleaseVersion()` → `1.0.0` (см. раздел 4);
- `0.0.0` в манифесте трактуется как «последняя выпущенная версия» и даёт честную
  0.x-линейку для приложения, которое ещё не готово обещать стабильный API
  (`docs/manifest-releaser.md`, «Initial Version»).

Альтернативы, если понадобятся:

- `"release-as": "1.0.0"` в пакете — принудительно выпустить 1.0.0 один раз
  (после мержа PR настройку надо убрать или поднять).
- `"initial-version": "0.1.0"` — задать стартовую версию без записи в манифест.
- `"bootstrap-sha": "<sha>"` — обрезать историю для CHANGELOG. Здесь не нужен:
  в репозитории 7 коммитов, весь список уместится в первый CHANGELOG. Если всё же
  хочется начать с текущего момента, ставьте SHA последнего коммита перед включением
  (ключ только top-level, действует до первого смерженного релизного PR).

Проверить результат до мержа конфига можно локально (нужен PAT с доступом к репо):

```bash
npx release-please@17 release-pr \
  --token="$GITHUB_TOKEN" \
  --repo-url=kmarenov/ai-for-developers-project-386 \
  --target-branch=<ветка-с-конфигом> \
  --dry-run
```

## 6. Как Conventional Commits превращаются в CHANGELOG

Цепочка:

1. `hk` на `commit-msg` вызывает `hk util check-conventional-commit` — формат
   `<type>(<scope>): <description>` проверяется локально
   (`pkl/builtins/check_conventional_commit.pkl` в `jdx/hk@v2.12.0`).
2. release-please читает коммиты из истории целевой ветки и парсит их тем же
   конвенциональным парсером (`src/commit.ts`). Коммит, не прошедший парсинг,
   просто игнорируется.
3. Заголовки группируются в секции и пишутся в `CHANGELOG.md` через
   `conventional-changelog-conventionalcommits` (`src/changelog-notes/default.ts`).

Правила бампа (`src/versioning-strategies/default.ts`):

| Что в коммитах               | Бамп                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `BREAKING CHANGE` / `type!:` | major (при `bump-minor-pre-major` и версии `<1.0.0` — minor) |
| `feat` / `feature`           | minor                                                        |
| всё остальное                | patch                                                        |

Секции CHANGELOG по умолчанию (пресет `conventional-changelog-conventionalcommits@6.1.0`,
`defaultConfig`):

| Тип        | Секция                   | Видна в CHANGELOG |
| ---------- | ------------------------ | ----------------- |
| `feat`     | Features                 | да                |
| `fix`      | Bug Fixes                | да                |
| `perf`     | Performance Improvements | да                |
| `revert`   | Reverts                  | да                |
| `docs`     | Documentation            | нет (hidden)      |
| `style`    | Styles                   | нет               |
| `chore`    | Miscellaneous Chores     | нет               |
| `refactor` | Code Refactoring         | нет               |
| `test`     | Tests                    | нет               |
| `build`    | Build System             | нет               |
| `ci`       | Continuous Integration   | нет               |

Практические следствия для этого репозитория (все типы из `AGENTS.md` укладываются
в конвенцию, ничего настраивать не нужно):

- `docs`, `chore`, `ci`, `test`, `build`, `style`, `refactor` не попадают в CHANGELOG.
  Если с последнего релиза были **только** такие коммиты, релизного PR не будет вообще:
  `BaseStrategy.buildReleasePullRequest` проверяет `changelogEmpty()` и логирует
  «No user facing commits found» (`src/strategies/base.ts`).
- `refactor`/`docs` в смеси с `fix` дадут patch-бамп, но в CHANGELOG попадёт только `fix`.
- Breaking change всегда печатается отдельной секцией `BREAKING CHANGES`, даже если
  сам тип скрыт.
- **Squash-merge**: заголовок PR становится subject'ом коммита в `main`. Значит
  заголовки PR тоже должны быть conventional — иначе коммит не распарсится и в
  CHANGELOG не попадёт. `hk`-хук на такие коммиты не действует (они создаются через
  API/UI), так что это единственное место, где конвенцию нужно соблюдать вручную.

## 7. Как это сочетается с существующим CI

`ci.yml` не меняется: он остаётся на `push` без фильтра веток и с `contents: read`.
Сосуществование:

| Событие                                             | Кто создаёт                 | Запустится ли `ci.yml` |
| --------------------------------------------------- | --------------------------- | ---------------------- |
| Пуш в `main` руками/мержем PR                       | человек                     | да                     |
| Пуш релизной ветки `release-please--branches--main` | action через `GITHUB_TOKEN` | **нет**                |
| Создание тегов и GitHub Release                     | action через `GITHUB_TOKEN` | **нет**                |
| Те же события, но с PAT в `token:`                  | PAT                         | да                     |

Подавление событий от `GITHUB_TOKEN` — документированное поведение GitHub, на него
прямо ссылается README action («Other Actions on Release Please PRs»). Отсюда два
следствия:

- С `GITHUB_TOKEN` (рекомендуемый минимум) шума нет: ни тег-раны, ни раны релизной
  ветки. CI проверяет только мерж-коммит в `main`.
- Релизный PR при этом **не проверяется** CI вообще, потому что в `ci.yml` нет
  триггера `pull_request`. Если нужна проверка именно PR — нужен PAT
  (`secrets.RELEASE_PLEASE_TOKEN`, fine-grained: contents/pull-requests/issues write),
  тогда пуш релизной ветки запустит `ci.yml`. Цена: тег-пуши тоже начнут запускать
  CI (для `on: push` без фильтра теги матчатся) — лечится добавлением
  `branches: [main]` в `ci.yml`, но это уже правка существующего workflow, вне рамок
  этого тикета.

Что обязательно поправить до включения (иначе `mise run check` сломается):

**`oxfmt` форматирует Markdown.** Проверено локально на `oxfmt 0.78.0`: файл в стиле
release-please не проходит `oxfmt --check`. Разница ровно такая:

```diff
 ## [0.1.0](…) (2026-11-13)
-

 ### Features

-*   **api:** add thing ([abc1234](…))
+- **api:** add thing ([abc1234](…))
```

Поэтому в `hk.pkl` в список `exclude` шага `oxfmt` нужно добавить:

```pkl
      "frontend/CHANGELOG.md",
      "backend/CHANGELOG.md",
```

Без этого: релизный коммит CI не запускает (см. таблицу выше), поэтому падение
проявится не сразу, а на первом же ручном пуше в `main` — и будет выглядеть
необъяснимо.

Остальное про форматирование и линт:

- `.release-please-manifest.json` release-please перезаписывает, **сохраняя**
  форматирование исходника: `jsonStringify` определяет отступ и сохраняет
  префикс/суффикс файла (`src/updaters/release-please-manifest.ts`,
  `src/util/json-stringify.ts`). Достаточно один раз закоммитить его в стиле oxfmt
  (2 пробела, перевод строки в конце) — оба JSON-файла из раздела 2 проверены
  `oxfmt --check` и проходят.
- Новый workflow будет проверяться `jactionlint` (`hk.pkl`, шаг `jactionlint`,
  исключён только `hexlet-check.yml`) и `oxfmt` (он берёт в проверку и YAML). Приведённый
  выше файл проверен локально обоими инструментами из `mise.toml` — оба проходят.
- `hk`-хуки на коммиты, созданные через API, не срабатывают — заголовок
  `chore: release main` не проходит через `check_conventional_commit` (но он и так
  валиден по конвенции).

Про pnpm и lock-файл:

- `node`-стратегия правит только `version` в `frontend/package.json`. `pnpm-lock.yaml`
  версию самого воркспейс-пакета не хранит (в `importers` только зависимости и
  `specifier`), поэтому `pnpm install --frozen-lockfile` в `mise run install`
  не сломается.
- Поддержки pnpm в release-please нет: `grep -rn pnpm src/` не даёт ни одного
  результата. Плагин `node-workspace` умеет только `package-lock.json`
  (`src/plugins/node-workspace.ts`), поэтому **не включаем** — он бесполезен, пока
  нет версионируемых локальных зависимостей.
- Go-часть ничего не пишет в `backend/go.mod`; `go test ./...` и
  `golangci-lint` не затрагиваются.

## 8. Риски и что осталось решить

- **Настройка репозитория**: без «Allow GitHub Actions to create and approve pull
  requests» (Settings → Actions → General) создание релизного PR упадёт. Требование
  из README action, раздел «Workflow Permissions».
- **Версия release-please внутри action**: `release-please-action@v5.0.0` тащит
  release-please `17.6.0` (из release notes v5.0.0), тогда как описанное поведение
  сверено с `main` `17.11.2`. Все используемые ключи и стратегии есть и в 17.6.0;
  если нужна свежая версия — либо ждать релиза action, либо запускать CLI из
  workflow (`npx release-please@17 …`), что требует своего токена и checkout.
- **`spec/` без релиза**: изменения контракта не порождают релиз. Решение осознанное;
  если понадобится — добавить `spec` в `packages`.
- **Один PR на два пакета**: при желании разделить — `"separate-pull-requests": true`.
- **Релизные теги и `on: push` в `ci.yml`**: при переходе на PAT тег-пуши начнут
  запускать CI. Пока используется `GITHUB_TOKEN`, проблемы нет.
- **Черновики релизов** (`"draft": true`) не включаем: при `draft` GitHub не создаёт
  тег до публикации, из-за чего следующий прогон может не найти предыдущий релиз и
  пересобрать CHANGELOG целиком (для этого есть `force-tag-creation`, но он не нужен,
  пока релизы публикуются сразу).

## 9. Чек-лист после включения

1. Прогнать `mise run check` после добавления workflow и исключений в `hk.pkl` —
   `jactionlint` и `oxfmt` не должны выдавать ошибок.
2. После мержа конфига — убедиться, что открылся PR `chore: release main` с версиями
   `0.1.0` и двумя CHANGELOG.
3. Смержить PR, проверить теги `frontend-v0.1.0` и `backend/v0.1.0` и два Release.
4. Сделать `fix(...)`-коммит и убедиться, что следующий релизный PR даёт `0.1.1`.

## 10. Источники

Документация и код release-please:

- `docs/manifest-releaser.md` — manifest-режим, `bootstrap-sha`, «Initial Version»,
  `packages`, `plugins`, `tag-separator`, `include-component-in-tag`:
  https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md
- `docs/customizing.md` — типы стратегий (`node`, `go`, `simple`), versioning-стратегии,
  поддиректории: https://github.com/googleapis/release-please/blob/main/docs/customizing.md
- `docs/cli.md` — `--dry-run`, `release-pr`, `bootstrap`:
  https://github.com/googleapis/release-please/blob/main/docs/cli.md
- `schemas/config.json` — полный список допустимых ключей (`additionalProperties: false`):
  https://github.com/googleapis/release-please/blob/main/schemas/config.json
- `src/strategies/node.ts`, `src/strategies/go.ts`, `src/strategies/simple.ts`,
  `src/strategies/base.ts` (`initialReleaseVersion`, `changelogEmpty`):
  https://github.com/googleapis/release-please/tree/main/src/strategies
- `src/util/tag-name.ts` — формат тега, `DEFAULT_SEPARATOR = '-'`:
  https://github.com/googleapis/release-please/blob/main/src/util/tag-name.ts
- `src/versioning-strategies/default.ts` — правила бампа:
  https://github.com/googleapis/release-please/blob/main/src/versioning-strategies/default.ts
- `src/changelog-notes/default.ts` — сборка CHANGELOG через
  `conventional-changelog-conventionalcommits`:
  https://github.com/googleapis/release-please/blob/main/src/changelog-notes/default.ts
- `src/plugins/node-workspace.ts`, `src/factories/plugin-factory.ts` — плагины, только
  npm-lockfile: https://github.com/googleapis/release-please/tree/main/src/plugins
- `src/github.ts` (~858) — пропуск отсутствующих файлов при `createIfMissing: false`:
  https://github.com/googleapis/release-please/blob/main/src/github.ts
- `src/updaters/release-please-manifest.ts`, `src/util/json-stringify.ts` — сохранение
  форматирования манифеста:
  https://github.com/googleapis/release-please/blob/main/src/util/json-stringify.ts
- Тесты-подтверждения: `test/strategies/{node,go,simple}.ts` (`defaultInitialVersion`
  = `1.0.0`), `test/manifest.ts` (Go-монорепо с `tagSeparator: '/'`):
  https://github.com/googleapis/release-please/tree/main/test
- Пресет секций CHANGELOG:
  `conventional-changelog-conventionalcommits@6.1.0/writer-opts.js` → `defaultConfig`:
  https://unpkg.com/conventional-changelog-conventionalcommits@6.1.0/writer-opts.js

GitHub Action:

- `release-please-action` README (входы, outputs, permissions, PAT и подавление
  событий от `GITHUB_TOKEN`): https://github.com/googleapis/release-please-action
- Release notes `v5.0.0` (переход на Node 24, release-please 17.6.0):
  https://github.com/googleapis/release-please-action/releases/tag/v5.0.0
- GitHub Docs, «Triggering a workflow from a workflow» (события от `GITHUB_TOKEN`
  не создают новых запусков):
  https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow

Локальные файлы репозитория, на которые опирается конфиг:

- `.github/workflows/ci.yml`, `hk.pkl`, `mise.toml`, `package.json`,
  `pnpm-workspace.yaml`, `frontend/package.json`, `spec/package.json`, `backend/go.mod`
- `jdx/hk@v2.12.0` → `pkl/builtins/check_conventional_commit.pkl`:
  https://github.com/jdx/hk/blob/v2.12.0/pkl/builtins/check_conventional_commit.pkl
