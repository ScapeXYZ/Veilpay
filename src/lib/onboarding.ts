"use client";

import { createContext, useContext } from "react";

/** Hook + context live outside the component module so Fast Refresh keeps working (see dev-mode.test). */
export type OnboardingApi = { open: boolean; start: () => void };
export const OnboardingContext = createContext<OnboardingApi | null>(null);

/** Safe outside the provider (e.g. unit tests): start() is then a no-op. */
export function useOnboarding(): OnboardingApi {
  return useContext(OnboardingContext) ?? { open: false, start: () => {} };
}
