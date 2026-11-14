import { expect, test } from "./fixtures";

test("гость открывает главную и переходит в каталог типов встреч", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Календарь звонков" })).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Записаться" }).click();

  await expect(page).toHaveURL(/\/meeting-types$/);
  await expect(page.getByRole("heading", { name: "Типы встреч" })).toBeVisible();

  // Каталог пришёл с настоящего backend, а не из мока: на свежем сервере стор пуст.
  await expect(page.getByText("Пока нет доступных типов встреч")).toBeVisible();
});

test("backend отвечает на GET /health", async ({ api }) => {
  const response = await api.get("/health");

  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ status: "ok" });
});
