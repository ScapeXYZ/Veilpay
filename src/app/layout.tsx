import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "VeilPay",
  description: "Policy-guarded shielded Zcash payments for AI agents, verified by the merchant.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
