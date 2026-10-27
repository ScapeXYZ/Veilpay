import clsx from "clsx";

/**
 * Local, decorative VeilPay identity artwork. It deliberately contains no
 * wallet or network data, and it is rendered inline so the product has no
 * image-hosting or third-party tracking dependency.
 */
export function VeilPayMark({ className, size = 48 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 96 108" width={size} height={Math.round(size * 1.125)} className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="veilpay-shield" x1="18" y1="10" x2="78" y2="94" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7cf5ff" />
          <stop offset="0.44" stopColor="#36cde9" />
          <stop offset="1" stopColor="#6d49d8" />
        </linearGradient>
        <linearGradient id="veilpay-facet" x1="35" y1="22" x2="70" y2="85" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d7fcff" stopOpacity=".82" />
          <stop offset="1" stopColor="#4b239e" stopOpacity=".28" />
        </linearGradient>
        <filter id="veilpay-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d="M48 3 88 18v30c0 25.8-15.3 43.7-40 56.8C23.3 91.7 8 73.8 8 48V18L48 3Z" fill="#071422" stroke="#6ff2ff" strokeWidth="2" />
      <path d="M48 8 82 21v27c0 21.2-12.3 37-34 49.1C26.3 85 14 69.2 14 48V21L48 8Z" fill="url(#veilpay-shield)" />
      <path d="m48 8 34 13-34 18L14 21 48 8Z" fill="#b5fbff" fillOpacity=".45" />
      <path d="m48 39 34-18v27c0 21.2-12.3 37-34 49.1V39Z" fill="url(#veilpay-facet)" />
      <path d="M48 18 71 27 48 78 25 27l23-9Z" fill="#071c35" fillOpacity=".42" />
      <path d="M48 23c2.7 12.7 7.3 17.3 20 20-12.7 2.7-17.3 7.3-20 20-2.7-12.7-7.3-17.3-20-20 12.7-2.7 17.3-7.3 20-20Z" fill="#f5feff" filter="url(#veilpay-glow)" />
      <path d="M48 29c1.7 8 4.8 11.1 12.8 12.8-8 1.7-11.1 4.8-12.8 12.8-1.7-8-4.8-11.1-12.8-12.8 8-1.7 11.1-4.8 12.8-12.8Z" fill="#64f3ff" />
    </svg>
  );
}

export function VeilPayBrand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={clsx("flex items-center", compact ? "gap-2" : "flex-col gap-1.5 text-center", className)}>
      <VeilPayMark size={compact ? 31 : 66} className="shrink-0 drop-shadow-[0_0_16px_rgba(77,231,255,.28)]" />
      <span className={clsx("flex flex-col", compact ? "items-start" : "items-center")}>
        <span className={clsx("font-semibold leading-none tracking-[-0.055em]", compact ? "text-lg" : "text-[25px]")}>
          <span className="text-zinc-50">Veil</span><span className="text-accent-300">Pay</span>
        </span>
        {!compact && <span className="mt-1 text-[9px] font-semibold tracking-[0.2em] text-accent-200/80">SAFE SPENDING<br />FOR AI AGENTS</span>}
      </span>
    </span>
  );
}
