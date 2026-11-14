import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useCreateBooking,
  useGetConfig,
  useListAvailableSlots,
  useListMeetingTypes,
} from "@/api/generated/calendar";
import type { Booking, ConfigResponse, MeetingType, TimeSlot } from "@/api/generated/model";
import { BookingPage } from "@/pages/BookingPage";

vi.mock("@/api/generated/calendar", () => ({
  useCreateBooking: vi.fn(),
  useGetConfig: vi.fn(),
  useListAvailableSlots: vi.fn(),
  useListMeetingTypes: vi.fn(),
}));

const mockedUseCreateBooking = vi.mocked(useCreateBooking);
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

const booking: Booking = {
  id: "22222222-2222-4222-8222-222222222222",
  meeting_type_id: meetingTypeId,
  start_time: "2026-11-16T06:00:00Z",
  end_time: "2026-11-16T06:30:00Z",
  guest_name: "Иван Петров",
  guest_email: "guest@example.com",
};

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

function mockCreateBooking(overrides: Record<string, unknown> = {}) {
  const mutateAsync = vi.fn().mockResolvedValue({
    data: booking,
    status: 201,
    headers: new Headers(),
  });

  mockedUseCreateBooking.mockReturnValue({
    mutateAsync,
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useCreateBooking>);

  return { mutateAsync };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/meeting-types/${meetingTypeId}`]}>
      <Routes>
        <Route path="/meeting-types/:meetingTypeId" element={<BookingPage />} />
        <Route path="/meeting-types" element={<p>Каталог встреч</p>} />
        <Route path="/" element={<p>Главная</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function slotButtons() {
  return screen
    .getAllByRole("button")
    .filter((button) => /^\d{2}:\d{2}$/.test(button.textContent ?? ""));
}

async function selectSlot(user: ReturnType<typeof userEvent.setup>, time = "09:00") {
  await user.click(screen.getByRole("button", { name: "пн, 16 ноября" }));
  await user.click(screen.getByRole("button", { name: time }));
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { name?: string; email?: string } = {},
) {
  await user.type(screen.getByLabelText("Имя"), values.name ?? "Иван Петров");
  await user.type(screen.getByLabelText("Email"), values.email ?? "Guest@Example.com");
}

function submissionError(status: number, code: string) {
  return Object.assign(new Error(code), {
    status,
    info: { code, message: code },
  });
}

describe("BookingPage", () => {
  beforeEach(() => {
    mockedUseCreateBooking.mockReset();
    mockedUseGetConfig.mockReset();
    mockedUseListAvailableSlots.mockReset();
    mockedUseListMeetingTypes.mockReset();

    mockConfig();
    mockCatalog();
    mockSlots();
    mockCreateBooking();
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

  it("reveals the guest form after the first slot selection", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();

    await selectSlot(user);

    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("16 ноября, 09:00–09:30 (МСК)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "09:00" })).toHaveAttribute("aria-pressed", "true");
  });

  it("validates the guest name and email before submitting", async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockCreateBooking();
    renderPage();
    await selectSlot(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));
    expect(await screen.findByText("Укажите имя")).toBeInTheDocument();
    expect(screen.getByText("Укажите email")).toBeInTheDocument();
    expect(screen.getByLabelText("Имя")).toHaveFocus();
    expect(mutateAsync).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Имя"), "   ");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Записаться" }));
    expect(await screen.findByText("Введите корректный email")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Имя"));
    await user.type(screen.getByLabelText("Имя"), "я".repeat(101));
    await user.click(screen.getByRole("button", { name: "Записаться" }));
    expect(await screen.findByText("Не больше 100 символов")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), `${"a".repeat(250)}@example.com`);
    await user.click(screen.getByRole("button", { name: "Записаться" }));
    expect(await screen.findByText("Не больше 254 символов")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("submits the selected slot with normalized guest data", async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockCreateBooking();
    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      data: {
        meeting_type_id: meetingTypeId,
        start_time: "2026-11-16T06:00:00Z",
        guest_name: "Иван Петров",
        guest_email: "Guest@Example.com",
      },
    });
  });

  it("disables the form and shows progress while submitting", async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockCreateBooking({ isPending: true });
    mutateAsync.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await selectSlot(user);
    await fillForm(user);

    const submit = screen.getByRole("button", { name: "Отправляем…" });

    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Имя")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("shows the success screen with the booking details and actions", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    expect(await screen.findByRole("heading", { name: "Вы записаны" })).toBeInTheDocument();
    expect(screen.getByText("Встреча 30 минут")).toBeInTheDocument();
    expect(screen.getByText("16 ноября, 09:00–09:30 (МСК)")).toBeInTheDocument();
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("guest@example.com")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Записаться ещё" })).toHaveAttribute(
      "href",
      "/meeting-types",
    );
    expect(screen.getByRole("link", { name: "На главную" })).toHaveAttribute("href", "/");
  });

  it("handles slot_taken by resetting the slot and refetching only the slots", async () => {
    const user = userEvent.setup();
    const slotsRefetch = vi.fn();
    const configRefetch = vi.fn();
    const { mutateAsync } = mockCreateBooking();
    mutateAsync.mockRejectedValue(submissionError(409, "slot_taken"));
    mockSlots(slots, { refetch: slotsRefetch });
    mockConfig({ refetch: configRefetch });

    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Это время только что заняли");
    expect(alert).toHaveTextContent("Выберите другой слот — список уже обновлён.");
    expect(alert).toHaveFocus();

    expect(slotsRefetch).toHaveBeenCalledTimes(1);
    expect(configRefetch).not.toHaveBeenCalled();

    // The day stays selected, the form keeps its values, the slot is reset.
    expect(screen.getByRole("button", { name: "пн, 16 ноября" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Имя")).toHaveValue("Иван Петров");
    expect(screen.getByLabelText("Email")).toHaveValue("Guest@Example.com");
    expect(screen.getByRole("button", { name: "09:00" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Записаться" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Выбрать другое время" }));

    expect(screen.getByRole("region", { name: "Свободные слоты" })).toHaveFocus();
  });

  it("handles invalid_slot by refetching both the config and the slots", async () => {
    const user = userEvent.setup();
    const slotsRefetch = vi.fn();
    const configRefetch = vi.fn();
    const { mutateAsync } = mockCreateBooking();
    mutateAsync.mockRejectedValue(submissionError(400, "invalid_slot"));
    mockSlots(slots, { refetch: slotsRefetch });
    mockConfig({ refetch: configRefetch });

    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Это время больше недоступно");
    expect(alert).toHaveTextContent("Расписание обновилось. Выберите другой слот.");
    expect(alert).toHaveFocus();

    expect(slotsRefetch).toHaveBeenCalledTimes(1);
    expect(configRefetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Записаться" })).toBeDisabled();
  });

  it("shows a form error for invalid_request and keeps the submitted values", async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockCreateBooking();
    mutateAsync.mockRejectedValue(submissionError(400, "invalid_request"));

    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Проверьте данные");
    expect(alert).toHaveTextContent("Не удалось отправить форму. Проверьте имя и email.");
    expect(screen.getByLabelText("Имя")).toHaveValue("Иван Петров");
    expect(screen.getByLabelText("Email")).toHaveValue("Guest@Example.com");
    expect(screen.getByRole("button", { name: "09:00" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["a 500 response", submissionError(500, "internal_error")],
    ["a network failure", new Error("network down")],
  ])("shows a form error for %s and keeps the form and slot", async (_, error) => {
    const user = userEvent.setup();
    const { mutateAsync } = mockCreateBooking();
    mutateAsync.mockRejectedValue(error);

    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Не удалось отправить запись");
    expect(alert).toHaveTextContent("Попробуйте ещё раз — данные формы сохранены.");
    expect(screen.getByLabelText("Имя")).toHaveValue("Иван Петров");
    expect(screen.getByLabelText("Email")).toHaveValue("Guest@Example.com");
    expect(screen.getByRole("button", { name: "09:00" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Записаться" })).toBeEnabled();
  });

  it("falls back to a neutral message for an unknown error code", async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockCreateBooking();
    mutateAsync.mockRejectedValue(submissionError(418, "teapot"));

    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Что-то пошло не так");
    expect(alert).toHaveTextContent("Попробуйте ещё раз.");
  });

  it("turns a 404 during submission into the page-level unavailable state", async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockCreateBooking();
    mutateAsync.mockRejectedValue(submissionError(404, "meeting_type_not_found"));

    renderPage();
    await selectSlot(user);
    await fillForm(user);

    await user.click(screen.getByRole("button", { name: "Записаться" }));

    expect(await screen.findByText("Тип встречи недоступен")).toBeInTheDocument();
  });
});
