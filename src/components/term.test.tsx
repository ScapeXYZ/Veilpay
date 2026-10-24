import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Term } from "./term";

describe("Term", () => {
  it("keeps the tooltip out of layout until hover or focus, then explains the term", () => {
    render(<p>money <Term k="reserved">set aside</Term></p>);
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip).not.toBeVisible();
    expect(tip).toHaveAttribute("hidden");
    fireEvent.focus(screen.getByTestId("term-reserved"));
    expect(screen.getByRole("tooltip")).toBeVisible();
    expect(screen.getByRole("tooltip")).toHaveTextContent(/not spent/i);
    fireEvent.keyDown(screen.getByTestId("term-reserved"), { key: "Escape" });
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveAttribute("hidden");
  });
});
