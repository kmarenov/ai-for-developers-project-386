import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useCreateBooking,
  useGetConfig,
  useListAvailableSlots,
  useListMeetingTypes,
} from "@/api/generated/calendar";
import type { ConfigResponse, MeetingType, TimeSlot } from "@/api/generated/model";
import { App } from "@/App";
import { MeetingTypesPage } from "@/pages/MeetingTypesPage";

vi.mock("@/api/generated/calendar", () => ({
  useCreateBooking: vi.fn(),
  useGetConfig: vi.fn(),
  useListAvailableSlots: vi.fn(),
  useListMeetingTypes: vi.fn(),
}));

const mockedUseListMeetingTypes = vi.mocked(useListMeetingTypes);
const mockedUseCreateBooking = vi.mocked(useCreateBooking);
const mockedUseGetConfig = vi.mocked(useGetConfig);
const mockedUseListAvailableSlots = vi.mocked(useListAvailableSlots);

function renderPage() {
  return render(
    <MemoryRouter>
      <MeetingTypesPage />
    </MemoryRouter>,
  );
}

function queryResult<T>(data: T) {
  return {
    data: { data, status: 200 as const, headers: new Headers() },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

const meetingTypes: MeetingType[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Встреча 30 минут",
    description: "Обсудим проект и следующие шаги.",
    duration_minutes: 30,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Короткий звонок",
    description: "",
    duration_minutes: 15,
  },
];

const config: ConfigResponse = {
  timezone: "Europe/Moscow",
  working_hours_start: "09:00",
  working_hours_end: "18:00",
  slot_step_minutes: 15,
  booking_window_days: 14,
  today: "2026-11-14",
};

describe("MeetingTypesPage", () => {
  beforeEach(() => {
    mockedUseCreateBooking.mockReset();
    mockedUseListMeetingTypes.mockReset();
    mockedUseGetConfig.mockReset();
    mockedUseListAvailableSlots.mockReset();

    mockedUseGetConfig.mockReturnValue(
      queryResult(config) as unknown as ReturnType<typeof useGetConfig>,
    );
    mockedUseListAvailableSlots.mockReturnValue(
      queryResult([] as TimeSlot[]) as unknown as ReturnType<typeof useListAvailableSlots>,
    );
    mockedUseCreateBooking.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateBooking>);
  });

  it("shows a loading state while the catalog is fetched", () => {
    mockedUseListMeetingTypes.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useListMeetingTypes>);

    renderPage();

    expect(screen.getByRole("heading", { name: "Типы встреч" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Загружаем типы встреч…");
  });

  it("shows an error state and retries on demand", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockedUseListMeetingTypes.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useListMeetingTypes>);

    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить типы встреч");
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when the owner has not published any meeting types", () => {
    mockedUseListMeetingTypes.mockReturnValue(
      queryResult([]) as unknown as ReturnType<typeof useListMeetingTypes>,
    );

    renderPage();

    expect(screen.getByText("Пока нет доступных типов встреч")).toBeInTheDocument();
  });

  it("renders meeting types in creation order with title, description and duration", () => {
    mockedUseListMeetingTypes.mockReturnValue(
      queryResult(meetingTypes) as unknown as ReturnType<typeof useListMeetingTypes>,
    );

    renderPage();

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);

    expect(within(cards[0]).getByText("Встреча 30 минут")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Обсудим проект и следующие шаги.")).toBeInTheDocument();
    expect(within(cards[0]).getByText("30 минут")).toBeInTheDocument();

    expect(within(cards[1]).getByText("Короткий звонок")).toBeInTheDocument();
    expect(within(cards[1]).getByText("15 минут")).toBeInTheDocument();
    expect(cards[1].querySelector('[data-slot="card-description"]')).toBeNull();
  });

  it("opens the booking page of the selected meeting type", async () => {
    const user = userEvent.setup();
    mockedUseListMeetingTypes.mockReturnValue(
      queryResult(meetingTypes) as unknown as ReturnType<typeof useListMeetingTypes>,
    );

    render(
      <MemoryRouter initialEntries={["/meeting-types"]}>
        <App />
      </MemoryRouter>,
    );

    const cardLink = screen.getByRole("link", { name: /Встреча 30 минут/ });
    expect(cardLink).toHaveAttribute("href", `/meeting-types/${meetingTypes[0].id}`);

    await user.click(cardLink);

    expect(screen.getByRole("heading", { name: "Встреча 30 минут" })).toBeInTheDocument();
    expect(screen.getByText("Время указано по Москве (МСК).")).toBeInTheDocument();
  });
});
