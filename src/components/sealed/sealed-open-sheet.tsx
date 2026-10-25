import { ADDRESS_FACT, AddressChip, OpenGlyph, SealGlyph } from "./address-chip";

/**
 * Privacy page "what's sealed / what's open" sheet, in the same chip language used
 * everywhere else. Factual only, and says what shielding does not hide.
 */
export function SealedOpenSheet() {
  return (
    <section data-testid="sealed-open-sheet" aria-labelledby="sealed-open-title" className="rounded-[14px] border border-line bg-zinc-900">
      <header className="border-b border-line px-5 py-4">
        <h2 id="sealed-open-title" className="font-display text-[1.375rem] text-zinc-50">What&apos;s sealed, what&apos;s open</h2>
        <p className="mt-1 text-sm text-zinc-400">How Zcash treats a payment by design. This sheet explains the design; it does not check the network.</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="border-b border-line p-5 md:border-b-0 md:border-r" data-testid="sheet-sealed">
          <div className="flex items-center gap-2 text-sm font-medium text-shield"><SealGlyph /> Sealed, between shielded addresses</div>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-zinc-300">
            <li>The amount</li>
            <li>Who paid and who was paid</li>
            <li>The memo attached to the payment</li>
          </ul>
          <p className="mt-3 text-xs text-zinc-400"><AddressChip kind="shielded" testId="privacy-chip-shielded" /> {ADDRESS_FACT.shielded}</p>
        </div>
        <div className="p-5" data-testid="sheet-open">
          <div className="flex items-center gap-2 text-sm font-medium text-open"><OpenGlyph /> Open to anyone</div>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-zinc-300">
            <li>That a transaction happened, when, and its fee</li>
            <li>Everything about a transparent address: amounts, counterparties, history</li>
            <li>Anything you tell a merchant yourself</li>
          </ul>
          <p className="mt-3 text-xs text-zinc-400"><AddressChip kind="transparent" testId="privacy-chip-transparent" /> {ADDRESS_FACT.transparent}</p>
        </div>
      </div>
      <footer className="border-t border-line px-5 py-3 text-xs text-zinc-400">
        Shielded payments hide amounts and parties on chain. They don&apos;t hide that you use VeilPay, or what you tell a merchant.
      </footer>
    </section>
  );
}
