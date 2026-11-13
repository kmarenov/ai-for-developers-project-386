import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { App } from "@/App";

describe("App", () => {
  it("renders the home page with a booking link", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Календарь звонков" })).toBeInTheDocument();

    const main = screen.getByRole("main");
    expect(within(main).getByRole("link", { name: /Записаться/ })).toHaveAttribute(
      "href",
      "/meeting-types",
    );
  });
});
