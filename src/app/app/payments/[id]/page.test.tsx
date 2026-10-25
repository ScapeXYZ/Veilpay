import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import PaymentPage from "./page";

const { mode } = vi.hoisted(() => ({ mode: { current: "mainnet_readonly" } }));
vi.mock("@/lib/api/data-source", () => ({
  useNetworkMode: () => ({ kind: mode.current, label: "Read-only", detail: "Read-only", canWrite: false, canExecute: false }),
}));
vi.mock("@/components/shell", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  RequireContext: ({ children }: { children: ReactNode }) => <div data-testid="demo-session-gate">{children}</div>,
}));

describe("mainnet payment detail route", () => {
  it.each(["mainnet_readonly", "unknown"])("fails closed for %s without entering a demo session", (kind) => {
    mode.current = kind;
    render(<PaymentPage params={Promise.resolve({ id: "pay_123" })} />);
    expect(screen.getByText(/payment details unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId("demo-session-gate")).toBeNull();
  });
});
