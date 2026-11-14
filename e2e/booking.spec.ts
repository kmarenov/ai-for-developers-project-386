import { expect, test } from "./fixtures";

const OWNER_TIMEZONE = "Europe/Moscow";

type MeetingType = {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
};

type TimeSlot = {
  start_time: string;
  end_time: string;
};

type Booking = {
  id: string;
  meeting_type_id: string;
  start_time: string;
  end_time: string;
  guest_name: string;
  guest_email: string;
};

/** Formats an instant for the assertions; independent of the app's date-fns helpers. */
function ownerFormat(instant: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: OWNER_TIMEZONE, ...options }).format(
    new Date(instant),
  );
}

function clock(instant: string): string {
  return ownerFormat(instant, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The calendar button of the booking page, e.g. «пн, 16 ноября». */
function dayLabel(instant: string): string {
  return ownerFormat(instant, { weekday: "short", day: "numeric", month: "long" });
}

/** The success screen and owner row interval, e.g. «16 ноября, 09:00–09:30 (МСК)». */
function bookingRange(slot: TimeSlot): string {
  const day = ownerFormat(slot.start_time, { day: "numeric", month: "long" });

  return `${day}, ${clock(slot.start_time)}–${clock(slot.end_time)} (МСК)`;
}

test("гость записывается на слот, а владелец видит бронь", async ({ page, api }, testInfo) => {
  // Every run gets its own meeting type and guest; the smoke test must not rely on an empty store.
  const title = `Созвон ${testInfo.testId}`;
  const description = `Тип встречи для E2E-прогона ${testInfo.testId}`;
  const durationMinutes = 30;
  const guestName = `Гость ${testInfo.testId}`;
  const guestEmail = `guest-${testInfo.testId}@example.com`;

  const meetingTypeResponse = await api.post("/meeting-types", {
    data: { title, description, duration_minutes: durationMinutes },
  });
  expect(meetingTypeResponse.status()).toBe(201);
  const meetingType = (await meetingTypeResponse.json()) as MeetingType;

  const slotsResponse = await api.get("/available-slots", {
    params: { meeting_type_id: meetingType.id },
  });
  expect(slotsResponse.status()).toBe(200);
  const slots = (await slotsResponse.json()) as TimeSlot[];
  expect(slots.length).toBeGreaterThan(0);

  // The first free slot of the whole window: its date and time drive the browser scenario.
  const [slot] = slots;

  // The guest walks the real UI: home → catalog → the meeting type card.
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Записаться" }).click();
  await expect(page).toHaveURL(/\/meeting-types$/);
  await page.getByRole("main").getByRole("link").filter({ hasText: title }).click();
  await expect(page).toHaveURL(new RegExp(`/meeting-types/${meetingType.id}$`));
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Время указано по Москве (МСК).")).toBeVisible();

  await page
    .getByRole("region", { name: "Календарь" })
    .getByRole("button", {
      name: dayLabel(slot.start_time),
    })
    .click();

  const slotsRegion = page.getByRole("region", { name: "Свободные слоты" });
  const firstSlotButton = slotsRegion.getByRole("button").first();
  await expect(firstSlotButton).toHaveText(clock(slot.start_time));
  await firstSlotButton.click();

  await page.getByLabel("Имя", { exact: true }).fill(guestName);
  await page.getByLabel("Email", { exact: true }).fill(guestEmail);
  await page.getByRole("button", { name: "Записаться", exact: true }).click();

  const success = page.getByRole("status");
  await expect(success.getByRole("heading", { name: "Вы записаны" })).toBeVisible();
  await expect(success).toContainText(title);
  await expect(success).toContainText(bookingRange(slot));
  await expect(success).toContainText(guestName);
  await expect(success).toContainText(guestEmail);

  // Postcondition through the API: the guest's booking exists with the requested interval.
  const bookingsResponse = await api.get("/bookings");
  expect(bookingsResponse.status()).toBe(200);
  const bookings = (await bookingsResponse.json()) as Booking[];
  const booking = bookings.find(
    (item) => item.guest_email === guestEmail && item.start_time === slot.start_time,
  );
  expect(booking).toMatchObject({
    meeting_type_id: meetingType.id,
    start_time: slot.start_time,
    end_time: slot.end_time,
    guest_name: guestName,
    guest_email: guestEmail,
  });

  // The owner sees the same booking in the upcoming-meetings list.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Предстоящие встречи" })).toBeVisible();

  const row = page.locator("article").filter({ hasText: guestEmail });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(title);
  await expect(row).toContainText(`${clock(slot.start_time)}–${clock(slot.end_time)}`);
  await expect(row).toContainText(guestName);
  await expect(row.getByRole("link", { name: guestEmail })).toHaveAttribute(
    "href",
    `mailto:${guestEmail}`,
  );
});
