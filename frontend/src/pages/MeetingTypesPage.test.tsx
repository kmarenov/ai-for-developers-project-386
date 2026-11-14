import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useListMeetingTypes } from "@/api/generated/calendar";
import type { MeetingType } from "@/api/generated/model";
import { MeetingTypesPage } from "@/pages/MeetingTypesPage";

vi.mock("@/api/generated/calendar", () => ({
  useListMeetingTypes: vi.fn(),
}));

const mockedUseListMeetingTypes = vi.mocked(useListMeetingTypes);

function renderPage() {
  return render(
    <MemoryRouter>
      <MeetingTypesPage />
    </MemoryRouter>,
  );
}

function queryResult(data: MeetingType[] | undefined) {
  return {
    data: data === undefined ? undefined : { data, status: 200 as const, headers: new Headers() },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListMeetingTypes>;
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

describe("MeetingTypesPage", () => {
  beforeEach(() => {
    mockedUseListMeetingTypes.mockReset();
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
    mockedUseListMeetingTypes.mockReturnValue(queryResult([]));

    renderPage();

    expect(screen.getByText("Пока нет доступных типов встреч")).toBeInTheDocument();
  });

  it("renders meeting types in creation order with title, description and duration", () => {
    mockedUseListMeetingTypes.mockReturnValue(queryResult(meetingTypes));

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
});
