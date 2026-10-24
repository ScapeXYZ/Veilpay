"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * One plain-language glossary. Screens use everyday words; the technical term and its meaning live
 * here and surface only as a tooltip (hover or keyboard focus) and on the Help page.
 */
export const GLOSSARY = {
  shielded: { term: "Shielded payment", def: "A Zcash payment whose amount, sender, receiver and memo are encrypted on the public network." },
  confirmations: { term: "Confirmations", def: "New blocks added after the payment's block. More confirmations means the payment is harder to undo." },
  reorg: { term: "Chain reorganization (reorg)", def: "The network briefly replaces recent blocks. A payment can move back from confirmed to waiting until it is included again." },
  reserved: { term: "Reserved", def: "Budget set aside for an approved request that has not been sent yet. It is not spent." },
  operator: { term: "Operator", def: "The person running the VeilPay wallet. On test network they send staged payments from a separate terminal; this app never signs or sends." },
  viewingKey: { term: "Viewing key", def: "A key that can read incoming payments for one wallet but cannot spend. The merchant uses it to check its own receipts." },
  txid: { term: "Transaction ID (txid)", def: "The public identifier of a network transaction. It does not reveal the amount or the parties of a shielded payment." },
  testnet: { term: "Test network (testnet)", def: "A Zcash network for testing. Its coins have no value." },
  mainnet: { term: "Main network (mainnet)", def: "The real Zcash network. VeilPay only observes it: sending is disabled." },
  zip321: { term: "Payment request (ZIP-321)", def: "The standard Zcash payment link a wallet can open, scan as a QR code, or copy." },
  safetyCheck: { term: "Reconciler", def: "A background check that re-reads unfinished sends from the wallet. It never resends anything." },
  outcomeUnknown: { term: "Outcome unknown", def: "The send may or may not have reached the network. VeilPay will not resend it; an operator resolves it." },
} as const;

export type TermKey = keyof typeof GLOSSARY;

/**
 * Inline term with a tooltip on hover or keyboard focus. Closed tooltips are display:none, so they
 * never widen the page (a visibility:hidden box still counts for mobile layout width); an open one
 * is measured and nudged back inside the screen.
 */
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const id = useId();
  const g = GLOSSARY[k];
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const tip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open || !tip.current) return;
    const r = tip.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const over = r.right - shift - (vw - 8);
    const under = 8 - (r.left - shift);
    setShift(over > 0 ? -over : under > 0 ? under : 0);
    // shift is intentionally read, not a dependency: measure once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const show = () => setOpen(true);
  const hide = () => { setOpen(false); setShift(0); };
  return (
    <span className="relative inline" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <span tabIndex={0} aria-describedby={id} onKeyDown={(e) => e.key === "Escape" && hide()}
        className="cursor-help underline decoration-zinc-500 decoration-dotted underline-offset-[3px] focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-accent-400" data-testid={`term-${k}`}>
        {children ?? g.term}
      </span>
      <span role="tooltip" id={id} ref={tip} hidden={!open} style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
        className="pointer-events-none absolute bottom-full left-0 z-[90] mb-1.5 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-zinc-200 shadow-lg">
        <b className="block text-zinc-50">{g.term}</b>
        {g.def}
      </span>
    </span>
  );
}
