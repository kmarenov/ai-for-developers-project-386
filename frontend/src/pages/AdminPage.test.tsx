import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useListBookings, useListMeetingTypes } from "@/api/generated/calendar";
import type { Booking, MeetingType } from "@/api/generated/model";
import { AdminPage } from "@/pages/AdminPage";

vi.mock("@/api/generated/calendar", () => ({
  useListBookings: vi.fn(),
  useListMeetingTypes: vi.fn(),
}));

const mockedUseListBookings = vi.mocked(useListBookings);
const mockedUseListMeetingTypes = vi.mocked(useListMeetingTypes);

// Monday 10 November 2025, 09:00 in Moscow. The tickets' day headers use the
// same 2025 weekdays: пн 10, вт 11, ср 12 ноября.
const now = new Date("2025-11-10T06:00:00.000Z");

const meetingTypes: MeetingType[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Встреча 30 минут",
    description: "Описание не должно попасть в список.",
    duration_minutes: 30,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Короткий звонок",
    description: "",
    duration_minutes: 15,
  },
];

const bookings: Booking[] = [
  {
    id: "booking-1",
    meeting_type_id: meetingTypes[0].id,
    start_time: "2025-11-10T06:00:00.000Z",
    end_time: "2025-11-10T06:30:00.000Z",
    guest_name: "Иван Петров",
    guest_email: "ivan@example.com",
  },
  {
    id: "booking-2",
    meeting_type_id: meetingTypes[1].id,
    start_time: "2025-11-10T07:00:00.000Z",
    end_time: "2025-11-10T07:15:00.000Z",
    guest_name: "Мария Смирнова",
    guest_email: "maria@example.com",
  },
  {
    id: "booking-3",
    meeting_type_id: meetingTypes[0].id,
    start_time: "2025-11-11T06:00:00.000Z",
    end_time: "2025-11-11T06:30:00.000Z",
    guest_name: "Пётр Орлов",
    guest_email: "petr@example.com",
  },
  {
    id: "booking-4",
    meeting_type_id: "33333333-3333-4333-8333-333333333333",
    start_time: "2025-11-12T06:00:00.000Z",
    end_time: "2025-11-12T06:30:00.000Z",
    guest_name: "Анна Ким",
    guest_email: "anna@example.com",
  },
];

function queryResult<T>(data: T, refetch = vi.fn()) {
  return {
    data: { data, status: 200 as const, headers: new Headers() },
    isLoading: false,
    isError: false,
    refetch,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

function mockSuccess(bookingsData: Booking[] = bookings, typesData: MeetingType[] = meetingTypes) {
  const bookingsRefetch = vi.fn();
  const typesRefetch = vi.fn();

  mockedUseListBookings.mockReturnValue(
    queryResult(bookingsData, bookingsRefetch) as unknown as ReturnType<typeof useListBookings>,
  );
  mockedUseListMeetingTypes.mockReturnValue(
    queryResult(typesData, typesRefetch) as unknown as ReturnType<typeof useListMeetingTypes>,
  );

  return { bookingsRefetch, typesRefetch };
}

describe("AdminPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    mockedUseListBookings.mockReset();
    mockedUseListMeetingTypes.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the heading, the timezone caption and day groups in server order", () => {
    mockSuccess();

    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Предстоящие встречи" })).toBeVisible();
    expect(screen.getByText("Время указано по Москве (МСК).")).toBeVisible();

    const dayHeaders = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);

    expect(dayHeaders).toEqual([
      "Сегодня, пн, 10 ноября",
      "Завтра, вт, 11 ноября",
      "ср, 12 ноября",
    ]);
  });

  it("keeps the server order inside a day and shows title, duration and interval", () => {
    mockSuccess();

    renderPage();

    const [today] = screen.getAllByRole("region");

    const rows = within(today).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    expect(within(rows[0]).getByText("Встреча 30 минут")).toBeVisible();
    expect(within(rows[0]).getByText("30 минут")).toBeVisible();
    expect(within(rows[0]).getByText("09:00–09:30")).toBeVisible();

    expect(within(rows[1]).getByText("Короткий звонок")).toBeVisible();
    expect(within(rows[1]).getByText("15 минут")).toBeVisible();
    expect(within(rows[1]).getByText("10:00–10:15")).toBeVisible();
  });

  it("marks only the ongoing meeting with the badge and keeps its place", () => {
    mockSuccess();

    renderPage();

    const [today] = screen.getAllByRole("region");
    const rows = within(today).getAllByRole("listitem");

    expect(within(rows[0]).getByText("Идёт сейчас")).toBeVisible();
    expect(within(rows[1]).queryByText("Идёт сейчас")).toBeNull();
    expect(within(rows[0]).getByText("Встреча 30 минут")).toBeVisible();
  });

  it("does not mark a meeting that already ended", () => {
    // 09:30 MSK: the first meeting ends exactly now, so it is not running.
    vi.setSystemTime(new Date("2025-11-10T06:30:00.000Z"));
    mockSuccess();

    renderPage();

    const [today] = screen.getAllByRole("region");
    const rows = within(today).getAllByRole("listitem");

    expect(within(rows[0]).queryByText("Идёт сейчас")).toBeNull();
  });

  it("shows a muted fallback without duration or links for an unknown meeting type", () => {
    mockSuccess();

    renderPage();

    const [, , thirdDay] = screen.getAllByRole("region");
    const [row] = within(thirdDay).getAllByRole("listitem");

    expect(within(row).getByText("Тип встречи недоступен")).toBeVisible();
    expect(within(row).queryByText(/минут/)).toBeNull();
    expect(within(row).queryByRole("link")).toBeNull();
    expect(within(row).getByText("Анна Ким")).toBeVisible();
  });

  it("links the guest email with mailto and hides the type description", async () => {
    mockSuccess();

    renderPage();

    const emailLink = screen.getByRole("link", { name: "ivan@example.com" });
    expect(emailLink).toHaveAttribute("href", "mailto:ivan@example.com");

    expect(screen.queryByText("Описание не должно попасть в список.")).toBeNull();
    expect(screen.queryByRole("link", { name: /Встреча 30 минут/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Отменить|Перенести/ })).toBeNull();
  });

  it("shows a skeleton with an announcement while meetings are loading", () => {
    mockedUseListBookings.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useListBookings>);
    mockedUseListMeetingTypes.mockReturnValue(
      queryResult(meetingTypes) as unknown as ReturnType<typeof useListMeetingTypes>,
    );

    renderPage();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Загружаем встречи…");
  });

  it("shows an empty state with a link to the catalog", () => {
    mockSuccess([]);

    renderPage();

    expect(screen.getByText("Пока нет предстоящих встреч")).toBeVisible();
    expect(
      screen.getByText(
        "Здесь появятся брони гостей. Проверьте каталог типов встреч, чтобы ссылки на запись работали.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Открыть каталог встреч" })).toHaveAttribute(
      "href",
      "/meeting-types",
    );
  });

  it("shows an error state and retries the failed queries", async () => {
    const user = userEvent.setup();
    const bookingsRefetch = vi.fn();

    mockedUseListBookings.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: bookingsRefetch,
    } as unknown as ReturnType<typeof useListBookings>);
    mockedUseListMeetingTypes.mockReturnValue(
      queryResult(meetingTypes) as unknown as ReturnType<typeof useListMeetingTypes>,
    );

    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить встречи");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Проверьте подключение и попробуйте ещё раз.",
    );

    await user.click(screen.getByRole("button", { name: "Повторить" }));

    expect(bookingsRefetch).toHaveBeenCalledTimes(1);
  });

  it("polls bookings without a manual refresh button", () => {
    mockSuccess();

    renderPage();

    expect(mockedUseListBookings).toHaveBeenCalledWith({
      query: { staleTime: 0, refetchInterval: 60_000, refetchOnWindowFocus: true },
    });
    expect(screen.queryByRole("button", { name: /Обновить/ })).toBeNull();
  });
});
