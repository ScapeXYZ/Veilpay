import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import NewPaymentPage from "./page";

vi.mock("@/lib/api/data-source", () => ({
  useNetworkMode: () => ({ kind: "mainnet_readonly", label: "Mainnet · Read-only · Execution disabled", detail: "Read-only", canWrite: false, canExecute: false }),
}));
vi.mock("@/components/shell", () => ({
  PageHeader: () => null,
  RequireContext: ({ children }: { children: ReactNode }) => <div data-testid="customer-session-gate">{children}</div>,
}));

describe("mainnet new payment route", () => {
  it("fails closed before entering the customer-session gate", () => {
    render(<NewPaymentPage />);
    expect(screen.getByTestId("new-payment-mainnet")).toHaveTextContent(/no new payments on mainnet/i);
    expect(screen.getByTestId("new-payment-mainnet")).toHaveTextContent(/never requests or sends payments there/i);
    expect(screen.queryByTestId("customer-session-gate")).toBeNull();
  });
});
