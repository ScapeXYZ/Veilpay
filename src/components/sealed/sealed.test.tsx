import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { MockApiClient } from "@/lib/api/mock";
import { AGENT_ID } from "@/lib/api/fixtures";
import { LiveChartWithheld } from "@/components/spending-chart";
import { AddressChip, ADDRESS_FACT } from "./address-chip";
import { PolicySheet, policySentence } from "./policy-sheet";
import { PracticeFrame } from "./practice-frame";
import { SealedOpenSheet } from "./sealed-open-sheet";

vi.mock("next/navigation", () => ({ usePathname: () => "/app" }));

describe("AddressChip", () => {
  it("labels shielded and transparent in words, with different treatments", () => {
    render(<><AddressChip kind="shielded" value="u1abc…wxyz" /><AddressChip kind="transparent" value="t1abc…wxyz" /></>);
    const s = screen.getByTestId("chip-shielded");
    const t = screen.getByTestId("chip-transparent");
    expect(s).toHaveTextContent("shielded");
    expect(t).toHaveTextContent("transparent, visible on chain");
    expect(s.className).not.toEqual(t.className);
  });
  it("facts make no absolute privacy claims", () => {
    for (const f of Object.values(ADDRESS_FACT)) expect(f).not.toMatch(/untraceable|100%|bank-grade|anonymous|guarantee/i);
  });
});

describe("SealedOpenSheet", () => {
  it("says what shielding does not hide", () => {
    render(<SealedOpenSheet />);
    expect(screen.getByTestId("sealed-open-sheet")).toHaveTextContent(/don't hide that you use VeilPay/i);
    expect(screen.getByTestId("sheet-open")).toHaveTextContent(/when, and its fee/);
  });
});

describe("LiveChartWithheld", () => {
  it("draws no chart and no amounts outside practice mode", () => {
    render(<LiveChartWithheld />);
    expect(screen.getByTestId("spending-live-withheld")).toHaveTextContent(/independently verified as confirmed/);
    expect(screen.queryByTestId("spending-chart")).toBeNull();
    expect(screen.getByTestId("spending-activity")).not.toHaveTextContent(/ZEC/);
  });
});

describe("PracticeFrame + PolicySheet in practice mode", () => {
  it("frames practice content and tags the policy sheet as practice", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    await api.createDemoSession("customer");
    const agent = await api.getAgent(AGENT_ID);
    render(<Providers client={api}><PracticeFrame><PolicySheet agent={agent} /></PracticeFrame></Providers>);
    await waitFor(() => expect(screen.getByTestId("practice-frame")).toBeInTheDocument());
    expect(screen.getByTestId("practice-line")).toHaveTextContent("Practice mode. Simulated payments, no funds move.");
    expect(screen.getByTestId("sheet-practice")).toHaveTextContent("practice agent");
    expect(screen.getByTestId("policy-sentence")).toHaveTextContent(policySentence(agent));
    expect(screen.getByTestId("policy-sentence")).toHaveTextContent(/ZEC per payment/);
  });
});
