/** Guided two-minute demo: the order the judges should see it in. Pure navigation, no data. */
export const DEMO_STEPS = [
  { href: "/", ctx: "customer", title: "Blocked agent", say: "The agent asks for 0.75 ZEC. The backend blocks it: CAP_EXCEEDED, exact limit shown." },
  { href: "/policy", ctx: "customer", title: "The owner's policy", say: "Cap, budget, allowed merchants. Enforced server-side, re-checked at execute." },
  { href: "/", ctx: "customer", title: "Approved, then sent", say: "A request inside policy is reserved, then sent once, shielded." },
  { href: "/payments", ctx: "customer", title: "Honest timeline", say: "Confirmations, reorgs and unresolved sends shown as they are. Nothing resent." },
  { href: "/merchant", ctx: "merchant", title: "Merchant verifies", say: "The merchant checks this invoice with its own viewing key. No customer key." },
  { href: "/privacy", ctx: "customer", title: "What stays hidden", say: "Amount, sender, recipient and memo never hit the public chain." },
] as const;
