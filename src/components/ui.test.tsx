import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatZec } from "@/lib/zat";
import { ErrorBox, StatusBadge, Zec } from "./ui";

describe("readable amounts", () => {
  it("shows a short amount, with the exact 8-decimal value on hover and no zatoshi jargon", () => {
    render(<Zec zat="12000000" testId="amt" />);
    const el = screen.getByTestId("amt");
    expect(el).toHaveTextContent("0.12 ZEC");
    expect(el).toHaveAttribute("title", "Exact amount: 0.12000000 ZEC");
    expect(el.className).not.toMatch(/font-mono/);
    expect(formatZec("123456789000")).toBe("1,234.56789 ZEC");
  });
});

describe("feedback is never colour-only", () => {
  it.each(["success", "danger", "warning", "progress", "review"] as const)("%s status badge carries an icon", (tone) => {
    render(<StatusBadge tone={tone} testId="b">label</StatusBadge>);
    expect(screen.getByTestId("b").querySelector("svg")).not.toBeNull();
  });
  it("error box is an alert with an icon", () => {
    render(<ErrorBox>failed</ErrorBox>);
    expect(screen.getByRole("alert").querySelector("svg")).not.toBeNull();
  });
});
