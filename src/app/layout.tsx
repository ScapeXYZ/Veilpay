import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

// Self-hosted, SIL OFL 1.1 (see src/app/fonts/README.md). No request to any font CDN at build or run time.
const geist = localFont({ src: "./fonts/Geist-Variable.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });
const newsreader = localFont({ src: "./fonts/Newsreader-Variable.woff2", variable: "--font-newsreader", weight: "200 800", display: "swap" });

export const metadata: Metadata = {
  title: "VeilPay",
  description: "Give AI agents permission to pay, not permission to overspend. Policy-guarded shielded Zcash payments, verified by the merchant.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${newsreader.variable}`}>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
