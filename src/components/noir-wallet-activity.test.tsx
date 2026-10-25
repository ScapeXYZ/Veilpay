import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoirWalletActivity } from "./noir-wallet-activity";

describe("NoirWalletActivity", () => {
  it("keeps a wallet with no reported history empty", () => {
    render(<NoirWalletActivity entries={[]} />);

    expect(screen.getByTestId("noir-wallet-chart-empty")).toHaveTextContent("No transactions reported in the last 7 days.");
    expect(screen.queryByTestId("noir-wallet-bars")).toBeNull();
    expect(screen.getByTestId("noir-wallet-recent")).toHaveTextContent("No transactions reported.");

    fireEvent.click(screen.getByTestId("noir-wallet-range-30"));
    expect(screen.getByTestId("noir-wallet-chart-empty")).toHaveTextContent("No transactions reported in the last 30 days.");
  });
});
