/** Preserves client-only identities across Next Fast Refresh module evaluation. */
type Store = Map<string, unknown>;
export function hmrSingleton<T>(key: string, make: () => T): T {
  const globalStore = globalThis as typeof globalThis & { __veilpaySingletons?: Store };
  const store = (globalStore.__veilpaySingletons ??= new Map());
  if (!store.has(key)) store.set(key, make());
  return store.get(key) as T;
}
