"use client";

import { dataSourceOf, type DataSource } from "@/lib/present";
import { useApi, useHealth } from "./hooks";

/** Kept outside a component module so Fast Refresh can preserve component state. */
export function useDataSource(): DataSource {
  const api = useApi();
  const { data } = useHealth();
  return dataSourceOf(data, api.mode);
}
