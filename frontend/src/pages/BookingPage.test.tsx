import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGetConfig, useListAvailableSlots, useListMeetingTypes } from "@/api/generated/calendar";
import type { ConfigResponse, MeetingType, TimeSlot } from "@/api/generated/model";
import { BookingPage } from "@/pages/BookingPage";

vi.mock("@/api/generated/calendar", () => ({
  useGetConfig: vi.fn(),
  useListAvailableSlots: vi.fn(),
  useListMeetingTypes: vi.fn(),
}));

const mockedUseGetConfig = vi.mocked(useGetConfig);
const mockedUseListAvailableSlots = vi.mocked(useListAvailableSlots);
const mockedUseListMeetingTypes = vi.mocked(useListMeetingTypes);

const meetingTypeId = "11111111-1111-4111-8111-111111111111";

const config: ConfigResponse = {
  timezone: "Europe/Moscow",
  working_hours_start: "09:00",
  working_hours_end: "18:00",
  slot_step_minutes: 15,
  booking_window_days: 14,
  today: "2026-11-14",
};

const meetingTypes: MeetingType[] = [
  {
    id: meetingTypeId,
    title: "Встреча 30 минут",
    description: "Обсудим проект.",
    duration_minutes: 30,
  },
];

const slots: TimeSlot[] = [
  { start_time: "2026-11-16T06:00:00Z", end_time: "2026-11-16T06:30:00Z" },
  { start_time: "2026-11-16T06:15:00Z", end_time: "2026-11-16T06:45:00Z" },
  { start_time: "2026-11-16T06:30:00Z", end_time: "2026-11-16T07:00:00Z" },
  { start_time: "2026-11-17T06:00:00Z", end_time: "2026-11-17T06:30:00Z" },
];

function queryResult<T>(data: T) {
  return {
    data: { data, status: 200 as const, headers: new Headers() },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetConfig>;
}

function mockConfig(overrides: Record<string, unknown> = {}) {
  mockedUseGetConfig.mockReturnValue({
    ...queryResult(config),
    ...overrides,
  } as unknown as ReturnType<typeof useGetConfig>);
}

function mockCatalog(data: MeetingType[] = meetingTypes) {
  mockedUseListMeetingTypes.mockReturnValue(
    queryResult(data) as unknown as ReturnType<typeof useListMeetingTypes>,
  );
}

function mockSlots(data: TimeSlot[] = slots, overrides: Record<string, unknown> = {}) {
  mockedUseListAvailableSlots.mockReturnValue({
    ...queryResult(data),
    ...overrides,
  } as unknown as ReturnType<typeof useListAvailableSlots>);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/meeting-types/${meetingTypeId}`]}>
      <Routes>
        <Route path="/meeting-types/:meetingTypeId" element={<BookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function slotButtons() {
  return screen
    .getAllByRole("button")
    .filter((button) => /^\d{2}:\d{2}$/.test(button.textContent ?? ""));
}

describe("BookingPage", () => {
  beforeEach(() => {
    mockedUseGetConfig.mockReset();
    mockedUseListAvailableSlots.mockReset();
    mockedUseListMeetingTypes.mockReset();

    mockConfig();
    mockCatalog();
    mockSlots();
  });

  it("builds a 14-day calendar from the config and disables days without slots", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Встреча 30 минут" })).toBeInTheDocument();
    expect(screen.getByText("30 минут")).toBeInTheDocument();
    expect(screen.getByText("Время указано по Москве (МСК).")).toBeInTheDocument();

    const days = screen.getAllByRole("button", { name: /ноября/ });
    expect(days).toHaveLength(14);

    expect(screen.getByRole("button", { name: "сб, 14 ноября" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "вс, 15 ноября" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "пн, 16 ноября" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "вт, 17 ноября" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ср, 18 ноября" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "пт, 27 ноября" })).toBeDisabled();
  });

  it("shows the empty-day state for a day without slots", () => {
    renderPage();

    expect(screen.getByText("На этот день нет свободного времени")).toBeInTheDocument();
    expect(screen.getByText("Выберите другой день.")).toBeInTheDocument();
  });

  it("renders the slots of the selected day in the owner timezone", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "пн, 16 ноября" }));

    expect(slotButtons().map((button) => button.textContent)).toEqual(["09:00", "09:15", "09:30"]);

    await user.click(screen.getByRole("button", { name: "вт, 17 ноября" }));

    expect(slotButtons().map((button) => button.textContent)).toEqual(["09:00"]);
  });

  it("shows a loading state while the schedule is fetched", () => {
    mockConfig({ data: undefined, isLoading: true });

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Загружаем слоты…");
  });

  it("shows the slots loading state while the config is already rendered", () => {
    mockSlots(undefined, { data: undefined, isLoading: true });

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Загружаем слоты…");
  });

  it("shows a whole-page error with retry when the schedule fails", async () => {
    const user = userEvent.setup();
    const configRefetch = vi.fn();
    const slotsRefetch = vi.fn();
    const error = Object.assign(new Error("boom"), {
      status: 500,
      info: { code: "internal_error", message: "boom" },
    });

    mockConfig({ refetch: configRefetch });
    mockSlots(undefined, { data: undefined, isError: true, error, refetch: slotsRefetch });

    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить расписание");
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    expect(slotsRefetch).toHaveBeenCalledTimes(1);
    expect(configRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows the meeting type unavailable state for a 404", () => {
    const error = Object.assign(new Error("not found"), {
      status: 404,
      info: { code: "meeting_type_not_found", message: "not found" },
    });
    mockSlots(undefined, { data: undefined, isError: true, error });

    renderPage();

    expect(screen.getByText("Тип встречи недоступен")).toBeInTheDocument();
    expect(
      screen.getByText("Возможно, ссылка устарела. Выберите другой тип встречи в каталоге."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "К каталогу встреч" })).toHaveAttribute(
      "href",
      "/meeting-types",
    );
  });
});
