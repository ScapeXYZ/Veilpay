import { LiveApiClient } from "./live";
import { MockApiClient } from "./mock";
import type { ApiClient } from "./types";

export function createApiClient(mode = process.env.NEXT_PUBLIC_API_MODE): ApiClient {
  return mode === "live" ? new LiveApiClient() : new MockApiClient();
}

export function isMockClient(c: ApiClient): c is MockApiClient {
  return c.mode === "mock";
}

export * from "./types";
