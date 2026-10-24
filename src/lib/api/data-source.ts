"use client";

import { dataSourceOf, type DataSource } from "@/lib/present";
import { useApi, useHealth } from "./hooks";

/** Kept out of components/source.tsx so that file exports only components (Fast Refresh). */
export function useDataSource(): DataSource {
  const api = useApi();
  const { data } = useHealth();
  return dataSourceOf(data, api.mode);
}
