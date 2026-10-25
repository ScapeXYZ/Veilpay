/**
 * Simple business onboarding draft. LOCAL ONLY: saved in this browser's
 * localStorage, clearly labelled as not registered. There is no API call and
 * no payout registration. Wallet data (account ids, addresses, balances) is
 * deliberately NOT stored, matching the Noir Wallet card's promise that wallet
 * data never reaches browser storage; the payout account is re-picked after
 * reconnecting.
 */
import { readUiPref, writeUiPref } from "@/lib/ui-prefs";

export const BUSINESS_DRAFT_KEY = "veilpay.businessDraft.v1" as const;

export const BUSINESS_CATEGORIES = ["Online store", "Services", "Digital goods", "Other"] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

export type BusinessDraft = {
  v: 1;
  businessName: string;
  category: BusinessCategory;
  savedAt: string;
  /** Always false: nothing is registered with VeilPay from this flow. */
  registered: false;
};

export const BUSINESS_NAME_MAX = 80;

export function validateBusinessName(name: string): string | null {
  const t = name.trim();
  if (!t) return "Enter your business name.";
  if (t.length > BUSINESS_NAME_MAX) return `Keep it under ${BUSINESS_NAME_MAX} characters.`;
  return null;
}

/** Storage goes through ui-prefs, the app's single allow-listed Web Storage gateway. */
function read(): string | null {
  try {
    return typeof window === "undefined" ? null : readUiPref("local", BUSINESS_DRAFT_KEY);
  } catch {
    return null;
  }
}

export function loadBusinessDraft(): BusinessDraft | null {
  try {
    const raw = read();
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<BusinessDraft>;
    if (d.v !== 1 || typeof d.businessName !== "string" || validateBusinessName(d.businessName)) return null;
    if (!BUSINESS_CATEGORIES.includes(d.category as BusinessCategory) || typeof d.savedAt !== "string") return null;
    return { v: 1, businessName: d.businessName.trim(), category: d.category as BusinessCategory, savedAt: d.savedAt, registered: false };
  } catch {
    return null;
  }
}

export function saveBusinessDraft(input: { businessName: string; category: BusinessCategory }, now = new Date()): BusinessDraft {
  const err = validateBusinessName(input.businessName);
  if (err) throw new Error(err);
  // Only these five fields are written. No wallet data.
  const draft: BusinessDraft = { v: 1, businessName: input.businessName.trim(), category: input.category, savedAt: now.toISOString(), registered: false };
  writeUiPref("local", BUSINESS_DRAFT_KEY, JSON.stringify(draft));
  return draft;
}

export function clearBusinessDraft(): void {
  writeUiPref("local", BUSINESS_DRAFT_KEY, null);
}
