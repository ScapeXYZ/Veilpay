import clsx from "clsx";

/** Closed seal: shielded. Drawn here, no icon library added. */
export function SealGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden className={className}>
      <circle cx="6" cy="6" r="5" fill="currentColor" />
      <path d="M3.6 6.1 5.3 7.7 8.4 4.5" fill="none" stroke="#0b1012" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Open ring: transparent, visible on chain. */
export function OpenGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden className={className}>
      <path d="M6 1.2a4.8 4.8 0 1 1-4.5 3.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export type AddressKind = "shielded" | "transparent";

/** Plain-language fact per kind. Factual only: no "untraceable", no "100% private". */
export const ADDRESS_FACT: Record<AddressKind, string> = {
  shielded: "Shielded: amount and parties are not visible on chain.",
  transparent: "Transparent: anyone can see this address's activity.",
};

/**
 * The Sealed Ledger signature. Shielded = filled surface, shield-ink left edge, closed seal.
 * Transparent = outline only in sand, open ring, "visible on chain". Never the same colour,
 * always labelled in words.
 */
export function AddressChip({ kind, value, className, testId }: { kind: AddressKind; value?: string; className?: string; testId?: string }) {
  const sealed = kind === "shielded";
  return (
    <span
      data-testid={testId ?? `chip-${kind}`}
      data-kind={kind}
      className={clsx(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs",
        sealed ? "border-l-2 border-shield bg-zinc-800 text-shield" : "border border-open/70 text-open",
        className,
      )}
    >
      {sealed ? <SealGlyph className="shrink-0" /> : <OpenGlyph className="shrink-0" />}
      <span className="shrink-0 font-medium">{sealed ? "shielded" : "transparent, visible on chain"}</span>
      {value && <span className="truncate font-mono text-zinc-200" title={value}>{value}</span>}
    </span>
  );
}
