/**
 * Regression tests for the `next dev` issues: session-readiness race, non-JSON error bodies
 * (the dev "SyntaxError"), StrictMode double-mount, and Fast Refresh / HMR identity.
 */
import { StrictMode } from "react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { LiveApiClient } from "@/lib/api/live";
import { MockApiClient } from "@/lib/api/mock";
import { ApiError } from "@/lib/api/types";
import { usePayments, useSession } from "@/lib/api/hooks";
import { seedHealth } from "@/lib/api/fixtures";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function PaymentsProbe() {
  const { data } = usePayments();
  return <p>{data ? `payments:${data.items.length}` : "waiting"}</p>;
}

function SessionProbe() {
  const { isFetching } = useSession();
  return <p>{isFetching ? "checking-session" : "session-idle"}</p>;
}

describe("dev mode: session readiness", () => {
  it("never lists payments before the session bootstrap has finished", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realGet = api.getSession.bind(api);
    vi.spyOn(api, "getSession").mockImplementation(async () => {
      await gate;
      return realGet();
    });
    const list = vi.spyOn(api, "listPayments");
    render(<Providers client={api}><PaymentsProbe /></Providers>);
    await new Promise((r) => setTimeout(r, 30));
    expect(list).not.toHaveBeenCalled();
    release();
    expect(await screen.findByText(/^payments:/)).toBeInTheDocument();
    expect(list).toHaveBeenCalled();
  });

  it("bootstraps the demo session exactly once under StrictMode double mount", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    const create = vi.spyOn(api, "createDemoSession");
    render(
      <StrictMode>
        <Providers client={api}>
          <PaymentsProbe />
          <PaymentsProbe />
        </Providers>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getAllByText(/^payments:/)).toHaveLength(2));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not look up or create a demo session when live health reports mainnet", async () => {
    const api = new LiveApiClient();
    vi.spyOn(api, "getHealth").mockResolvedValue({ ...seedHealth(), network: "mainnet", mode: "disabled", walletBackend: "zingo" });
    const getSession = vi.spyOn(api, "getSession");
    const createDemoSession = vi.spyOn(api, "createDemoSession");
    render(<Providers client={api}><SessionProbe /></Providers>);
    await waitFor(() => expect(api.getHealth).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("session-idle")).toBeInTheDocument());
    expect(getSession).not.toHaveBeenCalled();
    expect(createDemoSession).not.toHaveBeenCalled();
  });
});

describe("dev mode: live client error bodies", () => {
  it("turns a plain-text proxy 500 into a typed ApiError, not a SyntaxError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 })));
    const err = await new LiveApiClient().getHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, body: { code: "INTERNAL" } });
  });

  it("treats an HTML 200 (dev error page) as a backend failure, never as data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!DOCTYPE html><html></html>", { status: 200 })));
    await expect(new LiveApiClient().getSession()).rejects.toMatchObject({ status: 502, body: { code: "INTERNAL" } });
  });

  it("shares one GET /session between concurrent state changes that need a CSRF token", async () => {
    const mock = new MockApiClient({ latencyMs: 0 });
    const session = await mock.createDemoSession("merchant");
    const invoice = await mock.createInvoice({ reference: "a", amountZat: "1" }, "idem_concurrent_a");
    const fetcher = vi.fn((url: string) => Promise.resolve(url.endsWith("/session") ? json(session) : json(invoice)));
    vi.stubGlobal("fetch", fetcher);
    const live = new LiveApiClient();
    await Promise.all([
      live.createInvoice({ reference: "a", amountZat: "1" }, "idem_concurrent_a"),
      live.createInvoice({ reference: "b", amountZat: "1" }, "idem_concurrent_b"),
    ]);
    expect(fetcher.mock.calls.filter(([u]) => u === "/api/session")).toHaveLength(1);
  });
});

describe("dev mode: hydration-stable formatting", () => {
  it("formats times from UTC fields, identical to the previous en-GB output", async () => {
    const { fmtTime } = await import("@/lib/present");
    expect(fmtTime("2026-10-24T09:05:00Z")).toBe("24 Oct, 09:05 UTC");
    expect(fmtTime("2026-01-01T23:59:59.999Z")).toBe("01 Jan, 23:59 UTC");
    expect(fmtTime("not-a-date")).toBe("unknown time");
  });
});

describe("dev mode: Fast Refresh / HMR", () => {
  it("keeps the API context and execute keys identical when hooks.ts is re-evaluated", async () => {
    const first = await import("@/lib/api/hooks");
    const key = first.executeKeyFor("pay_hmrstable0001");
    vi.resetModules();
    const second = await import("@/lib/api/hooks");
    expect(second).not.toBe(first);
    expect(second.ApiContext).toBe(first.ApiContext);
    expect(second.executeKeyFor("pay_hmrstable0001")).toBe(key);
  });

  it("component modules export only components (otherwise Fast Refresh does a full reload)", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files = [
      ...readdirSync(path.join(root, "components")).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => path.join(root, "components", f)),
      path.join(root, "app", "providers.tsx"),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        if (!/^[A-Z]/.test(m[1])) offenders.push(`${path.basename(f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
