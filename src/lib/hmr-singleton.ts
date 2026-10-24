/**
 * One instance per key for the lifetime of the JS realm. In `next dev`, Fast Refresh re-evaluates
 * edited modules: a module-level `createContext()` or `new Map()` would then get a NEW identity while
 * already-mounted providers/consumers still hold the OLD one ("context missing" throws, lost
 * idempotency keys). Production evaluates each module once, so this is identical to a plain const there.
 */
type Store = Map<string, unknown>;

export function hmrSingleton<T>(key: string, make: () => T): T {
  const g = globalThis as typeof globalThis & { __veilpaySingletons?: Store };
  const store = (g.__veilpaySingletons ??= new Map());
  if (!store.has(key)) store.set(key, make());
  return store.get(key) as T;
}
