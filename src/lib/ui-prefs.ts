/**
 * The ONLY place the browser app touches Web Storage, and only for UI preferences.
 * The repo-wide rule "no client storage for payment/session data" still holds: this module refuses
 * every key that is not in UI_PREF_KEYS, so payment, session, key or wallet data can never be stored here.
 */
export const UI_PREF_KEYS = ["veilpay.onboarding.v1", "veilpay.onboarding.session"] as const;
export type UiPrefKey = (typeof UI_PREF_KEYS)[number];
type Area = "local" | "session";

function area(a: Area): Storage {
  return a === "local" ? window.localStorage : window.sessionStorage;
}

function assertKey(key: string): asserts key is UiPrefKey {
  if (!(UI_PREF_KEYS as readonly string[]).includes(key)) throw new Error(`ui-prefs: key not allowed: ${key}`);
}

/** Returns null when unset. Throws if storage is blocked; callers decide the safe fallback. */
export function readUiPref(a: Area, key: UiPrefKey): string | null {
  assertKey(key);
  return area(a).getItem(key);
}

/** Best effort: blocked storage is ignored (the preference just isn't remembered). */
export function writeUiPref(a: Area, key: UiPrefKey, value: string | null): void {
  assertKey(key);
  try {
    if (value === null) area(a).removeItem(key);
    else area(a).setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
