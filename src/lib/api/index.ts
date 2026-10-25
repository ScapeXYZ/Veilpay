import { LiveApiClient } from "./live";
import { MockApiClient } from "./mock";
import type { ApiClient } from "./types";

export function createApiClient(mode = process.env.NEXT_PUBLIC_API_MODE ?? "live"): ApiClient {
  // MockApiClient remains available only through explicit test/demo injection.
  // A missing or misspelled browser mode must never turn the submission UI
  // into a simulated wallet.
  return mode === "mock" && process.env.NODE_ENV === "test" ? new MockApiClient() : new LiveApiClient();
}

export function isMockClient(c: ApiClient): c is MockApiClient {
  return c.mode === "mock";
}

export * from "./types";
