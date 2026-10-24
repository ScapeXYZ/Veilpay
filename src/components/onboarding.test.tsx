import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readUiPref, writeUiPref } from "@/lib/ui-prefs";
import { ONBOARDING_SESSION_KEY, ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, OnboardingProvider } from "./onboarding";
import { useOnboarding } from "@/lib/onboarding";

const nav = vi.hoisted(() => ({ path: "/app", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ push: nav.push }) }));

function Restart() {
  const t = useOnboarding();
  return <button onClick={t.start}>restart</button>;
}
const mount = () => render(<OnboardingProvider><Restart /></OnboardingProvider>);

describe("first-time onboarding", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    nav.path = "/app";
    nav.push.mockReset();
  });

  it("opens by itself on the first visit to /app, as a non-modal dialog with the heading focused", () => {
    mount();
    const d = screen.getByTestId("onboarding");
    expect(d).toHaveAttribute("role", "dialog");
    expect(d).toHaveAttribute("aria-modal", "false");
    expect(screen.getByRole("heading", { name: /welcome to veilpay/i })).toHaveFocus();
  });

  it("does not open by itself on other pages", () => {
    nav.path = "/app/payments";
    mount();
    expect(screen.queryByTestId("onboarding")).toBeNull();
  });

  it("walks Spending rules, Payments, Merchant, Activity/Privacy with Next and Back", () => {
    mount();
    expect(screen.getByTestId("onboarding-back")).toBeDisabled();
    const hrefs: string[] = [];
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      fireEvent.click(screen.getByTestId("onboarding-next"));
      hrefs.push(nav.push.mock.calls.at(-1)![0]);
    }
    expect(hrefs).toEqual(["/app/spending-rules", "/app/payments", "/app/merchant", "/app/activity"]);
    expect(screen.getByTestId("onboarding")).toHaveAttribute("data-step", "activity");
    fireEvent.click(screen.getByTestId("onboarding-back"));
    expect(screen.getByTestId("onboarding")).toHaveAttribute("data-step", "merchant");
  });

  it("Finish remembers the tour as done", () => {
    mount();
    for (let i = 0; i < ONBOARDING_STEPS.length; i++) fireEvent.click(screen.getByTestId("onboarding-next"));
    expect(screen.queryByTestId("onboarding")).toBeNull();
    expect(readUiPref("local", ONBOARDING_STORAGE_KEY)).toBe("done");
  });

  it("Skip and Escape close it for this session only", () => {
    mount();
    fireEvent.click(screen.getByTestId("onboarding-skip"));
    expect(screen.queryByTestId("onboarding")).toBeNull();
    expect(readUiPref("local", ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(readUiPref("session", ONBOARDING_SESSION_KEY)).toBe("closed");

    fireEvent.click(screen.getByText("restart"));
    fireEvent.keyDown(screen.getByTestId("onboarding"), { key: "Escape" });
    expect(screen.queryByTestId("onboarding")).toBeNull();
  });

  it("Don't show again persists and stops the automatic open", () => {
    const { unmount } = mount();
    fireEvent.click(screen.getByTestId("onboarding-hide"));
    expect(readUiPref("local", ONBOARDING_STORAGE_KEY)).toBe("hidden");
    unmount();
    window.sessionStorage.clear();
    mount();
    expect(screen.queryByTestId("onboarding")).toBeNull();
  });

  it("can always be restarted, even after Don't show again", () => {
    writeUiPref("local", ONBOARDING_STORAGE_KEY, "hidden");
    nav.path = "/app/help";
    mount();
    expect(screen.queryByTestId("onboarding")).toBeNull();
    act(() => fireEvent.click(screen.getByText("restart")));
    expect(screen.getByTestId("onboarding")).toHaveAttribute("data-step", "welcome");
    expect(nav.push).toHaveBeenCalledWith("/app");
  });
});

describe("ui-prefs storage allowlist", () => {
  it("refuses any key that is not a UI preference", () => {
    // @ts-expect-error deliberately not an allowed key
    expect(() => readUiPref("local", "veilpay.session")).toThrow(/not allowed/);
    // @ts-expect-error deliberately not an allowed key
    expect(() => writeUiPref("local", "payment", "x")).toThrow(/not allowed/);
  });
});
