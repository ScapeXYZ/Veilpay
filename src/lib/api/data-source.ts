"use client";

import { networkModeOf, type NetworkMode } from "@/lib/mode";
import { dataSourceOf, type DataSource } from "@/lib/present";
import { useApi, useHealth } from "./hooks";

/** Kept out of components/source.tsx so that file exports only components (Fast Refresh). */
export function useDataSource(): DataSource {
  const api = useApi();
  const { data } = useHealth();
  return dataSourceOf(data, api.mode);
}

/** Server-owned network mode + write gates. Mainnet is always read-only. */
export function useNetworkMode(): NetworkMode {
  const api = useApi();
  const { data, isError } = useHealth();
  return networkModeOf(data, api.mode, isError && !data);
}
