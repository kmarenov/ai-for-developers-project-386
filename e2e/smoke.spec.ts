import { expect, test } from "./fixtures";

test("гость открывает главную и переходит в каталог типов встреч", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Календарь звонков" })).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Записаться" }).click();

  await expect(page).toHaveURL(/\/meeting-types$/);
  await expect(page.getByRole("heading", { name: "Типы встреч" })).toBeVisible();

  // Прямой переход и перезагрузка SPA-маршрута, совпадающего с префиксом API,
  // должны отдавать приложение, а не JSON бэкенда.
  await page.goto("/meeting-types");
  await expect(page.getByRole("heading", { name: "Типы встреч" })).toBeVisible();

  // Каталог пришёл с настоящего backend, а не из мока. Стор общий для всей сессии:
  // другие сценарии могут его наполнить, поэтому принимаем любой терминальный ответ —
  // пустое состояние или список. Само пустое состояние проверяют компонентные тесты.
  const emptyState = page.getByText("Пока нет доступных типов встреч");
  const catalogItem = page.getByText(/^\d+ минут$/);

  await expect(emptyState.or(catalogItem).first()).toBeVisible();
  await expect(page.getByText("Не удалось загрузить типы встреч")).toHaveCount(0);
});

test("backend отвечает на GET /health", async ({ api }) => {
  const response = await api.get("/health");

  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ status: "ok" });
});
