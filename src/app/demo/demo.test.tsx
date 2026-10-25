import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DemoPage from "./page";
import { MockApiClient } from "@/lib/api/mock";
import { Providers } from "../providers";

function renderDemo() {
  return render(<Providers client={new MockApiClient({ latencyMs: 0 })}><DemoPage /></Providers>);
}

describe("/demo", () => {
  it("never lets the agent request race the session bootstrap, and shows the exact cap", async () => {
    renderDemo();
    fireEvent.click(screen.getByTestId("demo-next"));
    fireEvent.click(screen.getByTestId("demo-next"));
    const submit = await screen.findByTestId("demo-blocked-submit", {}, { timeout: 5000 });
    fireEvent.click(submit);
    expect(await screen.findByText("CAP_EXCEEDED", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/no agent/i)).toBeNull();
  });

  it("is labelled a simulation on every frame", async () => {
    renderDemo();
    expect(await screen.findByTestId("mock-banner")).toHaveTextContent(/no real money moves/i);
    fireEvent.click(screen.getByRole("button", { name: /Skip to end/ }));
    expect(screen.getByTestId("demo-final")).toHaveTextContent(/Mainnet is read-only/);
  });
});
